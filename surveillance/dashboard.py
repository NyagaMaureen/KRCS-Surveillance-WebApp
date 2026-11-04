"""Dashboard Overview: one call that returns everything the Dashboard page shows.

Events (stats, alert list, daily volume, distribution) follow the same region scope as Alerts & Signals:
officers see their own region; national users (no region) see everything.
Disease trends come from Weekly Count for the pilot sub-counties, split by source:
  community = field reports (Case Report) + CBS
  facility  = MOH 505 / IDSR (and EMR once connected)
"""
from collections import defaultdict

import frappe
from frappe.utils import add_days, cint, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability

VIEW_EVENTS = "view_review_queue"
OPEN = ["New", "Verifying", "Investigating", "Confirmed", "Escalated"]
WAITING = ["New", "Verifying"]
ESCALATED_ACTION = "Escalated to county / MoH"
SEVERITY_ORDER = {"critical": 0, "high": 1, "standard": 2}
TREND_SOURCES = {
	"community": ["Case Report", "CBS"],
	"facility": ["IDSR", "EMR"],
	"cbs": ["CBS"],
	"all": ["Case Report", "CBS", "IDSR", "EMR"],
}
TREND_WEEKS = 12
TOP_DISEASES = 5


def _pct(now, before):
	if not before:
		return 100.0 if now else 0.0
	return round((now - before) * 100.0 / before, 1)


def _stat(key, label, value, icon, now, before, more_is_bad=True, compare=""):
	pct = _pct(now, before)
	trend = "up" if pct > 0 else "down" if pct < 0 else "flat"
	bad = (trend == "up") == more_is_bad if trend != "flat" else False
	return {"key": key, "label": label, "value": str(value), "icon": icon, "changePct": pct, "trend": trend,
		"sentiment": "negative" if bad else "positive", "compare": compare}


def _event_names():
	"""Names of events this user may see, or None for everything."""
	from surveillance.events import _scope_filters
	scope = _scope_filters()
	return scope["name"][1] if scope.get("name") else None


def _events(names, **filters):
	if names is not None:
		filters["name"] = ["in", names or [""]]
	return filters


def _disease_names():
	return {d.name: d.disease_name or d.name for d in frappe.get_all("Alert Threshold Config", fields=["name", "disease_name"])}


def _week_start(d):
	d = getdate(d)
	return add_days(d, -d.weekday())


CHANNEL_SOURCES = {"mobile": "Mobile", "web": "Web", "whatsapp": "WhatsApp"}
EVENT_SIGNAL_SOURCE = {"cbs": "CBS", "facility": "EMR"}


def _sub_county_name(sub_county):
	return (frappe.db.get_value("Sub County", sub_county, "sub_county_name") or sub_county) if sub_county else None


def _filtered_names(names, source, sub_county):
	"""Event names allowed by the user's scope AND the dashboard filters (area, source). None = no limit."""
	allowed = None if names is None else set(names)
	extra = None
	if sub_county:
		extra = set(frappe.get_all("Surveillance Event", filters={"sub_county": _sub_county_name(sub_county)}, pluck="name"))
	if source in CHANNEL_SOURCES:
		refs = frappe.get_all("Case Report", filters={"channel": CHANNEL_SOURCES[source]}, pluck="name")
		ev = set(frappe.get_all("Surveillance Signal", filters={"source": "Field", "ref": ["in", refs or [""]], "event": ["is", "set"]},
			pluck="event")) if refs else set()
		extra = ev if extra is None else extra & ev
	elif source in EVENT_SIGNAL_SOURCE:
		ev = set(frappe.get_all("Surveillance Signal", filters={"source": EVENT_SIGNAL_SOURCE[source], "event": ["is", "set"]}, pluck="event"))
		extra = ev if extra is None else extra & ev
	if extra is None:
		return None if allowed is None else sorted(allowed)
	return sorted(extra if allowed is None else allowed & extra)


@frappe.whitelist()
def get_dashboard(trend_source="all", weeks=None, sub_county=None, disease=None):
	"""trend_source: all | mobile | web | whatsapp | cbs | facility. weeks: 4..52. sub_county: one Sub County, or empty. disease: one disease name, or empty.
	The filters apply to the stats, the lists, the charts and the trends alike."""
	if not (has_capability(VIEW_EVENTS) or has_capability("view_alerts") or has_capability("view_reports")):
		frappe.throw("You do not have permission to view the dashboard.", frappe.PermissionError)

	today = getdate(nowdate())
	n_weeks = min(max(cint(weeks) or TREND_WEEKS, 4), 52)
	out = {"stats": [], "alerts": [], "dailyVolume": {"labels": [], "data": []},
		"distribution": {"labels": [], "data": [], "changePct": []}, "eventsAvailable": False, "weeks": n_weeks}

	if has_capability(VIEW_EVENTS):
		out.update(_event_sections(today, n_weeks, trend_source, sub_county, disease))
		out["eventsAvailable"] = True
	out["trends"] = _trends(trend_source, today, weeks=n_weeks, sub_county=sub_county, disease=disease)
	# the disease list offers only diseases shown in the charts (before the disease filter), so it stays stable once one is picked
	out["diseaseOptions"] = sorted(set(out.pop("_diseases", [])) | set(out["trends"].pop("_diseases", [])))
	out["generatedAt"] = str(now_datetime())
	return out


def _event_sections(today, n_weeks=12, source="all", sub_county=None, disease=None):
	names = _filtered_names(_event_names(), source, sub_county)
	days = n_weeks * 7
	start, prev_start = add_days(today, -days), add_days(today, -2 * days)
	present = {r.disease_name for r in frappe.get_all("Surveillance Event",
		filters=_events(names, status=["!=", "Discarded"], creation=[">=", start]), fields=["disease_name"]) if r.disease_name}
	if disease:
		names = frappe.get_all("Surveillance Event", filters=_events(names, disease_name=disease), pluck="name")
	count = lambda **f: frappe.db.count("Surveillance Event", _events(names, **f))
	window = lambda a, b: ["between", [a, b]]

	open_now = count(status=["in", OPEN], last_reported=[">=", start])
	new_win = count(creation=[">=", start])
	new_prev = count(creation=window(prev_start, add_days(start, -1)))

	# reports submitted in our system (web, mobile, WhatsApp); the channel filter applies, CBS / facility have no case reports
	report_filters = {}
	from surveillance.events import _user_region
	region = _user_region()
	if region:
		report_filters["region"] = region
	if sub_county:
		report_filters["sub_county"] = sub_county
	if source in CHANNEL_SOURCES:
		report_filters["channel"] = CHANNEL_SOURCES[source]
	if disease:
		report_filters["suspected_disease"] = ["in", [k for k, v in _disease_names().items() if v == disease] + [disease]]
	no_reports = source in EVENT_SIGNAL_SOURCE
	rc = lambda **f: 0 if no_reports else frappe.db.count("Case Report", {**report_filters, **f})
	reports_win = rc(creation=[">=", start])
	reports_prev = rc(creation=window(prev_start, add_days(start, -1)))

	waiting = count(status=["in", WAITING], last_reported=[">=", start])
	waiting_new = count(status=["in", WAITING], creation=[">=", start])
	waiting_prev = count(status=["in", WAITING], creation=window(prev_start, add_days(start, -1)))

	esc_filters = {"parenttype": "Surveillance Event", "action": ESCALATED_ACTION}
	if names is not None:
		esc_filters["parent"] = ["in", names or [""]]
	esc_win = len(set(frappe.get_all("Surveillance Event Action", filters={**esc_filters, "at": [">=", start]}, pluck="parent")))
	esc_prev = len(set(frappe.get_all("Surveillance Event Action",
		filters={**esc_filters, "at": window(prev_start, add_days(start, -1))}, pluck="parent")))

	label = f"last {n_weeks} weeks"
	stats = [
		_stat("open_events", "Open Events", open_now, "MapPin", new_win, new_prev, compare=f"open events with a report in the {label}"),
		_stat("reports", f"Reports ({n_weeks} weeks)", reports_win, "AlertTriangle", reports_win, reports_prev,
			more_is_bad=False, compare=f"reports submitted in the {label}"),
		_stat("waiting_verification", "Waiting for Verification", waiting, "Radio", waiting_new, waiting_prev,
			compare=f"events with a report in the {label} not yet verified"),
		_stat("escalated", f"Escalated to MOH ({n_weeks} weeks)", esc_win, "CheckCheck", esc_win, esc_prev, compare=f"events escalated to county / MoH in the {label}"),
	]

	# most urgent open events
	rows = frappe.get_all("Surveillance Event", filters=_events(names, status=["in", OPEN]),
		fields=["name", "title", "disease_name", "severity", "status", "county", "sub_county", "area", "people", "deaths",
			"reports", "sources", "last_reported"], order_by="last_reported desc", limit_page_length=50)
	rows.sort(key=lambda r: (SEVERITY_ORDER.get(r.severity, 9), -(getdate(r.last_reported).toordinal() if r.last_reported else 0)))
	alerts = [{
		"id": r.name, "title": r.title or r.disease_name, "status": r.status, "severity": r.severity or "standard",
		"location": ", ".join([x for x in (r.area, r.sub_county, r.county) if x]) or "Location missing",
		"date": getdate(r.last_reported).strftime("%-d %b %Y") if r.last_reported else "",
		"affected": r.people or 0, "deaths": r.deaths or 0, "reports": r.reports or 0,
		"sources": [s.strip() for s in (r.sources or "").split(",") if s.strip()],
	} for r in rows[:5]]
	from surveillance.events import _channels_for
	chans = _channels_for([a["id"] for a in alerts])
	for a in alerts:
		a["channels"] = chans.get(a["id"], [])

	# new events per week across the chosen range
	weeks = [add_days(_week_start(today), -7 * i) for i in reversed(range(n_weeks))]
	per_week = defaultdict(int)
	for c in frappe.get_all("Surveillance Event", filters=_events(names, creation=[">=", weeks[0]]), pluck="creation"):
		per_week[_week_start(c)] += 1
	volume = {"labels": [w.strftime("%-d %b") for w in weeks], "data": [per_week[w] for w in weeks]}

	# events by disease in the range (discarded left out), with change vs the range before
	def by_disease(a, b=None):
		f = {"status": ["!=", "Discarded"], "creation": [">=", a] if b is None else ["between", [a, b]]}
		res = defaultdict(int)
		for r in frappe.get_all("Surveillance Event", filters=_events(names, **f), fields=["disease_name"]):
			res[r.disease_name or "Unknown"] += 1
		return res
	cur, prev = by_disease(start), by_disease(prev_start, add_days(start, -1))
	order = sorted(cur, key=lambda k: -cur[k])
	distribution = {"labels": order, "data": [cur[k] for k in order], "changePct": [_pct(cur[k], prev.get(k, 0)) for k in order]}

	return {"stats": stats, "alerts": alerts, "dailyVolume": volume, "distribution": distribution, "_diseases": sorted(present)}


def _trends(source, today, weeks=None, sub_county=None, disease=None):
	from surveillance.events import _scope
	source = source if source in TREND_SOURCES or source in CHANNEL_SOURCES else "all"
	last = add_days(_week_start(today), -7)                     # last complete week
	n_weeks = min(max(int(weeks or TREND_WEEKS), 4), 52)
	weeks = [add_days(last, -7 * i) for i in reversed(range(n_weeks))]
	subs, _ = _scope()
	area = "Dadaab and Kalobeyei sites"
	from surveillance.events import _user_region
	region = _user_region()
	if region:
		mine = {(n or "").strip().lower() for n in frappe.get_all("Sub County", filters={"region": region}, pluck="sub_county_name")}
		subs = subs & mine
		area = (frappe.db.get_value("Region", region, "region_name") or region) + " site"


	if sub_county:   # one sub-county, only if it is inside this user's area
		key = (frappe.db.get_value("Sub County", sub_county, "sub_county_name") or sub_county).strip().lower()
		subs = {key} & subs
		area = frappe.db.get_value("Sub County", sub_county, "sub_county_name") or sub_county

	if source in CHANNEL_SOURCES:   # case reports from one channel, counted by suspected disease and week
		raw = frappe.db.sql("""
			select suspected_disease as disease, sub_county, date_sub(date(creation), interval weekday(creation) day) as week_start, count(*) as n
			from `tabCase Report`
			where channel = %(channel)s and suspected_disease is not null and suspected_disease != ''
				and date(creation) >= %(first)s and date(creation) < %(after)s
			group by suspected_disease, sub_county, week_start
		""", {"channel": CHANNEL_SOURCES[source], "first": weeks[0], "after": add_days(last, 7)}, as_dict=True)
		sc_names = {r.name: r.sub_county_name for r in frappe.get_all("Sub County", fields=["name", "sub_county_name"])}
		rows = [frappe._dict(disease=r.disease, sub_county=sc_names.get(r.sub_county, r.sub_county), week_start=r.week_start, n=r.n) for r in raw]
	else:
		rows = frappe.db.sql("""
			select disease, sub_county, week_start, sum(signals) as n
			from `tabWeekly Count`
			where source in %(sources)s and week_start between %(first)s and %(last)s
			group by disease, sub_county, week_start
		""", {"sources": tuple(TREND_SOURCES[source]), "first": weeks[0], "last": last}, as_dict=True)

	totals, series = defaultdict(int), defaultdict(lambda: defaultdict(int))
	for r in rows:
		if (r.sub_county or "").strip().lower() not in subs:
			continue
		n = int(r.n or 0)
		totals[r.disease] += n
		series[r.disease][getdate(r.week_start)] += n

	names = _disease_names()
	top = [d for d in sorted(totals, key=lambda k: -totals[k]) if totals[d] > 0][:TOP_DISEASES]
	shown = sorted({names.get(d, d) for d in top})
	if disease:
		top = [d for d in sorted(totals, key=lambda k: -totals[k]) if totals[d] > 0 and names.get(d, d) == disease]
	latest = None if source in CHANNEL_SOURCES else frappe.db.sql(
		"select max(week_start) from `tabWeekly Count` where source in %(s)s", {"s": tuple(TREND_SOURCES[source])})[0][0]
	return {
		"source": source,
		"labels": [w.strftime("%-d %b") for w in weeks],
		"weeks": [str(w) for w in weeks],
		"series": [{"key": d, "name": names.get(d, d), "data": [series[d][w] for w in weeks], "total": totals[d]} for d in top],
		"latestWeek": str(latest) if latest else None,
		"area": area,
		"_diseases": shown,

	}
