"""Maps tab (KRCS, 16 Nov 2026): Surveillance Officers, FHWs and CHAs start with View Surveillance Map, so their
dashboard shows the Maps tab (their sub-county). Untick it in Roles & Permissions to hide the tab. Runs once."""
import frappe

ROLES = ["Surveillance Officer", "Facility Health Worker", "CHA", "Community Health Assistant"]
CAP = "view_surveillance_map"


def execute():
	from surveillance.capabilities import sync_role_permissions
	for role in ROLES:
		if not frappe.db.exists("Role", role):
			continue
		if not frappe.db.exists("Role Capability", {"role": role, "capability": CAP}):
			frappe.get_doc({"doctype": "Role Capability", "role": role, "capability": CAP}).insert(ignore_permissions=True)
		sync_role_permissions(role)
	frappe.db.commit()
