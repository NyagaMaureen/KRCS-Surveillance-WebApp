"""HQ Admin is now called System Administrator (KRCS 18 Nov 2026). Users, primary roles, permissions and the
Roles & Permissions ticks move with the role. Safe to run again."""
import frappe

OLD, NEW = "HQ Admin", "System Administrator"


def execute():
	if frappe.db.exists("Role", OLD):
		frappe.rename_doc("Role", OLD, NEW, force=True, merge=bool(frappe.db.exists("Role", NEW)))
		frappe.db.set_value("Role", NEW, "role_name", NEW)
		print(f"role renamed: {OLD} -> {NEW}")
	if frappe.db.exists("DocType", "Surveillance Role") and frappe.db.exists("Surveillance Role", OLD):
		if frappe.db.exists("Surveillance Role", NEW):
			frappe.delete_doc("Surveillance Role", OLD, force=True)
		else:
			frappe.rename_doc("Surveillance Role", OLD, NEW, force=True)
			frappe.db.set_value("Surveillance Role", NEW, "role", NEW)
	from surveillance.capabilities import sync_all_role_permissions
	sync_all_role_permissions()
	frappe.clear_cache()
	frappe.db.commit()
