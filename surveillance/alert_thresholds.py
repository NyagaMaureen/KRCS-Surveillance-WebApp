import re

import frappe
from frappe import _

from surveillance.capabilities import require_capability

DOCTYPE = "Alert Threshold Config"
SETTINGS = "Alert Threshold Settings"
CAPABILITY = "manage_alert_thresholds"
CATEGORIES = {"human": "Human", "animal": "Animal"}

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


def _row(d):
	return {
		"key": d.disease_key,
		"name": d.disease_name,
		"category": (d.category or "Human").lower(),
		"note": d.note or "",
		"threshold": d.threshold,
		"sort_order": d.sort_order,
	}


# ---------- API ----------

@frappe.whitelist()
def get_alert_thresholds():
	"""Any logged-in user can read thresholds."""
	rows = frappe.get_all(
		DOCTYPE,
		filters={"is_active": 1},
		fields=["disease_key", "disease_name", "category", "note", "threshold", "sort_order"],
		order_by="sort_order asc, creation asc",
	)
	multiplier = frappe.db.get_single_value(SETTINGS, "outbreak_multiplier") or 2.5
	return {
		"diseases": [_row(frappe._dict(r)) for r in rows],
		"outbreak_multiplier": multiplier,
	}


@frappe.whitelist(methods=["POST"])
def add_disease(disease_name, threshold=1, category="human", note=""):
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

	doc = frappe.get_doc({
		"doctype": DOCTYPE,
		"disease_key": key,
		"disease_name": disease_name,
		"category": cat,
		"note": note or "",
		"threshold": _valid_threshold(threshold),
		"is_active": 1,
		"sort_order": max_order + 1,
	}).insert(ignore_permissions=True)
	return _row(doc)


@frappe.whitelist(methods=["POST"])
def save_alert_thresholds(thresholds, outbreak_multiplier=None):
	"""thresholds: {"awd-cholera": 1, "measles": 2, ...}"""
	require_capability(CAPABILITY)

	if isinstance(thresholds, str):
		thresholds = frappe.parse_json(thresholds)

	for key, value in (thresholds or {}).items():
		if not frappe.db.exists(DOCTYPE, key):
			frappe.throw(_("Unknown disease: {0}").format(key))
		new_value = _valid_threshold(value)
		doc = frappe.get_doc(DOCTYPE, key)
		if doc.threshold != new_value:
			doc.threshold = new_value
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
	"""Safe to run many times: adds missing diseases at threshold 1, never overwrites edits."""
	for i, (key, name, category, note) in enumerate(DEFAULT_DISEASES, start=1):
		if not frappe.db.exists(DOCTYPE, key):
			frappe.get_doc({
				"doctype": DOCTYPE,
				"disease_key": key,
				"disease_name": name,
				"category": category,
				"note": note,
				"threshold": 1,
				"is_active": 1,
				"sort_order": i,
			}).insert(ignore_permissions=True)

	if not frappe.db.get_single_value(SETTINGS, "outbreak_multiplier"):
		frappe.db.set_single_value(SETTINGS, "outbreak_multiplier", 2.5)

	frappe.db.commit()