"""Surveillance Officer workspace: dashboard, event lifecycle and data quality.

Everything is limited to the officer's region (User.assigned_region), the same rule as the Review Queue;
users with View All Regions see every region.
"""
import frappe
from frappe import _
from frappe.utils import add_days, cint, get_datetime, get_fullname, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability, require_capability

EVENT = "Surveillance Event"
OPEN = ["New", "Verifying", "Investigating", "Confirmed", "Escalated"]
SEV_ORDER = {"critical": 0, "high": 1, "standard": 2}


def _scope():
	from surveillance.events import _scope_filters
	return dict(_scope_filters())


def _region():
	from surveillance.events import _user_region
	return _user_region()


def _region_sub_counties():
	"""Lower-case sub-county names in the officer's region (None = every region)."""
	region = _region()
	if not region:
		return None
	return {(s or "").strip().lower() for s in frappe.get_all("Sub County", filters={"region": region}, pluck="sub_county_name")}


def _pct(now, before):
	if not before:
		return None
	return round(100.0 * (now - before) / before, 1)


# ---------- dashboard ----------

@frappe.whitelist()
def get_officer_dashboard():
	from surveillance.events import FIELDS, _shape as event_shape
	scope = _scope()

	def count(**f):
		return frappe.db.count(EVENT, {**scope, **f})

	now = now_datetime()
	wk, pwk = add_days(now, -7), add_days(now, -14)
	stats = [
		{"key": "new", "label": "New signals", "value": count(first_reported=[">=", wk]),
			"change": _pct(count(first_reported=[">=", wk]), count(first_reported=["between", [pwk, wk]])),
			"hint": "Events reported in the last 7 days, compared with the 7 days before", "link": "/alerts-signals?tab=all"},
		{"key": "priority", "label": "Priority alerts", "value": count(status=["in", OPEN], severity=["in", ["critical", "high"]]),
			"hint": "Open events of critical or high severity", "link": "/alerts-signals?tab=all"},
		{"key": "verify", "label": "Awaiting verification", "value": count(status=["in", ["New", "Verifying"]]),
			"hint": "New events and events being verified", "link": "/alerts-signals"},
		{"key": "investigating", "label": "Active investigations", "value": count(status="Investigating"),
			"hint": "Events in field investigation", "link": "/alerts-signals?tab=investigating"},
	]

	# signal trend: events per week for the last 6 weeks, with the most reported disease each week
	today = getdate(nowdate())
	monday = add_days(today, -today.weekday())
	starts = [add_days(monday, -7 * i) for i in range(5, -1, -1)]
	rows = frappe.get_all(EVENT, filters={**scope, "first_reported": [">=", starts[0]]},
		fields=["first_reported", "disease_name"], limit_page_length=5000)
	weeks = []
	for i, s in enumerate(starts):
		e = add_days(s, 7)
		inside = [r for r in rows if r.first_reported and s <= getdate(r.first_reported) < e]
		by = {}
		for r in inside:
			by[r.disease_name or "Other"] = by.get(r.disease_name or "Other", 0) + 1
		top = max(by.items(), key=lambda x: x[1]) if by else None
		weeks.append({"label": s.strftime("%d %b"), "total": len(inside),
			"top": {"disease": top[0], "count": top[1]} if top else None})

	# priority queue: open events, most severe and longest waiting first
	queue = frappe.get_all(EVENT, filters={**scope, "status": ["in", OPEN]}, fields=FIELDS,
		order_by="first_reported asc", limit_page_length=200)
	queue.sort(key=lambda d: (SEV_ORDER.get(d.severity, 3), get_datetime(d.first_reported) if d.first_reported else now))
	queue = [event_shape(d) for d in queue[:5]]

	return {"stats": stats, "trend": weeks, "queue": queue, "trends": _rising_trends()}


def _rising_trends(limit=3):
	"""Open Epi Trends alerts in the officer's region (for the dashboard card)."""
	if not has_capability("view_alerts"):
		return []
	from surveillance.alerts import _shape as alert_shape
	subs = _region_sub_counties()
	rows = frappe.get_all("Risk Alert", filters={"status": ["in", ["Pending", "Investigating"]]}, fields=["*"],
		order_by="last_week desc, modified desc", limit_page_length=300)
	if subs is not None:
		rows = [r for r in rows if (r.sub_county or "").strip().lower() in subs]
	rows.sort(key=lambda r: SEV_ORDER.get(r.severity, 3))
	out = []
	for r in rows[:limit]:
		a = alert_shape(r)
		out.append({"id": a["id"], "title": a["title"], "location": a["location"], "severity": a["severity"],
			"why": a.get("whyShort") or a.get("description")})
	return out


# ---------- event lifecycle ----------

STAGES = ["Signal detected", "Verification", "Investigation", "Response", "Monitoring", "Closed"]
STAGE_HELP = {
	"Signal detected": "Signal entered the system from a CHP, CBS or facility report",
	"Verification": "Signal checked and validated by an officer",
	"Investigation": "Field investigation: case search and samples",
	"Response": "Response actions under way after confirming or escalating",
	"Monitoring": "Closed, with follow-up checks still running (7 to 21 days)",
	"Closed": "Event formally closed",
}
ACTION_STAGE = {
	"Verification started": "Verification", "Field investigation started": "Investigation",
	"Confirmed": "Response", "Escalated to county / MoH": "Response", "Response action planned": "Response",
	"Follow-ups scheduled": "Monitoring",
	"Closed": "Closed", "Closed: no event found": "Closed", "Discarded": "Closed",
}


def _followups_open(names):
	if not names:
		return set()
	return set(frappe.get_all("Event Task", filters={"event": ["in", names], "task_type": "Follow-up",
		"status": ["in", ["Assigned", "In progress", "Blocked"]]}, pluck="event"))


def _stage(e, monitoring):
	return {"New": "Signal detected", "Verifying": "Verification", "Investigating": "Investigation",
		"Confirmed": "Response", "Escalated": "Response"}.get(e.status) or (
		"Monitoring" if e.name in monitoring else "Closed")


@frappe.whitelist()
def get_lifecycle(search=None, severity=None, stage=None, days=90):
	scope = _scope()
	since = add_days(nowdate(), -cint(days or 90))
	or_filters = None
	if search:
		like = f"%{search}%"
		or_filters = {"title": ["like", like], "area": ["like", like], "sub_county": ["like", like], "name": ["like", like]}
	filters = {**scope}
	if severity in SEV_ORDER:
		filters["severity"] = severity
	rows = frappe.get_all(EVENT, filters=filters, or_filters=or_filters,
		fields=["name", "title", "disease_name", "status", "severity", "area", "sub_county", "people", "first_reported", "last_reported"],
		order_by="last_reported desc", limit_page_length=500)
	rows = [r for r in rows if r.status in OPEN or (r.last_reported and getdate(r.last_reported) >= getdate(since))]
	monitoring = _followups_open([r.name for r in rows if r.status == "Closed"])
	counts = {s: 0 for s in STAGES}
	events = []
	for r in rows:
		st = _stage(r, monitoring)
		counts[st] += 1
		if stage and stage != st:
			continue
		days_open = (getdate(nowdate()) - getdate(r.first_reported)).days + 1 if r.first_reported else None
		events.append({"id": r.name, "title": r.disease_name or r.title, "status": r.status, "stage": st,
			"severity": r.severity, "place": ", ".join(x for x in [r.area, r.sub_county] if x),
			"people": cint(r.people), "day": days_open, "discarded": r.status == "Discarded"})
	return {"stages": [{"name": s, "count": counts[s], "help": STAGE_HELP[s]} for s in STAGES], "events": events}


@frappe.whitelist()
def get_event_lifecycle(event):
	from surveillance.events import _check_access
	require_capability("view_review_queue")
	doc = frappe.get_doc(EVENT, event)
	_check_access(doc)
	monitoring = _followups_open([doc.name]) if doc.status == "Closed" else set()
	current = _stage(doc, monitoring)
	history = [{"stage": "Signal detected", "at": str(doc.first_reported or doc.creation), "by": "Reporting system",
		"note": f"{doc.reports or 1} report(s), {doc.people or 0} people. {doc.reason or ''}".strip()}]
	seen = {"Signal detected"}
	for a in sorted(doc.actions or [], key=lambda a: a.at or now_datetime()):
		st = ACTION_STAGE.get(a.action)
		if not st:
			continue
		history.append({"stage": st, "at": str(a.at), "by": get_fullname(a.user) if a.user else None,
			"action": a.action, "note": a.note or ""})
		seen.add(st)
	reached = STAGES.index(current)
	if doc.status == "Discarded":
		steps = [{"name": s, "state": "done" if s == "Signal detected" or s in seen else "skipped"} for s in STAGES]
	else:
		steps = [{"name": s, "state": "done" if i < reached or (i == reached and s == "Closed") else
			"current" if i == reached else "future"} for i, s in enumerate(STAGES)]
	lead = next((a.user for a in sorted(doc.actions or [], key=lambda a: a.at or now_datetime())
		if a.action == "Verification started"), None)
	return {"id": doc.name, "title": doc.disease_name or doc.title, "status": doc.status, "stage": current,
		"severity": doc.severity, "place": ", ".join(x for x in [doc.area, doc.sub_county] if x),
		"lead": get_fullname(lead) if lead else None, "opened": str(doc.first_reported or doc.creation)[:10],
		"steps": steps, "history": history}


# ---------- data quality ----------

DQ_DISMISS = "Data Quality Dismissal"
DQ_KINDS = {
	"location": "Location missing",
	"warning": "Possible data entry error",
	"late": "Late report",
	"unclassified": "Not matched to a disease",
	"duplicate": "Possible duplicate",
	"completeness": "Facility not reporting",
}


def _report_filters(since):
	f = {"creation": [">=", since]}
	region = _region()
	if region:
		f["region"] = region
	return f


@frappe.whitelist()
def get_data_quality(days=30):
	require_capability("view_data_quality")
	since = add_days(nowdate(), -cint(days or 30))
	dismissed = set(frappe.get_all(DQ_DISMISS, pluck="issue_key")) if frappe.db.table_exists(DQ_DISMISS) else set()
	issues = []

	def add(kind, key, title, detail, link, at=None):
		k = f"{kind}:{key}"
		if k not in dismissed:
			issues.append({"key": k, "kind": kind, "kindLabel": DQ_KINDS[kind], "title": title, "detail": detail,
				"link": link, "at": str(at) if at else None})

	reports = frappe.get_all("Case Report", filters=_report_filters(since),
		fields=["name", "location_name", "sub_county", "latitude", "longitude", "onset_date", "creation", "suspected_disease",
			"review_outcome", "symptom_tags", "reported_by", "owner"], order_by="creation desc", limit_page_length=3000)
	for r in reports:
		if not r.sub_county:
			add("location", r.name, f"{r.name}: no sub-county", f"Place given: {r.location_name or 'none'}. Officers can't scope or map it.",
				f"/reports/{r.name}", r.creation)
		elif r.latitude in (None, 0) and r.longitude in (None, 0):
			add("location", r.name, f"{r.name}: no GPS point", f"{r.location_name or ''} {r.sub_county}".strip() + ". It won't show on the map.",
				f"/reports/{r.name}", r.creation)
		if r.onset_date and getdate(r.creation) > add_days(getdate(r.onset_date), 1):
			late = (getdate(r.creation) - getdate(r.onset_date)).days
			add("late", r.name, f"{r.name}: sent {late} days after symptoms started",
				"Reports should reach us within 24 hours of symptoms starting.", f"/reports/{r.name}", r.creation)
		if not r.suspected_disease and not r.review_outcome:
			add("unclassified", r.name, f"{r.name}: no disease matched", f"Symptoms: {r.symptom_tags or 'none given'}. Review and set the suspected disease.",
				f"/reports/{r.name}", r.creation)

	# possible duplicates: same reporter, same sub-county, same symptoms within 24 hours
	groups = {}
	for r in reports:
		groups.setdefault((r.reported_by or r.owner, (r.sub_county or "").lower(), (r.symptom_tags or "").lower()), []).append(r)
	for grp in groups.values():
		grp.sort(key=lambda r: get_datetime(r.creation))
		for a, b in zip(grp, grp[1:]):
			if (get_datetime(b.creation) - get_datetime(a.creation)).total_seconds() <= 86400:
				add("duplicate", f"{a.name}|{b.name}", f"{a.name} and {b.name} look the same",
					"Same reporter, place and symptoms within 24 hours. Check if it was sent twice.", f"/reports/{b.name}", b.creation)

	# open events flagged "confirm the number"
	for e in frappe.get_all(EVENT, filters={**_scope(), "status": ["in", OPEN], "data_warning": ["is", "set"]},
			fields=["name", "disease_name", "data_warning", "first_reported"]):
		add("warning", e.name, f"{e.name}: {e.disease_name or 'event'}", e.data_warning, f"/alerts-signals/{e.name}", e.first_reported)

	# MOH 505 (IDSR) reporting completeness, last 4 weeks
	try:
		from surveillance.analytics import _completeness
		subs = _region_sub_counties()
		if subs is None:
			subs = {(s or "").strip().lower() for s in frappe.get_all("Sub County", pluck="sub_county_name")}
		comp = _completeness(4, subs)
		for f in comp.get("facilities") or []:
			if f["pct"] < 100:
				add("completeness", f"{f['facility']}:{comp.get('upTo')}", f"{f['facility']}: {f['reported']} of {f['weeks']} weeks reported",
					f"{f['subCounty'] or ''}. MOH 505 weeks up to {comp.get('upTo')}.", "/facility-data")
	except Exception:
		frappe.log_error(title="Data quality: completeness failed", message=frappe.get_traceback())

	counts = {k: sum(1 for i in issues if i["kind"] == k) for k in DQ_KINDS}
	return {"issues": issues, "counts": counts, "kinds": DQ_KINDS, "days": cint(days or 30),
		"reportsChecked": len(reports), "canDismiss": has_capability("view_data_quality")}


@frappe.whitelist(methods=["POST"])
def dismiss_issue(key, note=None):
	"""Mark a data quality issue as checked (it stops showing)."""
	require_capability("view_data_quality")
	if not key or ":" not in key or key.split(":")[0] not in DQ_KINDS:
		frappe.throw(_("Unknown issue."))
	if not frappe.db.exists(DQ_DISMISS, {"issue_key": key}):
		frappe.get_doc({"doctype": DQ_DISMISS, "issue_key": key[:240], "kind": key.split(":")[0],
			"note": (note or "").strip()[:500], "dismissed_by": frappe.session.user,
			"dismissed_on": now_datetime()}).insert(ignore_permissions=True)
	return {"ok": True}
