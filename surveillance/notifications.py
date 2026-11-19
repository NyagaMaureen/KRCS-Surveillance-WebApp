"""Alerts to people outside the event page: email + in-app now, SMS ready to switch on.

1. New event   -> the CHA and SCDSC assigned to that sub-county (User.assigned_sub_county).
2. Escalation  -> County and National MOH contacts (Escalation Contact list, managed by KRCS),
                  with what they need to act: disease, signs and symptoms,
                  cases and deaths, dates, location, nearest health facility, reporter contacts,
                  and the officer escalating with their reason. The CHA/SCDSC also get an in-app copy.

Sending happens in a background job after the database commit, so a mail problem never blocks
an officer's action and the email always shows the final state of the event.

Settings (site config, never in code):
  bench --site <site> set-config frontend_url "https://<app address>"   # where the links in alerts point
  bench --site <site> set-config alert_sms 1                             # turn SMS on (uses Frappe SMS Settings)
The sending mailbox is the Default Outgoing Email Account in Desk.
"""
import frappe
from frappe.utils import add_days, cint, escape_html, get_datetime, get_fullname, get_url, now_datetime

NEW_EVENT_MAX_AGE_DAYS = 2   # do not alert on events created from old reports (backfills, late syncs)



def _link(event):
	base = (frappe.conf.get("frontend_url") or get_url()).rstrip("/")
	return f"{base}/alerts-signals/{event}"


def _send(recipients, subject, html, event, sms_numbers=None, sms_text=None):
	recipients = sorted({r for r in recipients if r})
	if recipients:
		frappe.sendmail(recipients=recipients, subject=subject, message=html,
			reference_doctype="Surveillance Event", reference_name=event, delayed=False)
	if sms_numbers and sms_text and cint(frappe.conf.get("alert_sms")):
		try:
			from frappe.core.doctype.sms_settings.sms_settings import send_sms
			send_sms(sorted(set(sms_numbers)), sms_text[:459])
		except Exception:
			frappe.log_error(title="Alert SMS failed", message=frappe.get_traceback())


def _in_app(users, subject, event):
	for user in set(users):
		if user and frappe.db.exists("User", user):
			frappe.get_doc({"doctype": "Notification Log", "for_user": user, "type": "Alert",
				"document_type": "Surveillance Event", "document_name": event,
				"subject": subject}).insert(ignore_permissions=True)


NO_EVENT_ALERTS = ("chp", "fhw", "dataai")   # workspaces that never get event alerts
NO_EVENT_ALERT_ROLES = ("CHP", "Facility Health Worker")   # the same by main role, if a workspace is not set up


def sub_county_users(sub_county_name, event=None):
	"""Enabled users assigned to this sub-county (the CHA and SCDSC). With an event, a CHA is told only when the event
	has reports from their CHU(s) or from no CHU (KRCS 17 Nov 2026)."""
	if not sub_county_name or not frappe.get_meta("User").has_field("assigned_sub_county"):
		return []
	ids = frappe.get_all("Sub County", filters={"sub_county_name": sub_county_name}, pluck="name")
	if not ids:
		return []
	users = frappe.get_all("User", filters={"assigned_sub_county": ["in", ids], "enabled": 1},
		fields=["name", "email", "mobile_no", "full_name"])
	# Event alerts (new signal, disease changed, resolved in Epi Trends, escalation copy) go to the officers and CHAs.
	# CHPs hear about their tasks and referrals, never about suspected diseases; FHWs, for now, only about referrals to
	# their facility (surveillance.fhw); Data & AI Administrators run the system and get no case alerts (KRCS 19 Nov 2026)
	from surveillance.user_scope import user_workspace
	users = [u for u in users if user_workspace(u.name) not in NO_EVENT_ALERTS
		and frappe.db.get_value("User", u.name, "primary_role") not in NO_EVENT_ALERT_ROLES]
	if event:
		from surveillance.health_units import event_visible
		users = [u for u in users if event_visible(event, u.name)]
	return users


MOH_ROLES = ("MOH DDSR",)


def moh_users(region):
	"""County MOH (MOH DDSR) users who see this escalation in the system: their assigned region (counties later), or
	every region when none is assigned."""
	users = frappe.get_all("Has Role", filters={"parenttype": "User", "role": ["in", list(MOH_ROLES)]}, pluck="parent")
	out = []
	for u in set(users):
		row = frappe.db.get_value("User", u, ["enabled", "assigned_region"], as_dict=True) if frappe.get_meta("User").has_field("assigned_region") \
			else frappe.db.get_value("User", u, ["enabled"], as_dict=True)
		if row and row.enabled and (not row.get("assigned_region") or row.get("assigned_region") == region):
			out.append(u)
	return out


def escalation_contacts(county):
	"""Active National contacts, plus County contacts for this county (or with no county set)."""
	rows = frappe.get_all("Escalation Contact", filters={"active": 1},
		fields=["contact_name", "level", "county", "email", "phone"])
	county = (county or "").strip().lower()
	return [r for r in rows if r.level == "National" or not r.county or r.county.strip().lower() == county]


def _rows(pairs):
	cells = "".join(
		f'<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap">{escape_html(k)}</td>'
		f'<td style="padding:4px 0;color:#111827">{v}</td></tr>' for k, v in pairs if v not in (None, ""))
	return f'<table style="border-collapse:collapse;font-size:14px">{cells}</table>'


def _button(url, label):
	return (f'<p style="margin-top:16px"><a href="{url}" style="background:#dc2626;color:#fff;padding:10px 16px;'
		f'border-radius:8px;text-decoration:none;font-weight:600">{label}</a></p>')


def _fmt(dt):
	return get_datetime(dt).strftime("%d %b %Y %H:%M") if dt else ""


def _suspected(name):
	"""Disease names in alerts always read "Suspected ..." (KRCS 18 Nov 2026)."""
	name = (name or "").strip()
	if not name or name.lower().startswith("suspected ") or _not_a_disease(name):
		return name   # "Unclassified illness" and unusual events are not suspected diseases
	return f"Suspected {name}"


def _not_a_disease(name):
	"""Unclassified illness and the unusual events (Unusual Death of People, Unusual Illness of Animals, Unusual Event /
	Emergency ...): named as they are, never "Suspected ..."."""
	name = (name or "").lower()
	return name.startswith("unusual") or any(w in name for w in ("unclassified", "unknown"))


def _is_unusual(doc):
	return (doc.disease or "").startswith("unusual") or (doc.disease_name or "").lower().startswith("unusual")


def _counted(doc):
	"""What the event counts: animals for the animal events, else people (as on the event page)."""
	return "animal" if "animal" in (doc.disease or "").lower() or "animal" in (doc.disease_name or "").lower() else "person"


def _affected(doc):
	n = doc.people or 0
	return f"{n} {'animal' if n == 1 else 'animals'}" if _counted(doc) == "animal" else _people(n)


def _cases_label(doc):
	return "Cases (animals affected)" if _counted(doc) == "animal" else "Cases (people affected)"


def _disease_label(doc):
	return "Event type" if _is_unusual(doc) else "Disease"


def _gps(doc):
	"""GPS numbers with a View on map link (KRCS 18 Nov 2026)."""
	if not (doc.latitude and doc.longitude):
		return ""
	return (f'{doc.latitude:.5f}, {doc.longitude:.5f} &nbsp;<a href="https://www.google.com/maps/search/?api=1&query='
		f'{doc.latitude},{doc.longitude}" style="color:#b91c1c;font-weight:700">View on map</a>')


CHANNEL_LABEL = {"Mobile": "Mobile app", "Web": "Web form"}
ANIMAL_LABEL = {"Bite or scratch": "Bitten or scratched", "Handled sick or dead animal": "Handled a sick or dead animal"}


def _report_details(event):
	"""Earliest date of onset, the age groups, any animal exposure and the reporting channels across the event's reports
	(both alert emails)."""
	onset, ages, animals, channels = None, [], [], []
	for s in frappe.get_all("Surveillance Signal", filters={"event": event}, fields=["source", "ref"], order_by="signal_date asc"):
		if s.source == "Field" and s.ref and frappe.db.exists("Case Report", s.ref):
			cr = frappe.db.get_value("Case Report", s.ref, ["onset_date", "age_group", "age_groups", "animal_exposure", "channel"], as_dict=True)
			if cr.onset_date and (not onset or cr.onset_date < onset):
				onset = cr.onset_date
			for a in [x.strip() for x in (cr.age_groups or cr.age_group or "").replace("\n", ",").split(",")]:
				if a and a not in ages:
					ages.append(a)
			if cr.animal_exposure and cr.animal_exposure != "None":   # shown only when someone recorded an exposure
				a = ANIMAL_LABEL.get(cr.animal_exposure, cr.animal_exposure)
				if a not in animals:
					animals.append(a)
			label = CHANNEL_LABEL.get(cr.channel, cr.channel) if cr.channel else None
		else:
			label = s.source
		if label and label not in channels:
			channels.append(label)
	return frappe._dict(onset=onset.strftime("%d %b %Y") if onset else "", ages=", ".join(ages),
		animals=", ".join(animals), channels=", ".join(channels))


def _dates(doc):
	"""One "Date reported" when the event has a single report time; first and last reported when reports came in over
	time (KRCS 18 Nov 2026)."""
	first, last = _fmt(doc.first_reported), _fmt(doc.last_reported)
	if not last or first == last:
		return [("Date reported", first)]
	return [("First reported", first), ("Last reported", last)]


# ---------- 1b. disease changed / left the Review Queue ----------
# The CHA and SCDSC who got the "New signal" alert also hear when the officer changes the disease, so their bell and
# inbox never point to a disease that is no longer true.

def on_disease_changed(event, old_name, new_name):
	"""The event continues under another priority disease (questions and steps now follow its protocol)."""
	frappe.enqueue("surveillance.notifications.send_disease_changed", event_name=event, old_name=old_name,
		new_name=new_name, queue="short", enqueue_after_commit=True)


def send_disease_changed(event_name, old_name, new_name):
	try:
		if not frappe.db.exists("Surveillance Event", event_name):
			return
		doc = frappe.get_doc("Surveillance Event", event_name)
		users = sub_county_users(doc.sub_county, event_name)
		if not users:
			return
		subject = f"{event_name} is now {new_name} (was {old_name}), {doc.sub_county or 'location missing'}"
		html = (f'<p style="font-size:15px">The officer reviewing {escape_html(event_name)} changed the suspected disease. '
			f'Verification questions and steps now follow the {escape_html(new_name)} protocol.</p>'
			+ _rows([("Was", escape_html(old_name)), ("Now", escape_html(new_name)),
				("Severity", escape_html((doc.severity or "standard").title())),
				("Location", escape_html(", ".join(x for x in [doc.area, doc.sub_county, doc.county] if x))),
				("Changed by", escape_html(get_fullname(frappe.session.user)))])
			+ _button(_link(event_name), "Open the event"))
		_send([u.email for u in users], subject, html, event_name)
		_in_app([u.name for u in users], subject, event_name)
		frappe.db.commit()
	except Exception:
		frappe.log_error(title=f"Disease change alert failed ({event_name})", message=frappe.get_traceback())


def on_left_queue(event, old_name, new_name, report):
	"""The only report on the event was changed to a disease that is not followed in the Review Queue (e.g. malaria):
	the event is closed and the disease is followed through Epi Trends."""
	frappe.enqueue("surveillance.notifications.send_left_queue", event_name=event, old_name=old_name,
		new_name=new_name, report=report, queue="short", enqueue_after_commit=True)


def send_left_queue(event_name, old_name, new_name, report):
	try:
		doc = frappe.db.get_value("Surveillance Event", event_name, ["sub_county", "county"], as_dict=True)
		users = sub_county_users(doc.sub_county, event_name) if doc else []
		if not users:
			return
		subject = f"Resolved: {event_name} ({report}) is {new_name}, followed in Epi Trends"
		base = (frappe.conf.get("frontend_url") or get_url()).rstrip("/")
		same = (old_name or "") == (new_name or "")   # the officer confirmed the disease it was held for a check on
		decided = (f'confirmed it is {escape_html(new_name)}, with no priority disease in play' if same
			else f'decided it is {escape_html(new_name)}, not {escape_html(old_name)}')
		html = (f'<p style="font-size:15px"><b>Resolved.</b> The officer reviewed {escape_html(report)} and {decided}. '
			f'{escape_html(new_name)} is not investigated case by case, '
			f'so {escape_html(event_name)} is closed without a field investigation. {escape_html(new_name)} is tracked in '
			f'Epi Trends, where a rise in cases raises an alert. Any follow-up task the officer assigns will reach the '
			f'person it is assigned to.</p>'
			+ _rows([("Outcome", "Resolved, no investigation needed")]
				+ ([] if same else [("Was", escape_html(old_name))]) + [("Disease", escape_html(new_name)),
				("Location", escape_html(", ".join(x for x in [doc.sub_county, doc.county] if x))),
				("Decided by", escape_html(get_fullname(frappe.session.user)))])
			+ _button(f"{base}/epi-trends", "Open Epi Trends"))
		_send([u.email for u in users], subject, html, event_name)
		_in_app([u.name for u in users], subject, event_name)
		frappe.db.commit()
	except Exception:
		frappe.log_error(title=f"Left-queue alert failed ({event_name})", message=frappe.get_traceback())


# ---------- 1. new event ----------

def on_new_event(event, signal_date=None):
	"""Called when an event is created. Skips events built from old reports."""
	if signal_date and get_datetime(signal_date) < add_days(now_datetime(), -NEW_EVENT_MAX_AGE_DAYS):
		return
	# "event" is a reserved argument of frappe.enqueue, so the event ID is passed as event_name
	frappe.enqueue("surveillance.notifications.send_new_event", event_name=event, queue="short",
		enqueue_after_commit=True)


def send_new_event(event_name):
	event = event_name
	try:
		if not frappe.db.exists("Surveillance Event", event):
			return
		doc = frappe.get_doc("Surveillance Event", event)
		users = sub_county_users(doc.sub_county, event)
		if not users:
			return
		from surveillance.events import related_events
		related = related_events(doc.disease, doc.sub_county, doc.first_reported, exclude=doc.name)
		related_ids = ", ".join(r["id"] for r in related)
		disease = _suspected(doc.disease_name or doc.disease) or "Disease not yet assigned"
		subject = (f"New signal: {disease}, {doc.sub_county or 'location missing'}, {_affected(doc)} affected"
			+ (f" · related to {related_ids}" if related else ""))
		signs, reporters = _report_lines(doc.name)
		det = _report_details(doc.name)
		# same arrangement as the escalation email; severity left out (KRCS 18 Nov 2026)
		html = (
			f'<p style="font-size:15px"><b>A new signal needs verification in the Review Queue.</b></p>'
			+ (f'<p style="font-size:14px"><b>Related to {escape_html(related_ids)}</b>: another open {escape_html(disease)} '
				f'event in {escape_html(doc.sub_county)} in the last 7 days. This may be the same outbreak.</p>' if related else "")
			+ _rows([
				(_disease_label(doc), escape_html(disease)),
				("Signs and symptoms", "<br>".join(escape_html(x) for x in signs) or "Not recorded"),
				(_cases_label(doc), doc.people or 0),
				("Deaths", doc.deaths or 0),
				("Reports", doc.reports or 0),
				("Date of onset", det.onset),
				("Affected age group", escape_html(det.ages)),
				("Animal exposure", escape_html(det.animals)),
				("Reporting channel", escape_html(det.channels)),
			] + _dates(doc) + [
				("Location", escape_html(", ".join(x for x in [doc.area, doc.county] if x))),
				("GPS", _gps(doc)),
				("Reporter contacts", "<br>".join(escape_html(x) for x in reporters)),
				("Why flagged", escape_html(doc.reason or "")),
				("Event ID", doc.name),
			])
			+ _button(_link(doc.name), "Open and verify")
		)
		_send([u.email for u in users], subject, html, doc.name,
			[u.mobile_no for u in users if u.mobile_no],
			f"KRCS: new {disease} signal, {doc.sub_county}. {_affected(doc)}."
			+ (f" Related to {related_ids}." if related else "") + f" Verify: {_link(doc.name)}")
		_in_app([u.name for u in users], subject, doc.name)
		frappe.db.commit()
	except Exception:
		frappe.log_error(title=f"New event alert failed ({event})", message=frappe.get_traceback())


# ---------- 2. escalation ----------

def on_escalation(doc, reason):
	frappe.enqueue("surveillance.notifications.send_escalation", event_name=doc.name, reason=reason,
		escalated_by=frappe.session.user, queue="short", enqueue_after_commit=True)


def _report_lines(event):
	"""Signs and symptoms, and how to reach each reporter (field CHPs). CBS reporters' contacts are not stored."""
	signs, contacts = [], []
	for s in frappe.get_all("Surveillance Signal", filters={"event": event},
			fields=["source", "ref", "reported", "signal_date", "area", "people", "check_status"], order_by="signal_date asc"):
		if s.check_status == "Not a case":
			continue
		if s.reported and s.reported not in signs:
			signs.append(s.reported)
		if s.source == "Field" and frappe.db.exists("Case Report", s.ref):
			cr = frappe.db.get_value("Case Report", s.ref, ["reporter_name", "phone_number", "reported_by"], as_dict=True)
			name = cr.reporter_name or (get_fullname(cr.reported_by) if cr.reported_by else "")
			phone = cr.phone_number or (frappe.db.get_value("User", cr.reported_by, "mobile_no") if cr.reported_by else "")
			contacts.append(f"{s.ref}: {name or 'CHP'}{', ' + phone if phone else ''} ({s.area or 'area not given'}, {_people(s.people)})")
		else:
			contacts.append(f"CBS case {s.ref} ({s.area or 'area not given'}, {_people(s.people)}), contact through CBS")
	return signs, contacts

def _strip_suspected(name):
	name = (name or "").strip()
	return name[10:] if name.lower().startswith("suspected ") else name


def _event_phrase(doc):
	"""Start of the escalation sentence: "A suspected Measles event", "An unclassified illness event" or
	"An event with no disease assigned yet" (KRCS 18 Nov 2026)."""
	name = _strip_suspected(doc.disease_name or doc.disease)
	if not name:
		return "An event with no disease assigned yet"
	if _not_a_disease(name):   # "An unclassified illness event", "An unusual death of people event", "An unusual event / emergency"
		low = name.lower()
		return f"An {low}" if "event" in low else f"An {low} event"
	return f"A suspected {name} event"


def _people(n):
	n = n or 0
	return f"{n} person" if n == 1 else f"{n} people"

def send_escalation(event_name, reason, escalated_by):
	event = event_name
	try:
		doc = frappe.get_doc("Surveillance Event", event)
		contacts = escalation_contacts(doc.county)
		signs, reporters = _report_lines(event)
		officer = frappe.db.get_value("User", escalated_by, ["full_name", "email", "mobile_no"], as_dict=True) or {}
		gps = _gps(doc)
		disease = _suspected(doc.disease_name or doc.disease) or "Disease not yet assigned"
		deaths = doc.deaths or 0
		verified = frappe.db.count("Surveillance Signal", {"event": event, "check_status": "Verified"})
		det = _report_details(event)
		subject = (f"ESCALATION: {disease}, {doc.sub_county}, {doc.county} ({doc.people or 0} case{'' if (doc.people or 0) == 1 else 's'}, "
			f"{deaths} death{'' if deaths == 1 else 's'})")
		html = (
			f'<p style="font-size:15px"><b>{escape_html(_event_phrase(doc))} has been escalated '
			f'to County and National MOH by the sub-county surveillance team.</b></p>'
			+ _rows([
				(_disease_label(doc), escape_html(disease)),
				("Signs and symptoms", "<br>".join(escape_html(x) for x in signs) or "Not recorded"),
				(_cases_label(doc), doc.people or 0),
				("Deaths", doc.deaths or 0),
				("Reports", f"{doc.reports or 0} ({verified} verified by phone or visit)"),
				("Date of onset", det.onset),
				("Affected age group", escape_html(det.ages)),
				("Animal exposure", escape_html(det.animals)),
			] + _dates(doc) + [
				("Location", escape_html(", ".join(x for x in [doc.area, doc.sub_county, doc.county] if x))),
				("GPS", gps),
				("Nearest health facility", escape_html(doc.nearest_facility or "")),
				("Reporter contacts", "<br>".join(escape_html(x) for x in reporters)),
				("Escalated by", escape_html(", ".join(x for x in [officer.get("full_name"), officer.get("mobile_no"), officer.get("email")] if x))),
				("Reason for escalation", escape_html(reason or "")),
				("Event ID", doc.name),
			])
			+ _button(_link(doc.name), "Open the event")
			+ '<p style="font-size:12px;color:#6b7280;margin-top:16px">Sent by the KRCS AI-enabled surveillance system. '
			'Patient names are not included.</p>'
		)
		_send([c.email for c in contacts], subject, html, doc.name,
			[c.phone for c in contacts if c.phone],
			f"KRCS ESCALATION: {disease}, {doc.sub_county}/{doc.county}. {doc.people or 0} cases, "
			f"{doc.deaths or 0} deaths. Facility: {doc.nearest_facility or '-'}. By {officer.get('full_name') or ''}"
			f"{', ' + officer['mobile_no'] if officer.get('mobile_no') else ''}. {_link(doc.name)}")
		team = [u.name for u in sub_county_users(doc.sub_county, doc.name)]
		_in_app(team + moh_users(doc.region), f"Escalated to County/MOH: {doc.title}", doc.name)
		doc.append("actions", {"at": now_datetime(), "user": "Administrator", "action": "Escalation sent",
			"note": f"Emailed {len([c for c in contacts if c.email])} County/National MOH contact(s)"
				+ (": " + ", ".join(c.contact_name for c in contacts) if contacts else ". No active Escalation Contacts: add them in Settings.")})
		doc.save(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error(title=f"Escalation alert failed ({event})", message=frappe.get_traceback())


# ---------- API for the Escalate dialog ----------

@frappe.whitelist()
def get_escalation_preview(event):
	"""Who will be notified, and facility suggestions (facilities used before in this sub-county)."""
	from surveillance.events import VIEW, _check_access
	from surveillance.capabilities import require_capability
	require_capability(VIEW)
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	used = frappe.get_all("Surveillance Event", filters={"sub_county": doc.sub_county, "nearest_facility": ["is", "set"]},
		pluck="nearest_facility", distinct=True, limit_page_length=50)
	return {
		"contacts": [{"name": c.contact_name, "level": c.level, "county": c.county, "hasEmail": bool(c.email),
			"hasPhone": bool(c.phone)} for c in escalation_contacts(doc.county)],
		"facilities": sorted({f for f in used if f}),
		"nearestFacility": doc.nearest_facility or None,
	}


# ---------- one-off setup ----------

def setup():
	"""One-off after deploying (safe to run again):
	  - adds "Assigned Sub-County" to User
	  - renames the event status Verified to Confirmed
	bench --site <site> execute surveillance.notifications.setup"""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
	insert_after = "assigned_region" if frappe.get_meta("User").has_field("assigned_region") else "email"
	create_custom_fields({"User": [{
		"fieldname": "assigned_sub_county", "label": "Assigned Sub-County", "fieldtype": "Link",
		"options": "Sub County", "insert_after": insert_after,
		"description": "CHA / SCDSC: gets an alert when a new signal arrives in this sub-county.",
	}]}, update=True)
	n = frappe.db.count("Surveillance Event", {"status": "Verified"})
	frappe.db.sql("update `tabSurveillance Event` set status='Confirmed' where status='Verified'")
	frappe.db.commit()
	print(f"User.assigned_sub_county ready | events renamed Verified -> Confirmed: {n}")


# ---------- API for the bell in the app header (every role) ----------

LINKS = {"Surveillance Event": "/alerts-signals/{}", "Case Report": "/reports/{}", "Risk Alert": "/epi-trends/{}",
	"Event Task": "/my-tasks?task={}", "User Feedback": "/feedback"}


def _link_for(doctype, name):
	if doctype == "DocType" and (name or "").startswith("System Alert:"):   # Data & AI Admin system alerts
		from surveillance.system_admin import alert_link
		return alert_link(name)
	if doctype == "User Feedback":
		from surveillance.capabilities import has_capability
		return "/settings?tab=feedback" if has_capability("view_feedback") else "/feedback"
	return LINKS[doctype].format(name) if doctype in LINKS and name else None


@frappe.whitelist()
def get_my_notifications(limit=20):
	"""The logged-in user's own in-app notifications, newest first, with where each one should open."""
	rows = frappe.get_all("Notification Log", filters={"for_user": frappe.session.user},
		fields=["name", "subject", "read", "document_type", "document_name", "creation"],
		order_by="creation desc", limit_page_length=min(cint(limit) or 20, 100))
	unread = frappe.db.count("Notification Log", {"for_user": frappe.session.user, "read": 0})
	return {
		"unread": unread,
		"items": [{"id": r.name, "text": frappe.utils.strip_html(r.subject or ""), "read": bool(r.read),
			"at": str(r.creation),
			"link": _link_for(r.document_type, r.document_name)}
			for r in rows],
	}


@frappe.whitelist(methods=["POST"])
def mark_notifications_read(name=None):
	"""Mark one notification (name) or all of the user's notifications as read."""
	filters = {"for_user": frappe.session.user, "read": 0}
	if name:
		filters["name"] = name
	for n in frappe.get_all("Notification Log", filters=filters, pluck="name"):
		frappe.db.set_value("Notification Log", n, "read", 1, update_modified=False)
	return get_my_notifications()


# ---------- phone push (Expo): names used by the mobile app ----------

@frappe.whitelist(methods=["POST"])
def register_device(token, platform=None, device_name=None):
	"""Save this phone's Expo push token for the logged-in user. Same as field_api.register_push_token."""
	from surveillance.field_api import register_push_token
	return register_push_token(token, platform, device_name)


@frappe.whitelist(methods=["POST"])
def unregister_device(token):
	from surveillance.field_api import unregister_push_token
	return unregister_push_token(token)
