"""Analytics page: surveillance performance and trends from real data only.

Sections (one call, get_analytics):
  summary        field reports, open events, median hours to start verification, escalations (vs previous period)
  trends         weekly counts per disease (top 5), all or one source
  expected       observed weekly counts for one disease vs the usual level (8-week baseline) and the outbreak level
  periodCompare  last 4 weeks vs the 4 weeks before, per disease
  responseTime   weekly median hours from an event arriving to verification starting, vs the 24-hour target
  ageGroups      field reports by age group (sex is not recorded, by design)
  hourPattern    field reports by hour of day
  completeness   MOH 505 reporting completeness per facility (% of weeks reported)
  indicators     CBS/IDSR performance indicators (% verified within 24 h, decided, escalated with facility, completeness)

Access: view_analytics. Region: officers see their region; View All Regions / no region see everything.
Pilot sites only (Review Queue sub-counties).
"""
from collections import defaultdict
from statistics import median

import frappe
from frappe.utils import add_days, cint, get_datetime, getdate, now_datetime, nowdate

from surveillance.capabilities import require_capability

VIEW = "view_analytics"
SOURCES = {"community": ("Case Report", "CBS"), "facility": ("IDSR", "EMR"), "all": ("Case Report", "CBS", "IDSR", "EMR")}
VERIFY_ACTION = "Verification started"
ESCALATE_ACTION = "Escalated to county / MoH"
DECIDED = {"Confirmed", "Discarded", "Escalated", "Closed"}
TARGET_HOURS = {"critical": 24, "high": 48, "standard": 72}
BASELINE_WEEKS = 8


# ---------- scope ----------

def _region():
	from surveillance.events import _user_region
	return _user_region()


def _sub_counties():
	"""Lower-case pilot sub-county names this user may see."""
	from surveillance.events import _scope
	subs, _ = _scope()
	region = _region()
	if region:
		mine = {(n or "").strip().lower() for n in frappe.get_all("Sub County", filters={"region": region}, pluck="sub_county_name")}
		subs = subs & mine
	return subs


def _event_filters(**extra):
	f = dict(extra)
	region = _region()
	if region:
		f["region"] = region
	return f


def _names():
	return {d.name: d.disease_name or d.name for d in frappe.get_all("Alert Threshold Config", fields=["name", "disease_name"])}


def _week_start(d):
	d = getdate(d)
	return add_days(d, -d.weekday())


def _epi(d):
	y, w, _ = getdate(d).isocalendar()
	return f"W{w}"


def _pct(now, before):
	if not before:
		return 100.0 if now else 0.0
	return round((now - before) * 100.0 / before, 1)


def _stat(key, label, value, icon, now, before, more_is_bad, unit=""):
	pct = _pct(now, before)
	trend = "up" if pct > 0 else "down" if pct < 0 else "flat"
	bad = trend != "flat" and ((trend == "up") == more_is_bad)
	return {"key": key, "label": label, "value": f"{value}{unit}", "icon": icon, "changePct": pct, "trend": trend,
		"sentiment": "negative" if bad else "positive"}


# ---------- weekly counts ----------

def _weekly(sources, subs, first, last, disease=None):
	values = {"sources": tuple(sources), "first": first, "last": last, "subs": tuple(subs) or ("",)}
	extra = ""
	if disease:
		extra = " and disease = %(disease)s"
		values["disease"] = disease
	return frappe.db.sql(f"""select disease, week_start, sum(signals) n, sum(affected) a
		from `tabWeekly Count` where source in %(sources)s and week_start between %(first)s and %(last)s
		and lower(trim(sub_county)) in %(subs)s{extra} group by disease, week_start""", values, as_dict=True)


def _trends(weeks, source, subs, names, last):
	cols = [add_days(last, -7 * i) for i in reversed(range(weeks))]
	rows = _weekly(SOURCES[source], subs, cols[0], last)
	totals, series = defaultdict(int), defaultdict(lambda: defaultdict(int))
	for r in rows:
		totals[r.disease] += int(r.n or 0)
		series[r.disease][getdate(r.week_start)] += int(r.n or 0)
	top = [d for d in sorted(totals, key=lambda k: -totals[k]) if totals[d]][:5]
	return {"labels": [_epi(w) for w in cols], "weeks": [str(w) for w in cols],
		"series": [{"key": d, "name": names.get(d, d), "data": [series[d][w] for w in cols], "total": totals[d]} for d in top]}


def _expected(weeks, source, subs, names, last, disease):
	"""Observed weekly counts vs the usual level (mean of the previous 8 weeks, as the alert engine uses)
	and the outbreak level (usual x outbreak multiplier)."""
	cols = [add_days(last, -7 * i) for i in reversed(range(weeks))]
	if not disease:
		top = _weekly(SOURCES[source], subs, cols[0], last)
		agg = defaultdict(int)
		for r in top:
			agg[r.disease] += int(r.n or 0)
		disease = max(agg, key=agg.get) if agg else None
	if not disease:
		return None
	start = add_days(cols[0], -7 * BASELINE_WEEKS)
	counts = defaultdict(int)
	for r in _weekly(SOURCES[source], subs, start, last, disease):
		counts[getdate(r.week_start)] += int(r.n or 0)
	multiplier = float(frappe.db.get_single_value("Alert Threshold Settings", "outbreak_multiplier") or 2.5)
	threshold = cint(frappe.db.get_value("Alert Threshold Config", disease, "threshold")) or 1
	observed, expected, outbreak = [], [], []
	for w in cols:
		prev = [counts[add_days(w, -7 * i)] for i in range(1, BASELINE_WEEKS + 1)]
		base = sum(prev) / len(prev)
		observed.append(counts[w])
		expected.append(round(base, 1))
		outbreak.append(round(max(base * multiplier, threshold), 1))
	return {"disease": disease, "diseaseName": names.get(disease, disease), "labels": [_epi(w) for w in cols],
		"observed": observed, "expected": expected, "outbreakLevel": outbreak, "threshold": threshold, "multiplier": multiplier}


def _period_compare(source, subs, names, last):
	cur_first, prev_first = add_days(last, -21), add_days(last, -49)
	cur, prev = defaultdict(int), defaultdict(int)
	for r in _weekly(SOURCES[source], subs, prev_first, last):
		(cur if getdate(r.week_start) >= cur_first else prev)[r.disease] += int(r.n or 0)
	keys = sorted(set(cur) | set(prev), key=lambda k: -(cur.get(k, 0) + prev.get(k, 0)))[:8]
	return {"labels": [names.get(k, k) for k in keys], "current": [cur.get(k, 0) for k in keys],
		"previous": [prev.get(k, 0) for k in keys], "changePct": [_pct(cur.get(k, 0), prev.get(k, 0)) for k in keys],
		"currentLabel": f"{_epi(cur_first)}–{_epi(last)}", "previousLabel": f"{_epi(prev_first)}–{_epi(add_days(cur_first, -7))}"}


# ---------- events: response time and indicators ----------

def _events_since(since, until=None):
	f = _event_filters(creation=[">=", since])
	if until:
		f["creation"] = ["between", [since, until]]
	return frappe.get_all("Surveillance Event", filters=f,
		fields=["name", "creation", "first_reported", "severity", "status", "nearest_facility", "from_alert"])


def _actions(events):
	out = defaultdict(list)
	if not events:
		return out
	for a in frappe.get_all("Surveillance Event Action", filters={"parent": ["in", [e.name for e in events]],
			"parenttype": "Surveillance Event"}, fields=["parent", "action", "at"], order_by="at asc"):
		out[a.parent].append(a)
	return out


def _hours_to_verify(e, acts):
	start = next((a.at for a in acts.get(e.name, []) if a.action == VERIFY_ACTION), None)
	if not start:
		return None
	return max((get_datetime(start) - get_datetime(e.creation)).total_seconds() / 3600, 0)


def _response_time(weeks, last):
	cols = [add_days(last, -7 * i) for i in reversed(range(weeks))]
	events = _events_since(cols[0])
	acts = _actions(events)
	per_week = defaultdict(list)
	for e in events:
		h = _hours_to_verify(e, acts)
		if h is not None:
			per_week[_week_start(e.creation)].append(h)
	return {"labels": [_epi(w) for w in cols],
		"medianHours": [round(median(per_week[w]), 1) if per_week[w] else None for w in cols],
		"verified": [len(per_week[w]) for w in cols], "target": 24}


def _indicators(since, completeness_pct):
	events = [e for e in _events_since(since) if not e.from_alert]
	acts = _actions(events)
	n = len(events)
	within = sum(1 for e in events if (h := _hours_to_verify(e, acts)) is not None and h <= TARGET_HOURS.get(e.severity or "standard", 72))
	started = sum(1 for e in events if _hours_to_verify(e, acts) is not None)
	decided = sum(1 for e in events if e.status in DECIDED)
	escalated = [e for e in events if any(a.action == ESCALATE_ACTION for a in acts.get(e.name, []))]
	with_facility = sum(1 for e in escalated if e.nearest_facility)
	pct = lambda a, b: round(a * 100 / b) if b else None
	items = [
		{"key": "verified_on_time", "label": "Verified within target time", "value": pct(within, n), "detail": f"{within} of {n} events (24 h critical, 48 h high, 72 h standard)"},
		{"key": "verification_started", "label": "Verification started", "value": pct(started, n), "detail": f"{started} of {n} events"},
		{"key": "decided", "label": "Reached a decision", "value": pct(decided, n), "detail": f"{decided} of {n} confirmed, discarded, escalated or closed"},
		{"key": "escalated_with_facility", "label": "Escalations with facility named", "value": pct(with_facility, len(escalated)), "detail": f"{with_facility} of {len(escalated)} escalations"},
		{"key": "moh505_completeness", "label": "MOH 505 reporting completeness", "value": completeness_pct, "detail": "facility weeks reported"},
	]
	return {"events": n, "items": items}


# ---------- field reports ----------

def _reports(since, until=None):
	region = _region()
	values = {"since": since, "until": until or now_datetime()}
	where = "cr.creation between %(since)s and %(until)s"
	if region:
		where += " and cr.region = %(region)s"
		values["region"] = region
	return frappe.db.sql(f"select cr.name, cr.creation, cr.age_group, cr.affected_count from `tabCase Report` cr where {where}",
		values, as_dict=True)


def _age_groups(reports):
	meta = frappe.get_meta("Case Report").get_field("age_group")
	order = [o for o in (meta.options or "").split("\n") if o] if meta and meta.fieldtype == "Select" else []
	counts, people = defaultdict(int), defaultdict(int)
	for r in reports:
		key = r.age_group or "Not recorded"
		counts[key] += 1
		people[key] += int(r.affected_count or 0)
	labels = [o for o in order if o in counts] + sorted(k for k in counts if k not in order)
	return {"labels": labels, "reports": [counts[k] for k in labels], "people": [people[k] for k in labels]}


def _hour_pattern(reports):
	hours = [0] * 24
	for r in reports:
		hours[get_datetime(r.creation).hour] += 1
	return {"labels": [f"{h:02d}:00" for h in range(24)], "data": hours}


# ---------- MOH 505 completeness ----------

def _completeness(weeks, subs):
	if not frappe.db.table_exists("IDSR Reporting Week"):
		return {"facilities": [], "overall": None, "upTo": None}
	latest = frappe.db.sql("select max(week_start) from `tabIDSR Reporting Week`")[0][0]
	if not latest:
		return {"facilities": [], "overall": None, "upTo": None}
	first = add_days(latest, -7 * (weeks - 1))
	facilities = {f.name: f for f in frappe.get_all("Reporting Facility", filters={"is_active": 1},
		fields=["name", "sub_county_name", "county"]) if (f.sub_county_name or "").strip().lower() in subs}
	if not facilities:
		return {"facilities": [], "overall": None, "upTo": str(latest)}
	rows = frappe.db.sql("""select facility, sum(reported) r, count(*) n from `tabIDSR Reporting Week`
		where week_start between %s and %s and facility in %s group by facility""",
		(first, latest, tuple(facilities)), as_dict=True)
	got = {r.facility: r for r in rows}
	out = []
	for name, f in sorted(facilities.items()):
		r = got.get(name)
		reported = int(r.r or 0) if r else 0
		out.append({"facility": name, "subCounty": f.sub_county_name, "reported": reported, "weeks": weeks,
			"pct": round(reported * 100 / weeks)})
	overall = round(sum(x["reported"] for x in out) * 100 / (weeks * len(out))) if out else None
	return {"facilities": sorted(out, key=lambda x: x["pct"]), "overall": overall, "upTo": str(latest), "from": str(first)}


# ---------- summary ----------

def _summary(weeks, today):
	start, prev_start = add_days(today, -7 * weeks), add_days(today, -14 * weeks)
	cur_reports = len(_reports(start))
	prev_reports = len(_reports(prev_start, start))
	open_now = frappe.db.count("Surveillance Event", _event_filters(status=["in", ["New", "Verifying", "Investigating", "Confirmed", "Escalated"]]))
	open_new = frappe.db.count("Surveillance Event", _event_filters(creation=[">=", start]))
	open_prev = frappe.db.count("Surveillance Event", _event_filters(creation=["between", [prev_start, start]]))

	def med(since, until=None):
		ev = _events_since(since, until)
		acts = _actions(ev)
		hrs = [h for e in ev if (h := _hours_to_verify(e, acts)) is not None]
		return round(median(hrs), 1) if hrs else None
	m_now, m_prev = med(start), med(prev_start, start)

	def esc(since, until=None):
		f = {"parenttype": "Surveillance Event", "action": ESCALATE_ACTION, "at": [">=", since] if not until else ["between", [since, until]]}
		region = _region()
		if region:
			f["parent"] = ["in", frappe.get_all("Surveillance Event", filters={"region": region}, pluck="name") or [""]]
		return len(set(frappe.get_all("Surveillance Event Action", filters=f, pluck="parent")))
	e_now, e_prev = esc(start), esc(prev_start, start)

	return [
		_stat("reports", "Field reports", cur_reports, "Sparkles", cur_reports, prev_reports, more_is_bad=False),
		_stat("open_events", "Open events", open_now, "AlertTriangle", open_new, open_prev, more_is_bad=True),
		_stat("median_verify", "Median time to verify", "—" if m_now is None else m_now, "Clock", m_now or 0, m_prev or 0,
			more_is_bad=True, unit="" if m_now is None else " h"),
		_stat("escalations", "Escalated to MOH", e_now, "Map", e_now, e_prev, more_is_bad=True),
	]


# ---------- API ----------

@frappe.whitelist()
def get_analytics(weeks=13, source="all", disease=None):
	"""weeks: 4, 13 or 52. source: all | community | facility. disease: for the observed-vs-expected chart."""
	require_capability(VIEW)
	weeks = max(4, min(cint(weeks) or 13, 52))
	source = source if source in SOURCES else "all"
	today = getdate(nowdate())
	last = add_days(_week_start(today), -7)   # last complete week
	subs = _sub_counties()
	names = _names()
	since = add_days(last, -7 * (weeks - 1))
	reports = _reports(since)
	completeness = _completeness(weeks, subs)
	region = _region()
	return {
		"weeks": weeks, "source": source, "from": str(since), "to": str(add_days(last, 6)),
		"region": (frappe.db.get_value("Region", region, "region_name") or region) if region else None,
		"summary": _summary(weeks, today),
		"trends": _trends(weeks, source, subs, names, last),
		"expected": _expected(weeks, source, subs, names, last, disease),
		"periodCompare": _period_compare(source, subs, names, last),
		"responseTime": _response_time(weeks, last),
		"ageGroups": _age_groups(reports),
		"hourPattern": _hour_pattern(reports),
		"completeness": completeness,
		"indicators": _indicators(since, completeness["overall"]),
		"diseases": [{"value": k, "label": v} for k, v in sorted(names.items(), key=lambda x: x[1] or "")],
	}
