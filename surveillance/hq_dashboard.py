"""System Administrator dashboard, in tabs (KRCS Dashboard and Main Menu Re-Organization, 13 Nov 2026):

  At a Glance              get_glance
  Surveillance & Response  get_surveillance
  Epidemiological Trends   (the Epi Trends page, shown inside the tab)
  System Performance       get_performance
  Maps                     (the Surveillance Map page, shown inside the tab)
  Last updated / sync      get_status

Filters on every call: region, sub_county (name), from_date, to_date, channel, status, category (Human / Animal).
A user limited to a region (no View All Regions) only ever sees that region. Surveillance Officers, FHWs and CHAs see
only their assigned sub-county (user_scope.locked_area) and have no System Performance tab.

Only diseases ticked Active are shown (charts, lists and counts), except the Total signals cards, which count
everything received with the active-disease count as their note; reports not matched to any disease are kept, as in
the Review Queue. "Signals" are everything that came in: field reports (Case Report: Mobile, Web, WhatsApp, SMS, USSD) plus CBS and
EMR signals that did not come from a field report. Report statuses are the ones people see: Awaiting review,
Investigating, Closed, Recorded. CBS / EMR signals take their status from the event they were grouped into.
"""
import re
from collections import Counter

import frappe
from frappe.utils import add_days, cint, get_datetime, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability, require_capability
from surveillance.user_scope import locked_area

VIEW = "view_analytics"
CHANNELS = ["Mobile", "Web", "WhatsApp", "CBS", "EMR"]   # SMS and USSD are not used (KRCS, 16 Nov 2026)
CHANNEL_LABEL = {"Mobile": "Mobile app", "EMR": "EMR (facility)"}
STATUSES = ["Awaiting review", "Investigating", "Closed", "Recorded"]
REPORT_STATUS = {"Submitted": "Awaiting review", "Linked": "Awaiting review", "Reviewed": "Recorded", "Verified": "Awaiting review",
	"Confirmed": "Investigating", "Escalated": "Investigating",
	"Not for review": "Recorded", "Investigating": "Investigating", "Closed": "Closed", "Recorded": "Recorded"}
EVENT_STATUS = {"New": "Awaiting review", "Verified": "Awaiting review", "Investigating": "Investigating",
	"Confirmed": "Investigating", "Escalated": "Investigating", "Closed": "Closed"}
OPEN = ["New", "Verified", "Investigating", "Confirmed", "Escalated"]
SIGNAL_TYPES = ["Suspected Outbreak", "Community Signal", "Facility Signal"]
SEV_ORDER = {"critical": 0, "high": 1, "standard": 2}
CHA_ROLES = ["CHA", "Community Health Assistant"]
USER_ROLES = ["CHP", "Facility Health Worker", "HIS Officer", "Surveillance Officer", "SCDSC",
	"Public Health HQ", "County MOH / PHEOC", "MOH DDSR (National)", "Data & AI Administrator", "System Administrator"] + CHA_ROLES


# ---------- filters ----------

def _require_dashboard():
	"""The dashboard: HQ-level users need View Analytics; officers, FHWs and CHAs see their own sub-county."""
	if not has_capability(VIEW) and not locked_area():
		frappe.throw("You do not have permission to see this dashboard.", frappe.PermissionError)


def _f(region=None, sub_county=None, from_date=None, to_date=None, channel=None, status=None, category=None):
	from surveillance.events import _user_region
	area = locked_area()
	if area:   # one of their sub-counties at a time: the one picked, or the first (KRCS 19 Nov 2026)
		from surveillance.user_scope import pick_sub_county
		sub_county = pick_sub_county(area, sub_county)
		region = _region_of(sub_county) or area.region
	to_d = getdate(to_date) if to_date else getdate(nowdate())
	from_d = getdate(from_date) if from_date else add_days(to_d, -29)
	if from_d > to_d:
		from_d, to_d = to_d, from_d
	mine = region if area else _user_region()
	from surveillance.health_units import cha_scope, visible_events
	return frappe._dict(
		cha=cha_scope(), vis=visible_events(),   # CHAs: their CHU(s) only (KRCS 17 Nov 2026)
		region=mine or (region or None), sub_county=(sub_county or "").strip().lower() or None,
		from_d=from_d, to_d=to_d, start=get_datetime(f"{from_d} 00:00:00"), end=get_datetime(f"{to_d} 23:59:59"),
		channel=channel if channel in CHANNELS else None, status=status if status in STATUSES else None,
		category=category if category in ("Human", "Animal") else None, locked_region=mine)


def _region_of(sub_county_name):
	return frappe.db.get_value("Sub County", {"sub_county_name": sub_county_name}, "region") if sub_county_name else None


def _sub_names():
	return {s.name: s for s in frappe.get_all("Sub County", fields=["name", "sub_county_name", "region"])}


def _diseases():
	return {d.name: d for d in frappe.get_all("Alert Threshold Config",
		fields=["name", "disease_name", "category", "synonyms", "is_active"])}


def _active():
	from surveillance.alert_thresholds import active_diseases
	return set(active_diseases())


def _disease_label(dis, key):
	if not key:
		return "Not matched to a disease"
	return (dis.get(key) or {}).get("disease_name") or key


# ---------- every signal in the period ----------

def _signals(f, dis=None, ignore_channel=False, all_diseases=False):
	"""Field reports + CBS / EMR signals in the period, after the filters. One dict per signal.
	Active diseases only (plus unmatched reports), unless all_diseases (the Total signals cards)."""
	dis = dis or _diseases()
	subs = _sub_names()
	rows = []

	cr_filters = {"creation": ["between", [f.start, f.end]]}
	if f.region and not f.sub_county:
		cr_filters["region"] = f.region
	reports = frappe.get_all("Case Report", filters=cr_filters, limit_page_length=0,
		fields=["name", "creation", "channel", "status", "category", "signal_type", "suspected_disease", "region",
			"sub_county", "affected_count"] + (["community_health_unit"] if f.get("cha") else []))
	if f.get("cha"):
		from surveillance.health_units import report_ok
		reports = [r for r in reports if report_ok(f.cha, r.community_health_unit)]
	ev_of = {}
	if reports:
		for s in frappe.get_all("Surveillance Signal", filters={"source": "Field", "ref": ["in", [r.name for r in reports]]},
				fields=["ref", "event"], limit_page_length=0):
			ev_of[s.ref] = s.event
	for r in reports:
		sc = subs.get(r.sub_county)
		rows.append({"id": r.name, "at": r.creation, "channel": r.channel or "Web",
			"status": REPORT_STATUS.get(r.status, r.status), "category": "Animal" if r.category == "Animal Disease" else "Human",
			"type": r.signal_type or "Community Signal", "disease": r.suspected_disease, "region": r.region,
			"subCounty": (sc.sub_county_name if sc else "") or "", "event": ev_of.get(r.name), "people": cint(r.affected_count)})

	sig_filters = {"source": ["in", ["CBS", "EMR"]], "signal_date": ["between", [f.start, f.end]]}
	if f.region and not f.sub_county:
		sig_filters["region"] = f.region
	for s in frappe.get_all("Surveillance Signal", filters=sig_filters, limit_page_length=0,
			fields=["name", "source", "signal_date", "disease", "region", "sub_county", "event", "people"]):
		rows.append({"id": s.name, "at": s.signal_date, "channel": s.source, "status": None,
			"category": (dis.get(s.disease) or {}).get("category") or "Human",
			"type": "Community Signal" if s.source == "CBS" else "Facility Signal", "disease": s.disease,
			"region": s.region, "subCounty": s.sub_county or "", "event": s.event, "people": cint(s.people)})

	events = {}
	ev_names = list({r["event"] for r in rows if r["event"]})
	if ev_names:
		for e in frappe.get_all("Surveillance Event", filters={"name": ["in", ev_names]},
				fields=["name", "status", "decision"], limit_page_length=0):
			events[e.name] = e
	for r in rows:
		e = events.get(r["event"])
		r["escalated"] = bool(e and (e.status == "Escalated" or e.decision == "Escalated"))
		if r["status"] is None:
			r["status"] = EVENT_STATUS.get(e.status, "Awaiting review") if e else "Recorded"

	active = _active()
	out = []
	for r in rows:
		if r["disease"] and r["disease"] not in active and not all_diseases:
			continue
		if f.sub_county and r["subCounty"].strip().lower() != f.sub_county:
			continue
		if f.channel and not ignore_channel and r["channel"] != f.channel:
			continue
		if f.status and r["status"] != f.status:
			continue
		if f.category and r["category"] != f.category:
			continue
		out.append(r)
	return out


def _bars(counter, keys=None, labels=None, limit=None):
	items = [(k, counter.get(k, 0)) for k in keys] if keys else counter.most_common(limit)
	return {"labels": [(labels or {}).get(k, k) for k, _ in items], "data": [n for _, n in items]}


def _card(key, label, value, note=""):
	return {"key": key, "label": label, "value": value, "note": note}


def _event_filters(f, **extra):
	ef = dict(extra)
	if f.region and not f.sub_county:
		ef["region"] = f.region
	return ef


def _event_in_sub(e, f):
	if f.get("vis") is not None and e.name not in f.vis:
		return False
	return not f.sub_county or (e.sub_county or "").strip().lower() == f.sub_county


# ---------- At a Glance ----------

@frappe.whitelist()
def get_glance(region=None, sub_county=None, from_date=None, to_date=None, channel=None, status=None, category=None):
	_require_dashboard()
	f = _f(region, sub_county, from_date, to_date, channel, status, category)
	dis = _diseases()
	rows = _signals(f, dis)
	st = Counter(r["status"] for r in rows)
	by_disease = Counter(r["disease"] for r in rows)
	channels_used = {r["channel"] for r in _signals(f, dis, ignore_channel=True)}

	priority = []
	active = _active()
	for e in frappe.get_all("Surveillance Event", filters=_event_filters(f, status=["in", OPEN], severity=["in", ["critical", "high"]]),
			fields=["name", "title", "disease", "disease_name", "severity", "status", "area", "sub_county", "people", "reports", "last_reported"],
			order_by="last_reported desc", limit_page_length=200):
		if _event_in_sub(e, f) and (not e.disease or e.disease in active):
			priority.append(e)
	priority.sort(key=lambda e: (SEV_ORDER.get(e.severity, 3), -(get_datetime(e.last_reported).timestamp() if e.last_reported else 0)))

	top = [(k, n) for k, n in by_disease.most_common() if k][:5]
	return {
		"cards": [
			_card("signals", "Total signals received", len(_signals(f, dis, all_diseases=True)), f"{len(rows)} for active diseases"),
			_card("closed", "Investigated and closed", st["Closed"], "reports closed"),
			_card("escalated", "Escalated", sum(1 for r in rows if r["escalated"]), "to county / MOH"),
			_card("pending", "Pending verification", st["Awaiting review"], "awaiting review"),
			_card("channels", "Active reporting channels", len(channels_used), f"of {len(CHANNELS)} sent data in this period"),
		],
		"topDiseases": {"labels": [_disease_label(dis, k) for k, _ in top], "data": [n for _, n in top]},
		"priorityEvents": [{"id": e.name, "title": e.title or e.disease_name, "disease": e.disease_name, "severity": e.severity,
			"status": e.status, "place": ", ".join(x for x in [e.area, e.sub_county] if x), "people": cint(e.people),
			"reports": cint(e.reports), "lastReported": str(e.last_reported or "")} for e in priority[:8]],
		"category": _bars(Counter(r["category"] for r in rows), ["Human", "Animal"]),
		"signalType": _bars(Counter(r["type"] for r in rows), SIGNAL_TYPES),
		"distribution": {"labels": [_disease_label(dis, k) for k, _ in by_disease.most_common()],
			"data": [n for _, n in by_disease.most_common()]},
	}


# ---------- Surveillance & Response ----------

def _week(d):
	d = getdate(d)
	return add_days(d, -d.weekday())


def _tasks(f, task_type, date_field, done=True):
	tf = _event_filters(f, task_type=task_type)
	tf[date_field] = ["between", [f.start, f.end]]
	if done:
		tf["status"] = "Done"
	rows = frappe.get_all("Event Task", filters=tf, fields=["name", "sub_county", "event"], limit_page_length=0)
	if f.get("vis") is not None:
		rows = [t for t in rows if t.event in f.vis]
	return sum(1 for t in rows if not f.sub_county or (t.sub_county or "").strip().lower() == f.sub_county)


def _response_time(analytics, weeks, last, sub_county=None):
	"""Analytics time to start verification; for a sub-county only, the events of that sub-county."""
	if not sub_county:
		return analytics._response_time(weeks, last)
	from statistics import median
	cols = [add_days(last, -7 * i) for i in reversed(range(weeks))]
	names = set(frappe.get_all("Surveillance Event", filters={"creation": [">=", cols[0]]},
		or_filters={"sub_county": sub_county, "area": ["like", f"%{sub_county}%"]}, pluck="name"))
	from surveillance.health_units import visible_events
	vis = visible_events()
	if vis is not None:
		names &= vis
	events = [e for e in analytics._events_since(cols[0]) if e.name in names]
	acts = analytics._actions(events)
	per_week = {}
	for e in events:
		h = analytics._hours_to_verify(e, acts)
		if h is not None:
			per_week.setdefault(analytics._week_start(e.creation), []).append(h)
	return {"labels": [analytics._epi(w) for w in cols],
		"medianHours": [round(median(per_week[w]), 1) if per_week.get(w) else None for w in cols],
		"verified": [len(per_week.get(w, [])) for w in cols], "target": 24}


@frappe.whitelist()
def get_surveillance(region=None, sub_county=None, from_date=None, to_date=None, channel=None, status=None, category=None,
		disease=None):
	_require_dashboard()
	from surveillance import analytics
	f = _f(region, sub_county, from_date, to_date, channel, status, category)
	dis = _diseases()
	rows = _signals(f, dis)
	st = Counter(r["status"] for r in rows)
	active = _active()

	# events that started in the period, per week and per disease
	events = [e for e in frappe.get_all("Surveillance Event", filters=_event_filters(f, creation=["between", [f.start, f.end]]),
		fields=["name", "creation", "disease", "disease_name", "sub_county"], limit_page_length=0)
		if _event_in_sub(e, f) and (not e.disease or e.disease in active)]
	weeks = []
	w = _week(f.from_d)
	while w <= f.to_d:
		weeks.append(w)
		w = add_days(w, 7)
	per_week = Counter(_week(e.creation) for e in events)
	ev_dis = Counter(e.disease_name or _disease_label(dis, e.disease) for e in events)

	# observed vs usual, last 4 weeks vs the 4 before, time to start verification: the Analytics calculations
	n_weeks = max(4, min(len(weeks), 52))
	last = add_days(_week(f.to_d), -7) if f.to_d >= getdate(nowdate()) else _week(f.to_d)
	subs = analytics._sub_counties()
	if f.sub_county:
		subs = {s for s in subs if s == f.sub_county}
	names = {k: v.disease_name or k for k, v in dis.items()}
	return {
		"cards": [
			_card("submitted", "Total signals submitted", len(_signals(f, dis, all_diseases=True)), f"{len(rows)} for active diseases"),
			_card("investigating", "Under investigation", st["Investigating"]),
			_card("closed", "Investigated and closed", st["Closed"]),
			_card("escalated", "Escalated", sum(1 for r in rows if r["escalated"])),
			_card("followups", "Follow-ups conducted", _tasks(f, "Follow-up", "completed_on")),
			_card("referrals", "Referrals made", _tasks(f, "Referral", "creation", done=False)),
			_card("responses", "Response actions completed", _tasks(f, "Response action", "completed_on")),
		],
		"newEvents": {"labels": [f"W{getdate(x).isocalendar()[1]}" for x in weeks], "weeks": [str(x) for x in weeks],
			"data": [per_week.get(x, 0) for x in weeks]},
		"eventDiseases": {"labels": [k for k, _ in ev_dis.most_common()], "data": [n for _, n in ev_dis.most_common()]},
		"expected": analytics._expected(n_weeks, "all", subs, names, last, disease or None),
		"periodCompare": analytics._period_compare("all", subs, names, last),
		"responseTime": _response_time(analytics, n_weeks, last, f.sub_county),
		"diseases": [{"value": k, "label": v.disease_name or k} for k, v in
			sorted(dis.items(), key=lambda x: (x[1].disease_name or "").lower().removeprefix("suspected ")) if k in active],
	}


# ---------- System Performance ----------

def _users_by_role():
	enabled = set(frappe.get_all("User", filters={"enabled": 1, "user_type": "System User",
		"name": ["not in", ["Administrator", "Guest"]]}, pluck="name"))
	counts = Counter()
	people = set()
	for h in frappe.get_all("Has Role", filters={"parenttype": "User", "role": ["in", USER_ROLES]},
			fields=["parent", "role"], limit_page_length=0):
		if h.parent in enabled:
			counts[h.role] += 1
			people.add(h.parent)
	return counts, people


def _chatbot(f, dis):
	from surveillance.chatbot_log import MATCHED, NOT_GUIDANCE
	if not frappe.db.table_exists("Chatbot Query Log"):
		return 0, None, None, {"labels": [], "data": []}
	rows = frappe.get_all("Chatbot Query Log", filters={"level": "Conversation", "creation": ["between", [f.start, f.end]]},
		fields=["outcome", "access_decision", "query_text", "feedback_helpful"], limit_page_length=0)
	guidance = [r for r in rows if r.outcome not in NOT_GUIDANCE and r.access_decision != "DENY"]
	usable = sum(1 for r in guidance if r.outcome in MATCHED)
	rate = round(usable * 100 / len(guidance), 1) if guidance else None
	rated = [r for r in rows if r.feedback_helpful]
	helpful = round(sum(1 for r in rated if r.feedback_helpful == "Yes") * 100 / len(rated), 1) if rated else None

	# diseases asked about: disease name (without "Suspected") or any of its synonyms in the question
	patterns = {}
	active = _active()
	for key, d in dis.items():
		if key not in active:
			continue
		words = {(d.disease_name or "").lower().removeprefix("suspected ").strip()}
		words |= {w.strip().lower() for w in (d.synonyms or "").split(",")}
		words = {w for w in words if len(w) >= 3}
		if words:
			patterns[key] = re.compile(r"\b(" + "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)) + r")\b")
	asked = Counter()
	for r in rows:
		q = (r.query_text or "").lower()
		for key, p in patterns.items():
			if p.search(q):
				asked[key] += 1
	top = asked.most_common(5)
	return len(rows), rate, helpful, {"labels": [_disease_label(dis, k) for k, _ in top], "data": [n for _, n in top]}


def _dq_top(f):
	from surveillance.officer import get_data_quality
	if not has_capability("view_data_quality"):
		return None
	try:
		dq = get_data_quality(max(1, (getdate(nowdate()) - f.from_d).days + 1))
	except Exception:
		frappe.log_error(title="HQ dashboard: data quality failed", message=frappe.get_traceback())
		return None
	top = sorted(dq["counts"].items(), key=lambda x: -x[1])[:5]
	return {"labels": [dq["kinds"][k] for k, _ in top], "data": [n for _, n in top]}


def _ai_measures(f):
	"""The AI measures of Monitoring Reports R38 (monitoring.ai_measures), for the dashboard's AI performance panel."""
	try:
		from surveillance.monitoring import ai_measures
		return ai_measures(frappe._dict(f, disease=None))
	except Exception:
		frappe.log_error(title="Dashboard: AI measures failed", message=frappe.get_traceback())
		return []


@frappe.whitelist()
def get_performance(region=None, sub_county=None, from_date=None, to_date=None, channel=None, status=None, category=None):
	require_capability(VIEW)
	if locked_area():
		frappe.throw("System Performance is for HQ users.", frappe.PermissionError)
	from surveillance import analytics
	f = _f(region, sub_county, from_date, to_date, channel, status, category)
	dis = _diseases()
	rows = _signals(f, dis, ignore_channel=True)   # the channel charts always show every channel
	by_channel = Counter(r["channel"] for r in rows)
	roles, people = _users_by_role()
	used = frappe.db.count("User", {"name": ["in", list(people) or [""]], "last_active": [">=", f.start]})
	cha_exists = any(frappe.db.exists("Role", r) for r in CHA_ROLES)
	questions, rate, helpful, asked = _chatbot(f, dis)
	hours = [0] * 24
	for r in rows:
		if r["at"]:
			hours[get_datetime(r["at"]).hour] += 1
	weeks = max(4, min(((f.to_d - f.from_d).days + 1) // 7 or 4, 52))
	subs = analytics._sub_counties()
	if f.sub_county:
		subs = {s for s in subs if s == f.sub_county}
	role_keys = [r for r in USER_ROLES if roles.get(r)]
	return {
		"cards": [
			_card("users", "Active system users", len(people), f"{used} used the system in this period"),
			_card("chps", "CHPs", roles.get("CHP", 0)),
			_card("chas", "CHAs", sum(roles.get(r, 0) for r in CHA_ROLES) if cha_exists else "—",
				"" if cha_exists else "CHA role not set up yet"),
			_card("whatsapp", "Submissions via WhatsApp", by_channel.get("WhatsApp", 0)),
			_card("mobile", "Submissions via mobile app", by_channel.get("Mobile", 0)),
			_card("questions", "Questions to the AI chatbot", questions),
			_card("answer_rate", "Questions answered", "—" if rate is None else f"{rate}%", "a usable answer was returned"),
		],
		"usersByRole": {"labels": role_keys, "data": [roles[r] for r in role_keys]},
		"chatbotDiseases": asked,
		"channels": _bars(by_channel, CHANNELS, CHANNEL_LABEL),
		"dataQuality": _dq_top(f),
		"hours": {"labels": [f"{h:02d}:00" for h in range(24)], "data": hours},
		"completeness": analytics._completeness(weeks, subs),
		# AI performance: the Monitoring Reports R38 measures for the same period and area
		"ai": {"answerRate": rate, "helpfulRate": helpful},
		"aiMeasures": _ai_measures(f),
	}


# ---------- last updated and data sync (shown on every tab) ----------

def _latest(doctype, field, filters=None):
	if not frappe.db.table_exists(doctype):
		return None
	filters = filters or {}
	where = " and ".join(f"`{k}` = %({k})s" for k in filters) or "1=1"
	v = frappe.db.sql(f"select max(`{field}`) from `tab{doctype}` where {where}", filters)[0][0]
	return str(v) if v else None


@frappe.whitelist()
def get_status():
	_require_dashboard()
	idsr_week = _latest("IDSR Facility Week", "week_start")
	mobile = None
	if frappe.db.table_exists("Mobile Sync Stats"):
		day = _latest("Mobile Sync Stats", "day")
		if day:
			r = frappe.db.sql("select sum(queued) q, sum(failed) f, count(*) n from `tabMobile Sync Stats` where day = %s", day, as_dict=True)[0]
			mobile = {"day": day, "waiting": cint(r.q), "failed": cint(r.f), "devices": cint(r.n)}
	return {
		"now": str(now_datetime()),
		"sources": [
			{"key": "field", "label": "Field reports", "last": _latest("Case Report", "creation")},
			{"key": "whatsapp", "label": "WhatsApp", "last": _latest("Case Report", "creation", {"channel": "WhatsApp"})},
			# CBS arrives as signals and as weekly counts (hourly sync): the newest of the two
			{"key": "cbs", "label": "CBS", "last": max(filter(None, [_latest("Surveillance Signal", "creation", {"source": "CBS"}),
				_latest("Weekly Count", "modified", {"source": "CBS"})]), default=None)},
			# MOH 505 weeks can be loaded by upload or from KHIS files: when the newest week row was saved
			{"key": "moh505", "label": "MOH 505", "last": _latest("IDSR Facility Week", "modified"),
				"week": f"W{getdate(idsr_week).isocalendar()[1]}" if idsr_week else None},
		],
		"mobile": mobile,
	}


@frappe.whitelist()
def get_filter_options():
	"""Regions and sub-counties the user may pick (their own region only, if limited), channels and statuses.
	Officers, FHWs and CHAs: their sub-county only (lockedSubCounty)."""
	_require_dashboard()
	from surveillance.events import _scope, _user_region
	area = locked_area()
	mine = area.region if area else _user_region()
	pilot, _d = _scope()
	if area:   # their sub-county or sub-counties, whatever region they are in (KRCS 19 Nov 2026)
		regions = frappe.get_all("Region", filters={"name": ["in", area.regions or [""]]}, fields=["name", "region_name"], order_by="region_name asc")
		subs = sorted(frappe.get_all("Sub County", filters={"name": ["in", area.ids]}, fields=["sub_county_name", "region"]),
			key=lambda s: area.sub_counties.index(s.sub_county_name) if s.sub_county_name in area.sub_counties else 99)
	else:
		regions = frappe.get_all("Region", filters={"name": mine} if mine else {}, fields=["name", "region_name"], order_by="region_name asc")
		subs = [s for s in frappe.get_all("Sub County", filters={"region": mine} if mine else {},
			fields=["sub_county_name", "region"], order_by="sub_county_name asc") if (s.sub_county_name or "").strip().lower() in pilot]
	return {
		"lockedRegion": mine if not area or len(area.regions) <= 1 else None,
		# one sub-county: shown fixed; more than one: picked from their own (pickSubCounty)
		"lockedSubCounty": area.sub_county if area and len(area.ids) == 1 else None,
		"pickSubCounty": bool(area and len(area.ids) > 1),
		"canSeeAll": has_capability(VIEW) and not area,
		"regions": [{"value": r.name, "label": r.region_name or r.name} for r in regions],
		"subCounties": [{"value": s.sub_county_name, "label": s.sub_county_name, "region": s.region} for s in subs],
		"channels": [{"value": c, "label": CHANNEL_LABEL.get(c, c)} for c in CHANNELS],
		"statuses": [{"value": s, "label": s} for s in STATUSES],
	}


@frappe.whitelist(methods=["POST"])
def export_xlsx(title, meta=None, sheets=None):
	"""A dashboard tab's numbers as Excel: who downloaded it, when and with which filters, then a sheet per chart or
	table (made from what was on screen). Anyone who can see the dashboard may download (KRCS, 17 Nov 2026)."""
	import io
	from openpyxl import Workbook
	from openpyxl.styles import Font, PatternFill
	if not has_capability("dataai_workspace"):   # the Data & AI Admin dashboard downloads too (KRCS 18 Nov 2026)
		_require_dashboard()
	meta = frappe.parse_json(meta) if isinstance(meta, str) else (meta or [])
	sheets = frappe.parse_json(sheets) if isinstance(sheets, str) else (sheets or [])
	wb = Workbook()
	wb.remove(wb.active)
	head, red = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="EE2435")
	used = set()
	for s in sheets[:40]:
		name = re.sub(r"[\\/*?:\[\]]", " ", str(s.get("name") or "Sheet")).strip()[:28] or "Sheet"
		base, n = name, 2
		while name.lower() in used:
			name, n = f"{base[:25]} {n}", n + 1
		used.add(name.lower())
		ws = wb.create_sheet(name)
		if len(wb.sheetnames) == 1:   # the first sheet starts with the title and who downloaded it, when, which filters
			ws.append([str(title or "Dashboard")])
			ws["A1"].font = Font(bold=True, size=14)
			for line in meta:
				ws.append([str(line)])
			ws.append([])
		cols = [str(c) for c in (s.get("columns") or [])]
		if cols:
			ws.append(cols)
			for c in ws[ws.max_row]:
				c.font, c.fill = head, red
		for r in (s.get("rows") or [])[:5000]:
			ws.append([v if isinstance(v, (int, float)) else ("" if v is None else str(v)) for v in r])
		for i in range(1, max(len(cols), 1) + 1):
			ws.column_dimensions[ws.cell(1, i).column_letter].width = 42 if i == 1 else 18
	if not wb.sheetnames:
		wb.create_sheet("Dashboard")
	buf = io.BytesIO()
	wb.save(buf)
	frappe.response["filename"] = "dashboard.xlsx"
	frappe.response["filecontent"] = buf.getvalue()
	frappe.response["type"] = "binary"
