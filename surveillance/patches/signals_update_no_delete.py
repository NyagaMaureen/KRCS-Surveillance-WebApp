"""Signals Captured: view and update only (KRCS 17 Nov 2026). Delete Reports is removed from every role, so nobody can
delete a report; Edit is now Update Signals (every change is kept in the report's Update history). Safe to run again."""
import frappe


def execute():
	from surveillance.capabilities import sync_all_role_permissions
	n = len(frappe.get_all("Role Capability", filters={"capability": "delete_reports"}, pluck="name"))
	frappe.db.delete("Role Capability", {"capability": "delete_reports"})
	sync_all_role_permissions()   # takes the Delete right on Case Report away from those roles
	frappe.db.commit()
	print(f"Delete Reports removed from {n} role(s)")
