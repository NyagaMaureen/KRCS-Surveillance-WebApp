"""CHA workspace (KRCS, 16 Nov 2026): the CHA role gets its own dashboard (its sub-county, like Surveillance Officers
and FHWs), Referrals and My Tasks. Other menu items follow the permissions set in Roles & Permissions.
Works with the role named CHA or Community Health Assistant. Nothing is removed. Safe to run again."""
import frappe

ROLES = ["CHA", "Community Health Assistant"]
CAPS = ["cha_workspace", "receive_tasks"]


def execute():
	from surveillance.capabilities import sync_role_permissions
	for role in ROLES:
		if not frappe.db.exists("Role", role):
			continue
		for cap in CAPS:
			if not frappe.db.exists("Role Capability", {"role": role, "capability": cap}):
				frappe.get_doc({"doctype": "Role Capability", "role": role, "capability": cap}).insert(ignore_permissions=True)
		sync_role_permissions(role)
	frappe.db.commit()
