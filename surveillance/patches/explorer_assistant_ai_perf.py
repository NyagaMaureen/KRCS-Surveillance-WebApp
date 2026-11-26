"""New permissions (KRCS 26 Nov 2026). Safe to run again.

    view_data_explorer     Data Explorer is back in the menu: roles that have View Dashboard (view_analytics) get it, so CHAs,
                           officers, County MOH / PHEOC, national and HQ users keep seeing it for their own area.
    ask_surveillance_data  The Surveillance data tab of the KRCS Data Assistant: the same roles.
    view_ai_performance    AI Performance under System settings: System Administrator and Data & AI Administrator.
"""
import frappe

from surveillance.patches.roles_cleanup_2026_11_v2 import _add_capabilities

CAP = "Role Capability"


def execute():
	data_roles = set(frappe.get_all(CAP, filters={"capability": "view_analytics"}, pluck="role")) - {"Data & AI Administrator"}
	for role in sorted(data_roles):
		_add_capabilities(role, ["view_data_explorer", "ask_surveillance_data"])
	for role in ("System Administrator", "Data & AI Administrator"):
		if frappe.db.exists("Role", role):
			_add_capabilities(role, ["view_ai_performance"])
	from surveillance.capabilities import sync_all_role_permissions
	sync_all_role_permissions()
	frappe.clear_cache()
	frappe.db.commit()
	print("Data Explorer and Surveillance data:", ", ".join(sorted(data_roles)) or "no role")
