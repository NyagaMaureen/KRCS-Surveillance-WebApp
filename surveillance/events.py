"""Review Queue: individual reports (signals) grouped into events for Surveillance Officers.

Signal = one de-identified report: a CBS report, a field Case Report, or (later) an EMR visit.
         Kept: source, reference (CBS case number / Case Report ID), date, disease, place, people, deaths.
         Never kept: names, phone numbers, free-text notes.
Event  = one report (signal) of a priority disease. Every new report starts its own event, so nothing
         is merged silently. Open events of the same disease in the same sub-county within WINDOW_DAYS
         are shown as "related", and an officer can merge them (merge_events) when they are one outbreak.
An officer works the event through the investigation workflow (investigation.py):
verify (questions), investigate (protocol steps), decide (confirm / discard / escalate), respond and close.

Officers see events for their assigned region only (User.assigned_region); users without a
region see every region.
"""
import frappe
from frappe import _
from frappe.utils import add_days, cint, get_datetime, now_datetime

from surveillance.capabilities import has_capability, require_capability

VIEW = "view_review_queue"
ACT = "act_on_events"
WINDOW_DAYS = 7            # open events of the same disease + sub-county within this many days are "related"
SIGNAL_DAYS = 30           # CBS reports newer than this are kept as signals
BIG_REPORT = 50            # one report with this many people gets a "confirm the number" warning
UNCLASSIFIED = "unclassified-illness"
NOT_OF_CONCERN = "Not a disease of concern"

# Scope agreed with KRCS (Allan, 14 Oct 2026): pilot sites only, priority diseases only.
# Both can be overridden in site config without a code change:
#   bench --site <site> set-config review_queue_sub_counties '["Dadaab", "Fafi", "Turkana West"]'
#   bench --site <site> set-config review_queue_diseases '["measles", "awd-cholera", ...]'
PILOT_SUB_COUNTIES = ["Dadaab", "Fafi", "Turkana West"]   # Dadaab camps (Fafi = Hagadera) and Kalobeyei
QUEUE_DISEASES = [
	# priority diseases with a case definition
	"afp-polio", "vhf", "mpox", "yellow-fever", "meningococcal-meningitis", "awd-cholera", "measles",
	"anthrax", "rift-valley-fever", "covid-sari", "rabies",
	# highest priority, no case definition yet
	"bvd",
	# unusual events, and field reports where no case definition matched
	"unusual-illness-people", "unusual-death-people", "unusual-event", "unclassified-illness",
]


def _scope():
	subs = frappe.conf.get("review_queue_sub_counties") or PILOT_SUB_COUNTIES
	diseases = frappe.conf.get("review_queue_diseases") or QUEUE_DISEASES
	return {x.strip().lower() for x in subs}, set(diseases)


def in_scope(disease, sub_county, source=None):
	"""True if a report belongs in the Review Queue. Field reports with no sub-county are kept
	(they come from our own pilot users) and shown with a 'location missing' warning."""
	subs, diseases = _scope()
	if disease not in diseases:
		return False
	if not sub_county:
		return source == "Field"
	return sub_county.strip().lower() in subs

OPEN = ["New", "Verifying", "Investigating", "Confirmed", "Escalated"]
CLOSED = ["Discarded", "Closed"]
LEVELS = ["standard", "high", "critical"]   # same three levels as disease priority and Risk Alerts
PRIORITY_SEVERITY = {"critical": "critical", "high": "high", "standard": "standard"}
SOURCE_ORDER = ["EMR", "Field", "CBS"]

# action -> (allowed from, new status, note required). Gates (answers, steps) are in investigation.check_gate.
ACTIONS = {
	"start": (["New"], "Verifying", False),
	"investigate": (["Verifying"], "Investigating", False),
	"confirm": (["Investigating"], "Confirmed", True),
	"escalate": (["New", "Verifying", "Investigating", "Confirmed"], "Escalated", True),
	"discard": (["New", "Verifying", "Investigating"], "Discarded", True),
	"close": (["Confirmed", "Escalated"], "Closed", True),
	"reopen": (CLOSED, "Verifying", False),
}
ACTION_LABEL = {"start": "Verification started", "investigate": "Field investigation started",
	"confirm": "Confirmed", "escalate": "Escalated to county / MoH", "discard": "Discarded",
	"close": "Closed", "reopen": "Reopened"}


# ---------- signals in ----------

def _sub_county_info(county, sub_county):
	"""(region, county, sub_county) using our Sub County list; region is None if not found."""
	if not sub_county:
		return None, county, sub_county
	row = frappe.db.get_value("Sub County", {"sub_county_name": sub_county, "county": county},
		["region", "county", "sub_county_name"], as_dict=True) or frappe.db.get_value(
		"Sub County", {"sub_county_name": sub_county}, ["region", "county", "sub_county_name"], as_dict=True)
	if row:
		return row.region, row.county, row.sub_county_name
	return None, county, sub_county


def upsert_signal(data, regroup=True):
	"""Create or update one signal and keep its event up to date.

	data: source, ref, disease, reported, signal_date, county, sub_county, area, people, deaths, reason
	"""
	name = f"{data['source']}-{data['ref']}"
	region, county, sub_county = _sub_county_info(data.get("county"), data.get("sub_county"))
	values = {
		"source": data["source"], "ref": data["ref"], "disease": data.get("disease"),
		"reported": (data.get("reported") or "")[:140], "signal_date": get_datetime(data["signal_date"]),
		"county": county, "sub_county": sub_county, "area": data.get("area") or "",
		"region": region, "people": cint(data.get("people")), "deaths": cint(data.get("deaths")),
		"reason": data.get("reason") or "",
		"latitude": data.get("latitude") or None, "longitude": data.get("longitude") or None,
	}
	if frappe.db.exists("Surveillance Signal", name):
		doc = frappe.get_doc("Surveillance Signal", name)
		moved = any(str(doc.get(k) or "") != str(values[k] or "") for k in ("disease", "sub_county", "area"))
		old_event = doc.event
		doc.update(values)
		if moved and old_event:
			doc.event = None
		doc.save(ignore_permissions=True)
		if moved and old_event:
			recompute_event(old_event)
	else:
		doc = frappe.get_doc({"doctype": "Surveillance Signal", **values}).insert(ignore_permissions=True)

	if not doc.event and regroup:
		_assign(doc)
	elif doc.event:
		recompute_event(doc.event)
	return doc.name


def remove_signal(source, ref):
	name = f"{source}-{ref}"
	if not frappe.db.exists("Surveillance Signal", name):
		return
	event = frappe.db.get_value("Surveillance Signal", name, "event")
	frappe.delete_doc("Surveillance Signal", name, ignore_permissions=True, force=True)
	if event:
		recompute_event(event)


def _group_key(sig):
	area = "" if sig.source == "Field" else (sig.area or "")
	return "|".join([sig.disease or "", sig.county or "", sig.sub_county or "", area])


def _assign(sig):
	"""Start a new event for this signal. Related open events (same disease and sub-county, within
	WINDOW_DAYS) are not merged automatically; officers see them and can merge (merge_events)."""
	if not sig.disease:
		return
	meta = frappe.db.get_value("Alert Threshold Config", sig.disease, ["disease_name", "priority"], as_dict=True) or {}
	ev = frappe.get_doc({
		"doctype": "Surveillance Event", "status": "New", "disease": sig.disease,
		"disease_name": meta.get("disease_name") or sig.disease, "priority": meta.get("priority") or "",
		"county": sig.county, "sub_county": sig.sub_county or "", "area": "" if sig.source == "Field" else sig.area,
		"group_key": f"{_group_key(sig)}|{sig.name}", "region": sig.region,
		"first_reported": sig.signal_date, "last_reported": sig.signal_date, "severity": "standard",
	})
	related = related_events(sig.disease, sig.sub_county, sig.signal_date)
	note = f"Event started from {sig.source} report {sig.ref}."
	if related:
		note += " Related open event(s): " + ", ".join(r["id"] for r in related) + "."
	ev.append("actions", {"at": now_datetime(), "user": "Administrator", "action": "Created", "note": note})
	ev.insert(ignore_permissions=True)
	frappe.db.set_value("Surveillance Signal", sig.name, "event", ev.name, update_modified=False)
	recompute_event(ev.name)
	from surveillance import notifications
	notifications.on_new_event(ev.name, sig.signal_date)


def related_events(disease, sub_county, when=None, exclude=None):
	"""Open events of the same disease in the same sub-county reported within WINDOW_DAYS of `when`."""
	if not disease or not sub_county:
		return []
	when = get_datetime(when) if when else now_datetime()
	filters = {"disease": disease, "sub_county": sub_county, "status": ["in", OPEN],
		"last_reported": [">=", add_days(when, -WINDOW_DAYS)], "first_reported": ["<=", add_days(when, WINDOW_DAYS)]}
	if exclude:
		filters["name"] = ["!=", exclude]
	return [{"id": r.name, "title": r.title, "status": r.status, "severity": r.severity, "reports": r.reports or 0,
		"people": r.people or 0, "lastSeen": str(r.last_reported or "")}
		for r in frappe.get_all("Surveillance Event", filters=filters,
			fields=["name", "title", "status", "severity", "reports", "people", "last_reported"], order_by="last_reported desc")]


@frappe.whitelist(methods=["POST"])
def merge_events(event, into, note=None):
	"""Move every report of `event` into `into` (same disease), then close `event` as merged.
	For when an officer decides two related events are the same outbreak."""
	require_capability(ACT)
	if event == into:
		frappe.throw(_("Choose a different event to merge into."))
	src, dst = frappe.get_doc("Surveillance Event", event), frappe.get_doc("Surveillance Event", into)
	_check_access(src)
	_check_access(dst)
	if src.status not in OPEN or dst.status not in OPEN:
		frappe.throw(_("Only open events can be merged."))
	if src.disease != dst.disease:
		frappe.throw(_("Only events of the same disease can be merged."))
	note = (note or "").strip()
	if not note:
		frappe.throw(_("Please say why these are the same outbreak."))

	refs = []
	for s in frappe.get_all("Surveillance Signal", filters={"event": src.name}, fields=["name", "ref"]):
		frappe.db.set_value("Surveillance Signal", s.name, "event", dst.name, update_modified=False)
		refs.append(s.ref)
	moved = ", ".join(refs) or "no reports"

	dst.reload()
	dst.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": "Merged in",
		"note": f"Merged from {src.name} ({moved}). {note}"})
	dst.save(ignore_permissions=True)
	recompute_event(dst.name)

	src.reload()
	src.status = "Closed"
	src.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": "Merged",
		"note": f"Merged into {dst.name} ({moved}). {note}"})
	src.reports = 0
	src.data_warning = f"Merged into {dst.name}."
	src.save(ignore_permissions=True)

	from surveillance.alerts import sync_alert_for_event
	sync_alert_for_event(src)
	sync_alert_for_event(frappe.get_doc("Surveillance Event", dst.name))
	frappe.db.commit()
	return _shape(frappe.get_doc("Surveillance Event", dst.name), detail=True)


def recompute_event(event):
	"""Refresh an event's totals, title, severity and warnings from its signals."""
	if not frappe.db.exists("Surveillance Event", event):
		return
	sigs = frappe.get_all("Surveillance Signal", filters={"event": event},
		fields=["source", "ref", "signal_date", "area", "people", "deaths", "reason", "reported", "latitude", "longitude",
			"check_status"], order_by="signal_date asc")
	doc = frappe.get_doc("Surveillance Event", event)
	if not sigs:
		if doc.get("from_alert"):
			return   # opened from an Epi Trends alert: no individual reports, keep its own totals
		if doc.status == "New" and len(doc.actions or []) <= 1:
			frappe.delete_doc("Surveillance Event", event, ignore_permissions=True, force=True)
		return

	areas = sorted({s.area for s in sigs if s.area})
	place = areas[0] if len(areas) == 1 else (f"{len(areas)} areas" if areas else "")
	place = ", ".join(p for p in [place, doc.sub_county] if p)
	sources = sorted({s.source for s in sigs}, key=SOURCE_ORDER.index)

	meta = frappe.db.get_value("Alert Threshold Config", doc.disease, ["threshold", "priority", "disease_name"], as_dict=True) or {}
	counted = [s for s in sigs if s.check_status != "Not a case"]   # reports checked as "Not a case" stay listed but are not counted
	people = sum(s.people or 0 for s in counted)
	computed = PRIORITY_SEVERITY.get((meta.get("priority") or "").lower(), "standard")
	threshold = cint(meta.get("threshold"))
	if (threshold > 1 and people >= threshold) or len(counted) >= 3:
		computed = LEVELS[min(LEVELS.index(computed) + 1, len(LEVELS) - 1)]
	severity = max([doc.severity if doc.severity in LEVELS else "standard", computed], key=LEVELS.index)  # never lowered automatically

	big = [s for s in sigs if (s.people or 0) >= BIG_REPORT]
	warnings = []
	if big:
		warnings.append(f"Report {big[0].ref} lists {big[0].people} people. Confirm the number with the reporter before acting.")
	if not doc.sub_county:
		warnings.append("Location missing: no sub-county on the report. Shown to all regions until corrected.")
	warning = " ".join(warnings)

	doc.update({
		"title": f"{meta.get('disease_name') or doc.disease} · {place or 'location unknown'}",
		"disease_name": meta.get("disease_name") or doc.disease_name,
		"priority": meta.get("priority") or doc.priority,
		"area": areas[0] if len(areas) == 1 else ("" if not areas else f"{len(areas)} areas"),
		"people": people, "deaths": sum(s.deaths or 0 for s in counted), "reports": len(sigs),
		"sources": ", ".join(sources),
		"first_reported": sigs[0].signal_date, "last_reported": sigs[-1].signal_date,
		"severity": severity, "reason": _reason(sigs), "data_warning": warning,
		"linked_alert": doc.get("from_alert") or _linked_alert(doc.disease, doc.sub_county),
		**_event_point(sigs),
	})
	doc.save(ignore_permissions=True)


def _event_point(sigs):
	"""Map position: average of the signals that have coordinates (usually one CHU or one GPS point)."""
	pts = [(s.latitude, s.longitude) for s in sigs if s.latitude and s.longitude]
	if not pts:
		return {"latitude": None, "longitude": None}
	return {"latitude": sum(p[0] for p in pts) / len(pts), "longitude": sum(p[1] for p in pts) / len(pts)}


def _reason(sigs):
	"""Strongest reason: EMR (doctor / case definition) > field case definition > CBS report."""
	for source in SOURCE_ORDER:
		hits = [s for s in sigs if s.source == source and s.reason]
		if hits:
			return hits[-1].reason
	return f"Reported through CBS as {sigs[-1].reported}" if sigs[-1].reported else ""


def _linked_alert(disease, sub_county):
	if not sub_county:
		return None
	rows = frappe.get_all("Risk Alert", filters={"disease": disease, "sub_county": sub_county,
		"status": ["not in", ["Resolved", "Rejected"]]}, pluck="name", order_by="last_detected desc", limit=1)
	return rows[0] if rows else None


# ---------- field Case Reports (doc_events) ----------

def _field_report_time(doc):
	"""Submission time when the report is dated the day it was submitted; otherwise the report's date."""
	created = get_datetime(doc.creation)
	if not doc.report_date or str(doc.report_date) == str(created.date()):
		return created
	return get_datetime(doc.report_date)


def on_case_report(doc, method=None):
	"""Keep the Field signal for a Case Report in step with the report."""
	if doc.review_outcome == NOT_OF_CONCERN and not doc.suspected_disease:
		event = frappe.db.get_value("Surveillance Signal", f"Field-{doc.name}", "event")
		if not (event and frappe.db.get_value("Surveillance Event", event, "status") in CLOSED):
			remove_signal("Field", doc.name)  # keep it on an event that was already discarded or closed
		return
	county = sub = None
	if doc.sub_county:
		county, sub = frappe.db.get_value("Sub County", doc.sub_county, ["county", "sub_county_name"]) or (None, None)
	disease = doc.suspected_disease or UNCLASSIFIED
	if not in_scope(disease, sub, "Field"):
		remove_signal("Field", doc.name)  # e.g. disease changed to one outside the queue
		return
	exposure = doc.get("animal_exposure")
	upsert_signal({
		"source": "Field", "ref": doc.name, "disease": disease,
		"reported": "; ".join(x for x in [doc.symptom_tags,
			f"Animal exposure: {exposure}" if exposure and exposure != "None" else ""] if x) or doc.signal_type,
		"signal_date": _field_report_time(doc),
		"county": county, "sub_county": sub, "area": doc.location_name,
		"people": doc.affected_count, "deaths": doc.deaths_count,
		"reason": doc.classification_reason or (f"Field report: {doc.signal_type}" if doc.signal_type else ""),
		"latitude": doc.get("latitude"), "longitude": doc.get("longitude"),
	})


def on_case_report_trash(doc, method=None):
	remove_signal("Field", doc.name)


# ---------- CBS (called from cbs_feed.sync) ----------

def sync_cbs_signals(signals):
	"""Upsert recent CBS signals; remove recent ones no longer in CBS (dismissed, test or deleted)."""
	since = add_days(now_datetime(), -SIGNAL_DAYS)
	seen = set()
	for s in signals:
		if get_datetime(s["signal_date"]) < since or not in_scope(s.get("disease"), s.get("sub_county"), "CBS"):
			continue
		seen.add(s["ref"])
		upsert_signal({**s, "source": "CBS"})
	stale = frappe.get_all("Surveillance Signal", filters={"source": "CBS", "signal_date": [">=", since]}, pluck="ref")
	for ref in set(stale) - seen:
		remove_signal("CBS", ref)
	frappe.db.commit()
	return len(seen)


def backfill_field_reports(days=SIGNAL_DAYS):
	"""One-off: create signals for recent Case Reports.
	bench --site <site> execute surveillance.events.backfill_field_reports"""
	n = 0
	for name in frappe.get_all("Case Report", filters={"creation": [">=", add_days(now_datetime(), -int(days))]}, pluck="name"):
		on_case_report(frappe.get_doc("Case Report", name))
		n += 1
	frappe.db.commit()
	print(f"Field reports processed: {n}")
	return n


def purge_out_of_scope():
	"""One-off after narrowing the scope: remove signals outside it, and drop events left empty.
	Events an officer already acted on are kept (their timeline is history), even if out of scope.
	bench --site <site> execute surveillance.events.purge_out_of_scope"""
	removed = 0
	for s in frappe.get_all("Surveillance Signal", fields=["source", "ref", "disease", "sub_county", "event"]):
		if in_scope(s.disease, s.sub_county, s.source):
			continue
		if s.event and frappe.db.get_value("Surveillance Event", s.event, "status") != "New":
			continue
		remove_signal(s.source, s.ref)
		removed += 1
	frappe.db.commit()
	left = frappe.db.count("Surveillance Event")
	print(f"Signals removed: {removed} | events left: {left}")
	return removed


def refresh_links():
	"""Daily, after alert detection: refresh outbreak-alert links on open events."""
	for name in frappe.get_all("Surveillance Event", filters={"status": ["in", OPEN]}, pluck="name"):
		recompute_event(name)
	frappe.db.commit()


# ---------- access ----------

def _user_region():
	"""The region this user is limited to, or None to see every region.
	Users with View All Regions (or no region assigned) see everything."""
	if has_capability("view_all_regions"):
		return None
	if frappe.get_meta("User").has_field("assigned_region"):
		return frappe.db.get_value("User", frappe.session.user, "assigned_region")
	return None


def _scope_filters():
	"""Officers see their own region plus events with no location at all (location missing).
	Events in places outside our Sub County list (e.g. other CBS counties) are for national users only."""
	require_capability(VIEW)
	region = _user_region()
	if not region:
		return {}
	names = frappe.get_all("Surveillance Event", filters={"region": region}, pluck="name")
	names += frappe.get_all("Surveillance Event", filters={"sub_county": ["in", ["", None]]}, pluck="name")
	names += frappe.get_all("Surveillance Event", filters={"sub_county": ["is", "not set"]}, pluck="name")
	return {"name": ["in", list(set(names)) or [""]]}


def _region_name(region):
	if not region:
		return ""
	title = frappe.get_meta("Region").title_field
	return (frappe.get_cached_value("Region", region, title) if title else None) or region


def _check_access(doc):
	region = _user_region()
	if region and doc.sub_county and doc.region != region:
		frappe.throw(_("This event is outside your region."), frappe.PermissionError)


# ---------- API ----------

def _signal_shape(s, can_act):
	"""One report in an event. Field reports show their reporter's name and phone to officers who can act,
	so they can call to verify. These come from the Case Report (our own CHP users); they are not copied onto
	the signal. CBS reporters' contacts are never stored, so officers use the CBS case number in CBS."""
	out = {"id": s.name, "source": s.source, "ref": s.ref, "date": str(s.signal_date), "area": s.area,
		"people": s.people or 0, "deaths": s.deaths or 0, "reported": s.reported, "reason": s.reason,
		"lat": s.latitude, "lng": s.longitude,
		"check": {"reached": s.check_reached or None, "meetsCaseDefinition": s.check_case_definition or None,
			"status": s.check_status or "Not checked",
			"by": frappe.utils.get_fullname(s.checked_by) if s.checked_by else None,
			"on": str(s.checked_on) if s.checked_on else None},
		"reporter": None}
	if s.source == "Field" and can_act and frappe.db.exists("Case Report", s.ref):
		cr = frappe.db.get_value("Case Report", s.ref, ["reporter_name", "phone_number", "reported_by"], as_dict=True)
		phone = cr.phone_number or (frappe.db.get_value("User", cr.reported_by, "mobile_no") if cr.reported_by else None)
		out["reporter"] = {"name": cr.reporter_name or (frappe.utils.get_fullname(cr.reported_by) if cr.reported_by else None),
			"phone": phone or None}
	return out


FIELDS = ["name", "title", "disease", "disease_name", "priority", "severity", "status", "county", "sub_county",
	"area", "region", "people", "deaths", "reports", "sources", "reason", "first_reported", "last_reported",
	"linked_alert", "data_warning", "latitude", "longitude", "from_alert"]


def _shape(d, detail=False):
	first = get_datetime(d.first_reported) if d.first_reported else None
	out = {
		"id": d.name, "title": d.title, "disease": d.disease, "diseaseName": d.disease_name,
		"priority": d.priority, "severity": d.severity, "status": d.status,
		"county": d.county, "subCounty": d.sub_county, "area": d.area, "region": d.region, "regionName": _region_name(d.region),
		"people": d.people or 0, "deaths": d.deaths or 0, "reports": d.reports or 0,
		"sources": [s.strip() for s in (d.sources or "").split(",") if s.strip()],
		"reason": d.reason, "firstSeen": str(d.first_reported or ""), "lastSeen": str(d.last_reported or ""),
		"openHours": int((now_datetime() - first).total_seconds() // 3600) if first else 0,
		"linkedAlert": ({"id": d.linked_alert, "severity": frappe.db.get_value("Risk Alert", d.linked_alert, "severity")}
			if d.linked_alert else None),
		"dataWarning": d.data_warning or None,
		"fromAlert": d.get("from_alert") or None,
		"lat": d.latitude, "lng": d.longitude,
	}
	if detail:
		can_act = has_capability(ACT)
		out["signals"] = [_signal_shape(s, can_act) for s in frappe.get_all("Surveillance Signal", filters={"event": d.name},
			fields=["name", "source", "ref", "signal_date", "area", "people", "deaths", "reported", "reason",
				"latitude", "longitude", "check_reached", "check_case_definition", "check_status", "checked_by", "checked_on"],
			order_by="signal_date desc")]
		out["timeline"] = [{"at": str(a.at), "user": a.user, "action": a.action, "note": a.note}
			for a in sorted(d.actions or [], key=lambda a: a.at or now_datetime(), reverse=True)]
		out["canAct"] = has_capability(ACT)
		out["related"] = related_events(d.disease, d.sub_county, d.last_reported, exclude=d.name) if d.status in OPEN else []
		merged = next((a.note for a in (d.actions or []) if a.action == "Merged"), None)
		out["mergedInto"] = merged.split(" ")[2] if merged and merged.startswith("Merged into ") else None
	return out


@frappe.whitelist()
def get_events(status=None, disease=None, region=None, source=None, search=None, limit=200):
	"""List events for the Review Queue. status: New|Verifying|Investigating|Confirmed|Escalated|Discarded|Closed|All."""
	scope = _scope_filters()
	base = dict(scope)
	if region and not scope:
		base["region"] = region
	if source:
		wanted = [x.strip() for x in source.split(",") if x.strip()]
		events = frappe.get_all("Surveillance Signal", filters={"source": ["in", wanted], "event": ["is", "set"]},
			pluck="event", distinct=True)
		keep = set(events) if "name" not in base else set(events) & set(base["name"][1])
		base["name"] = ["in", list(keep) or [""]]
	if disease:
		base["disease"] = disease

	counts = {s.lower(): 0 for s in OPEN + CLOSED}
	for r in frappe.get_all("Surveillance Event", filters=base, fields=["status", "count(name) as n"], group_by="status"):
		counts[(r.status or "").lower()] = r.n

	filters = dict(base)
	if status and status != "All":
		filters["status"] = status
	elif not status:
		filters["status"] = "New"
	or_filters = None
	if search:
		like = f"%{search}%"
		or_filters = {"title": ["like", like], "area": ["like", like], "sub_county": ["like", like]}

	rows = frappe.get_all("Surveillance Event", filters=filters, or_filters=or_filters, fields=FIELDS,
		order_by="last_reported desc", limit_page_length=cint(limit) or 200)
	rows.sort(key=lambda d: (-LEVELS.index(d.severity if d.severity in LEVELS else "standard"), -(get_datetime(d.last_reported).timestamp() if d.last_reported else 0)))

	# how many other open events of the same disease + sub-county each event has (for the "related" badge)
	open_rows = frappe.get_all("Surveillance Event", filters={"status": ["in", OPEN], "sub_county": ["is", "set"]},
		fields=["name", "disease", "sub_county", "first_reported", "last_reported"])
	events = []
	for d in rows:
		shaped = _shape(d)
		if d.status in OPEN and d.sub_county and d.last_reported:
			last = get_datetime(d.last_reported)
			shaped["relatedCount"] = sum(1 for o in open_rows if o.name != d.name and o.disease == d.disease
				and o.sub_county == d.sub_county and o.last_reported and o.first_reported
				and get_datetime(o.last_reported) >= add_days(last, -WINDOW_DAYS)
				and get_datetime(o.first_reported) <= add_days(last, WINDOW_DAYS))
		else:
			shaped["relatedCount"] = 0
		events.append(shaped)
	return {"counts": counts, "events": events, "canAct": has_capability(ACT)}


@frappe.whitelist()
def get_event(event):
	require_capability(VIEW)
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	return _shape(doc, detail=True)


@frappe.whitelist(methods=["POST"])
def set_status(event, action, note=None, facility=None):
	"""Officer action on an event: start, investigate, confirm, escalate, discard, close, reopen.
	confirm / escalate / discard need a reason and close needs a closing summary (kept for audit)."""
	from surveillance import investigation
	require_capability(ACT)
	if action not in ACTIONS:
		frappe.throw(_("Unknown action: {0}").format(action))
	allowed, new_status, needs_note = ACTIONS[action]
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	if doc.status not in allowed:
		frappe.throw(_("Cannot {0} an event that is {1}.").format(action, doc.status))
	note = (note or "").strip()
	if needs_note and not note:
		frappe.throw(_("Please add a closing summary.") if action == "close" else _("Please give a reason."))
	investigation.check_gate(doc, action)
	if action == "escalate":
		facility = (facility or "").strip()
		if not facility:
			frappe.throw(_("Enter the nearest health facility. County and National MOH need it."))
		doc.nearest_facility = facility

	doc.status = new_status
	investigation.after_status(doc, action, note)
	doc.append("actions", {"at": now_datetime(), "user": frappe.session.user,
		"action": ACTION_LABEL[action], "note": note})
	doc.save(ignore_permissions=True)
	investigation.sync_reports(doc, action, note)
	from surveillance.alerts import sync_alert_for_event
	sync_alert_for_event(doc)   # Epi Trends status follows the event (confirm, escalate, close, discard)
	if action == "escalate":
		from surveillance import notifications
		notifications.on_escalation(doc, note)

	if action == "discard" and doc.disease == UNCLASSIFIED:
		_dismiss_unclassified(doc.name, note)
	return _shape(doc, detail=True)


def _dismiss_unclassified(event, note):
	"""Discarding an unclassified-illness event marks its field reports 'Not a disease of concern',
	so they also leave the unclassified review list and the unclassified-illness counts."""
	for ref in frappe.get_all("Surveillance Signal", filters={"event": event, "source": "Field"}, pluck="ref"):
		if not frappe.db.exists("Case Report", ref):
			continue
		cr = frappe.get_doc("Case Report", ref)
		if not cr.suspected_disease and cr.review_outcome != NOT_OF_CONCERN:
			cr.review_outcome = NOT_OF_CONCERN
			cr.reviewed_by = frappe.session.user
			cr.reviewed_on = now_datetime()
			cr.add_comment("Comment", f"Discarded in Review Queue ({event}): {note}")
			cr.save(ignore_permissions=True)


@frappe.whitelist()
def get_map_events(status="open", disease=None, days=30):
	"""Review Queue events for the Surveillance Map (same region rules as the queue).
	status: "open" (New, Verifying, Investigating, Confirmed, Escalated) | "all" | one status name."""
	filters = dict(_scope_filters())
	if status == "open":
		filters["status"] = ["in", OPEN]
	elif status and status != "all":
		filters["status"] = status
	if disease:
		filters["disease"] = disease
	if cint(days):
		filters["last_reported"] = [">=", add_days(now_datetime(), -cint(days))]
	rows = frappe.get_all("Surveillance Event", filters=filters, fields=FIELDS, order_by="last_reported desc",
		limit_page_length=1000)
	events = [_shape(d) for d in rows]
	mapped = [e for e in events if e["lat"] is not None and e["lng"] is not None]
	counts = {"open": sum(1 for e in events if e["status"] in OPEN),
		"critical": sum(1 for e in events if e["severity"] == "critical" and e["status"] in OPEN),
		"waiting": sum(1 for e in events if e["status"] == "New" and e["openHours"] > 24),
		"escalated": sum(1 for e in events if e["status"] == "Escalated")}
	return {"events": mapped, "unmapped": len(events) - len(mapped), "stats": counts}


@frappe.whitelist(methods=["POST"])
def add_note(event, note):
	"""Add an investigation note to an event without changing its status."""
	require_capability(ACT)
	note = (note or "").strip()
	if not note:
		frappe.throw(_("Please write a note."))
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	doc.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": "Note", "note": note})
	doc.save(ignore_permissions=True)
	return _shape(doc, detail=True)