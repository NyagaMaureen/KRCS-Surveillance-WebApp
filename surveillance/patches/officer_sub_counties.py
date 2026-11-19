"""More than one sub-county for an officer (KRCS 19 Nov 2026, Elizabeth): adds User.other_sub_counties next to the
assigned sub-county. The Review Queue, Signals Captured, the filters and the alert emails then cover all of them.
Nothing changes for existing users. Safe to run again."""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
	frappe.reload_doc("surveillance", "doctype", "user_sub_county")
	if not frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "other_sub_counties"}):
		create_custom_field("User", {
			"fieldname": "other_sub_counties", "label": "Other sub-counties", "fieldtype": "Table MultiSelect",
			"options": "User Sub County", "insert_after": "assigned_sub_county",
			"description": "Officers only: more sub-counties they cover, besides the assigned one."})
	frappe.clear_cache(doctype="User")
