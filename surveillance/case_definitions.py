"""Suspected-disease classification from MOH IDSR community case definitions.

Definitions live in the Case Definition DocType so KRCS can edit them without code.
This module seeds the defaults (after_migrate, only missing ones) and classifies
Case Reports from their symptoms, age group and animal exposure.

Source: MOH "Standard Case Definitions for Priority Diseases in Kenya" (IDSR),
lay/community definitions for CHPs. Mpox is provisional (WHO) until KRCS confirms.
"""
import frappe
from frappe.utils import format_date, get_fullname, today
from surveillance.capabilities import has_capability, require_capability

DOCTYPE = "Case Definition"
VERIFY_CAPABILITY = "verify_suspected_disease"
CHILD_FIELDS = ("required_symptoms", "any_of_symptoms", "excluded_symptoms")

# Kenya IDSR edge cases approved by KRCS (Allan), Oct 2026:
#  - Cholera: 5 years or older normally; during a cholera outbreak in the area, 2 years or older.
#    The form's age groups are Under 1 / 1-4 / 5-14 / 15+, so in an outbreak "1-4 years" is accepted
#    (it cannot separate 1-year-olds); the reason text says so.
#  - New: diarrhoea with dehydration in children under 5 (Under 1, 1-4 years), with its own protocol.
#  - No definition matches: reporters get the unusual-event protocol's advice (protocols.get_reporter_advice).
CHOLERA_TEXT = ("Any person 5 years or older passing lots of watery diarrhoea. "
	"During a cholera outbreak in the area: any person 2 years or older.")
U5_KEY = "diarrhoea-dehydration-u5"
U5_NAME = "Diarrhoea with dehydration (under 5)"
U5_TEXT = "Any child under 5 years with diarrhoea (3 or more loose stools a day) and signs of dehydration."
OUTBREAK_AGES = {"awd-cholera": ["1-4 years"]}   # extra age groups accepted while the disease has an outbreak nearby

# Symptom names are matched case-insensitively; alternatives cover renames.
FEVER = ["Fever (hot body)", "High Fever", "Fever"]

DEFAULT_DEFINITIONS = [
	{
		"disease": "afp-polio", "match_order": 1,
		"lay_definition": "Any child under 15 years with sudden onset of weakness of the limb(s) not due to injury.",
		"required": [["Sudden Weakness of Arm or Leg"]],
		"ages": ["Under 1", "1-4 years", "5-14 years"],
	},
	{
		"disease": "vhf", "match_order": 2,
		"lay_definition": "Any person with fever and bleeding, or who died with the same signs.",
		"required": [FEVER, ["Unexplained Bleeding"]],
	},
	{
		"disease": "mpox", "match_order": 3, "source": "Provisional (WHO)",
		"lay_definition": "PROVISIONAL - awaiting MOH lay definition. Unexplained skin sores/blister-like rash with fever, swollen glands, headache or body pains.",
		"required": [["Skin Lesions"]],
		"any_of": [FEVER, ["Swollen Lymph Nodes"], ["Headache"], ["Severe Body or Muscle Pain"]], "min_any_of": 1,
	},
	{
		"disease": "yellow-fever", "match_order": 4,
		"lay_definition": "Fever followed by yellow eyes/skin, sometimes with bleeding.",
		"required": [FEVER, ["Yellow Eyes or Skin"]],
	},
	{
		"disease": "meningococcal-meningitis", "match_order": 5,
		"lay_definition": "Sudden high fever with stiff neck, or (infants under 1) a bulging soft spot, or confusion.",
		"required": [FEVER],
		"any_of": [["Stiff Neck"], ["Bulging Soft Spot (infant)"], ["Confusion or Unconsciousness"]], "min_any_of": 1,
	},
	{
		"disease": "awd-cholera", "match_order": 6,
		"lay_definition": CHOLERA_TEXT,
		"required": [["Diarrhea", "Diarrhoea"]],
		"any_of": [["Vomiting"], ["Dehydration"]],
		"excluded": [["Bloody Stool"]],
		"ages": ["5-14 years", "15+ years"],
	},
	{
		"disease": U5_KEY, "match_order": 20,
		"lay_definition": U5_TEXT,
		"required": [["Diarrhea", "Diarrhoea"], ["Dehydration"]],
		"excluded": [["Bloody Stool"]],
		"ages": ["Under 1", "1-4 years"],
	},
	{
		"disease": "measles", "match_order": 7,
		"lay_definition": "Any person with hotness of the body and a rash.",
		"required": [FEVER, ["Rash"]],
		"any_of": [["Red Eyes"], ["Cough"], ["Runny Nose"]],
	},
	{
		"disease": "anthrax", "match_order": 8,
		"lay_definition": "A painless black-centred skin sore with swelling in someone who handled a sick or dead animal or its hide/meat.",
		"required": [["Black Skin Sore"]],
		"exposure": "Handled sick or dead animal",
	},
	{
		"disease": "rift-valley-fever", "match_order": 9,
		"lay_definition": "Fever with severe body pains in someone around sick/aborting livestock, especially with bleeding or yellow eyes.",
		"required": [FEVER],
		"any_of": [["Severe Body or Muscle Pain"], ["Unexplained Bleeding"], ["Yellow Eyes or Skin"]], "min_any_of": 1,
		"exposure": "Handled sick or dead animal",
	},
	{
		"disease": "covid-sari", "match_order": 10,
		"lay_definition": "Severe cough with fever and fast or difficult breathing (5 years and older).",
		"required": [FEVER, ["Cough"], ["Difficulty Breathing"]],
		"ages": ["5-14 years", "15+ years"],
	},
	{
		"disease": "rabies", "match_order": 11,
		"lay_definition": "Any bite or scratch from a dog or other animal.",
		"exposure": "Bite or scratch",
	},
]


def _norm(text):
	"""Lowercase, trim, and treat en/em dashes as hyphens ('1–4 years' == '1-4 years')."""
	return (text or "").replace("–", "-").replace("—", "-").strip().lower()


# ---------- seeding ----------

def seed_case_definitions():
	"""after_migrate: create default definitions that don't exist yet. Never overwrites KRCS edits."""
	symptoms = {_norm(s.symptom_name): s.name for s in frappe.get_all("Symptom", fields=["name", "symptom_name"])}

	def resolve(groups, label):
		ids = []
		for alternatives in groups or []:
			sid = next((symptoms[_norm(a)] for a in alternatives if _norm(a) in symptoms), None)
			if not sid:
				return None, f"missing symptom '{alternatives[0]}' ({label})"
			ids.append(sid)
		return ids, None

	created = []
	for d in DEFAULT_DEFINITIONS:
		if frappe.db.exists(DOCTYPE, d["disease"]) or not frappe.db.exists("Alert Threshold Config", d["disease"]):
			continue
		req, err1 = resolve(d.get("required"), "required")
		anyof, err2 = resolve(d.get("any_of"), "any of")
		excl, err3 = resolve(d.get("excluded"), "excluded")
		err = err1 or err2 or err3
		if err:
			print(f"Case Definition {d['disease']} skipped: {err}")
			continue
		frappe.get_doc({
			"doctype": DOCTYPE,
			"disease": d["disease"],
			"enabled": 1,
			"match_order": d["match_order"],
			"source": d.get("source", "MOH IDSR"),
			"lay_definition": d["lay_definition"],
			"required_symptoms": [{"symptom": s} for s in req],
			"any_of_symptoms": [{"symptom": s} for s in anyof],
			"min_any_of": d.get("min_any_of", 0),
			"excluded_symptoms": [{"symptom": s} for s in excl],
			"allowed_age_groups": "\n".join(d.get("ages", [])),
			"required_exposure": d.get("exposure", ""),
		}).insert(ignore_permissions=True)
		created.append(d["disease"])
	if created:
		frappe.db.commit()
		print("Case Definitions created:", ", ".join(created))


# ---------- classification ----------

def get_definitions():
	defs = frappe.get_all(DOCTYPE, filters={"enabled": 1},
		fields=["name", "disease", "match_order", "min_any_of", "allowed_age_groups",
			"required_exposure", "lay_definition", "source"],
		order_by="match_order asc")
	if not defs:
		return []
	rows = frappe.get_all("Case Definition Symptom",
		filters={"parenttype": DOCTYPE, "parent": ["in", [d.name for d in defs]]},
		fields=["parent", "parentfield", "symptom"])
	for d in defs:
		for f in CHILD_FIELDS:
			d[f] = {r.symptom for r in rows if r.parent == d.name and r.parentfield == f}
		d["ages"] = {_norm(a) for a in (d.allowed_age_groups or "").splitlines() if a.strip()}
	return defs


def matches(defn, symptoms, age_group=None, animal_exposure=None):
	"""True if a report meets one definition. Unknown age never excludes (sensitivity first)."""
	if not (defn["required_symptoms"] or defn["any_of_symptoms"] or defn.get("required_exposure")):
		return False
	if not defn["required_symptoms"] <= symptoms:
		return False
	if defn["excluded_symptoms"] & symptoms:
		return False
	if (defn.get("min_any_of") or 0) > len(defn["any_of_symptoms"] & symptoms):
		return False
	if defn["ages"] and age_group and _norm(age_group) not in defn["ages"]:
		return False
	exposure = defn.get("required_exposure")
	if exposure:
		have = _norm(animal_exposure)
		if not have or have == "none":
			return False
		if exposure != "Any animal exposure" and have != _norm(exposure):
			return False
	return True


def classify_detailed(symptoms, age_group=None, animal_exposure=None, definitions=None):
	"""Return the matching definitions, best (lowest Match Order) first."""
	symptoms = set(symptoms or [])
	defs = definitions if definitions is not None else get_definitions()
	return [d for d in defs if matches(d, symptoms, age_group, animal_exposure)]


def classify(symptoms, age_group=None, animal_exposure=None, definitions=None):
	"""Return matching disease keys, best first."""
	return [d["disease"] for d in classify_detailed(symptoms, age_group, animal_exposure, definitions)]


def _labels():
	return {
		"disease": dict(frappe.get_all("Alert Threshold Config", fields=["name", "disease_name"], as_list=True)),
		"symptom": {s.name: (s.symptom_name or s.name).strip() for s in frappe.get_all("Symptom", fields=["name", "symptom_name"])},
	}


def explain(defn, symptoms, age_group, animal_exposure, labels):
	"""Plain-language evidence for one matching definition."""
	sym = lambda ids: " + ".join(sorted(labels["symptom"].get(i, i) for i in ids))
	symptoms = set(symptoms or [])
	evidence = []
	if defn["required_symptoms"]:
		evidence.append(sym(defn["required_symptoms"]))
	supporting = defn["any_of_symptoms"] & symptoms
	if supporting:
		evidence.append("supporting: " + sym(supporting))
	if defn.get("required_exposure"):
		evidence.append(f"animal exposure: {animal_exposure}")
	if defn["ages"]:
		evidence.append(f"age group: {age_group}" if age_group else "age not recorded, so not used to rule out")
	name = labels["disease"].get(defn["disease"], defn["disease"])
	label = name if str(name).lower().startswith("suspected") else f"Suspected {name}"
	text = f"{label}. Matched: {'; '.join(evidence)}."
	if defn.get("lay_definition"):
		text += f' {defn.get("source") or "MOH IDSR"} definition: "{defn["lay_definition"]}"'
	return text


def apply_to_case_report(doc):
	"""Called from CaseReport.validate. Officer/Model choices are kept; rules fill the rest.

	classification_reason line 1 = the decision, line 2 (when an officer decided) = what the rules say.
	"""
	before = doc.get_doc_before_save()
	previous = before.suspected_disease if before else None
	changed_by_person = (doc.suspected_disease or None) != (previous or None) and (before or doc.classified_by != "Rules")
	if changed_by_person:
		if not has_capability(VERIFY_CAPABILITY):
			frappe.throw("Only users allowed to verify the suspected disease can change it.", frappe.PermissionError)
		doc.classified_by = "Officer" if doc.suspected_disease else ""

	symptoms = [r.symptom for r in doc.symptoms if r.symptom]
	age, exposure = doc.get("age_group"), doc.get("animal_exposure")
	defs, widened = with_outbreak_ages(get_definitions(), doc.get("sub_county"))
	found = classify_detailed(symptoms, age, exposure, defs)
	labels = _labels()
	rules_view = explain(found[0], symptoms, age, exposure, labels) if found else "No case definition matched the reported signs."
	if found and found[0]["disease"] in widened and age and _norm(age) in {_norm(a) for a in OUTBREAK_AGES[found[0]["disease"]]}:
		rules_view += " (outbreak definition: 2 years or older, because of an active outbreak in this area)"

	if doc.classified_by in ("Officer", "Model"):
		if changed_by_person:
			who = get_fullname(frappe.session.user)
			name = labels["disease"].get(doc.suspected_disease, doc.suspected_disease)
			decision = f"Set to {name} by {who} on {format_date(today())}."
		else:
			decision = (doc.classification_reason or "").split("\n")[0] or "Set by an officer."
		doc.classification_reason = f"{decision}\nRules view: {rules_view}"
	else:
		doc.suspected_disease = found[0]["disease"] if found else None
		doc.classified_by = "Rules" if found else ""
		doc.classification_reason = rules_view

	others = [d["disease"] for d in found if d["disease"] != doc.suspected_disease]
	doc.also_consistent_with = ", ".join(labels["disease"].get(k, k) for k in others)


# ---------- API for the frontend ----------

@frappe.whitelist()
def classify_preview(symptoms=None, age_group=None, animal_exposure=None):
	"""Live hint for the report form: which diseases the reported signs match, and why."""
	symptoms = frappe.parse_json(symptoms) if isinstance(symptoms, str) else (symptoms or [])
	labels = _labels()
	return [
		{"key": d["disease"], "name": labels["disease"].get(d["disease"], d["disease"]),
		 "reason": explain(d, symptoms, age_group, animal_exposure, labels)}
		for d in classify_detailed(symptoms, age_group, animal_exposure)
	]


@frappe.whitelist()
def get_disease_options():
	"""Active priority diseases for the officer's 'Change suspected disease' dropdown."""
	rows = frappe.get_all("Alert Threshold Config", filters={"is_active": 1},
		fields=["name", "disease_name", "category"], order_by="sort_order asc")
	return [{"key": r.name, "name": r.disease_name, "category": r.category} for r in rows]


@frappe.whitelist(methods=["POST"])
def set_suspected_disease(report, disease=None):
	"""Officer override. An empty disease hands the decision back to the rules."""
	require_capability(VERIFY_CAPABILITY)
	doc = frappe.get_doc("Case Report", report)
	if disease and not frappe.db.exists("Alert Threshold Config", disease):
		frappe.throw(f"Unknown disease: {disease}")
	doc.suspected_disease = disease or None
	doc.save(ignore_permissions=True)  # the capability is the permission; officers may not hold edit_reports
	return {
		"suspected_disease": doc.suspected_disease,
		"suspected_disease_name": _labels()["disease"].get(doc.suspected_disease) if doc.suspected_disease else None,
		"classified_by": doc.classified_by,
		"classification_reason": doc.classification_reason,
		"also_consistent_with": doc.also_consistent_with,
	}


def backfill():
	"""Classify existing Case Reports (officer/model choices are left alone).

	bench --site <site> execute surveillance.case_definitions.backfill
	"""
	defs = get_definitions()
	labels = _labels()
	count = 0
	for name in frappe.get_all("Case Report", pluck="name"):
		doc = frappe.get_doc("Case Report", name)
		if doc.classified_by in ("Officer", "Model"):
			continue
		symptoms = [r.symptom for r in doc.symptoms if r.symptom]
		age, exposure = doc.get("age_group"), doc.get("animal_exposure")
		found = classify_detailed(symptoms, age, exposure, defs)
		doc.db_set({
			"suspected_disease": found[0]["disease"] if found else None,
			"classified_by": "Rules" if found else "",
			"classification_reason": explain(found[0], symptoms, age, exposure, labels) if found else "No case definition matched the reported signs.",
			"also_consistent_with": ", ".join(labels["disease"].get(d["disease"], d["disease"]) for d in found[1:]),
		}, update_modified=False)
		count += 1
		print(f"  {name}: {found[0]['disease'] if found else '-'}")
	frappe.db.commit()
	print(f"Classified {count} reports")


# ---------- outbreak context and the Oct 2026 edge cases ----------

def outbreak_active(disease, sub_county_id):
	"""An open confirmed/escalated event or an open Epi Trends alert for this disease in this sub-county."""
	if not sub_county_id:
		return False
	name = frappe.db.get_value("Sub County", sub_county_id, "sub_county_name") or sub_county_id
	if frappe.db.exists("Surveillance Event", {"disease": disease, "sub_county": name, "status": ["in", ["Confirmed", "Escalated"]]}):
		return True
	return bool(frappe.db.exists("Risk Alert", {"disease": disease, "sub_county": name,
		"status": ["in", ["Pending", "Investigating", "Confirmed"]]}))


def with_outbreak_ages(defs, sub_county_id):
	"""Copies of the definitions with outbreak age groups added where an outbreak is active. Returns (defs, widened keys)."""
	widened = set()
	out = []
	for d in defs:
		extra = OUTBREAK_AGES.get(d["disease"])
		if extra and d["ages"] and outbreak_active(d["disease"], sub_county_id):
			d = dict(d, ages=set(d["ages"]) | {_norm(a) for a in extra})
			widened.add(d["disease"])
		out.append(d)
	return out, widened


U5_PROTOCOL = ("Diarrhoea with Dehydration in Children Under 5", [
	("Give ORS after every loose stool and zinc for 10 days; keep breastfeeding and feeding", "Immediately", "CHP / caregiver", "Response", 1),
	("Refer urgently if the child cannot drink, is very sleepy, has sunken eyes, or blood in the stool", "Immediately", "CHP", "Investigation", 1),
	("Check for other children with diarrhoea in the household and block; report if 2 or more", "Within 24 hours", "CHP", "Investigation", 1),
	("Notify the SCDSC if there are 2 or more linked cases or any death", "Within 24 hours", "Surveillance officer", "Investigation", 0),
	("Check the household water source; advise safe water and handwashing with soap", "Within 48 hours", "CHP / WASH team", "Response", 1),
])


def apply_idsr_edge_cases():
	"""One-off (safe to repeat): add the under-5 diarrhoea definition, its disease and a Draft protocol,
	and update the cholera wording. Existing KRCS edits to other definitions are not touched.
	bench --site <site> execute surveillance.case_definitions.apply_idsr_edge_cases"""
	if not frappe.db.exists("Alert Threshold Config", U5_KEY):
		frappe.get_doc({"doctype": "Alert Threshold Config", "disease_key": U5_KEY, "disease_name": U5_NAME,
			"category": "Human", "threshold": 5, "priority": "Standard", "is_active": 1,
			"note": "IDSR edge case approved by KRCS, Oct 2026. Threshold and priority to confirm.",
			"synonyms": "watery diarrhoea child, dehydration, kuhara mtoto"}).insert(ignore_permissions=True)
		print("Disease added:", U5_NAME)
	seed_case_definitions()   # creates the under-5 definition (only if missing)
	cholera = frappe.db.get_value(DOCTYPE, {"disease": "awd-cholera"}, "name")
	if cholera:
		frappe.db.set_value(DOCTYPE, cholera, "lay_definition", CHOLERA_TEXT)
		print("Cholera wording updated (outbreak: 2 years or older)")
	if not frappe.db.exists("Response Protocol", {"disease": U5_KEY}):
		title, steps = U5_PROTOCOL
		doc = frappe.new_doc("Response Protocol")
		doc.update({"title": title, "disease": U5_KEY, "status": "Draft", "version": "v0.1", "summary": U5_TEXT,
			"source": "IDSR / IMCI; edge case approved by KRCS (Allan). KRCS to review before approval."})
		for s, tf, who, phase, show in steps:
			doc.append("steps", {"step": s, "timeframe": tf, "responsible": who, "phase": phase,
				"assignable": 1 if who.startswith("CHP") else 0, "show_to_reporters": show})
		from surveillance.protocols import questions_for
		for q, w, k in questions_for(U5_KEY, U5_TEXT, U5_NAME):
			doc.append("verification_questions", {"question": q, "why": w, "kind": k})
		doc.insert(ignore_permissions=True)
		print("Draft protocol added:", title, "(approve it in Response Protocols)")
	frappe.db.commit()
	print("Done. Re-classify recent reports with: bench --site <site> execute surveillance.case_definitions.backfill")
