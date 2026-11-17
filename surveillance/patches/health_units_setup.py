"""Community Health Units (KRCS 17 Nov 2026, Elizabeth): a CHP belongs to one CHU, a CHA heads one or more.
- adds User.health_units (Community Health Unit(s))
- existing CHPs and CHAs: each sub-county gets one CHU, "<sub-county> Health Unit", and its CHPs and CHAs are put in it
  (more CHUs can be added later in Users -> Community Health Units)
- reports already sent by those CHPs take their CHU
Nothing is removed. Safe to run again."""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field

from surveillance.health_units import CHA_ROLES, CHILD, CHP_ROLES, DT


def execute():
	frappe.reload_doc("surveillance", "doctype", "community_health_unit")
	frappe.reload_doc("surveillance", "doctype", "user_health_unit")
	frappe.reload_doc("surveillance", "doctype", "case_report_change")
	frappe.reload_doc("surveillance", "doctype", "case_report")
	if not frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "health_units"}):
		create_custom_field("User", {
			"fieldname": "health_units", "label": "Community Health Unit(s)", "fieldtype": "Table MultiSelect",
			"options": CHILD, "insert_after": "assigned_sub_county",
			"description": "CHP: the one CHU they belong to. CHA: the CHU(s) they head."})
	frappe.clear_cache(doctype="User")

	roles = CHP_ROLES | CHA_ROLES
	users = set(frappe.get_all("Has Role", filters={"parenttype": "User", "role": ["in", list(roles)]}, pluck="parent"))
	users |= set(frappe.get_all("User", filters={"primary_role": ["in", list(roles)]}, pluck="name"))
	made, placed = 0, 0
	for user in sorted(users):
		sc = frappe.db.get_value("User", user, "assigned_sub_county")
		if not sc or frappe.db.exists(CHILD, {"parent": user, "parenttype": "User", "parentfield": "health_units"}):
			continue
		sc_name, region = frappe.db.get_value("Sub County", sc, ["sub_county_name", "region"]) or (sc, None)
		title = f"{sc_name or sc} Health Unit"
		unit = frappe.db.get_value(DT, {"sub_county": sc, "health_unit_name": title})
		if not unit:
			unit = frappe.get_doc({"doctype": DT, "health_unit_name": title, "sub_county": sc, "region": region,
				"is_active": 1}).insert(ignore_permissions=True).name
			made += 1
		row = frappe.get_doc({"doctype": CHILD, "parent": user, "parenttype": "User", "parentfield": "health_units",
			"idx": 1, "health_unit": unit})
		row.name = frappe.generate_hash(length=10)
		row.db_insert()
		placed += 1

	# reports already sent by CHPs take the CHP's CHU
	filled = 0
	chps = set(frappe.get_all("Has Role", filters={"parenttype": "User", "role": ["in", list(CHP_ROLES)]}, pluck="parent"))
	chas = set(frappe.get_all("Has Role", filters={"parenttype": "User", "role": ["in", list(CHA_ROLES)]}, pluck="parent"))
	for user in chps - chas:
		unit = frappe.db.get_value(CHILD, {"parent": user, "parenttype": "User", "parentfield": "health_units"}, "health_unit")
		if not unit:
			continue
		filled += frappe.db.sql("""update `tabCase Report` set community_health_unit = %(unit)s
			where ifnull(community_health_unit, '') = '' and (reported_by = %(user)s or (ifnull(reported_by, '') = '' and owner = %(user)s))""",
			{"unit": unit, "user": user}) or 0
	frappe.db.commit()
	print(f"Community Health Units: {made} created, {placed} users placed in a CHU")
