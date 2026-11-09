"""AI triage insight for an event: what the case definition says, and what the disease model estimates.

The model runs on the AI server (BentoML). This module only calls it. If the AI server is not set up,
down or slow, the page still shows the case definition and says the model estimate is unavailable.

Site config (bench --site <site> set-config ...):
    ai_classifier_url    e.g. http://10.249.99.50:3000
    ai_classifier_token  the AI_API_TOKEN set on the AI server
Only de-identified data is sent: symptom names and the age group. No names, phones or places.
"""
import hashlib

import frappe
import requests
from frappe import _

from surveillance.capabilities import require_capability
from surveillance.events import VIEW, _check_access

MAX_REPORTS = 20       # reports sent to the model per event
SHOW_REPORTS = 5       # reports listed on the page
SHOW_CLUSTER = 10      # unclassified clusters: every report gets its own suggestion
CACHE_SECONDS = 900    # model answers are reused for 15 minutes
DOWN_SECONDS = 60      # after a failure, do not retry for a minute
TIMEOUT = 6

# The model only learned diseases that were common in clinic records. Rare, epidemic-prone diseases
# (VHF, cholera, meningitis, anthrax...) have too few past cases, so for them the case definition
# decides and no model percentages are shown. Event disease key -> what the model can say about it.
COVERED = {"diarrhoea-dehydration-u5", "covid-sari", "unclassified-illness", "malaria", "dysentery"}   # unclassified clusters: no case definition matched, so the model suggests
# Groups that tell an officer nothing, so they are never listed.
HIDDEN = {"Other", "Fever or cough, cause not recorded"}


def _config():
	url = (frappe.conf.get("ai_classifier_url") or "").rstrip("/")
	token = frappe.conf.get("ai_classifier_token") or ""
	return (url, token) if url and token else (None, None)


def _case_key(report, symptoms, age):
	"""Cache key from the content sent, so an edited report is never answered from old results."""
	raw = "|".join([",".join(sorted(symptoms)), age or ""])
	return "ai_cls:" + hashlib.sha1(f"{report}|{raw}".encode()).hexdigest()


def _ask(cases):
	"""cases: list of {symptoms, age_group}. Returns (results or None, error text or None)."""
	url, token = _config()
	if not url:
		return None, "not_configured"
	cache = frappe.cache()
	if cache.get_value("ai_cls_down"):
		return None, "unavailable"
	try:
		res = requests.post(f"{url}/v1/classify_batch", json={"cases": [dict(c, explain=True) for c in cases]},
			headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT)
		res.raise_for_status()
		return res.json()["results"], None
	except Exception:  # noqa: BLE001 - never break the event page because the AI server is away
		cache.set_value("ai_cls_down", 1, expires_in_sec=DOWN_SECONDS)
		frappe.log_error(title="AI classifier unreachable")
		return None, "unavailable"


def _field_reports(event):
	refs = frappe.get_all("Surveillance Signal", filters={"event": event, "source": "Field"},
		fields=["ref", "signal_date"], order_by="signal_date desc", limit=MAX_REPORTS)
	return [frappe.get_doc("Case Report", r.ref) for r in refs if frappe.db.exists("Case Report", r.ref)]


def _disease_label(labels, key):
	return labels["disease"].get(key, key) if key else None


def _shape_report(cr, labels):
	"""One report as the pages show it, and the de-identified case sent to the model."""
	names = [labels["symptom"].get(r.symptom, r.symptom) for r in cr.symptoms if r.symptom]
	age = cr.get("age_group")
	lines = (cr.classification_reason or "").split("\n")
	item = {
		"report": cr.name, "date": str(cr.creation)[:10],
		"symptoms": names, "ageGroup": age or None,
		"suspected": _disease_label(labels, cr.suspected_disease),
		"decidedBy": cr.classified_by or None,
		"reason": lines[0] or None,
		"rulesView": (lines[1].replace("Rules view:", "", 1).strip() or None) if len(lines) > 1 else None,
		"alsoConsistentWith": cr.get("also_consistent_with") or None,
	}
	return item, {"symptoms": names, "age_group": age}


def _answers(reports, cases):
	"""Model answers for these reports: cached ones are reused, the rest are asked. Returns (answers, error)."""
	cache = frappe.cache()
	answers, ask_idx = [None] * len(cases), []
	for i, c in enumerate(cases):
		hit = cache.get_value(_case_key(reports[i].name, c["symptoms"], c["age_group"]))
		if hit:
			answers[i] = hit
		else:
			ask_idx.append(i)
	error = None
	if ask_idx:
		fresh, error = _ask([cases[i] for i in ask_idx])
		for n, i in enumerate(ask_idx):
			if fresh:
				answers[i] = fresh[n]
				cache.set_value(_case_key(reports[i].name, cases[i]["symptoms"], cases[i]["age_group"]),
					fresh[n], expires_in_sec=CACHE_SECONDS)
	return answers, error


def _tops(answer, n):
	return [t for t in ((answer or {}).get("top") or []) if t["disease"] not in HIDDEN][:n]


def _why_not(error):
	return {"not_configured": "The disease model is not connected yet.",
		"unavailable": "The disease model could not be reached just now."}.get(
		error, "The model could not give an estimate from the signs reported (not enough to compare).")


@frappe.whitelist()
def get_triage_insight(event):
	require_capability(VIEW)
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)

	from surveillance.case_definitions import _labels
	labels = _labels()
	reports = _field_reports(event)
	if not reports:
		return {"status": "no_reports",
			"message": "No field report with symptoms is linked to this event, so there is nothing to check.",
			"caseDefinition": {"disease": doc.disease_name, "reports": []}, "model": None}

	shaped, cases = [], []
	for cr in reports:
		item, case = _shape_report(cr, labels)
		shaped.append(item)
		cases.append(case)

	per_report = doc.disease == "unclassified-illness"   # a cluster of different cases: one suggestion per report
	limit = SHOW_CLUSTER if per_report else SHOW_REPORTS
	case_def = {"disease": doc.disease_name, "reports": shaped[:limit], "total": len(shaped)}
	if doc.disease not in COVERED:
		return {"status": "not_covered", "caseDefinition": case_def, "model": None,
			"message": "Not used for this disease: too few past clinic cases to learn from."}

	answers, error = _answers(reports, cases)
	got = [a for a in answers if a and a.get("top")]
	if not got:
		return {"status": error or "no_estimate", "message": _why_not(error), "caseDefinition": case_def, "model": None}

	# event level: average each disease's probability over the reports that got an estimate
	total, flag = {}, {}
	for a in got:
		for t in a["top"]:
			if t["disease"] in HIDDEN:
				continue
			total[t["disease"]] = total.get(t["disease"], 0) + t["probability"]
			flag[t["disease"]] = t["surveillance"]
	top = sorted(total, key=total.get, reverse=True)[:3]
	for i, a in enumerate(answers[:limit]):
		shaped[i]["model"] = _tops(a, 3 if per_report else 2) or None
		shaped[i]["modelNote"] = a.get("note") if a else None
	return {
		"status": "ok", "message": None, "caseDefinition": case_def,
		"model": {"version": got[0]["model_version"], "basedOn": len(got), "perReport": per_report,
			"top": [{"disease": d, "probability": round(total[d] / len(got), 3), "surveillance": flag[d]} for d in top]},
	}


@frappe.whitelist()
def get_report_triage(event, report):
	"""Triage of one report: its case definition result and, when the model knows this kind of case, its suggestion."""
	require_capability(VIEW)
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	if not frappe.db.exists("Surveillance Signal", {"event": event, "source": "Field", "ref": report}) \
			or not frappe.db.exists("Case Report", report):
		frappe.throw(_("This report is not part of the event."), frappe.PermissionError)

	from surveillance.case_definitions import _labels
	cr = frappe.get_doc("Case Report", report)
	item, case = _shape_report(cr, _labels())
	# the model is used for reports no case definition matched, and for diseases it learned
	if cr.suspected_disease and cr.suspected_disease not in COVERED:
		return {"report": item, "status": "not_covered", "model": None,
			"message": "Not used for this disease: too few past clinic cases to learn from."}
	answers, error = _answers([cr], [case])
	tops = _tops(answers[0], 3)
	if not tops:
		return {"report": item, "status": error or "no_estimate", "model": None, "message": _why_not(error)}
	return {"report": item, "status": "ok", "message": None,
		"model": {"version": answers[0]["model_version"], "top": tops}}


def _model_why(t, known=None):
	"""The model's reasons for one suggestion, as the pages show them (empty lists if the AI server is older).
	known: the app's current symptom names; a sign not on the list (renamed or removed) is left out."""
	w = t.get("why") or {}
	keep = lambda s: s.startswith("age ") or known is None or s in known   # age lines are shown on their own line
	names = lambda key: [x["sign"] for x in (w.get(key) or []) if keep(x["sign"])]
	return {"for": names("for"), "against": names("against"), "ask": names("ask"), "rulesOut": [],
		"record": t.get("record")}


def _definition_why(defn, symptoms, age_group, exposure, labels):
	"""Why a case definition matched, and what is still worth checking: missing supporting signs, the age group if
	unknown, and signs that would rule it out. Taken straight from the definition, nothing estimated."""
	have = set(symptoms or [])
	names = lambda ids: sorted(labels["symptom"].get(i, i) for i in ids)
	pro = names(defn["required_symptoms"]) + names(defn["any_of_symptoms"] & have)
	if defn.get("required_exposure"):
		pro.append(f"animal exposure: {exposure}")
	if defn["ages"] and age_group:
		pro.append(f"age {age_group}")
	ask = names(defn["any_of_symptoms"] - have)[:3]
	if defn["ages"] and not age_group:
		ask.append("age group")
	return {"for": pro, "against": [], "ask": ask, "rulesOut": names(defn["excluded_symptoms"]), "record": None}


# Model group -> the system disease it points to. Anything not listed is ordinary illness (information only).
MODEL_TO_DISEASE = {
	"Malaria": "malaria", "Typhoid": "typhoid", "Measles": "measles", "Malnutrition": "acute-malnutrition",
	"Meningitis": "meningococcal-meningitis", "Cholera": "awd-cholera", "Pneumonia / lower respiratory infection": "covid-sari",
}
UNDER_FIVE = {"Under 1", "1-4 years"}
MIN_MODEL_SHARE = 0.10   # a model suggestion below 10% is not worth an officer's time
SHOW_CANDIDATES = 3      # cards shown; the rest are listed by name


@frappe.whitelist()
def get_report_candidates(report):
	"""Suspected diseases for one report, in the order officers should consider them (human in the loop):
	  1. case definitions met (Match Order = KRCS precedence: VHF, AFP, meningitis, cholera ... first)
	  2. "possible" priority diseases: a warning sign is there but the definition is not met (ask about the rest)
	  3. the model's suggestions (malaria, pneumonia ...)
	Up to SHOW_CANDIDATES are shown; the rest are listed by name. Also returns the model's plain-illness view and
	the Review Queue event the report is on, so the Reports page can send officers there to decide."""
	from surveillance.case_definitions import VERIFY_CAPABILITY, _labels, classify_detailed, get_definitions, possible_matches
	require_capability(VERIFY_CAPABILITY)
	cr = frappe.get_doc("Case Report", report)
	labels = _labels()
	item, case = _shape_report(cr, labels)
	symptoms = [r.symptom for r in cr.symptoms if r.symptom]
	age = cr.get("age_group")

	exposure = cr.get("animal_exposure")
	defs = get_definitions()
	cands = []
	for d in classify_detailed(symptoms, age, exposure, defs):
		cands.append({"key": d["disease"], "name": labels["disease"].get(d["disease"], d["disease"]),
			"source": "Case definition", "probability": None,
			"why": _definition_why(d, symptoms, age, exposure, labels)})
	from surveillance.case_definitions import absent_of
	for p in possible_matches(symptoms, age, exposure, defs, labels, absent_of(cr)):
		key = p["defn"]["disease"]
		cands.append({"key": key, "name": labels["disease"].get(key, key), "source": "Possible", "probability": None,
			"why": {"for": p["found"], "against": [], "ask": p["ask"], "rulesOut": [], "record": None}})

	answers, error = _answers([cr], [case])
	tops = _tops(answers[0], 6)
	known = set(labels["symptom"].values())
	others = []
	for t in tops:
		key = MODEL_TO_DISEASE.get(t["disease"])
		if t["disease"] == "Diarrhoea (incl. dysentery)" and age in UNDER_FIVE:
			key = "diarrhoea-dehydration-u5"
		if key and key in labels["disease"] and t["probability"] >= MIN_MODEL_SHARE:
			if not any(c["key"] == key for c in cands):
				cands.append({"key": key, "name": labels["disease"][key], "source": "Model", "probability": t["probability"],
					"why": _model_why(t, known)})
			else:
				for c in cands:
					if c["key"] == key:
						c["probability"] = t["probability"]
		elif not key and t["probability"] >= MIN_MODEL_SHARE:
			others.append({"disease": t["disease"], "probability": t["probability"], "why": _model_why(t, known)})
	sig = frappe.db.get_value("Surveillance Signal", {"source": "Field", "ref": cr.name}, ["event"], as_dict=True)
	ev = frappe.db.get_value("Surveillance Event", sig.event, ["name", "status", "title"], as_dict=True) if sig and sig.event else None
	return {
		"candidates": cands[:SHOW_CANDIDATES], "moreCandidates": [c["name"] for c in cands[SHOW_CANDIDATES:]],
		"event": {"id": ev.name, "status": ev.status, "title": ev.title} if ev else None,
		"current": cr.suspected_disease or None, "decidedBy": cr.classified_by or None,
		"modelOther": others[:2], "modelNote": None if tops else _why_not(error),
	}


@frappe.whitelist()
def get_model_hint(symptoms=None, age_group=None):
	"""Shown to the reporter on the review step: what else the model thinks it may be. Wording only; the
	case definition still classifies the report and an officer confirms. Sends symptom names and age group only."""
	from surveillance.case_definitions import _labels
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	symptoms = frappe.parse_json(symptoms) if isinstance(symptoms, str) else (symptoms or [])
	labels = _labels()
	names = [labels["symptom"].get(s, s) for s in symptoms][:30]
	if not names:
		return {"suggestions": []}
	res, _err = _ask([{"symptoms": names, "age_group": age_group or None}])
	out = []
	known = set(labels["symptom"].values())
	for t in _tops((res or [{}])[0], 6):
		key = MODEL_TO_DISEASE.get(t["disease"])
		if t["disease"] == "Diarrhoea (incl. dysentery)" and age_group in UNDER_FIVE:
			key = "diarrhoea-dehydration-u5"
		if t["probability"] < MIN_MODEL_SHARE:
			continue
		name = labels["disease"].get(key) if key and key in labels["disease"] else t["disease"]
		w = _model_why(t, known)
		out.append({"key": key if key in labels["disease"] else None, "name": name, "probability": t["probability"],
			"priority": bool(key and key in labels["disease"]), "why": {"for": w["for"], "ask": w["ask"]}})
	return {"suggestions": out[:2], "error": _err}
