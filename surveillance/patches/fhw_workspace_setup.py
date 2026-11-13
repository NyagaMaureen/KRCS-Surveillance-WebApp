"""Facility Health Worker workspace (Nov 2026): adds User 'Assigned Facility' (from the MOH 505 Reporting Facility
list) and gives the Facility Health Worker role its workspace permissions. Nothing is removed from the role.
Safe to run again."""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

ROLE = "Facility Health Worker"
CAPS = ["fhw_workspace", "create_reports", "view_own_reports", "receive_tasks", "receive_referrals", "use_knowledge_base"]


def execute():
	after = "assigned_sub_county" if frappe.get_meta("User").has_field("assigned_sub_county") else "email"
	create_custom_fields({"User": [{
		"fieldname": "assigned_facility", "label": "Assigned Facility", "fieldtype": "Link", "options": "Reporting Facility",
		"insert_after": after,
		"description": "Facility Health Worker: the facility they work at. Referrals to it show on their Referrals page.",
	}]}, update=True)
	if frappe.db.exists("Role", ROLE):
		for cap in CAPS:
			if not frappe.db.exists("Role Capability", {"role": ROLE, "capability": cap}):
				frappe.get_doc({"doctype": "Role Capability", "role": ROLE, "capability": cap}).insert(ignore_permissions=True)
		from surveillance.capabilities import sync_role_permissions
		sync_role_permissions(ROLE)
	frappe.db.commit()
