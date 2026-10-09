"""Alert engine: weekly counts -> anomaly detection -> severity -> Risk Alert records.

Runs daily (hooks.scheduler_events) and on demand:
    bench --site <site> execute surveillance.alerts.run_detection

Severity = disease priority (Alert Threshold Config) x signal strength (engine):
                     normal for area   threshold reached   outbreak level
    Critical         critical          critical            critical
    High             high              high                critical
    Standard         low               medium              high
A single week with 10+ affected persons raises severity one level (cluster).
"Possible reporting surge" is shown as a label and never lowers severity.
"""
import frappe
import pandas as pd
from frappe import _
from frappe.utils import add_days, getdate, now_datetime, today

from surveillance.anomaly.engine import detect
from surveillance.capabilities import require_capability
from surveillance.weekly_counts import replace_source, week_start

DOCTYPE = "Risk Alert"
RECENT_WEEKS = 4
CLUSTER_AFFECTED = 10
LEVELS = ["low", "medium", "high", "critical"]
MATRIX = {
	"Critical": {"normal": "critical", "threshold": "critical", "outbreak": "critical"},
	"High": {"normal": "high", "threshold": "high", "outbreak": "critical"},
	"Standard": {"normal": "low", "threshold": "medium", "outbreak": "high"},
}
STATUSES = ["Pending", "Investigating", "Confirmed", "Resolved", "Rejected"]
RESPONSE = {
	"critical": "Verify within 24 hours and notify the county surveillance team.",
	"high": "Verify within 48 hours.",
	"medium": "Verify within 72 hours.",
	"low": "Review in the weekly surveillance meeting.",
}


# ---------- pure logic (no database) ----------

def signal_strength(row):
	if row["level"] == "outbreak":
		return "outbreak"
	if pd.notna(row["baseline_mean"]) and row["count"] <= row["baseline_mean"]:
		return "normal"
	return "threshold"


def severity_for(priority, strength, affected):
	sev = MATRIX.get(priority or "Standard", MATRIX["Standard"])[strength]
	if affected and affected >= CLUSTER_AFFECTED and sev != "critical":
		sev = LEVELS[LEVELS.index(sev) + 1]
	return sev


def build_alerts(weekly, diseases, multiplier, since):
	"""weekly: DataFrame source, disease, location, county, sub_county, week_start, signals, affected.
	diseases: {key: {"threshold": n, "priority": p, "name": s}}. Returns one dict per disease+location+week."""
	if weekly.empty:
		return []
	thresholds = {k: int(v["threshold"] or 1) for k, v in diseases.items()}
	found = []
	for source, part in weekly.groupby("source"):
		table = part.rename(columns={"disease": "disease_key", "signals": "count"})[
			["week_start", "disease_key", "location", "count"]]
		_, alerts = detect(table, thresholds, multiplier)
		if alerts.empty:
			continue
		alerts = alerts[alerts["week_start"] >= pd.Timestamp(since)].copy()
		alerts["source"] = source
		found.append(alerts)
	if not found:
		return []
	alerts = pd.concat(found, ignore_index=True)

	extra = weekly.assign(week_start=pd.to_datetime(weekly["week_start"])).groupby(
		["disease", "location", "week_start"]).agg(
		affected=("affected", "sum"), county=("county", "first"), sub_county=("sub_county", "first")).reset_index()

	out = []
	for (disease, location, week), g in alerts.groupby(["disease_key", "location", "week_start"]):
		meta = diseases.get(disease, {})
		e = extra[(extra.disease == disease) & (extra.location == location) & (extra.week_start == week)]
		affected = int(e["affected"].iloc[0]) if len(e) else 0
		affected = max(affected, int(g["count"].sum()))  # CBS often doesn't record numbers affected: at least 1 per signal
		strengths = [signal_strength(r) for _, r in g.iterrows()]
		strength = "outbreak" if "outbreak" in strengths else ("threshold" if "threshold" in strengths else "normal")
		rules = sorted({rule for r in g["rules"] for rule in str(r).split(",") if rule})
		out.append({
			"disease": disease,
			"disease_name": meta.get("name", disease),
			"location": location,
			"county": e["county"].iloc[0] if len(e) else "",
			"sub_county": e["sub_county"].iloc[0] if len(e) else "",
			"week_start": week.date(),
			"signals": int(g["count"].sum()),
			"affected": affected,
			"baseline_mean": float(g["baseline_mean"].max()) if g["baseline_mean"].notna().any() else None,
			"level": "outbreak" if strength == "outbreak" else "alert",
			"signal_strength": strength,
			"priority": meta.get("priority") or "Standard",
			"severity": severity_for(meta.get("priority"), strength, affected),
			"rules": ",".join(rules),
			"possible_reporting_surge": int(bool(g["possible_reporting_surge"].any())),
			"sources": ", ".join(sorted(g["source"].unique())),
			"explanation": " | ".join(f"{s}: {x}" for s, x in zip(g["source"], g["explanation"])),
		})
	return out


# ---------- database glue ----------

def rebuild_case_report_counts():
	"""Turn classified Case Reports into weekly counts (source = Case Report)."""
	subs = {s.name: s for s in frappe.get_all("Sub County", fields=["name", "county", "sub_county_name"])}
	rows = []
	for r in frappe.get_all("Case Report",
			filters={"suspected_disease": ["is", "set"], "sub_county": ["is", "set"]},
			fields=["suspected_disease", "sub_county", "onset_date", "report_date", "creation",
				"affected_count", "deaths_count"]):
		sc = subs.get(r.sub_county)
		if not sc:
			continue
		rows.append({
			"disease": r.suspected_disease,
			"county": sc.county,
			"sub_county": sc.sub_county_name,
			"week_start": r.onset_date or r.report_date or r.creation,
			"signals": 1,
			"affected": r.affected_count or 1,
			"deaths": r.deaths_count or 0,
		})
	return replace_source("Case Report", rows)


def _disease_meta():
	return {d.name: {"threshold": d.threshold, "priority": d.priority, "name": d.disease_name}
		for d in frappe.get_all("Alert Threshold Config", filters={"is_active": 1},
			fields=["name", "threshold", "priority", "disease_name"])}


def run_detection(weeks=RECENT_WEEKS):
	"""Daily job. Creates or updates Risk Alerts for the last `weeks` weeks."""
	weeks = int(weeks)
	rebuild_case_report_counts()
	weekly = pd.DataFrame([dict(r) for r in frappe.get_all("Weekly Count",
		fields=["source", "disease", "location", "county", "sub_county", "week_start", "signals", "affected"],
		limit_page_length=0)])
	since = add_days(week_start(today()), -7 * (weeks - 1))
	multiplier = float(frappe.db.get_single_value("Alert Threshold Settings", "outbreak_multiplier") or 2.5)
	found = build_alerts(weekly, _disease_meta(), multiplier, since)

	created = updated = 0
	for a in found:
		name = frappe.db.get_value(DOCTYPE, {"disease": a["disease"], "location": a["location"], "week_start": a["week_start"]})
		if name:
			doc = frappe.get_doc(DOCTYPE, name)
			doc.update({k: v for k, v in a.items()})
			doc.last_detected = now_datetime()
			doc.save(ignore_permissions=True)
			updated += 1
		else:
			frappe.get_doc({"doctype": DOCTYPE, **a, "status": "Pending",
				"first_detected": now_datetime(), "last_detected": now_datetime()}).insert(ignore_permissions=True)
			created += 1
	frappe.db.commit()
	print(f"Weekly counts read: {len(weekly)} | alerts since {since}: {len(found)} | created {created}, updated {updated}")
	return {"created": created, "updated": updated}


# ---------- API for the Alerts & Signals pages ----------

def _shape(d, notes=None, related=None):
	strength = {"outbreak": "outbreak level", "threshold": "threshold reached", "normal": "within usual level"}
	rules = (d.rules or "").replace(",", ", ")
	insights = [x.strip() for x in (d.explanation or "").split("|") if x.strip()]
	insights.append(f"Disease priority: {d.priority}. Signal: {strength.get(d.signal_strength, d.signal_strength)}. Severity: {d.severity}.")
	if d.possible_reporting_surge:
		insights.append("Possible reporting surge: several diseases rose together at this location. Verify before acting.")
	insights.append("Recommended action: " + RESPONSE.get(d.severity, ""))
	return {
		"id": d.name,
		"title": f"{d.disease_name}" + (" (outbreak level)" if d.level == "outbreak" else ""),
		"description": insights[0] if insights else "",
		"location": f"{d.sub_county} · {d.county}" if d.sub_county else d.location,
		"region": d.county or "",
		"severity": d.severity,
		"status": d.status,
		"affected": d.affected,
		"signals": d.signals,
		"aiScore": None,
		"rulesLabel": f"Rules: {rules}" if rules else "",
		"surge": bool(d.possible_reporting_surge),
		"date": getdate(d.week_start).strftime("%-d/%-m/%Y"),
		"reportedBy": d.sources,
		"tags": [r for r in (d.rules or "").split(",") if r],
		"insights": insights,
		"notes": notes or [],
		"relatedAlerts": related or [],
	}


@frappe.whitelist()
def get_alerts(limit=500):
	require_capability("view_alerts")
	rows = frappe.get_all(DOCTYPE, fields=["*"], order_by="week_start desc, modified desc", limit_page_length=int(limit))
	order = {s: i for i, s in enumerate(reversed(LEVELS))}
	rows.sort(key=lambda d: (d.status not in ("Pending", "Investigating"), order.get(d.severity, 9)))
	return [_shape(d) for d in rows]


@frappe.whitelist()
def get_alert_regions():
	require_capability("view_alerts")
	return sorted({c for c in frappe.get_all(DOCTYPE, pluck="county") if c})


@frappe.whitelist()
def get_alert(name):
	require_capability("view_alerts")
	doc = frappe.get_doc(DOCTYPE, name)
	notes = [{"text": n.note, "createdAt": str(n.created_at), "by": n.added_by} for n in doc.notes]
	related = [{"title": f"{r.disease_name} ({r.severity})", "subtitle": f"{r.signals} signal(s), week of {r.week_start}"}
		for r in frappe.get_all(DOCTYPE, filters={"location": doc.location, "name": ["!=", doc.name],
			"week_start": [">=", add_days(doc.week_start, -56)]},
			fields=["disease_name", "severity", "signals", "week_start"], order_by="week_start desc", limit_page_length=5)]
	return _shape(doc, notes, related)


@frappe.whitelist(methods=["POST"])
def update_alert_status(name, status):
	require_capability("investigate_alerts")
	if status not in STATUSES:
		frappe.throw(_("Unknown status: {0}").format(status))
	doc = frappe.get_doc(DOCTYPE, name)
	doc.status = status
	doc.save(ignore_permissions=True)
	return {"status": doc.status}


@frappe.whitelist(methods=["POST"])
def add_alert_note(name, note):
	require_capability("investigate_alerts")
	note = (note or "").strip()
	if not note:
		frappe.throw(_("Note is empty"))
	doc = frappe.get_doc(DOCTYPE, name)
	doc.append("notes", {"note": note, "added_by": frappe.session.user, "created_at": now_datetime()})
	doc.save(ignore_permissions=True)
	return {"text": note, "createdAt": str(now_datetime()), "by": frappe.session.user}

def _report_points(disease, county, sub_county, week):
	"""Average GPS of the case reports behind one alert (same disease, sub-county and week)."""
	sc = frappe.db.get_value("Sub County", {"county": county, "sub_county_name": sub_county})
	if not sc:
		return None
	pts = []
	for r in frappe.get_all("Case Report", filters={"suspected_disease": disease, "sub_county": sc},
			fields=["latitude", "longitude", "onset_date", "report_date", "creation"]):
		if r.latitude and r.longitude and week_start(r.onset_date or r.report_date or r.creation) == getdate(week):
			pts.append((r.latitude, r.longitude))
	if not pts:
		return None
	return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


@frappe.whitelist()
def get_map_data(weeks=8):
	"""Alerts placed at sub-county centre points, plus GPS-located case reports, for the Surveillance Map."""
	require_capability("view_alerts")
	since = add_days(week_start(today()), -7 * (int(weeks) - 1))
	coords = {(s.county, s.sub_county_name): (s.latitude, s.longitude)
		for s in frappe.get_all("Sub County", fields=["county", "sub_county_name", "latitude", "longitude"])
		if s.latitude and s.longitude}
	alerts, unmapped = [], 0
	for d in frappe.get_all(DOCTYPE, filters={"week_start": [">=", since]}, fields=["*"], order_by="week_start desc"):
		point = _report_points(d.disease, d.county, d.sub_county, d.week_start) or coords.get((d.county, d.sub_county))
		if not point:
			unmapped += 1
			continue
		a = _shape(d)
		a.update({"lat": point[0], "lng": point[1], "disease": d.disease})
		alerts.append(a)
	reports = [{"id": r.name, "lat": r.latitude, "lng": r.longitude, "disease": r.suspected_disease,
		"title": frappe.db.get_value("Alert Threshold Config", r.suspected_disease, "disease_name") if r.suspected_disease else "Unclassified report", "location": r.location_name or "",
		"affected": r.affected_count, "date": str(r.creation)[:10]}
		for r in frappe.get_all("Case Report",
			filters={"creation": [">=", add_days(today(), -30)], "latitude": ["!=", 0], "longitude": ["!=", 0]},
			fields=["name", "latitude", "longitude", "suspected_disease", "location_name", "affected_count", "creation"])
		if r.latitude and r.longitude]
	all_alerts = frappe.get_all(DOCTYPE, filters={"week_start": [">=", since]}, fields=["severity", "status"])
	return {
		"alerts": alerts,
		"reports": reports,
		"unmapped_alerts": unmapped,
		"stats": {
			"total": len(all_alerts),
			"critical": sum(1 for a in all_alerts if a.severity == "critical"),
			"investigating": sum(1 for a in all_alerts if a.status == "Investigating"),
			"resolved": sum(1 for a in all_alerts if a.status == "Resolved"),
		},
	}