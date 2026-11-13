"""13 Nov 2026 (Allan): unusual illness of animals is High, like the other unusual events except death of people."""
import frappe


def execute():
	if frappe.db.exists("Alert Threshold Config", "unusual-illness-animals"):
		frappe.db.set_value("Alert Threshold Config", "unusual-illness-animals", "priority", "High", update_modified=False)
	frappe.db.commit()
