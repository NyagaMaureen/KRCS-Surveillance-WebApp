import re

import frappe
from frappe import _

from surveillance.capabilities import require_capability

DOCTYPE = "Alert Threshold Config"
SETTINGS = "Alert Threshold Settings"
CAPABILITY = "manage_alert_thresholds"
CATEGORIES = {"human": "Human", "animal": "Animal"}
PRIORITIES = ("Critical", "High", "Standard")

# How serious one suspected case is. Used with the engine's signal strength to set alert severity.
# Applied on migrate only to diseases whose priority is still blank, so KRCS changes are kept.
DEFAULT_PRIORITY = {
	"afp-polio": "Critical",
	"vhf": "Critical",
	"bvd": "Critical",
	"yellow-fever": "Critical",
	"mpox": "Critical",
	"unusual-death-people": "Critical",
	"unusual-illness-people": "Critical",
	"unusual-illness-animals": "Critical",
	"awd-cholera": "High",
	"measles": "High",
	"meningococcal-meningitis": "High",
	"anthrax": "High",
	"rift-valley-fever": "High",
	"covid-sari": "High",
	
}  # anything not listed is Standard

# key, name, category, note — keys match the frontend exactly
DEFAULT_DISEASES = [
	("unusual-illness-people", "Unusual Illness of People", "Human", ""),
	("covid-sari", "Suspected COVID-19 / SARI", "Human", ""),
	("unusual-death-people", "Unusual Death of People", "Human", "immediate"),
	("meningococcal-meningitis", "Suspected Meningococcal Meningitis", "Human", "immediate"),
	("yellow-fever", "Suspected Yellow Fever", "Human", "IHR notifiable"),
	("afp-polio", "Suspected Acute Flaccid Paralysis (AFP) / Poliomyelitis", "Human", "IHR notifiable"),
	("awd-cholera", "Acute Watery Diarrhoea (AWD) / Cholera", "Human", "immediate"),
	("mpox", "Suspected Mpox", "Human", ""),
	("measles", "Suspected Measles", "Human", ""),
	("vhf", "Suspected Viral Haemorrhagic Fever (Ebola/Marburg/Lassa/CCHF)", "Human", "immediate, IHR notifiable"),
	("bvd", "Suspected Bundibugyo Virus Disease (BVD)", "Human", "immediate, highest priority"),
	("rift-valley-fever", "Suspected Rift Valley Fever", "Animal", "immediate"),
	("anthrax", "Suspected Anthrax", "Animal", "immediate"),
	("rabies", "Suspected Rabies", "Animal", ""),
	("unusual-illness-animals", "Unusual Illness of Animals", "Animal", ""),
	("unusual-death-animals", "Unusual Death of Animals", "Animal", ""),
]


# ---------- helpers ----------

def _slugify(name):
	return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _valid_threshold(value):
	try:
		n = int(value)
	except (TypeError, ValueError):
		frappe.throw(_("Threshold must be a whole number"))
	if n < 1:
		frappe.throw(_("Threshold must be at least 1"))
	return n


def _valid_multiplier(value):
	try:
		m = float(value)
	except (TypeError, ValueError):
		frappe.throw(_("Outbreak multiplier must be a number"))
	if m < 1:
		frappe.throw(_("Outbreak multiplier must be at least 1"))
	return m


def _valid_priority(value):
	value = (value or "Standard").strip().title()
	if value not in PRIORITIES:
		frappe.throw(_("Priority must be Critical, High or Standard"))
	return value


def _row(d):
	return {
		"key": d.disease_key,
		"name": d.disease_name,
		"category": (d.category or "Human").lower(),
		"note": d.note or "",
		"threshold": d.threshold,
		"priority": d.get("priority") or "Standard",
		"sort_order": d.sort_order,
		"icd11_code": d.get("icd11_code") or "",
		"icd11_title": d.get("icd11_title") or "",
		"icd11_uri": d.get("icd11_uri") or "",
	}


# ---------- API ----------

@frappe.whitelist()
def get_alert_thresholds():
	"""Any logged-in user can read thresholds."""
	rows = frappe.get_all(
		DOCTYPE,
		filters={"is_active": 1},
		fields=["disease_key", "disease_name", "category", "note", "threshold", "priority", "sort_order",
		        "icd11_code", "icd11_title", "icd11_uri"],
		order_by="sort_order asc, creation asc",
	)
	multiplier = frappe.db.get_single_value(SETTINGS, "outbreak_multiplier") or 2.5
	return {
		"diseases": [_row(frappe._dict(r)) for r in rows],
		"outbreak_multiplier": multiplier,
	}

@frappe.whitelist(methods=["POST"])
def add_disease(disease_name, threshold=1, category="human", note="", icd11_code="", icd11_title="", icd11_uri="", priority="Standard"):
	require_capability(CAPABILITY)

	disease_name = (disease_name or "").strip()
	if not disease_name:
		frappe.throw(_("Disease name is required"))

	key = _slugify(disease_name)
	if frappe.db.exists(DOCTYPE, key):
		frappe.throw(_("{0} already exists").format(disease_name), frappe.DuplicateEntryError)

	cat = CATEGORIES.get((category or "human").lower())
	if not cat:
		frappe.throw(_("Category must be human or animal"))

	max_order = frappe.db.sql(f"select coalesce(max(sort_order), 0) from `tab{DOCTYPE}`")[0][0]

	code = (icd11_code or "").strip()
	doc = frappe.get_doc({
		"doctype": DOCTYPE,
		"disease_key": key,
		"disease_name": disease_name,
		"category": cat,
		"note": note or "",
		"threshold": _valid_threshold(threshold),
		"priority": _valid_priority(priority),
		"is_active": 1,
		"sort_order": max_order + 1,
		"icd11_code": code,
		"icd11_title": (icd11_title or "").strip() if code else "",
		"icd11_uri": (icd11_uri or "").strip() if code else "",
	}).insert(ignore_permissions=True)
	return _row(doc)


@frappe.whitelist(methods=["POST"])
def save_alert_thresholds(thresholds=None, outbreak_multiplier=None, priorities=None):
	"""thresholds: {"awd-cholera": 1, ...}   priorities: {"awd-cholera": "High", ...} (both optional)"""
	require_capability(CAPABILITY)

	thresholds = frappe.parse_json(thresholds) if isinstance(thresholds, str) else (thresholds or {})
	priorities = frappe.parse_json(priorities) if isinstance(priorities, str) else (priorities or {})

	for key in set(thresholds) | set(priorities):
		if not frappe.db.exists(DOCTYPE, key):
			frappe.throw(_("Unknown disease: {0}").format(key))
		doc = frappe.get_doc(DOCTYPE, key)
		changed = False
		if key in thresholds:
			new_value = _valid_threshold(thresholds[key])
			if doc.threshold != new_value:
				doc.threshold, changed = new_value, True
		if key in priorities:
			new_priority = _valid_priority(priorities[key])
			if doc.priority != new_priority:
				doc.priority, changed = new_priority, True
		if changed:
			doc.save(ignore_permissions=True)  # still validated + version-tracked

	if outbreak_multiplier is not None:
		settings = frappe.get_single(SETTINGS)
		new_mult = _valid_multiplier(outbreak_multiplier)
		if settings.outbreak_multiplier != new_mult:
			settings.outbreak_multiplier = new_mult
			settings.save(ignore_permissions=True)

	return get_alert_thresholds()


# ---------- seed ----------

def seed_defaults():
	"""Safe to run many times: adds missing diseases at threshold 1 and fills blank priorities.
	Never overwrites a threshold or priority someone has set."""
	for i, (key, name, category, note) in enumerate(DEFAULT_DISEASES, start=1):
		if not frappe.db.exists(DOCTYPE, key):
			frappe.get_doc({
				"doctype": DOCTYPE,
				"disease_key": key,
				"disease_name": name,
				"category": category,
				"note": note,
				"threshold": 1,
				"priority": DEFAULT_PRIORITY.get(key, "Standard"),
				"is_active": 1,
				"sort_order": i,
			}).insert(ignore_permissions=True)

	# "not set" matches both empty and NULL
	for key in frappe.get_all(DOCTYPE, filters={"priority": ["is", "not set"]}, pluck="name"):
		frappe.db.set_value(DOCTYPE, key, "priority", DEFAULT_PRIORITY.get(key, "Standard"), update_modified=False)

	if not frappe.db.get_single_value(SETTINGS, "outbreak_multiplier"):
		frappe.db.set_single_value(SETTINGS, "outbreak_multiplier", 2.5)

	frappe.db.commit()