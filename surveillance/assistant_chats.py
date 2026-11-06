"""AI Data Assistant chats, kept on the server so they follow the user to any device.

Each user sees and changes only their own chats. Questions are copied to a plain-text field for the chat search.
"""
import json

import frappe
from frappe import _
from frappe.utils import cint

DOCTYPE = "AI Assistant Chat"
MAX_CHATS = 200            # per user; the oldest are removed beyond this
MAX_BYTES = 2_000_000      # per chat


def _user():
	if frappe.session.user == "Guest":
		frappe.throw(_("Please sign in."), frappe.PermissionError)
	return frappe.session.user


def _own(chat_id):
	name = frappe.db.get_value(DOCTYPE, {"chat_id": str(chat_id)[:64], "user": _user()}, "name")
	if not name:
		frappe.throw(_("Chat not found."), frappe.DoesNotExistError)
	return frappe.get_doc(DOCTYPE, name)


def _summary(row):
	return {"id": row.chat_id, "title": row.title or "New chat", "updatedAt": str(row.modified), "count": cint(row.message_count)}


@frappe.whitelist()
def list_chats(search=None, limit=100):
	filters = {"user": _user()}
	or_filters = None
	term = (search or "").strip()
	if term:
		like = f"%{term[:100]}%"
		or_filters = [["title", "like", like], ["questions", "like", like]]
	rows = frappe.get_all(DOCTYPE, filters=filters, or_filters=or_filters,
		fields=["chat_id", "title", "modified", "message_count"], order_by="modified desc", limit_page_length=min(cint(limit) or 100, MAX_CHATS))
	return [_summary(r) for r in rows]


@frappe.whitelist()
def get_chat(chat_id):
	doc = _own(chat_id)
	try:
		messages = json.loads(doc.messages or "[]")
	except ValueError:
		messages = []
	return {**_summary(doc), "messages": messages}


@frappe.whitelist(methods=["POST"])
def save_chat(chat_id, title=None, messages=None):
	user = _user()
	chat_id = str(chat_id or "")[:64]
	if not chat_id:
		frappe.throw(_("Missing chat id."))
	msgs = json.loads(messages) if isinstance(messages, str) else (messages or [])
	if not isinstance(msgs, list):
		frappe.throw(_("Messages must be a list."))
	payload = json.dumps(msgs, ensure_ascii=False)
	if len(payload.encode()) > MAX_BYTES:
		frappe.throw(_("This chat is too long to save. Start a new chat."))
	questions = "\n".join(str(m.get("content") or "")[:500] for m in msgs if isinstance(m, dict) and m.get("role") == "user")
	name = frappe.db.get_value(DOCTYPE, {"chat_id": chat_id}, ["name", "user"], as_dict=True)
	if name and name.user != user:
		frappe.throw(_("Chat not found."), frappe.DoesNotExistError)
	doc = frappe.get_doc(DOCTYPE, name.name) if name else frappe.new_doc(DOCTYPE)
	doc.update({"chat_id": chat_id, "user": user, "title": (title or doc.get("title") or "New chat")[:140],
		"messages": payload, "questions": questions, "message_count": len(msgs)})
	doc.save(ignore_permissions=True)
	_trim(user)
	return _summary(doc)


@frappe.whitelist(methods=["POST"])
def delete_chat(chat_id):
	frappe.delete_doc(DOCTYPE, _own(chat_id).name, ignore_permissions=True)
	return {"ok": True}


def _trim(user):
	old = frappe.get_all(DOCTYPE, filters={"user": user}, pluck="name", order_by="modified desc", start=MAX_CHATS, limit_page_length=500)
	for name in old:
		frappe.delete_doc(DOCTYPE, name, ignore_permissions=True)
