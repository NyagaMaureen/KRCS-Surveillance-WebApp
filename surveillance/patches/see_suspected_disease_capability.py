"""New capability 'See Suspected Disease After Reporting': the suspected disease shown after a
report is sent is role-based. Given to every role that can create reports except CHP; change it per role in
Roles & Permissions."""
import frappe

KEY = "see_suspected_disease"


def execute():
	roles = set(frappe.get_all("Role Capability", filters={"capability": "create_reports"}, pluck="role"))
	roles |= set(frappe.get_all("Role Capability", filters={"capability": "view_reports"}, pluck="role"))
	for role in sorted(roles - {"CHP"}):
		if not frappe.db.exists("Role Capability", {"role": role, "capability": KEY}):
			frappe.get_doc({"doctype": "Role Capability", "role": role, "capability": KEY}).insert(ignore_permissions=True)
	frappe.db.commit()
