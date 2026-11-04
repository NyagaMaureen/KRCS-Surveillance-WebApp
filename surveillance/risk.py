"""Risk score (0-100) for Review Queue events: which signal should an officer look at first.

Rule-based, not a trained model (AI/ML Design Specification 3.6: rule-weighting agreed with public health
officers). Every point is explained, so officers see why an event ranks high, and the weights are set in
Settings -> Risk score (Risk Score Settings); weights to be tuned after testing.

Factors (default maximum points):
    priority  30  suspected disease priority (Critical / High / Standard)
    redflags  25  deaths, red-flag answers (questions ticked "Yes means escalate now"), red-flag symptoms
    people    15  number of people affected
    unusual   20  this disease in this sub-county compared with its usual weekly level, plus an Epi Trends alert
    context   10  WASH, rainfall and population, only for diseases they relate to and only when recorded
A factor with no data (e.g. no WASH assessment or weather for the place) is skipped and the score is rescaled
over the remaining factors, so missing data never blocks or lowers the score.
"""
import frappe
from frappe.utils import add_days, cint, flt, getdate, now_datetime, nowdate

SETTINGS = "Risk Score Settings"
DEFAULT_WEIGHTS = {"priority": 30, "redflags": 25, "people": 15, "unusual": 20, "context": 10}
LABELS = {"priority": "Disease priority", "redflags": "Red flags and deaths", "people": "People affected",
	"unusual": "Unusual for this area", "context": "Local context (WASH, rain, population)"}
LEVELS = [(75, "Very high"), (50, "High"), (25, "Medium"), (0, "Low")]

# EDITABLE PARAMETERS (Settings -> AI Config -> open each factor). These are the starting values, to be reviewed with
# KRCS after testing. kind: share = fraction of the factor's maximum points (shown as %), count = a number of people or
# cases, times = how many times the usual level, score = a score from 0 to 100.
PARAM_GROUPS = [
	{"key": "priority", "label": "Disease priority", "items": [
		("share_critical", "Critical priority disease", "share", 1.0),
		("share_high", "High priority disease", "share", 0.6),
		("share_standard", "Normal priority disease", "share", 0.25),
	]},
	{"key": "redflags", "label": "Red flags and deaths", "items": [
		("death_one", "1 death", "share", 0.6),
		("death_many", "2 or more deaths", "share", 0.8),
		("red_answer_each", "Each red-flag question answered Yes", "share", 0.4),
		("red_symptom_first", "First red-flag symptom", "share", 0.3),
		("red_symptom_extra", "Each extra red-flag symptom", "share", 0.1),
		("death_min_score", "Lowest risk score when there is at least 1 death (50 = High)", "score", 50),
	]},
	{"key": "people", "label": "People affected", "items": [
		("people_n1", "Top step: at least this many people", "count", 10), ("people_s1", "Top step: share", "share", 1.0),
		("people_n2", "Second step: at least this many people", "count", 5), ("people_s2", "Second step: share", "share", 0.75),
		("people_n3", "Third step: at least this many people", "count", 2), ("people_s3", "Third step: share", "share", 0.5),
		("people_n4", "Fourth step: at least this many people", "count", 1), ("people_s4", "Fourth step: share", "share", 0.2),
	]},
	{"key": "unusual", "label": "Unusual for this area", "items": [
		("unusual_x1", "Top step: at least this many times the usual week", "times", 3), ("unusual_s1", "Top step: share", "share", 1.0),
		("unusual_x2", "Second step: at least this many times usual", "times", 2), ("unusual_s2", "Second step: share", "share", 0.7),
		("unusual_x3", "Third step: at least this many times usual", "times", 1.5), ("unusual_s3", "Third step: share", "share", 0.4),
		("first_in_8_weeks", "First report of this disease here in 8 weeks", "share", 0.6),
		("epi_alert_min", "An Epi Trends alert raises the share to at least", "share", 0.8),
	]},
	{"key": "context", "label": "Local context (WASH, rain, population)", "items": [
		("context_sign_each", "Each warning sign for this disease (heavy rain, poor WASH)", "share", 0.5),
		("population_rate", "Many cases for the population size", "share", 0.3),
		("population_per10k", "...meaning at least this many cases per 10,000 people", "count", 5),
	]},
]
PARAM_DEFAULTS = {k: d for g in PARAM_GROUPS for (k, _l, _kind, d) in g["items"]}
PARAM_KIND = {k: kind for g in PARAM_GROUPS for (k, _l, kind, _d) in g["items"]}


def params():
	"""Defaults, overridden by what was saved in Settings -> AI Config."""
	out = dict(PARAM_DEFAULTS)
	if frappe.db.exists("DocType", SETTINGS):
		raw = frappe.get_cached_doc(SETTINGS).get("params_json")
		if raw:
			try:
				for k, v in (frappe.parse_json(raw) or {}).items():
					if k in out and isinstance(v, (int, float)):
						out[k] = v
			except Exception:
				pass
	return out


def _steps(c, prefix, n_key, s_key):
	"""[(at_least, share), ...] highest first, from the saved parameters."""
	pairs = [(flt(c[f"{prefix}_{n_key}{i}"]), flt(c[f"{prefix}_{s_key}{i}"])) for i in (1, 2, 3, 4) if f"{prefix}_{n_key}{i}" in c]
	return sorted(pairs, key=lambda x: -x[0])


def _step(value, steps):
	for at_least, share in steps:
		if value >= at_least:
			return share
	return 0.0

# Red-flag symptoms are chosen in Settings -> AI Config (from the Symptom list). These words are only used once,
# by seed_red_flags(), to suggest a starting list.
SEED_WORDS = ("bleed", "blood", "convuls", "seizure", "fits", "unconscious", "paraly", "floppy",
	"stiff neck", "severe dehydration", "difficulty breathing", "sudden death", "jaundice", "yellow")


def red_flag_symptoms():
	"""{symptom id: symptom name} chosen in Settings -> AI Config."""
	if not frappe.db.exists("DocType", SETTINGS):
		return {}
	ids = [r.symptom for r in (frappe.get_cached_doc(SETTINGS).get("red_flag_symptoms") or []) if r.symptom]
	if not ids:
		return {}
	return {r.name: r.symptom_name for r in frappe.get_all("Symptom", filters={"name": ["in", ids]}, fields=["name", "symptom_name"])}


def _event_symptoms(doc):
	"""Symptom ids picked on the event's field reports (CHPs choose them from the Symptom list)."""
	refs = frappe.get_all("Surveillance Signal", filters={"event": doc.name, "source": "Field"}, pluck="ref") if doc.name else []
	if not refs:
		return set()
	return set(frappe.get_all("Case Report Symptom", filters={"parent": ["in", refs], "parenttype": "Case Report"}, pluck="symptom"))


def weights():
	out = dict(DEFAULT_WEIGHTS)
	if frappe.db.exists("DocType", SETTINGS):
		s = frappe.get_cached_doc(SETTINGS)
		for k in out:
			v = s.get(f"weight_{k}")
			if v is not None and cint(v) >= 0:
				out[k] = cint(v)
	return out


def level_for(score):
	return next(label for floor, label in LEVELS if score >= floor)


# ---------- factors: each returns (share 0..1, reason) or None when there is no data ----------

def _priority(doc):
	c = params()
	p = (doc.priority or doc.severity or "standard").lower()
	share = c.get(f"share_{p}", c["share_standard"])
	name = "Normal" if p == "standard" else p.title()
	return share, f"{name} priority disease ({doc.disease_name or doc.disease})"


def _redflags(doc):
	c = params()
	share, why = 0.0, []
	deaths = cint(doc.deaths)
	if deaths:
		share += c["death_one"] if deaths == 1 else c["death_many"]
		why.append(f"{deaths} death{'s' if deaths > 1 else ''} reported")
	from surveillance.investigation import is_red
	yes = [a for a in (doc.get("verification") or []) if is_red(a) and a.answer == "Yes"]
	if yes:
		share += c["red_answer_each"] * len(yes)
		why.append(f"{len(yes)} red-flag question{'s' if len(yes) > 1 else ''} answered Yes")
	flags = red_flag_symptoms()
	if flags:
		picked = _event_symptoms(doc)
		text = (doc.reason or "").lower()   # CBS reports: symptoms only appear in the report text
		found = sorted({name for sid, name in flags.items() if sid in picked or (name and name.lower() in text)})
		if found:
			share += c["red_symptom_first"] + c["red_symptom_extra"] * (len(found) - 1)
			why.append("red-flag symptom" + ("s" if len(found) > 1 else "") + ": " + ", ".join(found[:3]))
	if not why:
		return 0.0, "No deaths or red-flag symptoms reported"
	return min(share, 1.0), "; ".join(why)


def _people(doc):
	n = cint(doc.people)
	share = _step(n, _steps(params(), "people", "n", "s"))
	if "animal" in (doc.disease or ""):
		return share, f"{n} {'case' if n == 1 else 'cases'} (animals)"
	return share, f"{n} {'person' if n == 1 else 'people'} affected"


def _unusual(doc):
	"""Same weeks as Epi Trends (epi weeks, Monday-Sunday). If Epi Trends already has an alert for this disease and
	place, its finding is used, so both pages tell the same story. Otherwise: this epi week vs the 8 weeks before."""
	if not (doc.disease and doc.sub_county):
		return None
	c = params()
	from surveillance.alerts import epi_label, _why_short
	from surveillance.weekly_counts import week_start
	alert = frappe.db.get_value("Risk Alert", doc.linked_alert, ["name", "last_week", "week_start", "status"], as_dict=True) \
		if doc.get("linked_alert") else None
	this_week = week_start(nowdate())
	base_start = add_days(this_week, -56)
	rows = frappe.get_all("Surveillance Signal", filters={"disease": doc.disease, "sub_county": doc.sub_county,
		"signal_date": [">=", base_start]}, fields=["signal_date"])
	now = sum(1 for r in rows if r.signal_date and getdate(r.signal_date) >= this_week)
	before = sum(1 for r in rows if r.signal_date and getdate(r.signal_date) < this_week)
	usual = before / 8.0
	week = epi_label(this_week)
	reports = f"{now} report{'' if now == 1 else 's'}"
	share, why = 0.0, ""
	if now and usual == 0:
		share, why = c["first_in_8_weeks"], f"{reports} in {doc.sub_county} in {week}; none in the 8 weeks before"
	elif usual:
		ratio = now / usual
		share = _step(ratio, _steps(c, "unusual", "x", "s"))
		usual_txt = "less than 1" if usual < 1 else f"about {usual:.0f}"
		if now:
			why = f"{reports} in {doc.sub_county} in {week}; usually {usual_txt} a week" + (f" ({ratio:.1f}x usual)" if share else "")
	if alert:
		share = max(share, c["epi_alert_min"])
		a = frappe.get_doc("Risk Alert", alert.name)
		why = f"Epi Trends alert {alert.name}, {epi_label(alert.last_week or alert.week_start)}: {_why_short(a)}"
	return share, why or f"No reports of this disease in {doc.sub_county} in {week}"


def _context(doc):
	"""WASH and rainfall only for the diseases they relate to; skipped when nothing is recorded."""
	if not doc.sub_county:
		return None
	c = params()
	from surveillance import context as ctx_mod
	sc = ctx_mod.resolve_sub_county(doc.sub_county, doc.county)
	if not sc:
		return None
	ctx = ctx_mod._context(sc, cint(doc.people) or None, doc.disease)
	rain_relevant = doc.disease in ctx_mod.RAIN_DISEASES and ctx.get("weather")
	wash_relevant = doc.disease in ctx_mod.WASH_DISEASES and ctx.get("wash")
	pop = ctx.get("population") or {}
	if not (rain_relevant or wash_relevant or pop.get("per10k") is not None):
		return None    # nothing recorded that relates to this disease: skip and rescale
	share, why = 0.0, []
	for s in ctx.get("supports") or []:
		share += c["context_sign_each"]
		why.append(s["text"] + (": " + s["why"] if s.get("why") else ""))
	if pop.get("per10k") is not None and flt(pop["per10k"]) >= c["population_per10k"]:
		share += c["population_rate"]
		why.append(f"{pop['per10k']} per 10,000 people affected: many cases for the population size, so wider spread is likely")
	if not why:
		checked = [x for x, ok in (("rainfall", rain_relevant), ("WASH", wash_relevant), ("population", pop)) if ok]
		unrelated = [x for x, group in (("rain", ctx_mod.RAIN_DISEASES), ("WASH", ctx_mod.WASH_DISEASES)) if doc.disease not in group]
		return 0.0, ("Nothing in the local data raises the risk; checked " + " and ".join(checked)
			+ (f" ({' and '.join(unrelated)} are not linked to this disease)" if unrelated else ""))
	return min(share, 1.0), "; ".join(why)


FACTORS = {"priority": _priority, "redflags": _redflags, "people": _people, "unusual": _unusual, "context": _context}


def compute(doc):
	w = weights()
	parts, skipped, got, possible = [], [], 0.0, 0
	for key, fn in FACTORS.items():
		try:
			res = fn(doc)
		except Exception:
			frappe.log_error(title=f"Risk score: {key} failed for {doc.name}", message=frappe.get_traceback())
			res = None
		if res is None:
			skipped.append({"key": key, "label": LABELS[key], "why": "No data recorded for this place"})
			continue
		share, why = res
		pts = round(share * w[key], 1)
		got += pts
		possible += w[key]
		parts.append({"key": key, "label": LABELS[key], "points": pts, "max": w[key], "why": why})
	score = round(got * 100 / possible) if possible else 0
	floor_note = None
	deaths = cint(doc.deaths)
	min_with_death = cint(params()["death_min_score"])
	if deaths >= 1 and score < min_with_death:
		floor_note = f"{deaths} death{'s' if deaths > 1 else ''} reported: the risk is at least {level_for(min_with_death)} (score {min_with_death})"
		score = min_with_death
	return {"score": score, "level": level_for(score), "parts": parts, "skipped": skipped,
		"rescaled": bool(skipped), "floorNote": floor_note, "computedOn": str(now_datetime())}


def on_event_save(doc, method=None):
	"""Keep the score current whenever the event changes (new reports, answers, status)."""
	try:
		r = compute(doc)
		doc.risk_score = r["score"]
		doc.risk_breakdown = frappe.as_json(r)
	except Exception:
		frappe.log_error(title=f"Risk score failed for {doc.name}", message=frappe.get_traceback())


def refresh_open():
	"""Hourly: "unusual for this area" changes as the week moves on, so re-score open events."""
	from surveillance.events import OPEN
	for name in frappe.get_all("Surveillance Event", filters={"status": ["in", OPEN]}, pluck="name"):
		doc = frappe.get_doc("Surveillance Event", name)
		r = compute(doc)
		if r["score"] != cint(doc.get("risk_score")) or not doc.get("risk_breakdown"):
			doc.db_set({"risk_score": r["score"], "risk_breakdown": frappe.as_json(r)}, update_modified=False)
	frappe.db.commit()


ACTIONS = {
	"Very high": "Verify today and be ready to escalate to the county",
	"High": "Verify within 24 hours",
	"Medium": "Verify within 48 hours",
	"Low": "Verify within 72 hours and keep monitoring",
}


def shape(doc_or_row):
	"""Risk for the API: {"score", "level"} (+ breakdown when available)."""
	score = doc_or_row.get("risk_score")
	if score is None:
		return None
	out = {"score": cint(score), "level": level_for(cint(score))}
	out["action"] = ACTIONS[out["level"]]
	raw = doc_or_row.get("risk_breakdown")
	if raw:
		try:
			out.update(frappe.parse_json(raw))
		except Exception:
			pass
	return out


@frappe.whitelist()
def get_weights():
	from surveillance.capabilities import require_capability
	require_capability("view_review_queue")
	return {"weights": weights(), "labels": LABELS, "defaults": DEFAULT_WEIGHTS,
		"groups": [{"key": g["key"], "label": g["label"],
			"items": [{"key": k, "label": l, "kind": kind, "default": d} for (k, l, kind, d) in g["items"]]} for g in PARAM_GROUPS],
		"params": params()}


@frappe.whitelist(methods=["POST"])
def save_weights(weights=None, params_values=None):
	"""Change the factor weights (Settings -> AI Config), then re-score open events."""
	from surveillance.capabilities import require_capability
	require_capability("manage_alert_thresholds")
	data = (frappe.parse_json(weights) if isinstance(weights, str) else weights) or {}
	s = frappe.get_doc(SETTINGS)
	if params_values:
		given = frappe.parse_json(params_values) if isinstance(params_values, str) else params_values
		merged = dict(params())
		for k, v in given.items():
			if k not in PARAM_KIND:
				continue
			try:
				v = float(v)
			except (TypeError, ValueError):
				frappe.throw(f"{k}: use a number.")
			kind = PARAM_KIND[k]
			if kind == "share" and not 0 <= v <= 1:
				frappe.throw("Shares must be between 0% and 100%.")
			if kind == "score" and not 0 <= v <= 100:
				frappe.throw("A score must be between 0 and 100.")
			if kind in ("count", "times") and v < 0:
				frappe.throw("Use a number of 0 or more.")
			merged[k] = v
		s.set("params_json", frappe.as_json(merged))
	for k in DEFAULT_WEIGHTS:
		if k in data:
			v = cint(data[k])
			if not 0 <= v <= 100:
				frappe.throw(f"{LABELS[k]}: use a number from 0 to 100.")
			s.set(f"weight_{k}", v)
	s.flags.ignore_permissions = True
	s.save()
	frappe.clear_document_cache(SETTINGS, SETTINGS)
	frappe.enqueue("surveillance.risk.refresh_open", queue="long", enqueue_after_commit=True)
	return get_weights()


def backfill():
	"""One-off after install: score every event. bench --site <site> execute surveillance.risk.backfill"""
	n = 0
	for name in frappe.get_all("Surveillance Event", pluck="name"):
		doc = frappe.get_doc("Surveillance Event", name)
		r = compute(doc)
		doc.db_set({"risk_score": r["score"], "risk_breakdown": frappe.as_json(r)}, update_modified=False)
		n += 1
	frappe.db.commit()
	print(f"Scored {n} events")


# ---------- red-flag symptoms (Settings -> AI Config) ----------

@frappe.whitelist()
def get_red_flags():
	from surveillance.capabilities import require_capability
	require_capability("view_review_queue")
	chosen = red_flag_symptoms()
	symptoms = frappe.get_all("Symptom", fields=["name", "symptom_name", "category"], order_by="category asc, symptom_name asc")
	return {"chosen": [{"id": k, "name": v} for k, v in sorted(chosen.items(), key=lambda x: (x[1] or "").lower())],
		"symptoms": [{"id": s.name, "name": s.symptom_name, "category": s.category or "Other"} for s in symptoms]}


@frappe.whitelist(methods=["POST"])
def save_red_flags(symptoms):
	"""Replace the red-flag symptom list (list of Symptom ids), then re-score open events."""
	from surveillance.capabilities import require_capability
	require_capability("manage_alert_thresholds")
	ids = frappe.parse_json(symptoms) if isinstance(symptoms, str) else symptoms
	valid = set(frappe.get_all("Symptom", filters={"name": ["in", list(ids) or [""]]}, pluck="name"))
	s = frappe.get_doc(SETTINGS)
	s.set("red_flag_symptoms", [{"symptom": i} for i in ids if i in valid])
	s.flags.ignore_permissions = True
	s.save()
	frappe.clear_document_cache(SETTINGS, SETTINGS)
	frappe.enqueue("surveillance.risk.refresh_open", queue="long", enqueue_after_commit=True)
	return get_red_flags()


def seed_red_flags():
	"""One-off: suggest a starting list from the Symptom list (only if none chosen yet).
	bench --site <site> execute surveillance.risk.seed_red_flags"""
	s = frappe.get_doc(SETTINGS)
	if s.get("red_flag_symptoms"):
		print("Red-flag symptoms already chosen; nothing changed.")
		return
	picked = [r for r in frappe.get_all("Symptom", fields=["name", "symptom_name"])
		if any(w in (r.symptom_name or "").lower() for w in SEED_WORDS)]
	s.set("red_flag_symptoms", [{"symptom": r.name} for r in picked])
	s.flags.ignore_permissions = True
	s.save()
	frappe.db.commit()
	print("Red-flag symptoms set:", ", ".join(r.symptom_name for r in picked) or "none matched; choose them in Settings -> AI Config")