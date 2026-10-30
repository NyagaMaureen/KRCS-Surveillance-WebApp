"""Phone push notifications through Expo (the mobile app is built with Expo).

Every in-app notification (Notification Log: new task, overdue task, new event, escalation, feedback reply)
is also pushed to the user's phones that registered an Expo token (field_api.register_push_token).
Expo delivers to Android (Firebase) and iPhone (Apple); the Firebase / Apple keys live in the Expo account,
not here.

hooks.py:  doc_events = {"Notification Log": {"after_insert": "surveillance.push.on_notification"}}
Optional site config:
  expo_access_token  - only if "enhanced push security" is on in the Expo account
  expo_push_off 1    - stop sending (e.g. on a test site)
"""
import re

import frappe
import requests
from frappe.utils import cint, get_url

EXPO_URL = "https://exp.host/--/api/v2/push/send"


def on_notification(doc, method=None):
	if cint(frappe.conf.get("expo_push_off")) or not doc.for_user:
		return
	if not frappe.db.exists("Push Device", {"user": doc.for_user}):
		return
	frappe.enqueue("surveillance.push.send", queue="short", enqueue_after_commit=True,
		user=doc.for_user, subject=doc.subject, doctype=doc.document_type, docname=doc.document_name)


def _plain(text):
	return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def _path(doctype, name):
	if doctype == "Surveillance Event":
		return f"/alerts-signals/{name}"
	if doctype == "Event Task":
		return f"/my-tasks?task={name}"
	return None


def send(user, subject, doctype=None, docname=None):
	tokens = frappe.get_all("Push Device", filters={"user": user}, pluck="token")
	if not tokens:
		return
	body = _plain(subject)[:178]
	title = "KRCS Surveillance"
	data = {"id": docname, "link": _path(doctype, docname), "doctype": doctype}
	messages = [{"to": t, "title": title, "body": body, "data": data, "sound": "default",
		"priority": "high", "channelId": "default"} for t in tokens]
	headers = {"Content-Type": "application/json", "Accept": "application/json"}
	if frappe.conf.get("expo_access_token"):
		headers["Authorization"] = f"Bearer {frappe.conf.get('expo_access_token')}"
	try:
		r = requests.post(EXPO_URL, json=messages, headers=headers, timeout=20)
		r.raise_for_status()
		tickets = (r.json() or {}).get("data") or []
	except Exception:
		frappe.log_error(title="Expo push failed", message=frappe.get_traceback())
		return
	for token, ticket in zip(tokens, tickets):
		err = (ticket.get("details") or {}).get("error") or ticket.get("message")
		frappe.get_doc({"doctype": "Push Message", "user": user, "token": token, "title": title, "body": body,
			"ticket_id": ticket.get("id"), "status": "Error" if ticket.get("status") == "error" else "Sent",
			"error": (err or "")[:140] or None}).insert(ignore_permissions=True)
		if ticket.get("status") == "error" and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
			frappe.db.delete("Push Device", {"token": token})   # app uninstalled or token expired
	frappe.db.commit()


RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"


def check_receipts():
	"""Scheduler (hourly): ask Expo whether sent pushes were delivered (Expo keeps receipts for 24 hours)."""
	rows = frappe.get_all("Push Message", filters={"status": "Sent", "ticket_id": ["is", "set"],
		"creation": [">", frappe.utils.add_to_date(None, hours=-23)]}, fields=["name", "ticket_id", "token"], limit=1000)
	if not rows:
		return
	headers = {"Content-Type": "application/json"}
	if frappe.conf.get("expo_access_token"):
		headers["Authorization"] = f"Bearer {frappe.conf.get('expo_access_token')}"
	for i in range(0, len(rows), 300):
		chunk = rows[i:i + 300]
		try:
			r = requests.post(RECEIPTS_URL, json={"ids": [x.ticket_id for x in chunk]}, headers=headers, timeout=20)
			r.raise_for_status()
			receipts = (r.json() or {}).get("data") or {}
		except Exception:
			frappe.log_error(title="Expo push receipts failed", message=frappe.get_traceback())
			return
		for x in chunk:
			rec = receipts.get(x.ticket_id)
			if not rec:
				continue   # not ready yet
			err = (rec.get("details") or {}).get("error")
			frappe.db.set_value("Push Message", x.name, {"status": "Delivered" if rec.get("status") == "ok" else "Error",
				"error": (err or rec.get("message") or "")[:140] or None, "checked_on": frappe.utils.now_datetime()})
			if err == "DeviceNotRegistered":
				frappe.db.delete("Push Device", {"token": x.token})
	frappe.db.commit()


def test(user=None):
	"""bench --site <site> execute surveillance.push.test --kwargs "{'user': 'someone@example.org'}" """
	send(user or frappe.session.user, "Test notification from KRCS Surveillance")
	print("sent (check the phone)")
