"""Facility Health Worker, as in Allan's role document (KRCS 23 Nov 2026): sees the signals submitted in their
sub-county (Signals Captured, view only: no investigation) and the Epidemiological Trends of their sub-county, besides
recording facility signals, referrals to their facility and tasks. Adds what is missing and removes nothing; their
sub-county is the one set on the user. Safe to run again."""
import frappe

ROLE = "Facility Health Worker"
CAPS = ["fhw_workspace", "create_reports", "view_own_reports", "view_reports", "view_alerts", "receive_tasks",
	"receive_referrals", "use_knowledge_base"]
NOT_FOR_FHW = ["act_on_events", "investigate_alerts"]   # view only (reported, not removed automatically)


def execute():
	if not frappe.db.exists("Role", ROLE):
		return
	from surveillance.capabilities import CAPABILITY_MAP, sync_role_permissions
	for cap in CAPS:
		if cap in CAPABILITY_MAP and not frappe.db.exists("Role Capability", {"role": ROLE, "capability": cap}):
			frappe.get_doc({"doctype": "Role Capability", "role": ROLE, "capability": cap}).insert(ignore_permissions=True)
	extra = frappe.get_all("Role Capability", filters={"role": ROLE, "capability": ["in", NOT_FOR_FHW]}, pluck="capability")
	if extra:
		print(f"Facility Health Worker can still act on events ({', '.join(extra)}): untick in Roles & Permissions if not wanted")
	sync_role_permissions(ROLE)
	frappe.db.commit()
