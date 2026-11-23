"""After the meeting with Allan (KRCS 23 Nov 2026). Safe to run again.

Roles
    CDSC                    removed: the same job as County MOH / PHEOC. Its users get County MOH / PHEOC.
    Public Health Officer   removed: the same job as Surveillance Officer. Its users get Surveillance Officer.
    AI review deadlines     level 2 goes to County MOH / PHEOC (it was Public Health Officer).
Monitoring Reports
    One permission per report (8), ticked in Roles & Permissions. Roles that could see Monitoring Reports get the
    reports they saw before: the Data & AI Administrator the 4 system reports; sub-county workspaces (officer, CHA,
    FHW) not Integration Health or System Health. With none ticked the page is hidden.
Knowledge Base
    View (see the page and download), Upload (documents and trusted sources), Approve. Roles that could upload or
    approve also get View.
"""
import frappe

from surveillance.patches.roles_cleanup_2026_11_v2 import _abolish, _add_capabilities

CAP = "Role Capability"
COUNTY = "County MOH / PHEOC"
OLD_VIEW = "view_monitoring_reports"
ALL_REPORTS = ["monitoring_r34", "monitoring_r35", "monitoring_r36", "monitoring_r37", "monitoring_r38",
	"monitoring_r39", "monitoring_r40", "monitoring_r40b"]
SYSTEM_REPORTS = ["monitoring_r37", "monitoring_r38", "monitoring_r40", "monitoring_r40b"]
HQ_ONLY = {"monitoring_r40", "monitoring_r40b"}
SCOPED = {"officer_workspace", "fhw_workspace", "cha_workspace", "chp_workspace"}


def _caps(role):
	return set(frappe.get_all(CAP, filters={"role": role}, pluck="capability"))


def execute():
	for old, into in (("CDSC", COUNTY), ("Public Health Officer", "Surveillance Officer")):
		_abolish(old, into)   # its users get the role it joins; that role keeps its own permissions

	if frappe.db.exists("DocType", "AI Review Settings"):
		l2 = frappe.db.get_single_value("AI Review Settings", "l2_roles") or ""
		roles = [r.strip() for r in l2.splitlines() if r.strip() and r.strip() not in ("Public Health Officer", "CDSC")]
		if COUNTY not in roles:
			roles.insert(0, COUNTY)
		frappe.db.set_single_value("AI Review Settings", "l2_roles", "\n".join(roles))
		l3 = frappe.db.get_single_value("AI Review Settings", "l3_roles") or ""
		l3_roles = [r.strip() for r in l3.splitlines() if r.strip() and r.strip() not in ("Public Health Officer", "CDSC")]
		if l3_roles:
			frappe.db.set_single_value("AI Review Settings", "l3_roles", "\n".join(l3_roles))

	for role in frappe.get_all(CAP, filters={"capability": OLD_VIEW}, pluck="role", distinct=True):
		have = _caps(role)
		if "dataai_workspace" in have:
			keys = SYSTEM_REPORTS
		elif have & SCOPED:
			keys = [k for k in ALL_REPORTS if k not in HQ_ONLY]
		else:
			keys = ALL_REPORTS
		_add_capabilities(role, keys)
		frappe.db.delete(CAP, {"role": role, "capability": OLD_VIEW})
		print(f"{role}: Monitoring Reports {', '.join(k.replace('monitoring_', '').upper() for k in keys)}")

	for role in frappe.get_all(CAP, filters={"capability": ["in", ["manage_knowledge_base", "approve_knowledge_base"]]},
			pluck="role", distinct=True):
		_add_capabilities(role, ["view_knowledge_base"])

	from surveillance.capabilities import sync_all_role_permissions
	sync_all_role_permissions()
	frappe.clear_cache()
	frappe.db.commit()
