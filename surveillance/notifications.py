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


def sub_county_users(sub_county_name):
	"""Enabled users assigned to this sub-county (the CHA and SCDSC)."""
	if not sub_county_name or not frappe.get_meta("User").has_field("assigned_sub_county"):
		return []
	ids = frappe.get_all("Sub County", filters={"sub_county_name": sub_county_name}, pluck="name")
	if not ids:
		return []
	return frappe.get_all("User", filters={"assigned_sub_county": ["in", ids], "enabled": 1},
		fields=["name", "email", "mobile_no", "full_name"])


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
		users = sub_county_users(doc.sub_county)
		if not users:
			return
		from surveillance.events import related_events
		related = related_events(doc.disease, doc.sub_county, doc.first_reported, exclude=doc.name)
		related_ids = ", ".join(r["id"] for r in related)
		subject = (f"New signal: {doc.disease_name or doc.disease}, {doc.sub_county or 'location missing'} ({doc.severity or 'standard'})"
			+ (f" · related to {related_ids}" if related else ""))
		html = (
			f'<p style="font-size:15px">A new signal needs verification in the Review Queue.</p>'
			+ (f'<p style="font-size:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 12px">'
				f'<b>Related to {escape_html(related_ids)}</b>: another open {escape_html(doc.disease_name or doc.disease)} '
				f'event in {escape_html(doc.sub_county)} in the last 7 days. This may be the same outbreak.</p>' if related else "")
			+ _rows([
				("Disease", escape_html(doc.disease_name or doc.disease)),
				("Severity", escape_html((doc.severity or "standard").title())),
				("Location", escape_html(", ".join(x for x in [doc.area, doc.sub_county, doc.county] if x))),
				("Reports", doc.reports or 0),
				("People affected", doc.people or 0),
				("Deaths", doc.deaths or 0),
				("First reported", _fmt(doc.first_reported)),
				("Why flagged", escape_html(doc.reason or "")),
				("Related events", escape_html(related_ids)),
			])
			+ _button(_link(doc.name), "Open and verify")
		)
		_send([u.email for u in users], subject, html, doc.name,
			[u.mobile_no for u in users if u.mobile_no],
			f"KRCS: new {doc.disease_name or doc.disease} signal, {doc.sub_county}. {doc.people or 0} people."
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
			contacts.append(f"{s.ref}: {name or 'CHP'}{', ' + phone if phone else ''} ({s.area or 'area not given'}, {_people(s.people)} people)")
		else:
			contacts.append(f"CBS case {s.ref} ({s.area or 'area not given'}, {_people(s.people)} people), contact through CBS")
	return signs, contacts

def _strip_suspected(name):
	name = (name or "").strip()
	return name[10:] if name.lower().startswith("suspected ") else name


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
		gps = (f'<a href="https://www.google.com/maps/search/?api=1&query={doc.latitude},{doc.longitude}">'
			f'{doc.latitude:.5f}, {doc.longitude:.5f}</a>') if doc.latitude and doc.longitude else ""
		verified = frappe.db.count("Surveillance Signal", {"event": event, "check_status": "Verified"})
		subject = f"ESCALATION: {doc.disease_name or doc.disease}, {doc.sub_county}, {doc.county} ({doc.people or 0} cases, {doc.deaths or 0} deaths)"
		html = (
			f'<p style="font-size:15px"><b>A suspected {escape_html(_strip_suspected(doc.disease_name or doc.disease))} event has been escalated '
			f'to County and National MOH by the sub-county surveillance team.</b></p>'
			+ _rows([
				("Disease", escape_html(doc.disease_name or doc.disease)),
				("Signs and symptoms", "<br>".join(escape_html(x) for x in signs) or "Not recorded"),
				("Cases (people affected)", doc.people or 0),
				("Deaths", doc.deaths or 0),
				("Reports", f"{doc.reports or 0} ({verified} verified by phone or visit)"),
				("First reported", _fmt(doc.first_reported)),
				("Last reported", _fmt(doc.last_reported)),
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
			f"KRCS ESCALATION: {doc.disease_name or doc.disease}, {doc.sub_county}/{doc.county}. {doc.people or 0} cases, "
			f"{doc.deaths or 0} deaths. Facility: {doc.nearest_facility or '-'}. By {officer.get('full_name') or ''}"
			f"{', ' + officer['mobile_no'] if officer.get('mobile_no') else ''}. {_link(doc.name)}")
		team = [u.name for u in sub_county_users(doc.sub_county)]
		_in_app(team, f"Escalated to County/MOH: {doc.title}", doc.name)
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
	"Event Task": "/my-tasks?task={}"}


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
			"link": LINKS[r.document_type].format(r.document_name) if r.document_type in LINKS and r.document_name else None}
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
