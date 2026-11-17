"""Monitoring Reports (KRCS, 16 Nov 2026), runs once:
- HQ Admin gets View Monitoring Reports and Export Monitoring Reports. Give them to other roles in Roles & Permissions
  (Surveillance Officers, FHWs and CHAs then see their own sub-county only).
- An "AI Server" role with only Send AI Model Measures, for the AI server's user (it sends MLflow measures)."""
import frappe

GRANTS = {"HQ Admin": ["view_monitoring_reports", "export_monitoring_reports"], "AI Server": ["push_model_metrics"]}


def execute():
	from surveillance.capabilities import sync_role_permissions
	if not frappe.db.exists("Role", "AI Server"):
		frappe.get_doc({"doctype": "Role", "role_name": "AI Server", "desk_access": 0}).insert(ignore_permissions=True)
	for role, caps in GRANTS.items():
		if not frappe.db.exists("Role", role):
			continue
		for cap in caps:
			if not frappe.db.exists("Role Capability", {"role": role, "capability": cap}):
				frappe.get_doc({"doctype": "Role Capability", "role": role, "capability": cap}).insert(ignore_permissions=True)
		sync_role_permissions(role)
	frappe.db.commit()
