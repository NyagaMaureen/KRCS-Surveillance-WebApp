"""Who sees which Case Reports.

- View Reports + View All Regions (or no assigned region): every report.
- View Reports with an assigned region (User.assigned_region, e.g. a surveillance officer for Kalobeyei): reports in
  that region, plus any report they submitted themselves. Same rule as the Review Queue (events._user_region).
- View Own Reports only (e.g. CHPs): only reports they submitted (reported_by or created by them).
Applied to every list, count, export and single-report read through Frappe, so the rule cannot be
bypassed from the browser. Server code that uses frappe.get_all is not affected.
"""
import frappe

from surveillance.capabilities import has_capability


def _own_only(user):
	return user not in ("Administrator",) and not has_capability("view_reports", user) and has_capability("view_own_reports", user)


def _region_only(user):
	"""The region a View Reports user is limited to, or None (all regions)."""
	if user in ("Administrator",) or not has_capability("view_reports", user) or has_capability("view_all_regions", user):
		return None
	if not frappe.get_meta("User").has_field("assigned_region"):
		return None
	return frappe.db.get_value("User", user, "assigned_region") or None


def case_report_query(user=None):
	user = user or frappe.session.user
	u = frappe.db.escape(user)
	own = f"`tabCase Report`.reported_by = {u} or `tabCase Report`.owner = {u}"
	if _own_only(user):
		return f"({own})"
	region = _region_only(user)
	if region:
		return f"(`tabCase Report`.region = {frappe.db.escape(region)} or {own})"
	return ""


def case_report_permission(doc, ptype=None, user=None):
	user = user or frappe.session.user
	own = doc.get("reported_by") == user or doc.owner == user
	if _own_only(user):
		return own
	region = _region_only(user)
	if region:
		return own or doc.get("region") == region
	return None          # no opinion: normal role permissions decide
