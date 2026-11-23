"""MOH DDSR (county MOH, KRCS 17 Nov 2026): the full (admin) interface for their region - dashboard, Epi Trends,
Surveillance & Response, map, Review Queue (escalations first), Signals Captured and reports. View rights only; adds
what is missing and removes nothing (change it later in Roles & Permissions). Their region is set on the user."""
import frappe

ROLE = "MOH DDSR"   # renamed County MOH / PHEOC by moh_roles_split (runs after this)
CAPS = ["view_analytics", "view_alerts", "view_surveillance_map", "export_data", "view_review_queue", "view_reports",
	"export_reports", "see_suspected_disease", "use_knowledge_base", "view_monitoring_reports", "export_monitoring_reports",
	"view_data_quality", "view_response_protocols"]


def execute():
	if not frappe.db.exists("Role", ROLE):
		return
	from surveillance.capabilities import CAPABILITY_MAP, sync_role_permissions
	added = 0
	for cap in CAPS:
		if cap in CAPABILITY_MAP and not frappe.db.exists("Role Capability", {"role": ROLE, "capability": cap}):
			frappe.get_doc({"doctype": "Role Capability", "role": ROLE, "capability": cap}).insert(ignore_permissions=True)
			added += 1
	sync_role_permissions(ROLE)
	frappe.db.commit()
	print(f"MOH DDSR: {added} permission(s) added")
