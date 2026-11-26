"""AWD / Cholera is called "Suspected Acute Watery Diarrhoea (AWD) / Cholera", like the other suspected diseases
(KRCS 26 Nov 2026). Renames the disease and the copies of its name on events, Epi Trends alerts and tasks. Safe to
run again; a name someone has changed in Settings is left alone."""
import frappe

KEY = "awd-cholera"
OLD = "Acute Watery Diarrhoea (AWD) / Cholera"
NEW = "Suspected Acute Watery Diarrhoea (AWD) / Cholera"


def execute():
	if frappe.db.get_value("Alert Threshold Config", KEY, "disease_name") == OLD:
		frappe.db.set_value("Alert Threshold Config", KEY, "disease_name", NEW, update_modified=False)
	for doctype in ("Surveillance Event", "Risk Alert", "Event Task"):
		if not frappe.db.table_exists(doctype) or not frappe.get_meta(doctype).has_field("disease_name"):
			continue
		frappe.db.sql(f"update `tab{doctype}` set disease_name = %(new)s where disease_name = %(old)s", {"new": NEW, "old": OLD})
		if frappe.get_meta(doctype).has_field("title"):
			frappe.db.sql(f"""update `tab{doctype}` set title = concat(%(new)s, substring(title, %(n)s))
				where title like %(like)s""", {"new": NEW, "n": len(OLD) + 1, "like": OLD.replace("%", "\\%").replace("_", "\\_") + "%"})
	frappe.db.commit()
