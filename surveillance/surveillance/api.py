import frappe
import json

from surveillance.capabilities import has_capability, require_capability


@frappe.whitelist()
def get_reference_labels():
    regions = frappe.get_all("Region", fields=["name", "region_name"])
    symptoms = frappe.get_all("Symptom", fields=["name", "symptom_name"])

    return {
        "regions": {r.name: r.region_name for r in regions},
        "symptoms": {s.name: s.symptom_name for s in symptoms},
    }


@frappe.whitelist()
def get_audit_logs(limit=1000, days=None, include_logins=0):
    """One audit trail for the whole system: see surveillance/audit_log.py."""
    from surveillance.audit_log import get_audit_logs as build
    return build(limit=limit, days=days, include_logins=include_logins)


@frappe.whitelist()
def get_my_profile():
    from surveillance.locations import is_field_staff
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
        # CHPs and FHWs always report for their assigned area (server enforces it in locations.lock_to_assigned_area)
        "location_locked": is_field_staff(),
    }

@frappe.whitelist()
def get_channel_stats(days=30):
    """Reports per channel: last `days` days, today, last 7 days, and last report time."""
    if not has_capability("view_reporting_channels"):   # the Reporting Channels page permission
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
    if not has_capability("view_reporting_channels"):
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