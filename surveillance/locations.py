"""Sub-counties for the report form and the weekly counts.

Region (Dadaab, Kalobeyei) is the pilot site. Each site has a short list of sub-counties.
Names follow CBS spelling where CBS already reports from that place, so Case Report counts
line up with CBS history in the anomaly engine ("Garissa / Dadaab").
"""
import frappe
from frappe import _

DOCTYPE = "Sub County"

# (region_name, county, sub_county, approx_lat, approx_lng). Coordinates are approximate centre points
# for the map; KRCS can correct them in Desk. Missing ones are added; blank coordinates are filled.
DEFAULT_SUB_COUNTIES = [
	("Dadaab", "Garissa", "Dadaab", 0.0560, 40.3110),
	("Dadaab", "Garissa", "Liboi", 0.3500, 40.8800),
	("Dadaab", "Garissa", "Fafi", 0.0010, 40.3700),
	("Kalobeyei", "Turkana", "Turkana West", 3.8100, 34.7500),
	("Kalobeyei", "Turkana", "Lokichogio", 4.2050, 34.3500),
]


def seed_sub_counties():
	"""after_migrate: add missing default sub-counties and fill blank coordinates. Never overwrites edits."""
	regions = {(r.region_name or "").strip().lower(): r.name
		for r in frappe.get_all("Region", fields=["name", "region_name"])}
	for region_name, county, sub_county, lat, lng in DEFAULT_SUB_COUNTIES:
		region = regions.get(region_name.lower())
		if not region:
			print(f"Sub County {sub_county} skipped: no Region named {region_name}")
			continue
		name = frappe.db.exists(DOCTYPE, {"county": county, "sub_county_name": sub_county})
		if name:
			if not frappe.db.get_value(DOCTYPE, name, "latitude"):
				frappe.db.set_value(DOCTYPE, name, {"latitude": lat, "longitude": lng}, update_modified=False)
			continue
		frappe.get_doc({"doctype": DOCTYPE, "sub_county_name": sub_county, "county": county,
			"region": region, "is_active": 1, "latitude": lat, "longitude": lng}).insert(ignore_permissions=True)
	frappe.db.commit()


@frappe.whitelist()
def get_sub_counties(region=None):
	"""Active sub-counties for the report form, optionally only those of one region."""
	filters = {"is_active": 1}
	if region:
		filters["region"] = region
	return frappe.get_all(DOCTYPE, filters=filters,
		fields=["name", "sub_county_name", "county", "region"],
		order_by="county asc, sub_county_name asc")


def validate_case_report_location(doc):
	"""Called from CaseReport.validate: the sub-county must belong to the selected region."""
	if not doc.get("sub_county"):
		return
	region = frappe.db.get_value(DOCTYPE, doc.sub_county, "region")
	if doc.get("region") and region and region != doc.region:
		frappe.throw(_("The selected sub-county does not belong to the selected region."))
	if not doc.get("region"):
		doc.region = region
