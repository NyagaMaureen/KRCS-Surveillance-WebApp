"""FHW workspace v2 (Nov 2026): Facility Health Workers can see Epi Trends (alerts and trends, read-only).
Adds View Alerts to the Facility Health Worker role. Nothing is removed. Safe to run again."""
import frappe

ROLE = "Facility Health Worker"
CAPS = ["view_alerts"]


def execute():
	if not frappe.db.exists("Role", ROLE):
		return
	for cap in CAPS:
		if not frappe.db.exists("Role Capability", {"role": ROLE, "capability": cap}):
			frappe.get_doc({"doctype": "Role Capability", "role": ROLE, "capability": cap}).insert(ignore_permissions=True)
	from surveillance.capabilities import sync_role_permissions
	sync_role_permissions(ROLE)
	frappe.db.commit()
