"""Feedback, problems and suggestions from users (Feedback page), read in the Feedback inbox (view_feedback)."""
import frappe
from frappe import _
from frappe.utils import cint, get_fullname, now_datetime

from surveillance.capabilities import require_capability

DOCTYPE = "User Feedback"
TYPES = ("Feedback", "Problem", "Suggestion")
STATUSES = ("New", "Seen", "Resolved")


def _shape(r, with_sender=False):
	out = {"id": r.name, "type": r.feedback_type, "message": r.message, "status": r.status,
		"response": r.response or "", "createdOn": str(r.creation)}
	if with_sender:
		out.update({"by": get_fullname(r.submitted_by) if r.submitted_by else None, "role": r.role or None,
			"region": frappe.db.get_value("Region", r.region, "region_name") if r.region else None, "page": r.page or None,
			"handledBy": get_fullname(r.handled_by) if r.handled_by else None})
	return out


@frappe.whitelist(methods=["POST"])
def submit_feedback(feedback_type, message, page=None):
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	if feedback_type not in TYPES:
		frappe.throw(_("Choose a type."))
	message = (message or "").strip()
	if len(message) < 3:
		frappe.throw(_("Please write your message."))
	user = frappe.session.user
	doc = frappe.get_doc({"doctype": DOCTYPE, "feedback_type": feedback_type, "message": message[:5000], "status": "New",
		"submitted_by": user, "role": frappe.db.get_value("User", user, "primary_role"),
		"region": frappe.db.get_value("User", user, "assigned_region") if frappe.get_meta("User").has_field("assigned_region") else None,
		"page": (page or "")[:140]}).insert(ignore_permissions=True)
	_notify_admins(doc)
	return _shape(doc)


def _notify_admins(doc):
	"""Bell notification for everyone whose role has View Feedback (not Administrator: no auto)."""
	roles = frappe.get_all("Role Capability", filters={"capability": "view_feedback"}, pluck="role")
	if not roles:
		return
	users = set(frappe.get_all("Has Role", filters={"role": ["in", roles], "parenttype": "User"}, pluck="parent"))
	who = get_fullname(doc.submitted_by) or "A user"
	kind = {"Problem": "problem report", "Suggestion": "suggestion"}.get(doc.feedback_type, "feedback")
	subject = f"New {kind} from {who}: {doc.message[:80]}"
	for user in users - {doc.submitted_by, "Administrator", "Guest"}:
		if frappe.db.get_value("User", user, "enabled"):
			frappe.get_doc({"doctype": "Notification Log", "for_user": user, "type": "Alert",
				"document_type": DOCTYPE, "document_name": doc.name, "subject": subject}).insert(ignore_permissions=True)


FIELDS = ["name", "feedback_type", "message", "status", "response", "creation", "submitted_by", "role", "region", "page", "handled_by"]


@frappe.whitelist()
def get_my_feedback(limit=20):
	rows = frappe.get_all(DOCTYPE, filters={"submitted_by": frappe.session.user}, fields=FIELDS,
		order_by="creation desc", limit_page_length=min(cint(limit) or 20, 100))
	return [_shape(r) for r in rows]


@frappe.whitelist()
def list_feedback(status=None, feedback_type=None, limit=200):
	require_capability("view_feedback")
	filters = {}
	if status in STATUSES:
		filters["status"] = status
	if feedback_type in TYPES:
		filters["feedback_type"] = feedback_type
	rows = frappe.get_all(DOCTYPE, filters=filters, fields=FIELDS, order_by="creation desc",
		limit_page_length=min(cint(limit) or 200, 1000))
	counts = {s.lower(): frappe.db.count(DOCTYPE, {"status": s}) for s in STATUSES}
	return {"items": [_shape(r, with_sender=True) for r in rows], "counts": counts}


@frappe.whitelist(methods=["POST"])
def set_feedback_status(name, status, response=None):
	require_capability("view_feedback")
	if status not in STATUSES:
		frappe.throw(_("Unknown status."))
	doc = frappe.get_doc(DOCTYPE, name)
	doc.status = status
	if response is not None:
		doc.response = response.strip()
	doc.handled_by, doc.handled_on = frappe.session.user, now_datetime()
	doc.save(ignore_permissions=True)
	if response and response.strip() and doc.submitted_by:
		frappe.get_doc({"doctype": "Notification Log", "for_user": doc.submitted_by, "type": "Alert",
			"document_type": DOCTYPE, "document_name": doc.name,
			"subject": f"Reply to your {doc.feedback_type.lower()}: {response.strip()[:120]}"}).insert(ignore_permissions=True)
	return _shape(doc, with_sender=True)
