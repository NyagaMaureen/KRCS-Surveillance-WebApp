"""Two MOH roles (KRCS, Allan's role document, 23 Nov 2026).

    County MOH / PHEOC    renamed from MOH DDSR: county based. Sees what the sub-county officers escalate to them and
                          the events in their county (their region on the user). Keeps its permissions and users.
    MOH DDSR (National)   new: national overview only. Dashboard (every county, with county and sub-county filters),
                          Epidemiological Trends, Maps, Monitoring Reports and the Knowledge Base. No Review Queue,
                          Signals Captured or event pages. Change it later in Roles & Permissions.
Safe to run again.
"""
import frappe

from surveillance.patches.roles_cleanup_2026_11_v2 import _add_capabilities, _ensure_role, _rename

COUNTY = "County MOH / PHEOC"
NATIONAL = "MOH DDSR (National)"
NATIONAL_CAPS = ["view_analytics", "view_alerts", "view_surveillance_map", "view_monitoring_reports",
	"export_monitoring_reports", "export_data", "use_knowledge_base", "view_all_regions"]


def execute():
	_rename("MOH DDSR", COUNTY)
	_ensure_role(COUNTY)
	_ensure_role(NATIONAL)
	_add_capabilities(NATIONAL, NATIONAL_CAPS)
	from surveillance.capabilities import sync_role_permissions
	for role in (COUNTY, NATIONAL):
		sync_role_permissions(role)
	frappe.db.commit()
