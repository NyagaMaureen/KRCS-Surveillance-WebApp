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

# =====================================================================================================
# PERCENTAGE STEPS: how much of each factor's maximum points an event earns (1.0 = 100%, 0.6 = 60%).
# Points for a factor = weight (Settings -> AI Config) x share. Shares are capped at 1.0.
# Starting values, to be reviewed with KRCS (Allan) after testing. Change them here only.
# =====================================================================================================

# 1. Disease priority (from Alert Thresholds)
PRIORITY_SHARE = {"critical": 1.0, "high": 0.6, "standard": 0.25}

# 2. Red flags: these add up
DEATH_ONE = 0.6               # 1 death
DEATH_MANY = 0.8              # 2 or more deaths
RED_ANSWER_EACH = 0.4         # each "Yes means escalate now" question answered Yes
RED_SYMPTOM_FIRST = 0.3       # first red-flag symptom found
RED_SYMPTOM_EXTRA = 0.1       # each extra red-flag symptom

# 3. People affected: (at least this many people, share); first match wins
PEOPLE_STEPS = [(10, 1.0), (5, 0.75), (2, 0.5), (1, 0.2)]

# 4. Unusual for this area: this week's reports vs the usual week (average of the 8 weeks before)
UNUSUAL_STEPS = [(3, 1.0), (2, 0.7), (1.5, 0.4)]   # (at least this many times usual, share)
FIRST_IN_8_WEEKS = 0.6        # first report of this disease in the sub-county in 8 weeks
EPI_TRENDS_ALERT_MIN = 0.8    # an Epi Trends alert raises the share to at least this

# 5. Local context: these add up
CONTEXT_SIGN_EACH = 0.5       # each warning sign for this disease (heavy rain, poor WASH)
POPULATION_RATE = 0.3         # many cases for the population size
POPULATION_RATE_PER10K = 5    # ... meaning at least this many cases per 10,000 people
# =====================================================================================================


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
	p = (doc.priority or doc.severity or "standard").lower()
	share = PRIORITY_SHARE.get(p, 0.25)
	return share, f"{(doc.priority or 'Standard').title()} priority disease ({doc.disease_name or doc.disease})"


def _redflags(doc):
	share, why = 0.0, []
	deaths = cint(doc.deaths)
	if deaths:
		share += DEATH_ONE if deaths == 1 else DEATH_MANY
		why.append(f"{deaths} death{'s' if deaths > 1 else ''} reported")
	from surveillance.investigation import is_red
	yes = [a for a in (doc.get("verification") or []) if is_red(a) and a.answer == "Yes"]
	if yes:
		share += RED_ANSWER_EACH * len(yes)
		why.append(f"{len(yes)} red-flag question{'s' if len(yes) > 1 else ''} answered Yes")
	flags = red_flag_symptoms()
	if flags:
		picked = _event_symptoms(doc)
		text = (doc.reason or "").lower()   # CBS reports: symptoms only appear in the report text
		found = sorted({name for sid, name in flags.items() if sid in picked or (name and name.lower() in text)})
		if found:
			share += RED_SYMPTOM_FIRST + RED_SYMPTOM_EXTRA * (len(found) - 1)
			why.append("red-flag symptom" + ("s" if len(found) > 1 else "") + ": " + ", ".join(found[:3]))
	if not why:
		return 0.0, "No deaths or red-flag symptoms reported"
	return min(share, 1.0), "; ".join(why)


def _people(doc):
	n = cint(doc.people)
	share = _step(n, PEOPLE_STEPS)
	if "animal" in (doc.disease or ""):
		return share, f"{n} {'case' if n == 1 else 'cases'} (animals)"
	return share, f"{n} {'person' if n == 1 else 'people'} affected"


def _unusual(doc):
	"""Same weeks as Epi Trends (epi weeks, Monday-Sunday). If Epi Trends already has an alert for this disease and
	place, its finding is used, so both pages tell the same story. Otherwise: this epi week vs the 8 weeks before."""
	if not (doc.disease and doc.sub_county):
		return None
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
		share, why = FIRST_IN_8_WEEKS, f"{reports} in {doc.sub_county} in {week}; none in the 8 weeks before"
	elif usual:
		ratio = now / usual
		share = _step(ratio, UNUSUAL_STEPS)
		usual_txt = "less than 1" if usual < 1 else f"about {usual:.0f}"
		if now:
			why = f"{reports} in {doc.sub_county} in {week}; usually {usual_txt} a week" + (f" ({ratio:.1f}x usual)" if share else "")
	if alert:
		share = max(share, EPI_TRENDS_ALERT_MIN)
		a = frappe.get_doc("Risk Alert", alert.name)
		why = f"Epi Trends alert {alert.name}, {epi_label(alert.last_week or alert.week_start)}: {_why_short(a)}"
	return share, why or f"No reports of this disease in {doc.sub_county} in {week}"


def _context(doc):
	"""WASH and rainfall only for the diseases they relate to; skipped when nothing is recorded."""
	if not doc.sub_county:
		return None
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
		share += CONTEXT_SIGN_EACH
		why.append(s["text"] + (": " + s["why"] if s.get("why") else ""))
	if pop.get("per10k") is not None and flt(pop["per10k"]) >= POPULATION_RATE_PER10K:
		share += POPULATION_RATE
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
	return {"score": score, "level": level_for(score), "parts": parts, "skipped": skipped,
		"rescaled": bool(skipped), "computedOn": str(now_datetime())}


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
	return {"weights": weights(), "labels": LABELS, "defaults": DEFAULT_WEIGHTS}


@frappe.whitelist(methods=["POST"])
def save_weights(weights):
	"""Change the factor weights (Settings -> AI Config), then re-score open events."""
	from surveillance.capabilities import require_capability
	require_capability("manage_alert_thresholds")
	data = frappe.parse_json(weights) if isinstance(weights, str) else weights
	s = frappe.get_doc(SETTINGS)
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