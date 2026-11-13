"""Nov 2026 (Elizabeth / Allan): only the priority diseases and the unusual events are shown for now.

Sets the new "Active" tick (Alert Threshold Config.monitored): on for the priority diseases and the unusual events,
off for everything else (malaria, typhoid, dysentery, acute jaundice ...). Inactive diseases are still classified,
routed and counted in the background; they are only hidden from Epi Trends, dashboards, the map and filters.
The unusual events get threshold 1, so every report raises an alert. Admins change the tick in Settings -> Alert Thresholds.
"""
import frappe

DOCTYPE = "Alert Threshold Config"

PRIORITY = [
	"awd-cholera", "meningococcal-meningitis", "yellow-fever", "vhf", "covid-sari", "measles", "afp-polio",
	"anthrax", "rabies", "rift-valley-fever", "mpox", "bvd",
]
UNUSUAL = [
	"unusual-illness-people", "unusual-death-people", "unusual-illness-animals", "unusual-death-animals", "unusual-event",
]


def execute():
	active = set(PRIORITY) | set(UNUSUAL)
	for name in frappe.get_all(DOCTYPE, pluck="name"):
		frappe.db.set_value(DOCTYPE, name, "monitored", 1 if name in active else 0, update_modified=False)
	for name in UNUSUAL:
		if frappe.db.exists(DOCTYPE, name):
			frappe.db.set_value(DOCTYPE, name, "threshold", 1, update_modified=False)
	frappe.db.commit()
