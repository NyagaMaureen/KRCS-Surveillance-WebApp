"""Data & AI Administrator (KRCS 18 Nov 2026): one role for the Data & AI Admin and ICT Admin designs.

Runs the system: AI performance and settings, knowledge base, integrations, system health, data quality, MOH 505 and
context data, users, roles, audit log, security and settings. Sees no case or patient data (no Review Queue, Signals
Captured, Referrals, Epi Trends or map). The role's permissions are set to exactly this list (DATA_AI_CAPABILITIES),
so case-data permissions it had before are removed; change it later in Roles & Permissions.
An ICT Admin role, where one exists, is merged into it: its users get Data & AI Administrator. Safe to run again."""
import frappe

ROLE = "Data & AI Administrator"
MERGED = "ICT Admin"
CAP = "Role Capability"


def execute():
	from surveillance.capabilities import CAPABILITY_MAP, DATA_AI_CAPABILITIES, sync_all_role_permissions
	from surveillance.patches.roles_cleanup_2026_11_v2 import _abolish, _ensure_role
	_ensure_role(ROLE)
	_abolish(MERGED, ROLE)
	# primary role set to ICT Admin on users who no longer hold the role
	if frappe.get_meta("User").has_field("primary_role"):
		for user in frappe.get_all("User", filters={"primary_role": MERGED}, pluck="name"):
			frappe.db.set_value("User", user, "primary_role", ROLE, update_modified=False)
	before = set(frappe.get_all(CAP, filters={"role": ROLE}, pluck="capability"))
	want = {k for k in DATA_AI_CAPABILITIES if k in CAPABILITY_MAP}
	for key in before - want:
		frappe.db.delete(CAP, {"role": ROLE, "capability": key})
	for key in want - before:
		frappe.get_doc({"doctype": CAP, "role": ROLE, "capability": key}).insert(ignore_permissions=True)
	sync_all_role_permissions()   # also gives Users and Roles access to the role list (Surveillance Role)
	frappe.clear_cache()
	frappe.db.commit()
	print(f"{ROLE}: {len(want - before)} permission(s) added, {len(before - want)} removed: {', '.join(sorted(before - want)) or 'none'}")
