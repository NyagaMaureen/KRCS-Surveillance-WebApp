import frappe
import json

from surveillance.capabilities import require_capability


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
    require_capability("view_audit_log")

    limit = int(limit)
    results = []

    CATEGORY_MAP = {
        "Case Report": "Report",
        "User": "User",
        "Surveillance Role": "User",
        "Symptom": "Config",
        "Region": "Config",
    }

    # DocTypes whose IDs are random hashes: show a readable name instead
    TITLE_FIELDS = {"Symptom": "symptom_name", "Region": "region_name", "User": "full_name"}
    title_cache = {}

    def display_name(doctype, name, title=None):
        field = TITLE_FIELDS.get(doctype)
        if not field:
            return name
        key = (doctype, name)
        if key not in title_cache:
            title_cache[key] = title if title is not None else frappe.db.get_value(doctype, name, field)
        return title_cache[key] or name

    role_cache = {}

    def user_role(user):
        if user not in role_cache:
            role_cache[user] = frappe.db.get_value("User", user, "primary_role") or "—"
        return role_cache[user]

    labels_cache = {}

    def field_label(doctype, fieldname):
        if doctype not in labels_cache:
            labels_cache[doctype] = {df.fieldname: df.label for df in frappe.get_meta(doctype).fields}
        return labels_cache[doctype].get(fieldname) or fieldname

    def short(value):
        text = "" if value is None else str(value)
        return text if len(text) <= 200 else text[:200] + "…"

    # Created records
    for doctype, category in CATEGORY_MAP.items():
        title_field = TITLE_FIELDS.get(doctype)
        fields = ["name", "owner", "creation"] + ([title_field] if title_field else [])
        records = frappe.get_all(doctype, fields=fields, limit_page_length=limit, order_by="creation desc")
        for r in records:
            title = r.get(title_field) if title_field else None
            results.append({
                "name": f"create-{doctype}-{r.name}",
                "timestamp": r.creation,
                "category": category,
                "action": "Created",
                "user": r.owner,
                "role": user_role(r.owner),
                "details": f"Created {doctype} {display_name(doctype, r.name, title)}",
            })

    # Updates (Frappe Version log; needs Track Changes on the DocType)
    versions = frappe.get_all(
        "Version",
        filters={"ref_doctype": ["in", list(CATEGORY_MAP.keys())]},
        fields=["name", "ref_doctype", "docname", "owner", "creation", "data"],
        order_by="creation desc",
        limit_page_length=limit,
    )
    for v in versions:
        category = CATEGORY_MAP.get(v.ref_doctype, "Config")
        label = display_name(v.ref_doctype, v.docname)
        changes = []
        try:
            data = json.loads(v.data) if v.data else {}
            changes = [
                {"field": field_label(v.ref_doctype, c[0]), "from": short(c[1]), "to": short(c[2])}
                for c in data.get("changed", [])
            ]
        except Exception:
            pass
        names = [c["field"] for c in changes]
        if names:
            summary = ", ".join(names[:3]) + (f" and {len(names) - 3} more" if len(names) > 3 else "")
            details = f"Changed {summary} on {v.ref_doctype} {label}"
        else:
            details = f"{v.ref_doctype} {label} was updated"
        results.append({
            "name": v.name,
            "timestamp": v.creation,
            "category": category,
            "action": "Updated",
            "user": v.owner,
            "role": user_role(v.owner),
            "details": details,
            "changes": changes,
        })

    # Logins and logouts
    logins = frappe.get_all(
        "Activity Log",
        filters={"operation": ["in", ["Login", "Logout"]]},
        fields=["name", "user", "operation", "creation", "status"],
        order_by="creation desc",
        limit_page_length=limit,
    )
    for l in logins:
        results.append({
            "name": l.name,
            "timestamp": l.creation,
            "category": "Auth",
            "action": l.operation,
            "user": l.user,
            "role": user_role(l.user),
            "details": f"{l.operation} - {l.status}",
        })

    results.sort(key=lambda r: r["timestamp"], reverse=True)
    return results[:limit]


@frappe.whitelist()
def get_my_profile():
    user_doc = frappe.get_doc("User", frappe.session.user)
    return {
        "name": user_doc.name,
        "full_name": user_doc.full_name,
        "phone_number": user_doc.mobile_no or "",
        "assigned_region": user_doc.get("assigned_region") or "",
    }

@frappe.whitelist()
def get_channel_stats(days=30):
    """Reports per channel: last `days` days, today, last 7 days, and last report time."""
    require_capability("view_reports")
    days = int(days)
    rows = frappe.db.sql("""
        select ifnull(channel, '') as channel,
               count(*) as total,
               sum(date(creation) = curdate()) as today,
               sum(creation >= now() - interval 7 day) as last7,
               max(creation) as last_report
        from `tabCase Report`
        where creation >= now() - interval %s day
        group by channel
    """, (days,), as_dict=True)
    grand = sum(r.total for r in rows) or 1
    return {
        "days": days,
        "total": sum(r.total for r in rows),
        "channels": [{
            "channel": r.channel or "Unknown",
            "total": int(r.total),
            "today": int(r.today or 0),
            "last7": int(r.last7 or 0),
            "share": round(100 * r.total / grand, 1),
            "last_report": str(r.last_report) if r.last_report else None,
        } for r in rows],
    }