"""Who sees which Case Reports.

- View Reports: every report (as before).
- View Own Reports only (e.g. CHPs): only reports they submitted (reported_by or created by them).
Applied to every list, count, export and single-report read through Frappe, so the rule cannot be
bypassed from the browser. Server code that uses frappe.get_all is not affected.
"""
import frappe

from surveillance.capabilities import has_capability


def _own_only(user):
	return user not in ("Administrator",) and not has_capability("view_reports", user) and has_capability("view_own_reports", user)


def case_report_query(user=None):
	user = user or frappe.session.user
	if not _own_only(user):
		return ""
	u = frappe.db.escape(user)
	return f"(`tabCase Report`.reported_by = {u} or `tabCase Report`.owner = {u})"


def case_report_permission(doc, ptype=None, user=None):
	user = user or frappe.session.user
	if not _own_only(user):
		return None          # no opinion: normal role permissions decide
	return doc.get("reported_by") == user or doc.owner == user
