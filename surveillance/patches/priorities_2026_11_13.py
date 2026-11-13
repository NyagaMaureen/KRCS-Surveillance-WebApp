"""Disease priorities agreed 13 Nov 2026 (Maureen / Allan). Runs once on migrate, on every site.
Critical: COVID-19 / SARI, AWD / cholera, unusual death of people.
High: unusual illness of people, unusual death of animals, unusual event / emergency.
Later changes are made in Settings -> Alert Thresholds."""
import frappe

DOCTYPE = "Alert Threshold Config"
PRIORITIES = {
	"covid-sari": "Critical",
	"awd-cholera": "Critical",
	"unusual-death-people": "Critical",
	"unusual-illness-people": "High",
	"unusual-death-animals": "High",
	"unusual-event": "High",
}


def execute():
	for key, priority in PRIORITIES.items():
		if frappe.db.exists(DOCTYPE, key):
			frappe.db.set_value(DOCTYPE, key, "priority", priority, update_modified=False)
	frappe.db.commit()
