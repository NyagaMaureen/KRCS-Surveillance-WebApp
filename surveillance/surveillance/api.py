import frappe
import json

@frappe.whitelist()
def get_reference_labels():
    regions = frappe.get_all("Region", fields=["name", "region_name"])
    symptoms = frappe.get_all("Symptom", fields=["name", "symptom_name"])

    return {
        "regions": {r.name: r.region_name for r in regions},
        "symptoms": {s.name: s.symptom_name for s in symptoms},
    }

    

@frappe.whitelist()
def get_audit_logs(limit=500):
    is_authorized = frappe.db.exists("Has Role", {
        "parent": frappe.session.user,
        "role": ["in", ["System Manager", "HQ Admin"]],
        "parenttype": "User"
    })
    if not is_authorized:
        frappe.throw("Not permitted", frappe.PermissionError)

    limit = int(limit)
    results = []

    CATEGORY_MAP = {
        "Case Report": "Report",
        "User": "User",
        "Surveillance Role": "User",
        "Symptom": "Config",
        "Region": "Config",
    }

    versions = frappe.get_all(
        "Version",
        filters={"ref_doctype": ["in", list(CATEGORY_MAP.keys())]},
        fields=["name", "ref_doctype", "docname", "owner", "creation", "data"],
        order_by="creation desc",
        limit_page_length=limit,
    )

    for v in versions:
        category = CATEGORY_MAP.get(v.ref_doctype, "Config")
        user_role = frappe.db.get_value("User", v.owner, "primary_role") or "—"
        action = "Updated"
        details = f"{v.ref_doctype} {v.docname} was updated"
        try:
            data = json.loads(v.data) if v.data else {}
            if data.get("creation"):
                action = "Created"
                details = f"Created {v.ref_doctype} {v.docname}"
            elif data.get("changed"):
                fields_changed = ", ".join([c[0] for c in data["changed"][:3]])
                details = f"Changed {fields_changed} on {v.ref_doctype} {v.docname}"
        except Exception:
            pass

        results.append({
            "name": v.name, "timestamp": v.creation, "category": category,
            "action": action, "user": v.owner, "role": user_role, "details": details,
        })

    logins = frappe.get_all(
        "Activity Log",
        filters={"operation": ["in", ["Login", "Logout"]]},
        fields=["name", "user", "operation", "creation", "status"],
        order_by="creation desc",
        limit_page_length=limit,
    )
    for l in logins:
        user_role = frappe.db.get_value("User", l.user, "primary_role") or "—"
        results.append({
            "name": l.name, "timestamp": l.creation, "category": "Auth",
            "action": l.operation, "user": l.user, "role": user_role,
            "details": f"{l.operation} - {l.status}",
        })

    results.sort(key=lambda r: r["timestamp"], reverse=True)
    return results[:limit]