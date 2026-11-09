"""Role clean-up agreed with KRCS (Allan, Nov 2026).

Renames (users, permissions, primary roles and every link follow the rename):
    County Officer           -> County Disease Surveillance Coordinator   (County PHEOC)
    Government / MOH / IDSR  -> MOH DDSR                                   (Division of Disease Surveillance & Response)
    Public Health Manager    -> Public Health Officer                      (one per health facility)
    Surveillance Officer     -> Disease Surveillance Officer               (covers several facilities)
    HQ Admin                 -> KRCS Public Health HQ                      (national monitoring, oversees PHOs)
Public Health Specialist is abolished: its users get KRCS Public Health HQ, then the role is removed.
New: HIS Officer (Health Information & Systems, facility based: uploads KHIS data weekly or monthly).
Public Health Officers get the Disease Surveillance Officer permissions as well (same work, smaller area).
Safe to run again: anything already done is skipped.
"""
import frappe

RENAMES = [
	("County Officer", "County Disease Surveillance Coordinator"),
	("Government / MOH / IDSR", "MOH DDSR"),
	("Public Health Manager", "Public Health Officer"),
	("Surveillance Officer", "Disease Surveillance Officer"),
	("HQ Admin", "KRCS Public Health HQ"),
]
ABOLISH = ("Public Health Specialist", "KRCS Public Health HQ")
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


def _abolish(old, move_to):
	if not frappe.db.exists("Role", old):
		return
	for user in frappe.get_all("Has Role", filters={"role": old, "parenttype": "User"}, pluck="parent", distinct=True):
		u = frappe.get_doc("User", user)
		if move_to not in [r.role for r in u.roles]:
			u.append("roles", {"role": move_to})
		if u.get("primary_role") == old:
			u.primary_role = move_to
		u.save(ignore_permissions=True)
		print(f"user {user}: {old} -> {move_to}")
	frappe.db.delete("Has Role", {"role": old})
	frappe.db.delete(CAP, {"role": old})
	frappe.db.delete("Custom DocPerm", {"role": old})
	if frappe.db.exists("DocType", "Surveillance Role") and frappe.db.exists("Surveillance Role", old):
		frappe.delete_doc("Surveillance Role", old, force=True)
	frappe.delete_doc("Role", old, force=True, ignore_permissions=True)
	print(f"role removed: {old}")


def execute():
	for old, new in RENAMES:
		_rename(old, new)
	_ensure_role("KRCS Public Health HQ")
	_abolish(*ABOLISH)

	_ensure_role(HIS)
	if not frappe.get_all(CAP, filters={"role": HIS}, limit=1):
		_add_capabilities(HIS, HIS_CAPABILITIES)

	# Public Health Officers do the same surveillance work as Disease Surveillance Officers
	if frappe.db.exists("Role", "Public Health Officer") and frappe.db.exists("Role", "Disease Surveillance Officer"):
		_add_capabilities("Public Health Officer",
			frappe.get_all(CAP, filters={"role": "Disease Surveillance Officer"}, pluck="capability"))

	from surveillance.capabilities import sync_all_role_permissions
	sync_all_role_permissions()
	frappe.clear_cache()
	frappe.db.commit()
