import frappe

@frappe.whitelist()
def get_reference_labels():
    regions = frappe.get_all("Region", fields=["name", "region_name"])
    symptoms = frappe.get_all("Symptom", fields=["name", "symptom_name"])

    return {
        "regions": {r.name: r.region_name for r in regions},
        "symptoms": {s.name: s.symptom_name for s in symptoms},
    }