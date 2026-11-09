"""Role clean-up agreed with KRCS (Allan, Nov 2026). Final roles:

    HQ Admin                                 system administrator (all permissions; users, roles, settings)
    Public Health HQ                  (new)  national monitoring of all events; oversees Public Health Officers, assigns tasks
    County Disease Surveillance Coordinator  renamed from County Officer (County PHEOC); renamed to CDSC by roles_rename_cdsc
    MOH DDSR                                 renamed from Government / MOH / IDSR (Division of Disease Surveillance & Response)
    Public Health Officer                    renamed from Public Health Manager (one per health facility); also gets
                                             the Surveillance Officer permissions (same work, smaller area)
    Surveillance Officer                     unchanged (covers several facilities)
    HIS Officer                       (new)  Health Information & Systems, facility based: uploads KHIS data
    CHP, Facility Health Worker, Data & AI Administrator   unchanged

Merged into HQ Admin (same job): System Administrator. Its users get HQ Admin.
Moved to Public Health HQ: Public Health Specialist (abolished). Its users get Public Health HQ.
Removed: Field Supervisor, Partner Organization (not in Allan's list). Users who held them
keep their other roles; the patch prints who they were so they can be given a new role.
Renames carry users, permissions, primary roles and every link with them. Safe to run again.
"""
import frappe

RENAMES = [
	("County Officer", "County Disease Surveillance Coordinator"),
	("Government / MOH / IDSR", "MOH DDSR"),
	("Public Health Manager", "Public Health Officer"),
]
MERGE_INTO = [
	("System Administrator", "HQ Admin"),
	("Public Health Specialist", "Public Health HQ"),
]
REMOVE = ["Field Supervisor", "Partner Organization"]
PH_HQ = "Public Health HQ"
PH_HQ_CAPABILITIES = ["view_review_queue", "act_on_events", "view_alerts", "investigate_alerts", "view_all_regions",
	"view_all_tasks", "view_surveillance_map", "view_analytics", "view_reports", "export_reports", "export_data",
	"view_response_protocols", "view_data_quality", "verify_suspected_disease", "use_knowledge_base", "view_users"]
HIS = "HIS Officer"
HIS_CAPABILITIES = ["upload_facility_data", "view_data_quality", "view_analytics", "use_knowledge_base"]
CAP = "Role Capability"


def _rename(old, new):
	if frappe.db.exists("Role", old):
		frappe.rename_doc("Role", old, new, force=True, merge=bool(frappe.db.exists("Role", new)))
		frappe.db.set_value("Role", new, "role_name", new)
		print(f"role renamed: {old} -> {new}")
	if frappe.db.exists("DocType", "Surveillance Role") and frappe.db.exists("Surveillance Role", old):
		if frappe.db.exists("Surveillance Role", new):
			frappe.delete_doc("Surveillance Role", old, force=True)
		else:
			frappe.rename_doc("Surveillance Role", old, new, force=True)
			frappe.db.set_value("Surveillance Role", new, "role", new)


def _ensure_role(name):
	if not frappe.db.exists("Role", name):
		frappe.get_doc({"doctype": "Role", "role_name": name, "desk_access": 1}).insert(ignore_permissions=True)
		print(f"role created: {name}")
	if frappe.db.exists("DocType", "Surveillance Role") and not frappe.db.exists("Surveillance Role", name):
		frappe.get_doc({"doctype": "Surveillance Role", "role": name}).insert(ignore_permissions=True)


def _add_capabilities(role, keys):
	have = set(frappe.get_all(CAP, filters={"role": role}, pluck="capability"))
	for key in keys:
		if key not in have:
			frappe.get_doc({"doctype": CAP, "role": role, "capability": key}).insert(ignore_permissions=True)


def _abolish(old, move_to=None):
	"""Remove a role. Its users get move_to (when given); without it they keep only their other roles."""
	if not frappe.db.exists("Role", old):
		return
	for user in frappe.get_all("Has Role", filters={"role": old, "parenttype": "User"}, pluck="parent", distinct=True):
		u = frappe.get_doc("User", user)
		if move_to and move_to not in [r.role for r in u.roles]:
			u.append("roles", {"role": move_to})
		if u.get("primary_role") == old:
			u.primary_role = move_to
		u.save(ignore_permissions=True)
		print(f"user {user}: {old} -> {move_to}" if move_to else f"user {user}: {old} removed, give them a new role")
	frappe.db.delete("Has Role", {"role": old})
	frappe.db.delete(CAP, {"role": old})
	frappe.db.delete("Custom DocPerm", {"role": old})
	if frappe.db.exists("DocType", "Surveillance Role") and frappe.db.exists("Surveillance Role", old):
		frappe.delete_doc("Surveillance Role", old, force=True)
	frappe.delete_doc("Role", old, force=True, ignore_permissions=True)
	print(f"role removed: {old}")


# names used by earlier drafts of this clean-up (run on some development sites): put them back first
UNDO_DRAFTS = [
	("Disease Surveillance Officer", "Surveillance Officer"),
	("KRCS Public Health HQ", "HQ Admin"),
]


def execute():
	for old, new in UNDO_DRAFTS:
		_rename(old, new)
	# an earlier draft renamed HQ Admin to Public Health HQ: that role (with all permissions) is HQ Admin again
	if not frappe.db.exists("Role", "HQ Admin") and frappe.db.exists("Role", PH_HQ):
		_rename(PH_HQ, "HQ Admin")
	for old, new in RENAMES:
		_rename(old, new)

	_ensure_role("HQ Admin")
	_ensure_role(PH_HQ)
	if not frappe.get_all(CAP, filters={"role": PH_HQ}, limit=1):
		_add_capabilities(PH_HQ, PH_HQ_CAPABILITIES)
	for old, into in MERGE_INTO:
		_abolish(old, into)
	for old in REMOVE:
		_abolish(old)

	_ensure_role(HIS)
	if not frappe.get_all(CAP, filters={"role": HIS}, limit=1):
		_add_capabilities(HIS, HIS_CAPABILITIES)

	# Public Health Officers do the same surveillance work as Surveillance Officers
	if frappe.db.exists("Role", "Public Health Officer") and frappe.db.exists("Role", "Surveillance Officer"):
		_add_capabilities("Public Health Officer",
			frappe.get_all(CAP, filters={"role": "Surveillance Officer"}, pluck="capability"))

	from surveillance.capabilities import sync_all_role_permissions
	sync_all_role_permissions()
	frappe.clear_cache()
	frappe.db.commit()
