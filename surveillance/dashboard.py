"""Dashboard Overview: one call that returns everything the Dashboard page shows.

Events (stats, alert list, daily volume, distribution) follow the same region scope as Alerts & Signals:
officers see their own region; national users (no region) see everything.
Disease trends come from Weekly Count for the pilot sub-counties, split by source:
  community = field reports (Case Report) + CBS
  facility  = MOH 505 / IDSR (and EMR once connected)
"""
from collections import defaultdict

import frappe
from frappe.utils import add_days, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability

VIEW_EVENTS = "view_review_queue"
OPEN = ["New", "Verifying", "Investigating", "Confirmed", "Escalated"]
WAITING = ["New", "Verifying"]
ESCALATED_ACTION = "Escalated to county / MoH"
SEVERITY_ORDER = {"critical": 0, "high": 1, "standard": 2}
TREND_SOURCES = {
	"community": ["Case Report", "CBS"],
	"facility": ["IDSR", "EMR"],
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


@frappe.whitelist()
def get_dashboard(trend_source="community"):
	if not (has_capability(VIEW_EVENTS) or has_capability("view_alerts") or has_capability("view_reports")):
		frappe.throw("You do not have permission to view the dashboard.", frappe.PermissionError)

	today = getdate(nowdate())
	out = {"stats": [], "alerts": [], "dailyVolume": {"labels": [], "data": []},
		"distribution": {"labels": [], "data": [], "changePct": []}, "eventsAvailable": False}

	if has_capability(VIEW_EVENTS):
		out.update(_event_sections(today))
		out["eventsAvailable"] = True
	out["trends"] = _trends(trend_source, today)
	out["generatedAt"] = str(now_datetime())
	return out


def _event_sections(today):
	names = _event_names()
	d30, d60, d7, d14 = add_days(today, -30), add_days(today, -60), add_days(today, -7), add_days(today, -14)
	count = lambda **f: frappe.db.count("Surveillance Event", _events(names, **f))

	open_now = count(status=["in", OPEN])
	new_30 = count(creation=[">=", d30])
	new_prev_30 = count(creation=["between", [d60, add_days(d30, -1)]])

	# every report submitted in our system (web, mobile, WhatsApp), any disease; officers see their own region
	report_filters = {}
	if names is not None:
		from surveillance.events import _user_region
		region = _user_region()
		if region:
			report_filters["region"] = region
	reports_today = frappe.db.count("Case Report", {**report_filters, "creation": [">=", today]})
	reports_yesterday = frappe.db.count("Case Report", {**report_filters,
		"creation": ["between", [add_days(today, -1), add_days(today, -1)]]})

	waiting = count(status=["in", WAITING])
	waiting_new_7 = count(status=["in", WAITING], creation=[">=", d7])
	waiting_new_prev = count(status=["in", WAITING], creation=["between", [d14, add_days(d7, -1)]])

	esc_filters = {"parenttype": "Surveillance Event", "action": ESCALATED_ACTION}
	if names is not None:
		esc_filters["parent"] = ["in", names or [""]]
	esc_30 = len(set(frappe.get_all("Surveillance Event Action", filters={**esc_filters, "at": [">=", d30]}, pluck="parent")))
	esc_prev = len(set(frappe.get_all("Surveillance Event Action",
		filters={**esc_filters, "at": ["between", [d60, add_days(d30, -1)]]}, pluck="parent")))

	stats = [
		_stat("open_events", "Open Events", open_now, "MapPin", new_30, new_prev_30, compare="new events vs previous 30 days"),
		_stat("reports_today", "Reports Today", reports_today, "AlertTriangle", reports_today, reports_yesterday,
			more_is_bad=False, compare="reports submitted in the system vs yesterday"),
		_stat("waiting_verification", "Waiting for Verification", waiting, "Radio", waiting_new_7, waiting_new_prev,
			compare="new this week vs last week"),
		_stat("escalated", "Escalated to MOH (30 days)", esc_30, "CheckCheck", esc_30, esc_prev, compare="vs previous 30 days"),
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

	# new events per day, last 7 days
	days = [add_days(today, -i) for i in reversed(range(7))]
	per_day = defaultdict(int)
	for c in frappe.get_all("Surveillance Event", filters=_events(names, creation=[">=", days[0]]), pluck="creation"):
		per_day[getdate(c)] += 1
	volume = {"labels": [d.strftime("%a %-d") for d in days], "data": [per_day[d] for d in days]}

	# events by disease, last 30 days (discarded left out), with change vs previous 30 days
	def by_disease(start, end=None):
		f = {"status": ["!=", "Discarded"], "creation": [">=", start] if end is None else ["between", [start, end]]}
		res = defaultdict(int)
		for r in frappe.get_all("Surveillance Event", filters=_events(names, **f), fields=["disease_name"]):
			res[r.disease_name or "Unknown"] += 1
		return res
	cur, prev = by_disease(d30), by_disease(d60, add_days(d30, -1))
	order = sorted(cur, key=lambda k: -cur[k])
	distribution = {"labels": order, "data": [cur[k] for k in order], "changePct": [_pct(cur[k], prev.get(k, 0)) for k in order]}

	return {"stats": stats, "alerts": alerts, "dailyVolume": volume, "distribution": distribution}


def _trends(source, today):
	from surveillance.events import _scope
	source = source if source in TREND_SOURCES else "community"
	last = add_days(_week_start(today), -7)                     # last complete week
	weeks = [add_days(last, -7 * i) for i in reversed(range(TREND_WEEKS))]
	subs, _ = _scope()
	area = "Dadaab and Kalobeyei sites"
	from surveillance.events import _user_region
	region = _user_region()
	if region:
		mine = {(n or "").strip().lower() for n in frappe.get_all("Sub County", filters={"region": region}, pluck="sub_county_name")}
		subs = subs & mine
		area = (frappe.db.get_value("Region", region, "region_name") or region) + " site"


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
	latest = frappe.db.sql("select max(week_start) from `tabWeekly Count` where source in %(s)s",
		{"s": tuple(TREND_SOURCES[source])})[0][0]
	return {
		"source": source,
		"labels": [w.strftime("%-d %b") for w in weeks],
		"weeks": [str(w) for w in weeks],
		"series": [{"key": d, "name": names.get(d, d), "data": [series[d][w] for w in weeks], "total": totals[d]} for d in top],
		"latestWeek": str(latest) if latest else None,
		"area": area,

	}
