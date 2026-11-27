"""Help Center: FAQs, Contact Us, Guides and Video Tutorials (KRCS 27 Nov 2026).

Each FAQ is ticked for one or more workspaces (CHP, CHA, Facility Health Worker, Surveillance Officer, Data & AI Admin,
County / National = everyone with the full menu) or for Everyone, and can have a Kiswahili version. The web Help Center
and the mobile app read the same list (get_faqs). Anyone with Manage FAQs adds, edits and removes them.
"""
import json

import frappe
from frappe import _

from surveillance.capabilities import has_capability, require_capability

DOCTYPE = "Help FAQ"
MANAGE = "manage_faqs"
# workspace (user_scope.user_workspace) -> the tick box that shows an FAQ to it
WORKSPACE_FIELDS = {"chp": "for_chp", "cha": "for_cha", "fhw": "for_fhw", "officer": "for_officer",
	"dataai": "for_dataai", "full": "for_full", "sysadmin": "for_sysadmin"}
WORKSPACE_LABELS = {"chp": "CHP", "cha": "CHA", "fhw": "Facility Health Worker", "officer": "Surveillance Officer",
	"dataai": "Data & AI Admin", "full": "County / National", "sysadmin": "System Administrator"}
SYSADMIN_ROLE = "System Administrator"


def _audiences(workspace, user=None):
	"""Who the user is for FAQs, guides and videos: their workspace, plus System Administrator for that role. System
	Administrators have the full menu like County / National users, and also get what is ticked for System Administrator
	(KRCS 27 Nov 2026)."""
	user = user or frappe.session.user
	out = [workspace]
	if workspace == "full" and (user == "Administrator" or SYSADMIN_ROLE in frappe.get_roles(user)):
		out.append("sysadmin")
	return out


def _audience_or(audiences):
	return {"for_everyone": 1, **{WORKSPACE_FIELDS[a]: 1 for a in audiences}}
LANGUAGES = ("English", "Kiswahili")
FIELDS = ["name", "question", "answer", "question_sw", "answer_sw", "topic", "sort_order", "published", "for_everyone",
	*WORKSPACE_FIELDS.values(), "modified"]


def _topics():
	options = frappe.get_meta(DOCTYPE).get_field("topic").options or ""
	return [t for t in options.split("\n") if t]


def _language(language=None):
	if language in LANGUAGES:
		return language
	lang = (frappe.db.get_value("User", frappe.session.user, "language") or "").lower()
	return "Kiswahili" if lang.startswith("sw") else "English"


@frappe.whitelist()
def get_faqs(language=None, workspace=None):
	"""Published FAQs for the user's workspace, in their language (English when there is no Kiswahili version),
	grouped by topic in order. workspace: only for people who manage FAQs, to see what another workspace sees."""
	from surveillance.user_scope import user_workspace
	mine = user_workspace(frappe.session.user)
	audiences = _audiences(mine)
	if workspace and workspace != mine:
		if workspace not in WORKSPACE_FIELDS or not has_capability(MANAGE):
			frappe.throw(_("You can only see the FAQs for your own workspace."), frappe.PermissionError)
		mine, audiences = workspace, [workspace]
	language = _language(language)
	rows = frappe.get_all(DOCTYPE, filters={"published": 1}, or_filters=_audience_or(audiences),
		fields=["name", "question", "answer", "question_sw", "answer_sw", "topic", "sort_order"],
		order_by="sort_order asc, creation asc", limit_page_length=500)
	order = {t: i for i, t in enumerate(_topics())}
	rows.sort(key=lambda r: (order.get(r.topic, len(order)), r.sort_order or 0))
	sw = language == "Kiswahili"
	return {
		"workspace": mine, "workspaceLabel": WORKSPACE_LABELS["sysadmin" if "sysadmin" in audiences else mine],
		"language": language,
		"canManage": has_capability(MANAGE),
		"faqs": [{
			"id": r.name, "topic": r.topic or "Other",
			"question": (r.question_sw if sw and r.question_sw else r.question),
			"answer": (r.answer_sw if sw and r.answer_sw else r.answer),
			"inKiswahili": bool(sw and r.question_sw and r.answer_sw),
		} for r in rows],
	}


# ---------- managing ----------

@frappe.whitelist()
def list_faqs():
	require_capability(MANAGE)
	rows = frappe.get_all(DOCTYPE, fields=FIELDS, order_by="sort_order asc, creation asc", limit_page_length=1000)
	order = {t: i for i, t in enumerate(_topics())}
	rows.sort(key=lambda r: (order.get(r.topic, len(order)), r.sort_order or 0))
	return {"faqs": [_shape(r) for r in rows], "topics": _topics(),
		"workspaces": [{"key": k, "label": v} for k, v in WORKSPACE_LABELS.items()]}


def _shape(r):
	return {
		"id": r.name, "question": r.question, "answer": r.answer, "question_sw": r.question_sw or "",
		"answer_sw": r.answer_sw or "", "topic": r.topic, "sort_order": r.sort_order or 0,
		"published": bool(r.published), "everyone": bool(r.for_everyone),
		"workspaces": [k for k, f in WORKSPACE_FIELDS.items() if r.get(f)], "modified": str(r.modified)[:16],
	}


@frappe.whitelist(methods=["POST"])
def save_faq(faq):
	"""Add (no id) or change an FAQ."""
	require_capability(MANAGE)
	data = json.loads(faq) if isinstance(faq, str) else (faq or {})
	question, answer = (data.get("question") or "").strip(), (data.get("answer") or "").strip()
	if not question or not answer:
		frappe.throw(_("Write the question and the answer in English."))
	everyone = bool(data.get("everyone"))
	workspaces = [w for w in data.get("workspaces") or [] if w in WORKSPACE_FIELDS]
	if not everyone and not workspaces:
		frappe.throw(_("Choose who should see this FAQ."))
	topic = data.get("topic") if data.get("topic") in _topics() else "Other"
	doc = frappe.get_doc(DOCTYPE, data["id"]) if data.get("id") else frappe.new_doc(DOCTYPE)
	doc.update({
		"question": question[:1000], "answer": answer[:10000],
		"question_sw": (data.get("question_sw") or "").strip()[:1000], "answer_sw": (data.get("answer_sw") or "").strip()[:10000],
		"topic": topic, "sort_order": int(data.get("sort_order") or 0), "published": 1 if data.get("published", True) else 0,
		"for_everyone": 1 if everyone else 0,
		**{f: 1 if k in workspaces else 0 for k, f in WORKSPACE_FIELDS.items()},
	})
	doc.save(ignore_permissions=True)
	return _shape(frappe.get_doc(DOCTYPE, doc.name).as_dict())


@frappe.whitelist(methods=["POST"])
def delete_faq(id):
	require_capability(MANAGE)
	frappe.delete_doc(DOCTYPE, id, ignore_permissions=True)
	return {"ok": True}


# ---------- Contact Us (one block for everyone, set by admins) and support tickets ----------

SETTINGS = "Help Center Settings"
CONTACT_FIELDS = ("support_email", "support_phone", "support_hours", "support_note")
TICKET_PAGE = "Help Center: Contact Us"


def _contact():
	s = frappe.get_single(SETTINGS)
	return {"email": s.support_email or "", "phone": s.support_phone or "", "hours": s.support_hours or "",
		"note": s.support_note or ""}


@frappe.whitelist()
def get_contact():
	"""The Contact Us details and the user's own support tickets (sent from Contact Us), newest first."""
	from surveillance.feedback import DOCTYPE as FEEDBACK, FIELDS, _shape
	rows = frappe.get_all(FEEDBACK, filters={"submitted_by": frappe.session.user, "page": TICKET_PAGE}, fields=FIELDS,
		order_by="creation desc", limit_page_length=50)
	return {"contact": _contact(), "canManage": has_capability(MANAGE), "tickets": [_shape(r) for r in rows]}


@frappe.whitelist(methods=["POST"])
def save_contact(contact):
	require_capability(MANAGE)
	data = json.loads(contact) if isinstance(contact, str) else (contact or {})
	s = frappe.get_single(SETTINGS)
	s.support_email = (data.get("email") or "").strip()[:140]
	s.support_phone = (data.get("phone") or "").strip()[:140]
	s.support_hours = (data.get("hours") or "").strip()[:140]
	s.support_note = (data.get("note") or "").strip()[:2000]
	s.save(ignore_permissions=True)
	return _contact()


@frappe.whitelist(methods=["POST"])
def submit_ticket(message):
	"""A support ticket from Contact Us: a Problem in Feedback Received, for the admins who have View Feedback
	Received (System Administrator, Data & AI Admin), never the user's CHA."""
	from surveillance.feedback import submit_feedback
	return submit_feedback("Problem", message, TICKET_PAGE)


# ---------- Guides and Video Tutorials ----------

RESOURCE = "Help Resource"
KINDS = ("Guide", "Video")


@frappe.whitelist()
def get_resources(kind):
	"""Published guides or videos for the user's workspace, in order."""
	from surveillance.user_scope import user_workspace
	if kind not in KINDS:
		frappe.throw(_("Unknown kind."))
	mine = user_workspace(frappe.session.user)
	rows = frappe.get_all(RESOURCE, filters={"published": 1, "kind": kind}, or_filters=_audience_or(_audiences(mine)),
		fields=["name", "title", "description", "url", "file"], order_by="sort_order asc, creation asc", limit_page_length=500)
	return {"kind": kind, "canManage": has_capability(MANAGE), "items": [{
		"id": r.name, "title": r.title, "description": r.description or "", "link": r.file or r.url or "",
		"isFile": bool(r.file)} for r in rows]}


def _shape_resource(r):
	return {"id": r.name, "kind": r.kind, "title": r.title, "description": r.description or "", "url": r.url or "",
		"file": r.file or "", "sort_order": r.sort_order or 0, "published": bool(r.published),
		"everyone": bool(r.for_everyone), "workspaces": [k for k, f in WORKSPACE_FIELDS.items() if r.get(f)]}


@frappe.whitelist()
def list_resources(kind):
	require_capability(MANAGE)
	rows = frappe.get_all(RESOURCE, filters={"kind": kind}, fields=["name", "kind", "title", "description", "url", "file",
		"sort_order", "published", "for_everyone", *WORKSPACE_FIELDS.values()], order_by="sort_order asc, creation asc",
		limit_page_length=1000)
	return {"items": [_shape_resource(r) for r in rows]}


@frappe.whitelist(methods=["POST"])
def save_resource(resource):
	require_capability(MANAGE)
	data = json.loads(resource) if isinstance(resource, str) else (resource or {})
	if data.get("kind") not in KINDS:
		frappe.throw(_("Unknown kind."))
	title = (data.get("title") or "").strip()
	url, file = (data.get("url") or "").strip(), (data.get("file") or "").strip()
	if not title:
		frappe.throw(_("Write a title."))
	if not url and not file:
		frappe.throw(_("Add a link or upload a file."))
	if url and not url.startswith(("https://", "http://")):
		frappe.throw(_("The link must start with https://"))
	everyone = bool(data.get("everyone"))
	workspaces = [w for w in data.get("workspaces") or [] if w in WORKSPACE_FIELDS]
	if not everyone and not workspaces:
		frappe.throw(_("Choose who should see this."))
	doc = frappe.get_doc(RESOURCE, data["id"]) if data.get("id") else frappe.new_doc(RESOURCE)
	doc.update({"kind": data["kind"], "title": title[:140], "description": (data.get("description") or "").strip()[:2000],
		"url": url[:1000], "file": file[:1000], "sort_order": int(data.get("sort_order") or 0),
		"published": 1 if data.get("published", True) else 0, "for_everyone": 1 if everyone else 0,
		**{f: 1 if k in workspaces else 0 for k, f in WORKSPACE_FIELDS.items()}})
	doc.save(ignore_permissions=True)
	return _shape_resource(frappe.get_doc(RESOURCE, doc.name).as_dict())


@frappe.whitelist(methods=["POST"])
def delete_resource(id):
	require_capability(MANAGE)
	frappe.delete_doc(RESOURCE, id, ignore_permissions=True)
	return {"ok": True}
