"""Conversation state per phone number, in Redis (frappe.cache), kept for 30 days of inactivity.

Survives app restarts and deploys. Redis is not persisted on a standard bench, so a restart of
redis-cache itself (e.g. a server reboot) loses unfinished drafts; submitted reports are safe in the database.
"""

import json

import frappe

from surveillance.whatsapp.conversation import AttrDict, new_session

KEY = "whatsapp:session:{}"
TTL = 30 * 24 * 3600


def load(phone):
	# expires=True: read Redis every time. Otherwise a miss is kept in frappe.local.cache for the rest of the
	# job, and a job that answers several messages from one number would start a new session for each.
	raw = frappe.cache.get_value(KEY.format(phone), expires=True)
	return AttrDict.wrap(json.loads(raw)) if raw else new_session(phone)


def save(session):
	frappe.cache.set_value(KEY.format(session.phone), json.dumps(session, default=str), expires_in_sec=TTL)


def clear(phone):
	frappe.cache.delete_value(KEY.format(phone))
