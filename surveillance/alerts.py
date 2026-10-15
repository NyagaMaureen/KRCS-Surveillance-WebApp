"""Alert engine: weekly counts -> anomaly detection -> outbreak episodes -> Risk Alert records.

Runs daily (hooks.scheduler_events) and on demand:
    bench --site <site> execute surveillance.alerts.run_detection

One Risk Alert = one outbreak EPISODE of one disease at one location: consecutive flagged
weeks (gaps of up to EPISODE_GAP_WEEKS quiet weeks allowed) are one alert, updated every
day while it continues, with its start week, latest week, number of weeks, total cases and
peak. Only episodes still active in the last RECENT_WEEKS weeks are created or updated, so
the Alerts page shows current outbreaks, not history (use backtest() for history).

Severity = disease priority (Alert Threshold Config) x signal strength (engine):
                     normal for area   threshold reached   outbreak level
    Critical         critical          critical            critical
    High             high              high                critical
    Standard         low               medium              high
A single week with 10+ affected persons raises severity one level (cluster), for community
sources only (CBS, Case Report). Facility counts (IDSR, EMR) are totals, so 10+ is normal there.
An episode keeps the highest severity it has reached; severity never goes down automatically.
"Possible reporting surge" is shown as a label and never lowers severity.
"""
import frappe
import pandas as pd
import json
from frappe import _
from frappe.utils import add_days, getdate, now_datetime, today

from surveillance.anomaly.engine import detect
from surveillance.capabilities import require_capability
from surveillance.weekly_counts import replace_source, week_start

DOCTYPE = "Risk Alert"
RECENT_WEEKS = 4
EPISODE_GAP_WEEKS = 4          # up to 4 quiet weeks inside one outbreak; 5+ starts a new episode
CLUSTER_AFFECTED = 10
COMMUNITY_SOURCES = {"CBS", "Case Report"}   # cluster bump and zero-filling apply to these
FACILITY_SOURCES = {"IDSR", "EMR"}           # empty weeks = not reported, not zero
LEVELS = ["standard", "high", "critical"]
STRENGTHS = ["normal", "threshold", "outbreak"]
MATRIX = {
	"Critical": {"normal": "critical", "threshold": "critical", "outbreak": "critical"},
	"High": {"normal": "high", "threshold": "high", "outbreak": "critical"},
	"Standard": {"normal": "standard", "threshold": "standard", "outbreak": "high"},
}
STATUSES = ["Pending", "Investigating", "Confirmed", "Resolved", "Rejected"]
CLOSED = {"Resolved", "Rejected"}
RESPONSE = {
	"critical": "Verify within 24 hours and notify the county surveillance team.",
	"high": "Verify within 48 hours.",
	"standard": "Verify within 72 hours.",
}


# ---------- pure logic (no database) ----------

def signal_strength(row):
	if row["level"] == "outbreak":
		return "outbreak"
	if pd.notna(row["baseline_mean"]) and row["count"] <= row["baseline_mean"]:
		return "normal"
	return "threshold"


def severity_for(priority, strength, affected, community=True):
	sev = MATRIX.get(priority or "Standard", MATRIX["Standard"])[strength]
	if community and affected and affected >= CLUSTER_AFFECTED and sev != "critical":
		sev = LEVELS[LEVELS.index(sev) + 1]
	return sev


def build_weekly_alerts(weekly, diseases, multiplier):
	"""One dict per flagged disease + location + week, over the whole history.

	weekly: DataFrame source, disease, location, county, sub_county, week_start, signals, affected.
	diseases: {key: {"threshold": n, "priority": p, "name": s}}."""
	if weekly.empty:
		return []
	thresholds = {k: int(v["threshold"] or 1) for k, v in diseases.items()}
	found = []
	for source, part in weekly.groupby("source"):
		table = part.rename(columns={"disease": "disease_key", "signals": "count"})[
			["week_start", "disease_key", "location", "count"]]
		_, alerts = detect(table, thresholds, multiplier, gap_as_missing=source in FACILITY_SOURCES)
		if alerts.empty:
			continue
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
		signals = int(g["count"].sum())
		affected = max(int(e["affected"].iloc[0]) if len(e) else 0, signals)  # at least 1 per signal
		strengths = [signal_strength(r) for _, r in g.iterrows()]
		strength = max(strengths, key=STRENGTHS.index)
		community = bool(set(g["source"]) & COMMUNITY_SOURCES)
		out.append({
			"disease": disease,
			"disease_name": meta.get("name", disease),
			"location": location,
			"county": e["county"].iloc[0] if len(e) else "",
			"sub_county": e["sub_county"].iloc[0] if len(e) else "",
			"week_start": week.date(),
			"signals": signals,
			"affected": affected,
			"baseline_mean": float(g["baseline_mean"].max()) if g["baseline_mean"].notna().any() else None,
			"level": "outbreak" if strength == "outbreak" else "alert",
			"signal_strength": strength,
			"priority": meta.get("priority") or "Standard",
			"severity": severity_for(meta.get("priority"), strength, affected, community),
			"rules": ",".join(sorted({rule for r in g["rules"] for rule in str(r).split(",") if rule})),
			"possible_reporting_surge": int(bool(g["possible_reporting_surge"].any())),
			"sources": ", ".join(sorted(g["source"].unique())),
			"explanation": " | ".join(f"{s}: {x}" for s, x in zip(g["source"], g["explanation"])),
		})
	return out


def group_episodes(week_alerts, gap_weeks=EPISODE_GAP_WEEKS):
	"""Merge flagged weeks of the same disease + location into outbreak episodes."""
	episodes = []
	by_series = {}
	for a in sorted(week_alerts, key=lambda a: (a["disease"], a["location"], a["week_start"])):
		by_series.setdefault((a["disease"], a["location"]), []).append(a)

	for weeks in by_series.values():
		current = [weeks[0]]
		for a in weeks[1:]:
			if (a["week_start"] - current[-1]["week_start"]).days > 7 * (gap_weeks + 1):
				episodes.append(_episode(current))
				current = []
			current.append(a)
		episodes.append(_episode(current))
	return episodes


DATA_ERROR_TAG = "POSSIBLE DATA ENTRY ERROR"


def _with_data_check(text, weeks):
	"""Keep the data-error warning on the episode even if it was raised in an earlier week."""
	text = text or ""
	flagged = [a for a in weeks if DATA_ERROR_TAG in (a.get("explanation") or "")]
	if flagged and DATA_ERROR_TAG not in text:
		a = flagged[0]
		text += (f"; {DATA_ERROR_TAG} in week of {a['week_start']} ({a['signals']} cases); "
			"confirm the number with the facility before acting")
	return text

def _episode(weeks):
	first, last = weeks[0], weeks[-1]
	peak = max(weeks, key=lambda a: a["signals"])
	strength = max((a["signal_strength"] for a in weeks), key=STRENGTHS.index)
	return {
		**{k: last[k] for k in ("disease", "disease_name", "location", "county", "sub_county", "priority", "baseline_mean")},
		"week_start": first["week_start"],
		"last_week": last["week_start"],
		"weeks_flagged": len(weeks),
		"peak_signals": peak["signals"],
		"peak_week": peak["week_start"],
		"signals": sum(a["signals"] for a in weeks),
		"affected": sum(a["affected"] for a in weeks),
		"level": "outbreak" if strength == "outbreak" else "alert",
		"signal_strength": strength,
		"severity": max((a["severity"] for a in weeks), key=LEVELS.index),
		"rules": ",".join(sorted({r for a in weeks for r in a["rules"].split(",") if r})),
		"possible_reporting_surge": int(any(a["possible_reporting_surge"] for a in weeks)),
		"sources": ", ".join(sorted({s.strip() for a in weeks for s in a["sources"].split(",")})),
		"explanation": _with_data_check(last["explanation"], weeks),
	}


def build_alerts(weekly, diseases, multiplier, since):
	"""Outbreak episodes whose latest flagged week is on or after `since`."""
	since = getdate(since)
	episodes = group_episodes(build_weekly_alerts(weekly, diseases, multiplier))
	return [e for e in episodes if e["last_week"] >= since]


# ---------- database glue ----------

UNCLASSIFIED_KEY = "unclassified-illness"


def rebuild_case_report_counts():
	"""Turn Case Reports into weekly counts (source = Case Report).
	Reports with a suspected disease count under that disease. Reports without one count as
	"unclassified-illness" (unless an officer marked them "Not a disease of concern"), so a
	cluster of unexplained illness still raises an alert."""
	from surveillance.review import is_unclassified
	subs = {s.name: s for s in frappe.get_all("Sub County", fields=["name", "county", "sub_county_name"])}
	rows = []
	for r in frappe.get_all("Case Report", filters={"sub_county": ["is", "set"]},
			fields=["suspected_disease", "review_outcome", "sub_county", "onset_date", "report_date", "creation",
				"affected_count", "deaths_count"]):
		sc = subs.get(r.sub_county)
		if not sc:
			continue
		if r.suspected_disease:
			disease = r.suspected_disease
		elif is_unclassified(r):
			disease = UNCLASSIFIED_KEY
		else:
			continue
		rows.append({
			"disease": disease,
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


def _load_weekly(source=None):
	"""Weekly counts for the pilot sites only (Dadaab and Kalobeyei). All configured diseases are kept,
	so everyday diseases like malaria still alert when they rise above their usual level.
	Optional disease limit: bench --site <site> set-config alert_diseases '["measles", "malaria", ...]'"""
	from surveillance.events import _scope
	filters = {"source": source} if source else {}
	df = pd.DataFrame([dict(r) for r in frappe.get_all("Weekly Count", filters=filters,
		fields=["source", "disease", "location", "county", "sub_county", "week_start", "signals", "affected"],
		limit_page_length=0)])
	if df.empty:
		return df
	subs, _ = _scope()
	df = df[df["sub_county"].fillna("").str.strip().str.lower().isin(subs)]
	only = frappe.conf.get("alert_diseases")
	return df[df["disease"].isin(set(only))] if only else df


def _multiplier():
	return float(frappe.db.get_single_value("Alert Threshold Settings", "outbreak_multiplier") or 2.5)


def _save_episode(a):
	"""Create or update the Risk Alert for one episode. Returns 'created', 'updated' or 'skipped'."""
	existing = frappe.get_all(DOCTYPE,
		filters={"disease": a["disease"], "location": a["location"],
			"week_start": ["between", [add_days(a["week_start"], -7 * EPISODE_GAP_WEEKS), a["last_week"]]]},
		fields=["name", "status", "last_week", "severity"], order_by="week_start asc")
	open_alerts = [r for r in existing if r.status not in CLOSED]

	if open_alerts:
		doc = frappe.get_doc(DOCTYPE, open_alerts[0].name)
		old = doc.severity
		new = max([old if old in LEVELS else "standard", a["severity"]], key=LEVELS.index)
		doc.update({**a, "severity": new, "last_detected": now_datetime()})
		if old and new != old:
			doc.append("notes", {"note": f"Severity raised from {old} to {new} by the alert engine.",
				"added_by": "Administrator", "created_at": now_datetime()})
		doc.save(ignore_permissions=True)
		return "updated"

	# A closed alert already covers these weeks: don't reopen it
	if any(r.last_week and getdate(r.last_week) >= a["last_week"] for r in existing):
		return "skipped"

	frappe.get_doc({"doctype": DOCTYPE, **a, "status": "Pending",
		"first_detected": now_datetime(), "last_detected": now_datetime()}).insert(ignore_permissions=True)
	return "created"


def run_detection(weeks=RECENT_WEEKS):
	"""Daily job. Creates or updates one Risk Alert per outbreak still active in the last `weeks` weeks."""
	weeks = int(weeks)
	rebuild_case_report_counts()
	weekly = _load_weekly()
	since = add_days(week_start(today()), -7 * (weeks - 1))
	found = build_alerts(weekly, _disease_meta(), _multiplier(), since)

	counts = {"created": 0, "updated": 0, "skipped": 0}
	for a in found:
		counts[_save_episode(a)] += 1
	frappe.db.commit()
	print(f"Weekly counts read: {len(weekly)} | active outbreaks since {since}: {len(found)} | "
		f"created {counts['created']}, updated {counts['updated']}, skipped (closed) {counts['skipped']}")
	return counts


def rebuild_alerts(weeks=RECENT_WEEKS):
	"""One-off after upgrading to episodes: delete untouched alerts (Pending, no notes) and run detection again.
	Alerts someone has worked on (other status or notes) are kept.

	bench --site <site> execute surveillance.alerts.rebuild_alerts
	"""
	removed = 0
	for name in frappe.get_all(DOCTYPE, filters={"status": "Pending"}, pluck="name"):
		doc = frappe.get_doc(DOCTYPE, name)
		if not doc.notes:
			frappe.delete_doc(DOCTYPE, name, ignore_permissions=True, force=True)
			removed += 1
	frappe.db.commit()
	print(f"Removed {removed} untouched alerts")
	return run_detection(weeks)


def backtest(source="IDSR", path=None):
	"""Run the engine over the whole history of one source WITHOUT saving Risk Alerts.
	Writes one CSV row per outbreak episode.

	bench --site <site> execute surveillance.alerts.backtest --kwargs "{'source': 'IDSR'}"
	"""
	weekly = _load_weekly(source)
	if weekly.empty:
		print(f"No Weekly Count rows for source {source}")
		return
	weekly_alerts = build_weekly_alerts(weekly, _disease_meta(), _multiplier())
	episodes = pd.DataFrame(group_episodes(weekly_alerts))
	path = path or frappe.get_site_path("private", "files", f"backtest_{source.lower()}.csv")
	cols = ["disease", "disease_name", "location", "week_start", "last_week", "weeks_flagged", "peak_week",
		"peak_signals", "signals", "severity", "level", "rules", "possible_reporting_surge", "explanation"]
	episodes.sort_values(["week_start", "disease"])[cols].to_csv(path, index=False)
	print(f"Flagged weeks: {len(weekly_alerts)} -> outbreak episodes (alerts): {len(episodes)}  (written to {path})")
	print(episodes.groupby(["location", "disease", "severity"]).size().unstack(fill_value=0).to_string())
	return len(episodes)


# ---------- API for the Alerts & Signals pages ----------

def _fmt(d):
	return getdate(d).strftime("%-d/%-m/%Y") if d else ""


def _shape(d, notes=None, related=None):
	strength = {"outbreak": "outbreak level", "threshold": "threshold reached", "normal": "within usual level"}
	rules = (d.rules or "").replace(",", ", ")
	last = d.get("last_week") or d.week_start
	ongoing = getdate(last) >= add_days(week_start(today()), -7 * RECENT_WEEKS)
	weeks = d.get("weeks_flagged") or 1

	insights = []
	if weeks > 1:
		insights.append(f"{'Ongoing' if ongoing else 'Ended'}: flagged in {weeks} week(s) from {_fmt(d.week_start)} "
			f"to {_fmt(last)}; {d.signals} case(s) in total, peak {d.get('peak_signals') or d.signals} in week of {_fmt(d.get('peak_week') or last)}.")
	insights += [x.strip() for x in (d.explanation or "").split("|") if x.strip()]
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
		"date": _fmt(last),
		"startDate": _fmt(d.week_start),
		"weeks": weeks,
		"ongoing": ongoing,
		"lastWeek": str(getdate(last)),          # ISO date for sorting/filtering
		"startWeek": str(getdate(d.week_start)),
		"disease": d.disease,
		"peak": d.get("peak_signals") or d.signals,
		"sources": [s.strip() for s in (d.sources or "").split(",") if s.strip()],
		"reportedBy": d.sources,
		"tags": [r for r in (d.rules or "").split(",") if r],
		"insights": insights,
		"notes": notes or [],
		"relatedAlerts": related or [],
	}
def _trend(doc, before_weeks=8):
	"""Weekly counts for this disease and place, from 8 weeks before the outbreak to its latest week, per source."""
	start = add_days(doc.week_start, -7 * before_weeks)
	end = getdate(doc.last_week or doc.week_start)
	rows = frappe.get_all("Weekly Count", filters={"disease": doc.disease, "location": doc.location,
		"week_start": ["between", [start, end]]}, fields=["week_start", "source", "signals"], limit_page_length=0)
	weeks = {}
	w = getdate(start)
	while w <= end:
		weeks[str(w)] = {"week": str(w), "total": 0, "CBS": 0, "Case Report": 0, "IDSR": 0, "EMR": 0}
		w = add_days(w, 7)
	for r in rows:
		wk = weeks.get(str(getdate(r.week_start)))
		if wk:
			wk[r.source] = wk.get(r.source, 0) + r.signals
			wk["total"] += r.signals
	return list(weeks.values())


def _timeline(doc):
	"""Real history: when the engine raised it, every status or severity change, and the latest engine update."""
	events = [{"label": "Alert raised by the alert engine", "by": "Alert engine",
		"at": str(doc.first_detected or doc.creation)}]
	for v in frappe.get_all("Version", filters={"ref_doctype": DOCTYPE, "docname": doc.name},
			fields=["data", "owner", "creation"], order_by="creation asc"):
		changed = (json.loads(v.data or "{}") or {}).get("changed", [])
		who = "Alert engine" if v.owner == "Administrator" else frappe.utils.get_fullname(v.owner)
		for field, old, new in changed:
			if field == "status":
				events.append({"label": f"Status changed: {old} → {new}", "by": who, "at": str(v.creation)})
			elif field == "severity":
				events.append({"label": f"Severity changed: {old} → {new}", "by": who, "at": str(v.creation)})
	if doc.last_detected:
		events.append({"label": "Latest check by the alert engine", "by": "Alert engine", "at": str(doc.last_detected)})
	return events

@frappe.whitelist()
def get_alerts(limit=500):
	require_capability("view_alerts")
	rows = frappe.get_all(DOCTYPE, fields=["*"], order_by="last_week desc, modified desc", limit_page_length=int(limit))
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
	notes = [{"text": n.note, "createdAt": str(n.created_at),
		"by": "Alert engine" if n.added_by == "Administrator" else frappe.utils.get_fullname(n.added_by)} for n in doc.notes]
	related = [{"id": r.name, "severity": r.severity, "title": f"{r.disease_name} ({r.severity})",
		"subtitle": f"{r.signals} case(s), week of {r.last_week or r.week_start}"}
		for r in frappe.get_all(DOCTYPE, filters={"location": doc.location, "name": ["!=", doc.name],
			"last_week": [">=", add_days(doc.last_week or doc.week_start, -56)]},
			fields=["name", "disease_name", "severity", "signals", "week_start", "last_week"], order_by="last_week desc", limit_page_length=5)]
	shaped = _shape(doc, notes, related)
	shaped.update({"trend": _trend(doc), "timeline": _timeline(doc),
		"firstDetected": str(doc.first_detected or ""), "lastDetected": str(doc.last_detected or "")})
	return shaped


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


def _report_points(disease, county, sub_county, first_week, last_week):
	"""Average GPS of the case reports behind one alert (same disease and sub-county, within the episode)."""
	sc = frappe.db.get_value("Sub County", {"county": county, "sub_county_name": sub_county})
	if not sc:
		return None
	start, end = getdate(first_week), getdate(last_week or first_week)
	pts = []
	for r in frappe.get_all("Case Report", filters={"suspected_disease": disease, "sub_county": sc},
			fields=["latitude", "longitude", "onset_date", "report_date", "creation"]):
		if r.latitude and r.longitude and start <= week_start(r.onset_date or r.report_date or r.creation) <= end:
			pts.append((r.latitude, r.longitude))
	if not pts:
		return None
	return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


@frappe.whitelist()
def get_map_data(weeks=8):
	"""Active outbreaks placed at the GPS of their reports or the sub-county centre. Alerts only, no individual reports."""
	require_capability("view_alerts")
	since = add_days(week_start(today()), -7 * (int(weeks) - 1))
	coords = {(s.county, s.sub_county_name): (s.latitude, s.longitude)
		for s in frappe.get_all("Sub County", fields=["county", "sub_county_name", "latitude", "longitude"])
		if s.latitude and s.longitude}
	recent = frappe.get_all(DOCTYPE, filters={"last_week": [">=", since]}, fields=["*"], order_by="last_week desc")
	alerts, unmapped = [], 0
	for d in recent:
		point = _report_points(d.disease, d.county, d.sub_county, d.week_start, d.last_week) or coords.get((d.county, d.sub_county))
		if not point:
			unmapped += 1
			continue
		a = _shape(d)
		a.update({"lat": point[0], "lng": point[1], "disease": d.disease})
		alerts.append(a)
	return {
		"alerts": alerts,
		"reports": [],  # the map shows outbreak alerts only
		"unmapped_alerts": unmapped,
		"stats": {
			"total": len(recent),
			"critical": sum(1 for a in recent if a.severity == "critical"),
			"investigating": sum(1 for a in recent if a.status == "Investigating"),
			"resolved": sum(1 for a in recent if a.status == "Resolved"),
		},
	}