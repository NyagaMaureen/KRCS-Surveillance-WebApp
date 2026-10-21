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
def get_audit_logs(limit=1000, days=None):
    """One audit trail for the whole system, newest first.

    Sources:
      - created / updated records (Frappe Version log) for reports, users, configuration,
        response protocols, escalation contacts and Epi Trends alerts
      - every action on an Alerts & Signals event (its own timeline: checks, answers, steps, evidence,
        decisions, escalations, closures, splits, notes), category "Investigation"
      - Epi Trends notes (investigation opened, reviewed, reopened, status changes), category "Alert"
      - logins and logouts
    days: only entries from the last N days (optional).
    """
    require_capability("view_audit_log")

    limit = min(int(limit or 1000), 5000)
    since = frappe.utils.add_days(frappe.utils.now_datetime(), -int(days)) if days else None
    results = []

    CATEGORY_MAP = {
        "Case Report": "Report",
        "User": "User",
        "Surveillance Role": "User",
        "Symptom": "Config",
        "Region": "Config",
        "Response Protocol": "Config",
        "Escalation Contact": "Config",
        "Alert Threshold Config": "Config",
        "Risk Alert": "Alert",
    }
    CREATED_LABEL = {"Risk Alert": "Alert raised"}

    # DocTypes whose IDs are random hashes: show a readable name instead
    TITLE_FIELDS = {"Symptom": "symptom_name", "Region": "region_name", "User": "full_name",
        "Response Protocol": "title", "Escalation Contact": "contact_name", "Risk Alert": "disease_name"}
    title_cache = {}

    def display_name(doctype, name, title=None):
        field = TITLE_FIELDS.get(doctype)
        if not field:
            return name
        key = (doctype, name)
        if key not in title_cache:
            title_cache[key] = title if title is not None else frappe.db.get_value(doctype, name, field)
        label = title_cache[key]
        return f"{label} ({name})" if label and doctype == "Risk Alert" else (label or name)

    role_cache = {}

    def user_role(user):
        if user not in role_cache:
            role_cache[user] = frappe.db.get_value("User", user, "primary_role") or ("System" if user == "Administrator" else "—")
        return role_cache[user]

    labels_cache = {}

    def field_label(doctype, fieldname):
        if doctype not in labels_cache:
            labels_cache[doctype] = {df.fieldname: df.label for df in frappe.get_meta(doctype).fields}
        return labels_cache[doctype].get(fieldname) or fieldname

    def short(value):
        text = "" if value is None else str(value)
        return text if len(text) <= 200 else text[:200] + "…"

    def since_filter(field="creation"):
        return {field: [">=", since]} if since else {}

    # Created records
    for doctype, category in CATEGORY_MAP.items():
        if not frappe.db.table_exists(doctype):
            continue
        title_field = TITLE_FIELDS.get(doctype)
        fields = ["name", "owner", "creation"] + ([title_field] if title_field else [])
        records = frappe.get_all(doctype, filters=since_filter(), fields=fields, limit_page_length=limit, order_by="creation desc")
        for r in records:
            title = r.get(title_field) if title_field else None
            action = CREATED_LABEL.get(doctype, "Created")
            results.append({
                "name": f"create-{doctype}-{r.name}",
                "timestamp": r.creation,
                "category": category,
                "action": action,
                "user": r.owner,
                "role": user_role(r.owner),
                "details": f"{'Alert engine raised' if doctype == 'Risk Alert' else 'Created'} {doctype} {display_name(doctype, r.name, title)}",
            })

    # Updates (Frappe Version log; needs Track Changes on the DocType)
    versions = frappe.get_all(
        "Version",
        filters={"ref_doctype": ["in", list(CATEGORY_MAP.keys())], **since_filter()},
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
        if not names:
            continue   # child-table-only saves (e.g. notes) are covered by the entries below
        summary = ", ".join(names[:3]) + (f" and {len(names) - 3} more" if len(names) > 3 else "")
        status = next((c for c in changes if c["field"] in ("Status",)), None)
        action = f"Status: {status['from']} → {status['to']}" if status and len(changes) == 1 else "Updated"
        results.append({
            "name": v.name,
            "timestamp": v.creation,
            "category": category,
            "action": action,
            "user": v.owner,
            "role": user_role(v.owner),
            "details": f"Changed {summary} on {v.ref_doctype} {label}",
            "changes": changes,
        })

    # Alerts & Signals: every action on every event (the investigation's own timeline)
    if frappe.db.table_exists("Surveillance Event Action"):
        cond = "and a.`at` >= %(since)s" if since else ""
        actions = frappe.db.sql(f"""
            select a.name, a.parent, a.`at`, a.`user`, a.action, a.note, e.title
            from `tabSurveillance Event Action` a
            left join `tabSurveillance Event` e on e.name = a.parent
            where a.parenttype = 'Surveillance Event' {cond}
            order by a.`at` desc limit %(limit)s
        """, {"since": since, "limit": limit}, as_dict=True)
        for a in actions:
            user = a.user or "Administrator"
            results.append({
                "name": f"event-{a.name}",
                "timestamp": a.at,
                "category": "Investigation",
                "action": a.action or "Updated",
                "user": user,
                "role": user_role(user),
                "details": f"{a.parent}" + (f" · {a.title}" if a.title else "") + (f": {short(a.note)}" if a.note else ""),
                "link": f"/alerts-signals/{a.parent}",
            })

    # Epi Trends notes (investigation opened, reviewed, reopened, status changes, officer notes)
    if frappe.db.table_exists("Risk Alert Note"):
        cond = "and n.created_at >= %(since)s" if since else ""
        notes = frappe.db.sql(f"""
            select n.name, n.parent, n.created_at, n.added_by, n.note, r.disease_name, r.sub_county
            from `tabRisk Alert Note` n
            left join `tabRisk Alert` r on r.name = n.parent
            where n.parenttype = 'Risk Alert' {cond}
            order by n.created_at desc limit %(limit)s
        """, {"since": since, "limit": limit}, as_dict=True)
        for n in notes:
            user = n.added_by or "Administrator"
            text = n.note or ""
            action = ("Investigation opened" if text.startswith("Investigation opened")
                else "Reviewed" if text.startswith("Reviewed") else "Reopened" if text.startswith("Reopened")
                else "Status changed" if text.startswith("Status ") else "Note")
            results.append({
                "name": f"alertnote-{n.name}",
                "timestamp": n.created_at,
                "category": "Alert",
                "action": action,
                "user": user,
                "role": user_role(user),
                "details": f"{n.parent} · {n.disease_name or ''}{', ' + n.sub_county if n.sub_county else ''}: {short(text)}",
                "link": f"/epi-trends/{n.parent}",
            })

    # Logins and logouts
    logins = frappe.get_all(
        "Activity Log",
        filters={"operation": ["in", ["Login", "Logout"]], **since_filter()},
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

    results = [r for r in results if r["timestamp"]]
    results.sort(key=lambda r: frappe.utils.get_datetime(r["timestamp"]), reverse=True)
    return results[:limit]


@frappe.whitelist()
def get_my_profile():
    user_doc = frappe.get_doc("User", frappe.session.user)
    region = user_doc.get("assigned_region") or ""
    sub_county = user_doc.get("assigned_sub_county") or ""
    return {
        "name": user_doc.name,
        "full_name": user_doc.full_name,
        "phone_number": user_doc.mobile_no or "",
        "assigned_region": region,
        "region_name": frappe.db.get_value("Region", region, "region_name") if region else "",
        "assigned_sub_county": sub_county,
        "sub_county_name": frappe.db.get_value("Sub County", sub_county, "sub_county_name") if sub_county else "",
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


@frappe.whitelist()
def get_source_stats(days=30):
    """Weekly Count sources that are loaded in batches (CBS, IDSR), for the Reporting Channels page.
    Counts weeks starting within the last `days` days; split into pilot sub-counties vs all areas."""
    require_capability("view_reports")
    from frappe.utils import add_days, getdate, nowdate
    days = int(days)
    since = add_days(getdate(nowdate()), -days)

    pilot = {((s.county or "").strip().lower(), (s.sub_county_name or "").strip().lower())
             for s in frappe.get_all("Sub County", filters={"is_active": 1}, fields=["county", "sub_county_name"])}

    out = []
    for source in ("CBS", "IDSR"):
        rows = frappe.db.sql("""
            select county, sub_county, sum(signals) as signals
            from `tabWeekly Count`
            where source = %s and week_start >= %s
            group by county, sub_county
        """, (source, since), as_dict=True)
        total = sum(int(r.signals or 0) for r in rows)
        in_pilot = sum(int(r.signals or 0) for r in rows
                       if ((r.county or "").strip().lower(), (r.sub_county or "").strip().lower()) in pilot)
        span = frappe.db.sql("""
            select min(week_start) as first_week, max(week_start) as last_week,
                   count(distinct week_start) as weeks, max(modified) as last_updated
            from `tabWeekly Count` where source = %s
        """, (source,), as_dict=True)[0]
        out.append({
            "source": source,
            "signals": total,
            "pilot_signals": in_pilot,
            "first_week": str(span.first_week) if span.first_week else None,
            "last_week": str(span.last_week) if span.last_week else None,
            "weeks_loaded": int(span.weeks or 0),
            "last_updated": str(span.last_updated) if span.last_updated else None,
        })
    return {"sources": out, "days": days}