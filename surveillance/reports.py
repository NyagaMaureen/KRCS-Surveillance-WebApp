"""Report endpoints for the mobile app and WhatsApp bot (names as agreed with the app team).

  POST surveillance.reports.add_report_update(report, note, attachments=[], client_ref=None)
  GET  surveillance.reports.get_report_updates(report)
  POST surveillance.reports.record_sync_stats(stats)
"""
import frappe
from frappe import _
from frappe.utils import cint, get_datetime, get_fullname, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability


def _report(report):
	cr = frappe.db.get_value("Case Report", report, ["name", "reported_by", "owner"], as_dict=True)
	if not cr:
		frappe.throw(_("Report not found."), frappe.DoesNotExistError)
	return cr


def _can_update(cr):
	return frappe.session.user in (cr.reported_by, cr.owner) or has_capability("edit_reports")


def _insert_child(doctype, parent, parentfield, values):
	idx = cint(frappe.db.count(doctype, {"parent": parent, "parentfield": parentfield})) + 1
	row = frappe.get_doc({"doctype": doctype, "parent": parent, "parenttype": "Case Report",
		"parentfield": parentfield, "idx": idx, **values})
	row.name = frappe.generate_hash(length=10)
	row.db_insert()   # child rows only: the report itself is not saved, so its status, symptoms, counts and place never change
	return row


@frappe.whitelist(methods=["POST"])
def add_report_update(report, note, attachments=None, client_ref=None, channel=None):
	"""Append a follow-up to a report ('one more child is sick') and optional photos / voice notes / files.
	Only the reporter, or users with edit_reports. A retry with the same client_ref adds nothing.
	attachments: [{"attachment_type", "file", "text_content", "people_shown", "consent", "consent_recorded_on"}]
	Returns {"name", "updates": [...]}."""
	cr = _report(report)
	if not _can_update(cr):
		frappe.throw(_("You can only add updates to your own reports."), frappe.PermissionError)
	note = (note or "").strip()
	attachments = frappe.parse_json(attachments) if isinstance(attachments, str) else (attachments or [])
	if not note and not attachments:
		frappe.throw(_("The update is empty."))
	ref = (client_ref or "").strip()[:64] or None
	if ref and frappe.db.exists("Case Report Update", {"parent": cr.name, "client_ref": ref}):
		return {"name": cr.name, "updates": _updates(cr.name), "duplicate": True}

	from surveillance.case_report_rules import check_consent
	rows = []
	for a in attachments:
		kind = a.get("attachment_type") or "Attachment"
		if kind != "Text Note" and not a.get("file"):
			frappe.throw(_("Upload the file first."))
		shown, consent, recorded = check_consent(kind, a.get("people_shown"), a.get("consent"))
		if a.get("consent_recorded_on") and kind in ("Photo", "Voice Note"):
			recorded = get_datetime(a["consent_recorded_on"])
		rows.append({"attachment_type": kind, "file": a.get("file"), "text_content": (a.get("text_content") or "")[:2000] or None,
			"people_shown": shown, "consent": consent, "consent_recorded_on": recorded})
	for r in rows:
		_insert_child("Case Report Attachment", cr.name, "attachments", r)
	_insert_child("Case Report Update", cr.name, "updates", {"at": now_datetime(), "user": frappe.session.user,
		"note": (note or f"{len(rows)} attachment(s) added")[:2000], "channel": (channel or "")[:40] or None, "client_ref": ref})
	_on_event(cr.name, note, len(rows))
	return {"name": cr.name, "updates": _updates(cr.name), "duplicate": False}


def _on_event(report, note, n_files):
	"""Show the update on the linked event (timeline), so the officer sees it."""
	event = frappe.db.get_value("Surveillance Signal", f"Field-{report}", "event")
	if not event:
		return
	ev = frappe.get_doc("Surveillance Event", event)
	text = note[:500] if note else ""
	if n_files:
		text = (text + " " if text else "") + f"({n_files} attachment{'s' if n_files > 1 else ''} added)"
	ev.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": "Reporter update",
		"note": f"{report}: {text}"})
	ev.flags.ignore_permissions = True
	ev.save()


def _updates(name):
	return [{"at": str(u.at or ""), "user": u.user, "userName": get_fullname(u.user) if u.user else None, "note": u.note}
		for u in frappe.get_all("Case Report Update", filters={"parent": name, "parenttype": "Case Report"},
			fields=["at", "user", "note"], order_by="idx asc")]


@frappe.whitelist()
def get_report_updates(report):
	cr = _report(report)
	if not (_can_update(cr) or has_capability("view_reports")):
		frappe.throw(_("Report not found."), frappe.DoesNotExistError)
	return _updates(cr.name)


@frappe.whitelist(methods=["POST"])
def record_sync_stats(stats):
	"""The app's daily sync numbers for one device. Upserts one row per user + device + day.
	stats: {"device_id", "day" (YYYY-MM-DD, default today), "queued", "sent", "failed", "max_queue_age_minutes", ...}
	Anything else in stats is kept as JSON."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Log in first."), frappe.PermissionError)
	data = frappe.parse_json(stats) if isinstance(stats, str) else dict(stats or {})
	device = (data.get("device_id") or "").strip()[:100]
	if not device:
		frappe.throw(_("device_id is required."))
	day = getdate(data.get("day") or nowdate())
	values = {"queued": cint(data.get("queued")), "sent": cint(data.get("sent")), "failed": cint(data.get("failed")),
		"max_queue_age_minutes": cint(data.get("max_queue_age_minutes")), "stats": frappe.as_json(data)[:60000]}
	name = frappe.db.get_value("Mobile Sync Stats", {"user": frappe.session.user, "device_id": device, "day": day}, "name")
	if name:
		frappe.db.set_value("Mobile Sync Stats", name, values)
	else:
		frappe.get_doc({"doctype": "Mobile Sync Stats", "user": frappe.session.user, "device_id": device, "day": day,
			**values}).insert(ignore_permissions=True)
	return {"ok": True}
