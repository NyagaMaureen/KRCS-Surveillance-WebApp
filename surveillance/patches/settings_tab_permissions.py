"""Settings tabs by role (KRCS review, 12 Nov 2026). Each Settings tab except Profile is now a permission; this gives
sensible defaults once, then they are changed per role in Roles & Permissions:
  Notifications     every role except CHP
  Alert Thresholds  roles that view alerts or manage thresholds
  AI Config, System, Data, Security   admin roles (manage users or roles) and Data & AI Administrator
CHPs keep only Profile (their details, location and password)."""
import frappe

RC = "Role Capability"
ADMIN_ROLES = {"HQ Admin", "Data & AI Administrator"}


def _with(cap):
	return set(frappe.get_all(RC, filters={"capability": cap}, pluck="role"))


def _give(roles, cap):
	for role in roles:
		if role != "CHP" and frappe.db.exists("Role", role) and not frappe.db.exists(RC, {"role": role, "capability": cap}):
			frappe.get_doc({"doctype": RC, "role": role, "capability": cap}).insert(ignore_permissions=True)


def execute():
	everyone = set(frappe.get_all(RC, pluck="role"))
	admins = (_with("manage_users") | _with("manage_roles") | ADMIN_ROLES)
	_give(everyone | ADMIN_ROLES, "settings_notifications")
	_give(_with("view_alerts") | _with("manage_alert_thresholds") | ADMIN_ROLES, "settings_alert_thresholds")
	for cap in ("settings_ai_config", "settings_system", "settings_data", "settings_security"):
		_give(admins, cap)
	frappe.db.commit()
