"""Reporting Channels and Context Data pages now follow permissions (KRCS review, Nov 2026). Defaults, once:
  View Reporting Channels  roles that view reports or analytics
  View Context Data        roles that view alerts, the Review Queue or analytics, or manage context data
CHP and officer workspaces are left out (their menus are fixed; giving it to them adds the page under 'More').
Context shown next to events, Epi Trends and AI triage is NOT affected; it follows the same rules as before."""
import frappe

RC = "Role Capability"


def _with(*caps):
	return set(frappe.get_all(RC, filters={"capability": ["in", list(caps)]}, pluck="role"))


def _give(roles, cap):
	skip = _with("chp_workspace", "officer_workspace") | {"CHP"}
	for role in sorted(roles - skip):
		if frappe.db.exists("Role", role) and not frappe.db.exists(RC, {"role": role, "capability": cap}):
			frappe.get_doc({"doctype": RC, "role": role, "capability": cap}).insert(ignore_permissions=True)


def execute():
	_give(_with("view_reports", "view_analytics") | {"HQ Admin"}, "view_reporting_channels")
	_give(_with("view_alerts", "view_review_queue", "view_analytics", "manage_context_data") | {"HQ Admin"}, "view_context_data")
	frappe.db.commit()
