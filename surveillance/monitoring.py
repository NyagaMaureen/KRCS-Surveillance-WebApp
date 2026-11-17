"""Monitoring Reports (SRS D.5, KRCS 16 Nov 2026).

  R34  Surveillance Signal Summary   signals in the period, by week, channel, disease and sub-county
  R35  Alert and Triage              events, priority, risk score and time to start verification
  R36  Investigation and Response    decisions, closures and field tasks for the events of the period
  R37  Data Quality                  the Data Quality checks for the period, plus MOH 505 completeness
  R38  AI Performance                how often each AI part agreed with what people decided
  R39  Operational KPI               the main performance measures, one row per sub-county
  R40  Integration Health            CBS, MOH 505, WhatsApp, push, AI model, speech to text, weather
  R40b System Health                 errors, background jobs, logins and phones waiting to send

R41 every report is generated the same way: get_report(report, filters) -> summary (cards, charts) and detail (table).
R42 filters: region, sub_county, from_date, to_date, disease, channel (each report says which it uses).
R43 summary and detail views.  R44 exports: CSV and Excel here (export_report); PDF and JPEG are made in the browser
and logged with log_export. Exports need Export Monitoring Reports.  R46 every generation and export is logged
(Report Run Log) and shows in the Audit Log.  R45 (scheduled reports) comes later.

Access: View Monitoring Reports. Users limited to a region see that region; Surveillance Officers, FHWs and CHAs see
their own sub-county only (user_scope.locked_area) and do not get R40 / R40b (system-wide).

AI measures (R38, also on the dashboard's System Performance tab):
  Disease suggestions  the list of possible diseases shown to the officer (case definitions, possible diseases and the
                     AI model; logged by ai_classifier.get_report_candidates as AI Prediction rows, kind "Shown to officer")
                     against the report's final disease, once an officer chose it or its event was confirmed / escalated.
                     The model's own answers are also kept (kind "Model") for reference.
  Risk engine        events decided in the period: risk score 50+ ("High" or "Very high") against Confirmed / Escalated.
  Voice notes        Voice Extraction Review rows (logged when an officer adds details from a voice note).
  Speech to text     AI Model Metric rows the AI server sends from MLflow (push_model_metrics), e.g. metric "wer".
  Data Assistant     Chatbot Query Log, as on the AI Assistant Query Log page.
"""
import io
import json
from datetime import timedelta
from collections import Counter, defaultdict
from statistics import median

import frappe
from frappe.utils import add_days, cint, flt, get_datetime, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability, require_capability
from surveillance.user_scope import locked_area

VIEW = "view_monitoring_reports"
EXPORT = "export_monitoring_reports"
PUSH = "push_model_metrics"
RUN_LOG = "Report Run Log"
HIGH_RISK = 50          # risk score at or above this is "High" or "Very high" (risk.LEVELS)
DECIDED_POSITIVE = {"Confirmed", "Escalated"}
SEEN_AGAIN_MINUTES = 10  # the same report with the same filters opened again within this is not logged twice

FILTERS_ALL = ["region", "sub_county", "period", "disease", "channel"]
REPORTS = [
	{"key": "R34", "title": "Surveillance Signal Summary", "filters": FILTERS_ALL,
	 "description": "Every signal received in the period: field reports, CBS and EMR, by week, channel, disease and sub-county."},
	{"key": "R35", "title": "Alert and Triage", "filters": ["region", "sub_county", "period", "disease"],
	 "description": "Events created in the period: priority, risk score, and how fast verification started against the target."},
	{"key": "R36", "title": "Investigation and Response", "filters": ["region", "sub_county", "period", "disease"],
	 "description": "What happened to the events of the period: decisions, closures and the field tasks done for them."},
	{"key": "R37", "title": "Data Quality", "filters": ["region", "sub_county", "period"],
	 "description": "The Data Quality checks for reports and CBS signals of the period, and MOH 505 reporting completeness."},
	{"key": "R38", "title": "AI Performance", "filters": ["region", "sub_county", "period", "disease"],
	 "description": "How often each AI part agreed with what people decided in the end, and the model measures from MLflow."},
	{"key": "R39", "title": "Operational KPI", "filters": ["region", "sub_county", "period", "channel"],
	 "description": "The main performance measures for the period, one row per sub-county."},
	{"key": "R40", "title": "Integration Health", "filters": ["period"], "hq": True,
	 "description": "Each outside system the platform depends on: when data last came in, and errors in the period."},
	{"key": "R40b", "title": "System Health", "filters": ["period"], "hq": True,
	 "description": "Application errors, background jobs, sign-ins and phones with reports waiting to send, day by day."},
]
REPORT_MAP = {r["key"]: r for r in REPORTS}


# ---------- access and filters ----------

def _require(report=None):
	require_capability(VIEW)
	if report is None:
		return None
	r = REPORT_MAP.get(report)
	if not r:
		frappe.throw("Unknown report.")
	if r.get("hq") and locked_area():
		frappe.throw("This report is for HQ users.", frappe.PermissionError)
	return r


def _parse(filters):
	if isinstance(filters, str):
		filters = json.loads(filters or "{}")
	return frappe._dict(filters or {})


def _filters(raw):
	"""The report filters after the user's area lock (hq_dashboard._f) plus disease."""
	from surveillance.hq_dashboard import _f
	raw = _parse(raw)
	f = _f(raw.region, raw.sub_county, raw.from_date, raw.to_date, raw.channel)
	f.disease = raw.disease or None
	area = locked_area()
	if area:
		f.scope = f"{area.sub_county} sub-county"
	elif f.sub_county:
		f.scope = f"{(raw.sub_county or '').strip()} sub-county"
	elif f.region:
		f.scope = frappe.db.get_value("Region", f.region, "region_name") or f.region
	else:
		f.scope = "National"
	f.weeks = _weeks(f)
	return f


def _weeks(f):
	out, w = [], _week(f.from_d)
	while w <= f.to_d:
		out.append(w)
		w = add_days(w, 7)
	return out


def _week(d):
	d = getdate(d)
	return add_days(d, -d.weekday())


def _wlabel(w):
	return f"W{getdate(w).isocalendar()[1]}"


def _in_period(v, f):
	return bool(v) and f.start <= get_datetime(v) <= f.end


def _pct(a, b, digits=1):
	return round(a * 100 / b, digits) if b else None


def _card(key, label, value, note=""):
	return {"key": key, "label": label, "value": value, "note": note}


def _chart(key, title, kind, labels, series, note=""):
	"""kind: bar | hbar | line | doughnut. series: [{label, data}]"""
	return {"key": key, "title": title, "type": kind, "labels": [str(x) for x in labels], "series": series, "note": note}


def _counter_chart(key, title, kind, counter, keys=None, label="Count", limit=None, note=""):
	items = [(k, counter.get(k, 0)) for k in keys] if keys else counter.most_common(limit)
	return _chart(key, title, kind, [k for k, _ in items], [{"label": label, "data": [n for _, n in items]}], note)


def _sub_of(name_or_text, subs=None):
	"""Case Report.sub_county is a Sub County link: its readable name, lower case for matching."""
	if not name_or_text:
		return ""
	subs = subs if subs is not None else _subs()
	s = subs.get(name_or_text)
	return ((s.sub_county_name if s else name_or_text) or "").strip()


def _subs():
	return {s.name: s for s in frappe.get_all("Sub County", fields=["name", "sub_county_name", "region"])}


def _scope_subs(f):
	"""Lower-case names of the pilot sub-counties in the user's scope."""
	from surveillance.events import _scope
	pilot, _d = _scope()
	names = set()
	for s in frappe.get_all("Sub County", filters={"region": f.region} if f.region else {}, fields=["sub_county_name"]):
		n = (s.sub_county_name or "").strip().lower()
		if n and (not pilot or n in pilot):
			names.add(n)
	if f.sub_county:
		names = {f.sub_county}
	return names


def _events(f, date_field="creation", extra_fields=()):
	from surveillance.hq_dashboard import _event_filters, _event_in_sub
	ef = _event_filters(f, **{date_field: ["between", [f.start, f.end]]})
	if f.disease:
		ef["disease"] = f.disease
	fields = ["name", "creation", "title", "disease", "disease_name", "severity", "status", "sub_county", "area", "region",
		"risk_score", "decision", "decided_on", "closed_on", "first_reported", "people", "reports", *extra_fields]
	return [e for e in frappe.get_all("Surveillance Event", filters=ef, fields=fields, order_by="creation desc",
		limit_page_length=0) if _event_in_sub(e, f)]


def _risk_level(score):
	from surveillance.risk import LEVELS
	if score is None:
		return "—"
	return next((label for floor, label in LEVELS if cint(score) >= floor), "Low")


def _dt(v):
	return str(v)[:16] if v else ""


# ---------- R34 Surveillance Signal Summary ----------

def _r34(f):
	from surveillance.hq_dashboard import CHANNEL_LABEL, _diseases, _disease_label, _signals
	dis = _diseases()
	rows = _signals(f, dis, all_diseases=True)
	if f.disease:
		rows = [r for r in rows if r["disease"] == f.disease]
	from surveillance.alert_thresholds import active_diseases
	active = set(active_diseases())
	per_week = Counter(_week(r["at"]) for r in rows if r["at"])
	by_disease = Counter(_disease_label(dis, r["disease"]) for r in rows)
	by_sub = Counter(r["subCounty"] or "No sub-county" for r in rows)
	return {
		"cards": [
			_card("signals", "Signals received", len(rows), f"{sum(1 for r in rows if not r['disease'] or r['disease'] in active)} for active diseases"),
			_card("people", "People affected", sum(r["people"] for r in rows), "as reported"),
			_card("grouped", "Grouped into events", sum(1 for r in rows if r["event"]), "signals that formed or joined an event"),
			_card("escalated", "Escalated", sum(1 for r in rows if r["escalated"]), "to county / MOH"),
			_card("unmatched", "Not matched to a disease", sum(1 for r in rows if not r["disease"]), "need an officer's review"),
		],
		"charts": [
			_chart("weeks", "Signals per week", "bar", [_wlabel(w) for w in f.weeks],
				[{"label": "Signals", "data": [per_week.get(w, 0) for w in f.weeks]}]),
			_counter_chart("channels", "Signals by channel", "bar",
				Counter(CHANNEL_LABEL.get(r["channel"], r["channel"]) for r in rows), label="Signals"),
			_counter_chart("diseases", "Signals by disease", "hbar", by_disease, label="Signals", limit=12,
				note="The 12 most reported"),
			_counter_chart("subcounties", "Signals by sub-county", "hbar", by_sub, label="Signals"),
		],
		"columns": [("id", "Signal"), ("date", "Received"), ("channel", "Channel"), ("disease", "Disease"),
			("subCounty", "Sub-county"), ("category", "Human or animal"), ("type", "Signal type"), ("status", "Status"),
			("people", "People"), ("event", "Event")],
		"rows": [{"id": r["id"], "date": _dt(r["at"]), "channel": CHANNEL_LABEL.get(r["channel"], r["channel"]),
			"disease": _disease_label(dis, r["disease"]), "subCounty": r["subCounty"], "category": r["category"],
			"type": r["type"], "status": r["status"], "people": r["people"], "event": r["event"] or ""}
			for r in sorted(rows, key=lambda r: str(r["at"] or ""), reverse=True)],
	}


# ---------- R35 Alert and Triage ----------

def _r35(f):
	from surveillance import analytics
	events = _events(f)
	acts = analytics._actions(events)
	hours = {e.name: analytics._hours_to_verify(e, acts) for e in events}
	started = [e for e in events if hours[e.name] is not None]
	in_target = {e.name for e in started if hours[e.name] <= analytics.TARGET_HOURS.get(e.severity, 72)}
	per_week = defaultdict(list)
	for e in started:
		per_week[_week(e.creation)].append(hours[e.name])
	med = round(median(hours[e.name] for e in started), 1) if started else None
	sev = Counter(e.severity or "standard" for e in events)
	return {
		"cards": [
			_card("events", "Events created", len(events), "clusters of signals"),
			_card("priority", "Critical or high", sev["critical"] + sev["high"], f"{sev['critical']} critical"),
			_card("high_risk", "High risk score", sum(1 for e in events if cint(e.risk_score) >= HIGH_RISK), f"score {HIGH_RISK} or more"),
			_card("started", "Verification started", len(started), f"of {len(events)} events"),
			_card("in_target", "Verified within target", "—" if not started else f"{_pct(len(in_target), len(started))}%",
				"critical 24 h, high 48 h, standard 72 h"),
			_card("median", "Median time to start verification", "—" if med is None else f"{med} h", "half the events started within this time"),
		],
		"charts": [
			_counter_chart("severity", "Events by priority", "bar", sev, keys=["critical", "high", "standard"], label="Events"),
			_counter_chart("risk", "Events by risk level", "bar", Counter(_risk_level(e.risk_score) for e in events),
				keys=["Very high", "High", "Medium", "Low"], label="Events"),
			_counter_chart("status", "Events by status", "bar", Counter(e.status for e in events),
				keys=["New", "Verifying", "Investigating", "Confirmed", "Escalated", "Discarded", "Closed"], label="Events"),
			_chart("median_week", "Median hours to start verification, per week", "bar", [_wlabel(w) for w in f.weeks],
				[{"label": "Median hours", "data": [round(median(per_week[w]), 1) if per_week.get(w) else None for w in f.weeks]}],
				"Weeks with no verification started are empty"),
		],
		"columns": [("id", "Event"), ("disease", "Disease"), ("subCounty", "Sub-county"), ("severity", "Priority"),
			("riskScore", "Risk score"), ("riskLevel", "Risk level"), ("status", "Status"), ("created", "Created"),
			("hours", "Hours to start verification"), ("inTarget", "Within target"), ("decision", "Decision")],
		"rows": [{"id": e.name, "disease": e.disease_name or e.title or "", "subCounty": e.sub_county or "",
			"severity": e.severity or "", "riskScore": e.risk_score if e.risk_score is not None else "",
			"riskLevel": _risk_level(e.risk_score), "status": e.status, "created": _dt(e.creation),
			"hours": "" if hours[e.name] is None else round(hours[e.name], 1),
			"inTarget": "" if hours[e.name] is None else ("Yes" if e.name in in_target else "No"), "decision": e.decision or ""}
			for e in events],
		"notes": [
			"Time to start verification: hours from the event being created (its first signal arriving) to an officer pressing "
			"\"Start verification\" in the Review Queue. The median is the middle value: half the events started faster, half slower.",
			"Verified within target: of the events where verification has started, how many started within the target for their "
			"priority: critical 24 hours, high 48 hours, standard 72 hours. Events not started yet are not counted.",
			f"Risk score: the AI risk engine's score from 0 to 100; {HIGH_RISK} or more is High or Very high.",
		],
	}


# ---------- R36 Investigation and Response ----------

def _closed_at(e, acts):
	"""When the event was closed. Discarding closes an event too (at verification), but only "Close" sets closed_on,
	so a discarded event uses its decision time, or the time of its Discarded / Closed action."""
	if e.status not in ("Closed", "Discarded"):
		return None
	if e.closed_on:
		return e.closed_on
	if e.decided_on:
		return e.decided_on
	at = [a.at for a in acts.get(e.name, []) if a.action in ("Discarded", "Closed") and a.at]
	return max(at) if at else None


def _r36(f):
	from frappe.utils import get_fullname
	from surveillance import analytics
	events = _events(f)
	names = [e.name for e in events]
	acts = analytics._actions(events)
	tasks = frappe.get_all("Event Task", filters={"event": ["in", names]}, limit_page_length=0, order_by="creation asc",
		fields=["name", "event", "task_type", "title", "assigned_to", "assigned_by", "status", "due_date", "completed_on",
			"creation", "outcome", "disease_name", "sub_county", "area", "facility"]) if names else []
	today = getdate(nowdate())
	by_event = defaultdict(list)
	for t in tasks:
		by_event[t.event].append(t)
	open_status = ("Assigned", "In progress", "Blocked")
	overdue = {t.name for t in tasks if t.status in open_status and t.due_date and getdate(t.due_date) < today}
	closed = {e.name: _closed_at(e, acts) for e in events}
	closed = {k: v for k, v in closed.items() if v}
	status_of = {e.name: e.status for e in events}
	days_to_close = {e.name: round((get_datetime(closed[e.name]) - get_datetime(e.creation)).total_seconds() / 86400, 1)
		for e in events if e.name in closed}
	decisions = Counter(e.decision or "No decision yet" for e in events)
	types = ["Field visit", "Referral", "Sample collection", "Follow-up", "Response action"]
	done = Counter(t.task_type for t in tasks if t.status == "Done")
	open_ = Counter(t.task_type for t in tasks if t.status in open_status)
	failed = Counter(t.task_type for t in tasks if t.status == "Could not complete")
	names_cache = {}

	def who(user):
		if not user:
			return ""
		if user not in names_cache:
			names_cache[user] = get_fullname(user)
		return names_cache[user]
	discarded = sum(1 for e in events if e.status == "Discarded")
	return {
		"cards": [
			_card("events", "Events in the period", len(events)),
			_card("decided", "Decision made", sum(1 for e in events if e.decision), f"{decisions['Confirmed']} confirmed, {decisions['Escalated']} escalated"),
			_card("closed", "Closed", len(closed), f"{discarded} of them discarded at verification" if discarded else "events closed so far"),
			_card("days", "Median days to close", "—" if not days_to_close else f"{round(median(days_to_close.values()), 1)}", "from the event arriving to closing or discarding"),
			_card("tasks", "Field tasks", len(tasks), f"{sum(done.values())} done"),
			_card("overdue", "Tasks overdue", len(overdue), "past their due date, not done"),
		],
		"charts": [
			_counter_chart("decisions", "Decisions", "bar", decisions,
				keys=["Confirmed", "Not confirmed", "Discarded", "Escalated", "No decision yet"], label="Events"),
			_chart("tasks", "Field tasks by type", "hbar", types, [
				{"label": "Done", "data": [done.get(t, 0) for t in types]},
				{"label": "Still open", "data": [open_.get(t, 0) for t in types]},
				{"label": "Could not complete", "data": [failed.get(t, 0) for t in types]}]),
		],
		"tableTitle": "Events",
		"columns": [("id", "Event"), ("disease", "Disease"), ("subCounty", "Sub-county"), ("status", "Status"),
			("decision", "Decision"), ("decidedOn", "Decided on"), ("closedOn", "Closed on"), ("daysToClose", "Days to close"),
			("tasksDone", "Tasks done"), ("tasksTotal", "Tasks"), ("tasksOverdue", "Tasks overdue")],
		"rows": [{"id": e.name, "disease": e.disease_name or e.title or "", "subCounty": e.sub_county or "", "status": e.status,
			"decision": e.decision or "", "decidedOn": _dt(e.decided_on), "closedOn": _dt(closed.get(e.name)),
			"daysToClose": days_to_close.get(e.name, ""), "tasksDone": sum(1 for t in by_event[e.name] if t.status == "Done"),
			"tasksTotal": len(by_event[e.name]), "tasksOverdue": sum(1 for t in by_event[e.name] if t.name in overdue)} for e in events],
		"notes": [
			"Events in the period: events created in the period; their decisions, closures and tasks are counted whenever they happened.",
			"Closed includes events discarded at verification: discarding closes an event. Its closing date is when it was discarded.",
			"Tasks overdue: still assigned, in progress or blocked after their due date. The Detail view lists every task, "
			"who it was assigned to and its outcome (choose Field tasks).",
		],
		# second table: every field task of these events, what it was and who had it
		"tables": [{"key": "tasks", "title": "Field tasks", "columns": [("id", "Task"), ("event", "Event"), ("type", "Type"),
			("task", "What to do"), ("place", "Place"), ("assignedTo", "Assigned to"), ("assignedBy", "Assigned by"),
			("assignedOn", "Assigned on"), ("due", "Due"), ("status", "Status"), ("completedOn", "Completed on"),
			("overdue", "Overdue"), ("outcome", "Outcome")],
			"rows": [{"id": t.name, "event": t.event, "type": t.task_type, "task": t.title or "",
				"place": ", ".join(x for x in [t.facility and f"Refer to {t.facility}", t.area, t.sub_county] if x),
				"assignedTo": who(t.assigned_to), "assignedBy": who(t.assigned_by), "assignedOn": _dt(t.creation),
				"due": str(t.due_date or ""), "status": t.status, "completedOn": _dt(t.completed_on),
				"overdue": "Yes" if t.name in overdue else ("" if t.status in open_status else "No"),
				"outcome": (t.outcome or "")[:300], "eventStatus": status_of.get(t.event, "")} for t in tasks]}],
	}


# ---------- R37 Data Quality ----------

DQ_LABELS = {"location": "Missing place", "late": "Sent late", "unclassified": "No disease matched",
	"duplicate": "Possible duplicate", "completeness": "MOH 505 week missing"}


def _r37(f):
	"""The Data Quality page's checks (officer.get_data_quality), for this period and area. Issues already checked
	on the Data Quality page are kept here and marked Checked."""
	from surveillance.analytics import _completeness
	from surveillance.officer import DQ_DISMISS
	dismissed = set(frappe.get_all(DQ_DISMISS, pluck="issue_key")) if frappe.db.table_exists(DQ_DISMISS) else set()
	subs = _subs()
	issues = []

	def add(kind, key, record, detail, source, at=None, sub=""):
		issues.append({"kind": DQ_LABELS[kind], "record": record, "detail": detail, "source": source, "date": _dt(at),
			"subCounty": sub, "checked": "Yes" if f"{kind}:{key}" in dismissed else "No"})

	cr = {"creation": ["between", [f.start, f.end]]}
	if f.region and not f.sub_county:
		cr["region"] = f.region
	reports = [r for r in frappe.get_all("Case Report", filters=cr, limit_page_length=0, order_by="creation asc",
		fields=["name", "location_name", "sub_county", "latitude", "longitude", "onset_date", "creation", "suspected_disease",
			"review_outcome", "symptom_tags", "reported_by", "owner", "channel"])
		if not f.sub_county or _sub_of(r.sub_county, subs).lower() == f.sub_county]
	for r in reports:
		sub, src = _sub_of(r.sub_county, subs), r.channel or "Web"
		if not r.sub_county:
			add("location", r.name, r.name, f"No sub-county. Place given: {r.location_name or 'none'}.", src, r.creation)
		elif r.latitude in (None, 0) and r.longitude in (None, 0):
			add("location", r.name, r.name, "No GPS point, so it does not show on the map.", src, r.creation, sub)
		if r.onset_date and getdate(r.creation) > add_days(getdate(r.onset_date), 1):
			add("late", r.name, r.name, f"Sent {(getdate(r.creation) - getdate(r.onset_date)).days} days after symptoms started.",
				src, r.creation, sub)
		if not r.suspected_disease and not r.review_outcome:
			add("unclassified", r.name, r.name, f"Symptoms: {r.symptom_tags or 'none given'}.", src, r.creation, sub)
	groups = defaultdict(list)
	for r in reports:
		groups[(r.reported_by or r.owner, (r.sub_county or "").lower(), (r.symptom_tags or "").lower())].append(r)
	for grp in groups.values():
		for a, b in zip(grp, grp[1:]):
			if (get_datetime(b.creation) - get_datetime(a.creation)).total_seconds() <= 86400:
				add("duplicate", f"{a.name}|{b.name}", f"{a.name} and {b.name}", "Same reporter, place and symptoms within 24 hours.",
					b.channel or "Web", b.creation, _sub_of(b.sub_county, subs))

	sf = {"source": "CBS", "signal_date": ["between", [f.start, f.end]]}
	if f.region and not f.sub_county:
		sf["region"] = f.region
	for s in frappe.get_all("Surveillance Signal", filters=sf, fields=["ref", "disease", "sub_county", "area", "signal_date"],
			limit_page_length=0):
		if f.sub_county and (s.sub_county or "").strip().lower() != f.sub_county:
			continue
		if not s.sub_county:
			add("location", f"cbs-{s.ref}", f"CBS {s.ref}", f"No sub-county. Place given: {s.area or 'none'}.", "CBS", s.signal_date)
		if not s.disease or s.disease == "unclassified-illness":
			add("unclassified", f"cbs-{s.ref}", f"CBS {s.ref}", "No disease matched.", "CBS", s.signal_date, s.sub_county or "")

	weeks = max(1, min(len(f.weeks), 52))
	comp = _completeness(weeks, _scope_subs(f))
	for c in comp.get("facilities") or []:
		if c["pct"] < 100:
			add("completeness", f"{c['facility']}:{comp.get('upTo')}", c["facility"],
				f"{c['reported']} of the last {c['weeks']} weeks reported.", "MOH 505", comp.get("upTo"), c["subCounty"] or "")

	kinds = Counter(i["kind"] for i in issues)
	low = sorted(comp.get("facilities") or [], key=lambda c: c["pct"])[:15]
	return {
		"cards": [
			_card("issues", "Issues found", len(issues), f"{sum(1 for i in issues if i['checked'] == 'Yes')} already checked"),
			_card("checked", "Reports checked", len(reports), "field reports in the period"),
			_card("location", "Missing place", kinds[DQ_LABELS["location"]]),
			_card("late", "Sent late", kinds[DQ_LABELS["late"]], "more than a day after symptoms started"),
			_card("duplicate", "Possible duplicates", kinds[DQ_LABELS["duplicate"]]),
			_card("completeness", "MOH 505 completeness", "—" if comp.get("overall") is None else f"{comp['overall']}%",
				f"last {weeks} weeks loaded" if comp.get("upTo") else "no MOH 505 weeks loaded"),
		],
		"charts": [
			_counter_chart("kinds", "Issues by kind", "hbar", kinds, keys=list(DQ_LABELS.values()), label="Issues"),
			_counter_chart("sources", "Issues by source", "bar", Counter(i["source"] for i in issues), label="Issues"),
			_chart("facilities", "MOH 505 completeness, lowest facilities", "hbar", [c["facility"] for c in low],
				[{"label": "% of weeks reported", "data": [c["pct"] for c in low]}], "Percent of weeks reported"),
		],
		"columns": [("kind", "Issue"), ("record", "Record"), ("detail", "Detail"), ("source", "Source"), ("subCounty", "Sub-county"),
			("date", "Date"), ("checked", "Checked")],
		"rows": sorted(issues, key=lambda i: i["date"], reverse=True),
	}


# ---------- R38 AI Performance ----------

SHOWN = "Shown to officer"
SOURCE_LABEL = {"Case definition": "Case definition", "Possible": "Possible (warning sign)", "Model": "AI model",
	"Unlikely": "Listed as unlikely"}


def _suggestions(f):
	"""For each report, the first list of suggested diseases an officer was shown in the period (what they saw before
	deciding), with the report's final disease. Judged only when a person settled the disease: the officer chose it
	(classified_by = Officer), or its event was confirmed or escalated with that disease."""
	if not frappe.db.table_exists("AI Prediction") or not frappe.db.has_column("AI Prediction", "kind"):
		return []
	rows = frappe.get_all("AI Prediction", filters={"kind": SHOWN, "predicted_on": ["between", [f.start, f.end]]},
		limit_page_length=0, order_by="predicted_on asc",
		fields=["case_report", "predicted_on", "predicted_disease", "top_group", "suggested", "suggested_sources"])
	first = {}
	for r in rows:
		first.setdefault(r.case_report, r)
	if not first:
		return []
	subs = _subs()
	reports = {c.name: c for c in frappe.get_all("Case Report", filters={"name": ["in", list(first)]}, limit_page_length=0,
		fields=["name", "suspected_disease", "classified_by", "region", "sub_county"])}
	ev_of = {s.ref: s.event for s in frappe.get_all("Surveillance Signal", filters={"source": "Field", "ref": ["in", list(first)]},
		fields=["ref", "event"], limit_page_length=0)}
	decision = {e.name: e.decision for e in frappe.get_all("Surveillance Event",
		filters={"name": ["in", [e for e in ev_of.values() if e] or [""]]}, fields=["name", "decision"], limit_page_length=0)}
	out = []
	for name, p in first.items():
		c = reports.get(name)
		if not c:
			continue
		sub = _sub_of(c.sub_county, subs)
		if f.sub_county and sub.lower() != f.sub_county:
			continue
		if f.region and not f.sub_county and c.region != f.region:
			continue
		if f.disease and c.suspected_disease != f.disease:
			continue
		keys = [k for k in (p.suggested or "").split(",") if k]
		sources = (p.suggested_sources or "").split(",")
		settled_by = ("Officer" if c.classified_by == "Officer" else
			"Event confirmed" if decision.get(ev_of.get(name)) in DECIDED_POSITIVE else None)
		p.update({"final": c.suspected_disease, "decidedBy": c.classified_by, "settledBy": settled_by, "subCounty": sub,
			"shownKeys": keys, "sources": dict(zip(keys, sources)), "judged": bool(settled_by and c.suspected_disease)})
		out.append(p)
	return out


def _measure(key, part, measure, value, based, how, unit="%", target=None):
	return {"key": key, "part": part, "measure": measure, "value": value, "unit": unit, "based": based, "how": how,
		"target": target}


def ai_measures(f, sugg=None, decided=None):
	"""The AI measures for this period and area. Also used by hq_dashboard.get_performance (AI performance panel)."""
	from surveillance.hq_dashboard import _chatbot, _diseases
	sugg = _suggestions(f) if sugg is None else sugg
	judged = [s for s in sugg if s.judged]
	top = [s for s in judged if s.shownKeys and s.shownKeys[0] == s.final]
	listed = [s for s in judged if s.final in s.shownKeys]

	decided = _events(f, "decided_on") if decided is None else decided
	decided = [e for e in decided if e.decision]
	high = [e for e in decided if cint(e.risk_score) >= HIGH_RISK]
	positive = [e for e in decided if e.decision in DECIDED_POSITIVE]
	tp = [e for e in high if e.decision in DECIDED_POSITIVE]

	voice = _voice_reviews(f)
	offered = sum(cint(v.offered) for v in voice)
	accepted = sum(min(cint(v.accepted), cint(v.offered)) for v in voice)

	wer = _latest_per_model(("wer", "word_error_rate"))
	pct = lambda v: round(flt(v) * 100, 1) if flt(v) <= 1 else round(flt(v), 1)   # noqa: E731 - MLflow may send 0.12 or 12
	wer_avg = round(sum(pct(m.value) for m in wer) / len(wer), 1) if wer else None
	wer_based = (", ".join(f"{_stt_label(m.model)} {pct(m.value)}%" for m in wer) + f" (MLflow, {_dt(max(m.recorded_on for m in wer))})"
		if wer else "Not sent by the AI server yet")
	questions, rate, helpful, _asked = _chatbot(f, _diseases())

	return [
		_measure("top_suggestion", "Disease suggestions", "First suggested disease matches the officer's final disease",
			_pct(len(top), len(judged)), f"{len(judged)} reports" if judged else "No settled reports with suggestions yet",
			"Officers see a list of possible diseases for each report: case definitions met, possible diseases (a warning sign "
			"is there) and the AI model's suggestions, in that order. We save the list the officer first saw and compare the "
			"first one with the disease the report ends up with, once an officer chose it or its event was confirmed or escalated."),
		_measure("in_suggestions", "Disease suggestions", "Officer's final disease was one of the diseases suggested",
			_pct(len(listed), len(judged)), f"{len(judged)} reports" if judged else "No settled reports with suggestions yet",
			"Same reports: counts a match anywhere in the list shown (case definition, possible or AI model)."),
		_measure("risk_precision", "Risk engine", "High-risk events that were confirmed or escalated (precision)", _pct(len(tp), len(high)),
			f"{len(high)} high-risk events decided" if high else "No high-risk events decided in the period",
			f"Events decided in the period with a risk score of {HIGH_RISK} or more: how many the officer confirmed or escalated."),
		_measure("risk_recall", "Risk engine", "Confirmed or escalated events that were scored high risk (recall)", _pct(len(tp), len(positive)),
			f"{len(positive)} confirmed or escalated" if positive else "No events confirmed or escalated in the period",
			f"Events confirmed or escalated in the period: how many had a risk score of {HIGH_RISK} or more."),
		_measure("voice", "Voice notes", "Details picked from voice notes that officers accepted", _pct(accepted, offered),
			f"{offered} details offered on {len(voice)} reports" if offered else "No voice note details reviewed yet",
			"When an officer checks a voice note against the report, we count the details offered and the ones they added."),
		_measure("wer", "Speech to text", "Word error rate on test recordings (lower is better)", wer_avg, wer_based,
			"The AI server tests each speech model in use (English, Kiswahili, mixed) on recordings with known text and sends the "
			"result from MLflow. The value is the average of the latest result for each language; each one is listed under Based on."),
		_measure("answer_rate", "KRCS Data Assistant", "Questions answered from approved content", rate,
			f"{questions} questions" if questions else "No questions in the period",
			"From the AI Assistant Query Log: questions answered from KRCS-approved documents.", target=75),
		_measure("helpful", "KRCS Data Assistant", "Answers rated helpful by users", helpful,
			"Of the answers users rated" if helpful is not None else "No ratings yet",
			"Users can mark an answer helpful or not; this is the share marked helpful."),
	]


def _voice_reviews(f):
	if not frappe.db.table_exists("Voice Extraction Review"):
		return []
	rows = frappe.get_all("Voice Extraction Review", filters={"reviewed_on": ["between", [f.start, f.end]]},
		fields=["case_report", "offered", "accepted"], limit_page_length=0)
	if not rows or not (f.region or f.sub_county):
		return rows
	subs = _subs()
	where = {c.name: c for c in frappe.get_all("Case Report", filters={"name": ["in", [r.case_report for r in rows]]},
		fields=["name", "region", "sub_county"], limit_page_length=0)}
	out = []
	for r in rows:
		c = where.get(r.case_report)
		if not c:
			continue
		if f.sub_county and _sub_of(c.sub_county, subs).lower() != f.sub_county:
			continue
		if f.region and not f.sub_county and c.region != f.region:
			continue
		out.append(r)
	return out


def _latest_per_model(names):
	"""The newest value of these metrics for each model (e.g. speech to text English, Kiswahili, mixed)."""
	if not frappe.db.table_exists("AI Model Metric"):
		return []
	latest = {}
	for r in frappe.get_all("AI Model Metric", filters={"metric": ["in", list(names)]}, order_by="recorded_on desc",
			fields=["model", "metric", "value", "model_version", "run_id", "recorded_on"], limit=500):
		latest.setdefault(r.model, r)
	return sorted(latest.values(), key=lambda r: r.model)


def _stt_label(model):
	"""speech-to-text-sw -> Kiswahili"""
	tail = (model or "").rsplit("-", 1)[-1].lower()
	return {"en": "English", "sw": "Kiswahili", "mixed": "Mixed"}.get(tail, model)


def _r38(f):
	from surveillance.hq_dashboard import _diseases, _disease_label
	dis = _diseases()
	sugg = _suggestions(f)
	decided = _events(f, "decided_on")
	measures = ai_measures(f, sugg, decided)
	judged = [s for s in sugg if s.judged]
	per_week = defaultdict(lambda: [0, 0])
	for s in judged:
		w = _week(s.predicted_on)
		per_week[w][1] += 1
		per_week[w][0] += bool(s.shownKeys) and s.shownKeys[0] == s.final
	# which kind of suggestion had the final disease (the first one that did)
	came_from = Counter(SOURCE_LABEL.get(s.sources.get(s.final), s.sources.get(s.final)) if s.final in s.shownKeys else "Not suggested"
		for s in judged)
	decided = [e for e in decided if e.decision]
	high = lambda e: cint(e.risk_score) >= HIGH_RISK   # noqa: E731
	pos = lambda e: e.decision in DECIDED_POSITIVE      # noqa: E731
	metrics = frappe.get_all("AI Model Metric", fields=["model", "metric", "value", "model_version", "run_id", "dataset", "recorded_on"],
		order_by="recorded_on desc", limit=200) if frappe.db.table_exists("AI Model Metric") else []
	latest = {}
	for m in metrics:
		latest.setdefault((m.model, m.metric), m)

	def name(k):
		return _disease_label(dis, k) if k else ""

	def shown(s):
		return "; ".join(f"{i + 1}. {name(k)} ({SOURCE_LABEL.get(s.sources.get(k), s.sources.get(k) or '')})" for i, k in enumerate(s.shownKeys))
	return {
		"cards": [_card(m["key"], f"{m['part']}: {m['measure']}", "—" if m["value"] is None else f"{m['value']}%", m["based"])
			for m in measures],
		"measures": measures,
		"charts": [
			_chart("agree_week", "First suggestion matched the final disease, per week", "line", [_wlabel(w) for w in f.weeks],
				[{"label": "% matched", "data": [_pct(*per_week[w]) if per_week.get(w) else None for w in f.weeks]}],
				"Weeks with no settled reports are empty"),
			_counter_chart("came_from", "Where the final disease was in the suggestions", "hbar", came_from,
				keys=[SOURCE_LABEL["Case definition"], SOURCE_LABEL["Possible"], SOURCE_LABEL["Model"], SOURCE_LABEL["Unlikely"], "Not suggested"],
				label="Reports", note="Case definitions, possible diseases and the AI model, as shown to the officer"),
			_chart("risk", "Risk score against the officer's decision", "hbar",
				["High risk, confirmed or escalated", "High risk, not confirmed", "Lower risk, confirmed or escalated", "Lower risk, not confirmed"],
				[{"label": "Events", "data": [sum(1 for e in decided if high(e) and pos(e)), sum(1 for e in decided if high(e) and not pos(e)),
					sum(1 for e in decided if not high(e) and pos(e)), sum(1 for e in decided if not high(e) and not pos(e))]}]),
		],
		"modelMetrics": [{"model": m.model, "metric": m.metric, "value": m.value, "version": m.model_version or "",
			"run": m.run_id or "", "dataset": m.dataset or "", "recordedOn": _dt(m.recorded_on)} for m in latest.values()],
		"notes": [
			"Suggestions start being saved when this update is installed: reports opened by an officer before then are not counted.",
			"A report counts once its disease is settled: an officer chose it on the report, or its event was confirmed or escalated.",
		],
		"columns": [("report", "Report"), ("date", "First shown"), ("subCounty", "Sub-county"), ("first", "First suggestion"),
			("shown", "All suggestions shown"), ("final", "Final disease"), ("settledBy", "Settled by"), ("firstMatched", "First matched"),
			("inList", "In the list")],
		"rows": [{"report": s.case_report, "date": _dt(s.predicted_on), "subCounty": s.subCounty,
			"first": f"{name(s.shownKeys[0])} ({SOURCE_LABEL.get(s.sources.get(s.shownKeys[0]), '')})" if s.shownKeys else "None",
			"shown": shown(s), "final": name(s.final), "settledBy": s.settledBy or "Not settled yet",
			"firstMatched": ("Yes" if s.shownKeys and s.shownKeys[0] == s.final else "No") if s.judged else "",
			"inList": ("Yes" if s.final in s.shownKeys else "No") if s.judged else ""}
			for s in sorted(sugg, key=lambda s: str(s.predicted_on), reverse=True)],
	}


# ---------- R39 Operational KPI ----------

# event actions that mean an officer is working on it (events.ACTION_LABEL, plus disease changes and notes)
OFFICER_ACTIONS = {"Verification started", "Field investigation started", "Confirmed", "Escalated to county / MoH", "Discarded",
	"Closed", "Closed: no event found", "Disease changed", "Note"}
NOT_FOR_REVIEW = {"Not for review", "Recorded"}


def _picked_up(reports):
	"""Hours from each report arriving to an officer first acting on it: the first officer action on the event the
	report is in (0 if officers were already working on that event), or the report's own review. None if not yet."""
	names = [r.name for r in reports]
	if not names:
		return {}
	ev_of = {s.ref: s.event for s in frappe.get_all("Surveillance Signal", filters={"source": "Field", "ref": ["in", names]},
		fields=["ref", "event"], limit_page_length=0) if s.event}
	first = {}
	if ev_of:
		for a in frappe.get_all("Surveillance Event Action", filters={"parenttype": "Surveillance Event",
				"parent": ["in", list(set(ev_of.values()))], "action": ["in", list(OFFICER_ACTIONS)]},
				fields=["parent", "at"], order_by="at asc", limit_page_length=0):
			first.setdefault(a.parent, a.at)
	out = {}
	for r in reports:
		at = first.get(ev_of.get(r.name)) or r.reviewed_on
		out[r.name] = max((get_datetime(at) - get_datetime(r.creation)).total_seconds() / 3600, 0) if at else None
	return out


def _r39(f):
	from surveillance import analytics
	subs_map = _subs()
	scope = _scope_subs(f)
	cr = {"creation": ["between", [f.start, f.end]]}
	if f.region and not f.sub_county:
		cr["region"] = f.region
	if f.channel:
		cr["channel"] = f.channel
	reports = [r for r in frappe.get_all("Case Report", filters=cr, limit_page_length=0,
		fields=["name", "creation", "sub_county", "reported_by", "owner", "reviewed_on", "status"])
		if _sub_of(r.sub_county, subs_map).lower() in scope]
	hours = _picked_up([r for r in reports if r.status not in NOT_FOR_REVIEW])
	events = _events(f)
	acts = analytics._actions(events)
	tf = {"due_date": ["between", [f.from_d, f.to_d]]}
	if f.region and not f.sub_county:
		tf["region"] = f.region
	tasks = [t for t in frappe.get_all("Event Task", filters=tf, fields=["sub_county", "status", "due_date", "completed_on"],
		limit_page_length=0) if (t.sub_county or "").strip().lower() in scope]
	comp = analytics._completeness(max(1, min(len(f.weeks), 52)), scope)
	comp_by = defaultdict(list)
	for c in comp.get("facilities") or []:
		comp_by[(c["subCounty"] or "").strip().lower()].append(c)

	def kpis(rs, evs, ts, facilities):
		need = [r for r in rs if r.name in hours]
		got = [hours[r.name] for r in need if hours[r.name] is not None]
		started = [(e, h) for e in evs if (h := analytics._hours_to_verify(e, acts)) is not None]
		in_t = sum(1 for e, h in started if h <= analytics.TARGET_HOURS.get(e.severity, 72))
		on_time = sum(1 for t in ts if t.status == "Done" and t.completed_on and getdate(t.completed_on) <= getdate(t.due_date))
		weeks = sum(c["weeks"] for c in facilities)
		return {"reports": len(rs), "reporters": len({r.reported_by or r.owner for r in rs}), "needReview": len(need),
			"picked48": _pct(sum(1 for h in got if h <= 48), len(need)), "pickedN": sum(1 for h in got if h <= 48),
			"medianPicked": round(median(got), 1) if got else None, "events": len(evs), "started": len(started), "inTarget": in_t,
			"verifiedInTarget": _pct(in_t, len(started)), "tasksDue": len(ts), "tasksOnTimeN": on_time,
			"tasksOnTime": _pct(on_time, len(ts)), "moh505": _pct(sum(c["reported"] for c in facilities), weeks, 0),
			"mohWeeks": weeks, "mohReported": sum(c["reported"] for c in facilities)}

	rows = []
	for sub in sorted(scope):
		label = next((s.sub_county_name for s in subs_map.values() if (s.sub_county_name or "").strip().lower() == sub), sub)
		k = kpis([r for r in reports if _sub_of(r.sub_county, subs_map).lower() == sub],
			[e for e in events if (e.sub_county or "").strip().lower() == sub or sub in (e.area or "").lower()],
			[t for t in tasks if (t.sub_county or "").strip().lower() == sub], comp_by.get(sub, []))
		rows.append({"subCounty": label, **{key: ("" if v is None else v) for key, v in k.items()}})
	k = kpis(reports, events, tasks, comp.get("facilities") or [])
	per_week = Counter(_week(r.creation) for r in reports)
	reporters_week = defaultdict(set)
	for r in reports:
		reporters_week[_week(r.creation)].add(r.reported_by or r.owner)
	show = lambda v, unit="%": "—" if v is None else f"{v}{unit}"   # noqa: E731
	return {
		"cards": [
			_card("reports", "Field reports", k["reports"], f"sent by {k['reporters']} different people"),
			_card("picked48", "Picked up within 48 hours", show(k["picked48"]),
				f"{k['pickedN']} of {k['needReview']} reports for the Review Queue"
				+ (f"; half within {k['medianPicked']} h" if k["medianPicked"] is not None else "")),
			_card("verified", "Verification started on time", show(k["verifiedInTarget"]),
				f"{k['inTarget']} of {k['started']} events started; {k['events']} events in all"),
			_card("tasks", "Field tasks done by the due date", show(k["tasksOnTime"]), f"{k['tasksOnTimeN']} of {k['tasksDue']} tasks due in the period"),
			_card("moh505", "MOH 505 weeks reported", show(k["moh505"]),
				f"{k['mohReported']} of {k['mohWeeks']} facility-weeks" if k["mohWeeks"] else "no MOH 505 weeks loaded"),
		],
		"charts": [
			_chart("reports_week", "Field reports per week", "bar", [_wlabel(w) for w in f.weeks],
				[{"label": "Reports", "data": [per_week.get(w, 0) for w in f.weeks]}]),
			_chart("reporters_week", "Active reporters per week", "line", [_wlabel(w) for w in f.weeks],
				[{"label": "Reporters", "data": [len(reporters_week.get(w, ())) for w in f.weeks]}], "People who sent at least one report"),
			_chart("by_sub", "Field reports by sub-county", "hbar", [r["subCounty"] for r in rows],
				[{"label": "Reports", "data": [r["reports"] or 0 for r in rows]}]),
		],
		"columns": [("subCounty", "Sub-county"), ("reports", "Field reports"), ("reporters", "Reporters"),
			("needReview", "For the Review Queue"), ("picked48", "% picked up within 48 h"), ("medianPicked", "Median hours to pick up"),
			("events", "Events"), ("started", "Verification started"), ("verifiedInTarget", "% started on time"),
			("tasksDue", "Tasks due"), ("tasksOnTime", "% tasks done by due date"), ("moh505", "% MOH 505 weeks reported")],
		"rows": rows,
		"notes": [
			"Picked up: from a report arriving to an officer first acting on its event in the Review Queue (starting "
			"verification, a decision, changing the disease or adding a note). If officers were already working on that event, "
			"it counts as picked up at once. Reports outside the Review Queue (other diseases or areas) are not counted.",
			"Verification started on time: hours from the event being created to \"Start verification\", against the target for "
			"its priority: critical 24 h, high 48 h, standard 72 h. Only events where verification has started are counted.",
			"Field tasks done by the due date: tasks due in the period, marked Done on or before their due date.",
			"MOH 505 weeks reported: of all facility-weeks in the period (each active facility, each week), how many the "
			"facility reported, from the uploaded MOH 505 reporting files.",
		],
	}


# ---------- R40 Integration Health ----------

INTEGRATIONS = [
	# key, name, error titles (LIKE), job (Scheduled Job Type contains), how often new data should arrive (hours)
	("cbs", "CBS", ["CBS %"], "cbs_feed", 24),
	("moh505", "MOH 505 (KHIS files)", [], None, None),   # judged by the newest week loaded (MOH505_LATE_DAYS)
	("whatsapp", "WhatsApp reporting", ["WhatsApp %"], None, None),
	("push", "Phone notifications", ["Expo push%"], "push.check_receipts", None),
	("ai_model", "AI disease model", ["AI classifier unreachable%"], None, None),
	("speech", "Speech to text", ["Voice note transcription failed%"], "transcription", None),
	("weather", "Weather data", ["Weather import failed%"], "import_weather", 48),
]
RECENT_HOURS = 24        # errors in the last day make an integration "Needs a look"; older ones are only listed
MOH505_LATE_DAYS = 14    # the newest MOH 505 week loaded should be at most two weeks old


def _errors(titles, f):
	if not titles:
		return []
	out = []
	for t in titles:
		out += frappe.get_all("Error Log", filters={"method": ["like", t], "creation": ["between", [f.start, f.end]]},
			fields=["name", "method", "creation"], limit_page_length=0)
	return out


def _jobs(match, f):
	if not match:
		return []
	return frappe.get_all("Scheduled Job Log", filters={"scheduled_job_type": ["like", f"%{match}%"],
		"creation": ["between", [f.start, f.end]]}, fields=["status", "creation"], limit_page_length=0)


def _r40(f):
	"""Status: OK; Needs a look (errors or failures in the last 24 hours, or no new data for longer than expected);
	Down (both); Not set up (never any data). Errors earlier in the period are counted and named in the notes only."""
	from surveillance.hq_dashboard import _latest
	now = now_datetime()
	recent = now - timedelta(hours=RECENT_HOURS)
	rows, all_errors = [], []
	for key, name, titles, job, every in INTEGRATIONS:
		errs = _errors(titles, f)
		all_errors += [(name, e.creation) for e in errs]
		runs = _jobs(job, f)
		failed = [r.creation for r in runs if r.status == "Failed"]
		notes, late = [], False
		if key == "cbs":
			last = max(filter(None, [_latest("Surveillance Signal", "creation", {"source": "CBS"}),
				_latest("Weekly Count", "modified", {"source": "CBS"})]), default=None)
		elif key == "moh505":
			last = _latest("IDSR Facility Week", "modified")
			week = _latest("IDSR Facility Week", "week_start")
			if week:
				late = (getdate(nowdate()) - getdate(week)).days > MOH505_LATE_DAYS
				notes.append(f"newest week loaded: {_wlabel(week)} (starting {getdate(week).strftime('%-d %b')})")
			ups = frappe.get_all("IDSR Upload", filters={"creation": ["between", [f.start, f.end]]}, fields=["status", "creation"])
			st = Counter(u.status for u in ups)
			failed += [u.creation for u in ups if u.status == "Failed"]
			if ups:
				parts = [f"{st[s]} {label}" for s, label in [("Ingested", "loaded"), ("Ready", "uploaded but not loaded yet"),
					("Failed", "failed"), ("Discarded", "discarded")] if st.get(s)]
				notes.append(f"{len(ups)} files uploaded in the period: " + ", ".join(parts))
			else:
				notes.append("no files uploaded in the period")
		elif key == "whatsapp":
			last = _latest("Case Report", "creation", {"channel": "WhatsApp"})
		elif key == "push":
			last = _latest("Push Message", "creation")
			msgs = frappe.get_all("Push Message", filters={"creation": ["between", [f.start, f.end]]}, fields=["status", "creation"])
			st = Counter(m.status for m in msgs)
			failed += [m.creation for m in msgs if m.status == "Error"]
			notes.append(f"{len(msgs)} sent, {st.get('Delivered', 0)} delivered, {st.get('Error', 0)} failed" if msgs else "nothing sent in the period")
		elif key == "ai_model":
			last = _latest("AI Prediction", "predicted_on")
			if not (frappe.conf.get("ai_classifier_url") and frappe.conf.get("ai_classifier_token")):
				notes.append("not connected on this site")
		elif key == "speech":
			att = frappe.get_all("Case Report Attachment", filters={"attachment_type": "Voice Note",
				"creation": ["between", [f.start, f.end]]}, fields=["transcript_status", "creation"])
			st = Counter(a.transcript_status for a in att)
			last = _latest("Case Report Attachment", "transcribed_on")
			failed += [a.creation for a in att if a.transcript_status == "Failed"]
			notes.append(f"{st.get('Done', 0)} voice notes transcribed, {st.get('Failed', 0)} failed, {st.get('Queued', 0)} waiting")
		else:
			last = _latest("Weather Snapshot", "creation")
		if every and last and (now - get_datetime(last)).total_seconds() > every * 3600:
			late = True
			notes.append(f"no new data for over {every} hours")
		recent_problems = sum(1 for e in errs if get_datetime(e.creation) >= recent) + sum(1 for c in failed if get_datetime(c) >= recent)
		if errs:
			kinds = Counter(e.method for e in errs)
			notes.append("errors: " + ", ".join(f"{k} ({n})" for k, n in kinds.most_common(3))
				+ ("" if recent_problems else " (none in the last 24 hours)"))
		if not last and not errs and not failed:
			status = "Not set up"
		elif (late and recent_problems) or (not last and recent_problems):
			status = "Down"
		elif late or recent_problems:
			status = "Warning"
		else:
			status = "OK"
		rows.append({"integration": name, "status": status, "lastData": _dt(last) or "never", "errors": len(errs),
			"lastError": _dt(max((e.creation for e in errs), default=None)), "failed": len(failed), "note": "; ".join(notes)})
	per_day = Counter(getdate(c) for _n, c in all_errors)
	days = [add_days(f.from_d, i) for i in range((f.to_d - f.from_d).days + 1)]
	ok = sum(1 for r in rows if r["status"] == "OK")
	return {
		"cards": [
			_card("ok", "Working normally", f"{ok} of {len(rows)}", "integrations"),
			_card("warning", "Need a look", sum(1 for r in rows if r["status"] == "Warning"), "errors in the last 24 hours, or data is late"),
			_card("down", "Down", sum(1 for r in rows if r["status"] == "Down"), "errors and data is late"),
			_card("errors", "Errors logged", len(all_errors), "in the whole period"),
		],
		"charts": [
			_chart("by_integration", "Problems by integration, in the period", "hbar", [r["integration"] for r in rows],
				[{"label": "Errors", "data": [r["errors"] for r in rows]}, {"label": "Failed items", "data": [r["failed"] for r in rows]}]),
			_chart("per_day", "Integration errors per day", "bar", [d.strftime("%-d %b") for d in days],
				[{"label": "Errors", "data": [per_day.get(d, 0) for d in days]}]),
		],
		"columns": [("integration", "Integration"), ("status", "Status"), ("lastData", "Last data received"),
			("errors", "Errors in the period"), ("lastError", "Last error"), ("failed", "Failed items"), ("note", "Notes")],
		"rows": rows,
		"notes": [
			"OK: data is arriving and there were no errors in the last 24 hours. Needs a look: errors or failed items in the "
			"last 24 hours, or no new data for longer than expected (CBS 24 hours, weather 48 hours, MOH 505: newest week "
			"loaded more than 2 weeks old). Down: both. Older errors are counted and named but do not change the status.",
			"Errors come from the system's Error Log (for example \"CBS hourly sync failed\"); failed items are files, "
			"messages or voice notes that did not go through.",
		],
	}


# ---------- R40b System Health ----------

def _r40b(f):
	days = [add_days(f.from_d, i) for i in range((f.to_d - f.from_d).days + 1)]
	between = ["between", [f.start, f.end]]
	errors = frappe.get_all("Error Log", filters={"creation": between}, fields=["creation", "method"], limit_page_length=0)
	jobs = frappe.get_all("Scheduled Job Log", filters={"creation": between, "status": "Failed"},
		fields=["creation", "scheduled_job_type"], limit_page_length=0)
	logins = frappe.get_all("Activity Log", filters={"operation": "Login", "creation": between},
		fields=["creation", "status", "user"], limit_page_length=0)
	sync = frappe.get_all("Mobile Sync Stats", filters={"day": ["between", [f.from_d, f.to_d]]},
		fields=["day", "user", "queued", "failed", "max_queue_age_minutes"], limit_page_length=0) \
		if frappe.db.table_exists("Mobile Sync Stats") else []
	try:
		from frappe.utils.scheduler import is_scheduler_disabled
		scheduler = "Off" if is_scheduler_disabled() else "On"
	except Exception:
		scheduler = "—"
	err_day = Counter(getdate(e.creation) for e in errors)
	job_day = Counter(getdate(j.creation) for j in jobs)
	ok_day = Counter(getdate(x.creation) for x in logins if x.status == "Success")
	bad_day = Counter(getdate(x.creation) for x in logins if x.status != "Success")
	users_day = defaultdict(set)
	for x in logins:
		if x.status == "Success":
			users_day[getdate(x.creation)].add(x.user)
	sync_day = defaultdict(lambda: [0, 0, 0])
	for s in sync:
		d = sync_day[getdate(s.day)]
		d[0] += cint(s.queued)
		d[1] += cint(s.failed)
		d[2] = max(d[2], cint(s.max_queue_age_minutes))
	last_sync = max((getdate(s.day) for s in sync), default=None)
	waiting_now = sum(1 for s in sync if last_sync and getdate(s.day) == last_sync and cint(s.queued))
	labels = [d.strftime("%-d %b") for d in days]
	return {
		"cards": [
			_card("errors", "Application errors", len(errors), "from the Error Log"),
			_card("jobs", "Background jobs failed", len(jobs), f"scheduler is {scheduler.lower()}" if scheduler != "—" else ""),
			_card("users", "People who signed in", len({x.user for x in logins if x.status == "Success"})),
			_card("failed_logins", "Failed sign-ins", sum(bad_day.values())),
			_card("phones", "Phones with reports waiting", waiting_now, f"on {last_sync.strftime('%-d %b')}" if last_sync else "no phone sync data yet"),
		],
		"charts": [
			_chart("errors_day", "Errors and failed jobs per day", "bar", labels,
				[{"label": "Application errors", "data": [err_day.get(d, 0) for d in days]},
				 {"label": "Failed jobs", "data": [job_day.get(d, 0) for d in days]}]),
			_chart("logins_day", "Sign-ins per day", "line", labels,
				[{"label": "Signed in", "data": [ok_day.get(d, 0) for d in days]},
				 {"label": "Failed", "data": [bad_day.get(d, 0) for d in days]}]),
			_counter_chart("top_errors", "Most frequent errors", "hbar", Counter((e.method or "Unknown")[:60] for e in errors),
				label="Errors", limit=10),
		],
		"columns": [("day", "Day"), ("errors", "Application errors"), ("jobsFailed", "Failed jobs"), ("signedIn", "People signed in"),
			("failedLogins", "Failed sign-ins"), ("waiting", "Reports waiting on phones"), ("syncFailed", "Phone sends failed"),
			("longestWait", "Longest wait on a phone (min)")],
		"rows": [{"day": str(d), "errors": err_day.get(d, 0), "jobsFailed": job_day.get(d, 0), "signedIn": len(users_day.get(d, ())),
			"failedLogins": bad_day.get(d, 0), "waiting": sync_day[d][0] if d in sync_day else "",
			"syncFailed": sync_day[d][1] if d in sync_day else "", "longestWait": sync_day[d][2] if d in sync_day else ""}
			for d in reversed(days)],
	}


BUILDERS = {"R34": _r34, "R35": _r35, "R36": _r36, "R37": _r37, "R38": _r38, "R39": _r39, "R40": _r40, "R40b": _r40b}


# ---------- API ----------

def _build(report, filters):
	r = _require(report)
	f = _filters(filters)
	out = BUILDERS[report](f)
	cols = [{"key": k, "label": label} for k, label in out.pop("columns")]
	rows = out.pop("rows")
	# the detail view: the main table, plus any other tables (R36 has Events and Field tasks)
	tables = [{"key": "main", "title": out.pop("tableTitle", "Details"), "columns": cols, "rows": rows}]
	for x in out.pop("tables", []):
		tables.append({"key": x["key"], "title": x["title"], "columns": [{"key": k, "label": label} for k, label in x["columns"]],
			"rows": x["rows"]})
	return r, f, {
		"report": report, "title": r["title"], "description": r["description"], "filters": r["filters"],
		"scope": f.scope, "from": str(f.from_d), "to": str(f.to_d),
		"period": f"{f.from_d.strftime('%-d %b %Y')} to {f.to_d.strftime('%-d %b %Y')}",
		"generatedAt": str(now_datetime())[:16], "generatedBy": frappe.utils.get_fullname(frappe.session.user),
		"canExport": has_capability(EXPORT),
		"summary": out, "detail": {"columns": cols, "rows": rows, "tables": tables},
	}


def _log(report, action, fmt, filters, scope, rows):
	try:
		flt_text = json.dumps({k: v for k, v in _parse(filters).items() if v}, sort_keys=True)[:1000]
		if action == "Viewed" and frappe.db.exists(RUN_LOG, {"user": frappe.session.user, "report": report, "action": "Viewed",
				"filters": flt_text, "at": [">=", now_datetime() - timedelta(minutes=SEEN_AGAIN_MINUTES)]}):
			return
		frappe.get_doc({"doctype": RUN_LOG, "report": report, "report_title": REPORT_MAP[report]["title"], "action": action,
			"format": fmt, "filters": flt_text, "scope": scope, "rows": cint(rows), "user": frappe.session.user,
			"at": now_datetime()}).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="Monitoring report log failed")


def _options():
	"""Filter choices in the user's area: regions, sub-counties (pilot), active diseases, channels."""
	from surveillance.events import _scope, _user_region
	from surveillance.hq_dashboard import CHANNEL_LABEL, CHANNELS, _active, _diseases
	area = locked_area()
	mine = area.region if area else _user_region()
	pilot, _d = _scope()
	regions = frappe.get_all("Region", filters={"name": mine} if mine else {}, fields=["name", "region_name"], order_by="region_name asc")
	subs = [s for s in frappe.get_all("Sub County", filters={"region": mine} if mine else {},
		fields=["sub_county_name", "region"], order_by="sub_county_name asc") if (s.sub_county_name or "").strip().lower() in pilot]
	if area:
		subs = [s for s in subs if (s.sub_county_name or "").strip().lower() == area.sub_county.strip().lower()]
	active = _active()
	dis = sorted(((k, d.disease_name or k) for k, d in _diseases().items() if k in active),
		key=lambda x: x[1].lower().removeprefix("suspected "))
	return {"lockedRegion": mine, "lockedSubCounty": area.sub_county if area else None,
		"regions": [{"value": r.name, "label": r.region_name or r.name} for r in regions],
		"subCounties": [{"value": s.sub_county_name, "label": s.sub_county_name, "region": s.region} for s in subs],
		"diseases": [{"value": k, "label": v} for k, v in dis],
		"channels": [{"value": c, "label": CHANNEL_LABEL.get(c, c)} for c in CHANNELS]}


@frappe.whitelist()
def list_reports():
	_require()
	hq = not locked_area()
	return {"reports": [{k: r[k] for k in ("key", "title", "description", "filters")} for r in REPORTS if hq or not r.get("hq")],
		"canExport": has_capability(EXPORT), "options": _options()}


@frappe.whitelist(methods=["POST"])
def get_report(report, filters=None):
	"""R41 / R43: one report, summary and detail. POST so the generation is logged (R46)."""
	_r, f, out = _build(report, filters)
	_log(report, "Viewed", "Screen", filters, f.scope, len(out["detail"]["rows"]))
	return out


@frappe.whitelist(methods=["POST"])
def export_report(report, format="xlsx", filters=None, table=None):
	"""R44: the report as Excel (a summary sheet and one sheet per detail table) or CSV (one detail table: table, else
	the main one). Needs Export Monitoring Reports."""
	require_capability(EXPORT)
	if format not in ("xlsx", "csv"):
		frappe.throw("Unknown format.")
	_r, f, out = _build(report, filters)
	tbl = next((x for x in out["detail"]["tables"] if x["key"] == table), out["detail"]["tables"][0])
	cols, rows = tbl["columns"], tbl["rows"]
	name = f"{out['title'].replace(' ', '_')}_{f.from_d}_{f.to_d}"
	if tbl["key"] != "main":
		name += f"_{tbl['title'].replace(' ', '_')}"
	if format == "csv":
		import csv
		buf = io.StringIO()
		w = csv.writer(buf)
		w.writerow([c["label"] for c in cols])
		for r in rows:
			w.writerow([r.get(c["key"], "") for c in cols])
		content, name = buf.getvalue().encode("utf-8-sig"), f"{name}.csv"
	else:
		content, name = _xlsx(out), f"{name}.xlsx"
	_log(report, "Exported", "Excel" if format == "xlsx" else "CSV", filters, f.scope, len(rows))
	frappe.response["filename"] = name
	frappe.response["filecontent"] = content
	frappe.response["type"] = "binary"


def _xlsx(out):
	from openpyxl import Workbook
	from openpyxl.styles import Font, PatternFill
	wb = Workbook()
	ws = wb.active
	ws.title = "Summary"
	bold, white = Font(bold=True), Font(bold=True, color="FFFFFF")
	red = PatternFill("solid", fgColor="EE2435")
	ws.append([out['title']])
	ws["A1"].font = Font(bold=True, size=14)
	for label, value in [("Area", out["scope"]), ("Period", out["period"]), ("Generated", f"{out['generatedAt']} by {out['generatedBy']}")]:
		ws.append([label, value])
	ws.append([])
	ws.append(["Measure", "Value", "Note"])
	for c in ws[ws.max_row]:
		c.font, c.fill = white, red
	for c in out["summary"].get("cards", []):
		ws.append([c["label"], c["value"], c.get("note") or ""])
	if out["summary"].get("measures"):
		hw = wb.create_sheet("How measured")
		hw.append(["AI part", "Measure", "Value (%)", "Based on", "How it is measured"])
		for c in hw[1]:
			c.font, c.fill = white, red
		for m in out["summary"]["measures"]:
			hw.append([m["part"], m["measure"], m["value"], m["based"], m["how"]])
	for ch in out["summary"].get("charts", []):
		ws.append([])
		ws.append([ch["title"]])
		ws.cell(ws.max_row, 1).font = bold
		ws.append(["", *[s["label"] for s in ch["series"]]])
		for i, label in enumerate(ch["labels"]):
			ws.append([label, *[s["data"][i] for s in ch["series"]]])
	ws.column_dimensions["A"].width = 48
	ws.column_dimensions["B"].width = 18
	ws.column_dimensions["C"].width = 40
	for note in out["summary"].get("notes") or []:
		if note is out["summary"]["notes"][0]:
			ws.append([])
			ws.append(["How these are worked out"])
			ws.cell(ws.max_row, 1).font = bold
		ws.append([note])
	for tbl in out["detail"]["tables"]:
		dw = wb.create_sheet(("Detail" if tbl["key"] == "main" and len(out["detail"]["tables"]) == 1 else tbl["title"])[:31])
		cols = tbl["columns"]
		dw.append([c["label"] for c in cols])
		for c in dw[1]:
			c.font, c.fill = white, red
		for r in tbl["rows"]:
			dw.append([r.get(c["key"], "") for c in cols])
		for i, _c in enumerate(cols):
			dw.column_dimensions[dw.cell(1, i + 1).column_letter].width = 20
	buf = io.BytesIO()
	wb.save(buf)
	return buf.getvalue()


@frappe.whitelist(methods=["POST"])
def log_export(report, format, filters=None, rows=0):
	"""R46: PDF and JPEG are made in the browser; this records them. Needs Export Monitoring Reports."""
	require_capability(EXPORT)
	_require(report)
	if format not in ("PDF", "JPEG"):
		frappe.throw("Unknown format.")
	f = _filters(filters)
	_log(report, "Exported", format, filters, f.scope, rows)
	return {"ok": True}


# ---------- AI logging (called from ai_classifier and voice_extract; never breaks the caller) ----------

def log_predictions(items):
	"""items: [(report name, case key, case, model answer)] for fresh model answers. Saved in the background."""
	from surveillance.ai_classifier import HIDDEN, MODEL_TO_DISEASE, UNDER_FIVE
	rows = []
	for report, key, case, answer in items:
		tops = [t for t in ((answer or {}).get("top") or []) if t.get("disease") not in HIDDEN]
		if not tops:
			continue

		def mapped(t):
			if t["disease"] == "Diarrhoea (incl. dysentery)" and case.get("age_group") in UNDER_FIVE:
				return "diarrhoea-dehydration-u5"
			return MODEL_TO_DISEASE.get(t["disease"], "")
		rows.append({"kind": "Model", "case_report": report, "case_key": key, "model_version": str((answer or {}).get("model_version") or "")[:140],
			"age_group": case.get("age_group") or "", "top_group": tops[0]["disease"][:140],
			"top_probability": flt(tops[0].get("probability")), "predicted_disease": mapped(tops[0]),
			"top3_diseases": ",".join(m for m in (mapped(t) for t in tops[:3]) if m)})
	if rows:
		frappe.enqueue("surveillance.monitoring.save_predictions", queue="short", rows=rows)


def log_suggestions(report, candidates):
	"""The possible diseases shown to the officer for a report (ai_classifier.get_report_candidates), in order, with
	where each came from. Saved in the background; the same list for the same report is saved once."""
	import hashlib
	keys = [c["key"] for c in candidates if c.get("key")]
	if not keys:
		return
	sources = ["Unlikely" if c.get("unlikely") else (c.get("source") or "") for c in candidates if c.get("key")]
	key = "shown:" + hashlib.sha1(f"{report}|{','.join(keys)}|{','.join(sources)}".encode()).hexdigest()
	first = candidates[0]
	frappe.enqueue("surveillance.monitoring.save_predictions", queue="short", rows=[{
		"kind": SHOWN, "case_report": report, "case_key": key, "model_version": "", "top_group": (first.get("name") or "")[:140],
		"top_probability": flt(first.get("probability")) if first.get("probability") is not None else None,
		"predicted_disease": keys[0], "top3_diseases": ",".join(keys[:3]),
		"suggested": ",".join(keys)[:1000], "suggested_sources": ",".join(sources)[:1000]}])


def save_predictions(rows):
	for r in rows:
		same = {"case_key": r["case_key"]}
		if r.get("model_version"):
			same["model_version"] = r["model_version"]
		if frappe.db.exists("AI Prediction", same):
			continue
		frappe.get_doc({"doctype": "AI Prediction", "predicted_on": now_datetime(), **r}).insert(ignore_permissions=True)
	frappe.db.commit()


def voice_offered(report):
	"""What the voice notes of a report offer the officer now (before anything is added): labels."""
	from surveillance.voice_extract import for_rows
	rows = frappe.get_all("Case Report Attachment", filters={"parent": report, "parenttype": "Case Report",
		"attachment_type": "Voice Note", "transcript_status": "Done"},
		fields=["name", "transcript", "transcript_language", "spoken_language"])
	items = set()
	for p in (for_rows(report, rows) or {}).values():
		if not p or p.get("empty"):
			continue
		rep = p.get("report") or {}
		items |= {s["name"] for s in p.get("symptoms") or [] if not s.get("onReport")}
		if p.get("ageGroup") and p["ageGroup"] != rep.get("ageGroup"):
			items.add(f"age group {p['ageGroup']}")
		if p.get("animal") and p["animal"] != rep.get("animal"):
			items.add(f"animal contact {p['animal'].lower()}")
		if p.get("people") and p["people"] != rep.get("people"):
			items.add(f"people sick {p['people']}")
	return sorted(items)


def log_voice_review(report, offered, accepted):
	try:
		if offered is None:
			return
		frappe.get_doc({"doctype": "Voice Extraction Review", "case_report": report, "reviewed_by": frappe.session.user,
			"reviewed_on": now_datetime(), "offered": max(len(offered), len(accepted)), "accepted": len(accepted),
			"offered_items": ", ".join(offered)[:1000], "accepted_items": ", ".join(accepted)[:1000]}).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="Voice review log failed")


# ---------- model measures from MLflow (the AI server sends them) ----------

@frappe.whitelist(methods=["POST"])
def push_model_metrics(metrics=None, **single):
	"""The AI server sends model measures from MLflow. Needs Send AI Model Measures (give it only to the AI server's user).
	metrics: [{model, metric, value, model_version?, run_id?, dataset?, recorded_on?}] or the same fields on their own.
	A measure with the same model, metric and run is not saved twice."""
	require_capability(PUSH)
	items = frappe.parse_json(metrics) if isinstance(metrics, str) else metrics
	if not items:
		items = [{k: single.get(k) for k in ("model", "metric", "value", "model_version", "run_id", "dataset", "recorded_on")}]
	saved = 0
	for m in items[:200]:
		model, metric = str(m.get("model") or "").strip()[:140], str(m.get("metric") or "").strip().lower()[:140]
		if not model or not metric or m.get("value") is None:
			continue
		run = str(m.get("run_id") or "")[:140]
		if run and frappe.db.exists("AI Model Metric", {"model": model, "metric": metric, "run_id": run}):
			continue
		frappe.get_doc({"doctype": "AI Model Metric", "model": model, "metric": metric, "value": flt(m["value"]),
			"model_version": str(m.get("model_version") or "")[:140], "run_id": run, "dataset": str(m.get("dataset") or "")[:140],
			"recorded_on": get_datetime(m["recorded_on"]) if m.get("recorded_on") else now_datetime(), "source": "MLflow",
			"sent_by": frappe.session.user}).insert(ignore_permissions=True)
		saved += 1
	return {"saved": saved}
