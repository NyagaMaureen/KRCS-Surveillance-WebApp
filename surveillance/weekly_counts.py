"""Weekly Count: the standard weekly table every data source is converted into.

One row = one source, one disease, one sub-county, one week (weeks start on Monday).
The anomaly engine reads only this table, so adding a source (EMR, IDSR) never changes the engine.
Rows are aggregates only: no names, phone numbers or other personal data.

Sources
    CBS          community-based surveillance signals (load_cbs_history)
    Case Report  reports submitted in this app (alerts.rebuild_case_report_counts)
    IDSR         MOH 505 weekly facility exports from KHIS (load_moh505)
    EMR          facility records (later)
"""
import csv
import glob
import hashlib
import os
import re

import frappe
from frappe.utils import add_days, getdate, now

from surveillance.anomaly.diseases import to_key

DOCTYPE = "Weekly Count"
SOURCES = ("CBS", "Case Report", "EMR", "IDSR")
FIELDS = ["name", "creation", "modified", "owner", "modified_by", "docstatus",
	"source", "disease", "county", "sub_county", "location", "week_start", "signals", "affected", "deaths"]


def week_start(date):
	"""Monday of the week containing date."""
	d = getdate(date)
	return add_days(d, -d.weekday())


def location_label(county, sub_county):
	county = (county or "").strip() or "(county unknown)"
	sub_county = (sub_county or "").strip() or "(sub-county unknown)"
	return f"{county} / {sub_county}"


def row_name(source, disease, location, week):
	return hashlib.sha1(f"{source}|{disease}|{location}|{week}".encode()).hexdigest()[:20]


def replace_source(source, rows):
	"""Replace every Weekly Count row of one source with freshly aggregated rows.

	rows: iterable of dicts with disease, county, sub_county, week_start, signals, affected, deaths.
	Rows for the same disease, location and week are summed. Returns the number of rows saved.
	"""
	if source not in SOURCES:
		frappe.throw(f"Unknown source: {source}")

	totals = {}
	for r in rows:
		loc = location_label(r.get("county"), r.get("sub_county"))
		week = week_start(r["week_start"])
		key = (r["disease"], loc, week)
		t = totals.setdefault(key, {"county": (r.get("county") or "").strip(),
			"sub_county": (r.get("sub_county") or "").strip(), "signals": 0, "affected": 0, "deaths": 0})
		for f in ("signals", "affected", "deaths"):
			t[f] += int(r.get(f) or 0)

	ts, user = now(), frappe.session.user
	values = [
		(row_name(source, disease, loc, week), ts, ts, user, user, 0,
		 source, disease, t["county"], t["sub_county"], loc, week, t["signals"], t["affected"], t["deaths"])
		for (disease, loc, week), t in totals.items()
	]

	frappe.db.delete(DOCTYPE, {"source": source})
	if values:
		frappe.db.bulk_insert(DOCTYPE, FIELDS, values, chunk_size=2000)
	frappe.db.commit()
	return len(values)


# ---------- CBS (community) ----------

def load_cbs_history(path):
	"""One-off (safe to re-run): load cbs_weekly_counts.csv produced by the CBS pipeline.

	bench --site <site> execute surveillance.weekly_counts.load_cbs_history --kwargs '{"path": "/full/path/cbs_weekly_counts.csv"}'
	"""
	known = set(frappe.get_all("Alert Threshold Config", pluck="name"))
	rows, unmapped, read = [], {}, 0
	with open(path, newline="", encoding="utf-8") as f:
		for r in csv.DictReader(f):
			read += 1
			key = to_key(r.get("disease"))
			if key not in known:
				unmapped[r.get("disease")] = unmapped.get(r.get("disease"), 0) + 1
				continue
			rows.append({
				"disease": key,
				"county": r.get("county"),
				"sub_county": r.get("sub_county"),
				"week_start": r["week_start"],
				"signals": r.get("signals") or 0,
				"affected": r.get("cases") or 0,
				"deaths": 0,
			})

	saved = replace_source("CBS", rows)
	weeks = sorted({str(week_start(r["week_start"])) for r in rows})
	print(f"CSV rows read      : {read}")
	print(f"Weekly Count rows  : {saved} (source CBS)")
	if weeks:
		print(f"Weeks covered      : {weeks[0]} to {weeks[-1]}")
	if unmapped:
		print("Skipped (no matching disease):")
		for name, n in sorted(unmapped.items(), key=lambda x: -x[1]):
			print(f"  {n:5}  {name}")
	return saved


# ---------- MOH 505 (weekly IDSR) exports from KHIS ----------

# Organisation unit name in the export -> (county, sub-county in our Sub County list).
# One line per facility. A facility mapped to None is skipped (listed in the output) until its
# location is confirmed. Add a line here when KRCS sends files for a new facility.
UNIT_LOCATIONS = [
	# DRO (Dadaab)
	(r"\bifo\b", "Garissa", "Dadaab"),
	(r"abaqalaan", "Garissa", "Dadaab"),   
	(r"balaambal", "Garissa", "Dadaab"),   
	(r"darkenley", "Garissa", "Dadaab"),   
	(r"wadajir", "Garissa", "Dadaab"),     
	# KRO (Kalobeyei)
	(r"naregae", "Turkana", "Turkana West"),
	(r"natukobenyo", "Turkana", "Turkana West"),
]
MOH505_COLUMN = re.compile(r"^(?:MOH[ _]505[^_]*_)?(?:IDSR )?(?P<name>.+?)\s*(?P<age>[<>]5 yrs)?,\s*(?P<kind>Cases|Deaths)$", re.I)
MOH505_WEEK = re.compile(r"Week \d+ (\d{4}-\d{2}-\d{2})")
# Lab test rows and the separate malaria-death rows are not case counts for the engine
MOH505_SKIP = re.compile(r"^deaths due to|other cases|tested|positive", re.I)
COUNT_DEATHS_AS_CASES = {"maternal-death", "neonatal-death"}  # the event itself is the death


def _unit_location(unit):
	"""(county, sub_county) for a unit. (None, None) = listed but pending; raises if not listed at all."""
	for rx, county, sub_county in UNIT_LOCATIONS:
		if re.search(rx, unit or "", re.I):
			return county, sub_county
	raise ValueError(f"Unknown organisation unit '{unit}'. Add it to UNIT_LOCATIONS.")


def _is_reporting_file(path):
	return os.path.basename(path).lower().startswith("reporting")


def parse_reporting_file(path):
	"""Read one KHIS reporting-rate export. Returns (unit, {week_start: reported(bool)})."""
	import pandas as pd
	raw = pd.read_excel(path, header=None)
	unit = str(raw.iloc[0, 0]).strip()
	header_row = next((i for i in range(min(10, len(raw))) if str(raw.iloc[i, 0]).strip().lower() == "periodname"), None)
	if header_row is None:
		raise ValueError(f"{path}: no 'periodname' header row found")
	headers = [str(h) for h in raw.iloc[header_row].tolist()]
	col = next((j for j, h in enumerate(headers) if re.search(r"actual reports$", h.strip(), re.I)), None)
	if col is None:
		raise ValueError(f"{path}: no 'Actual reports' column found")
	weeks = {}
	for i in range(header_row + 1, len(raw)):
		wk = MOH505_WEEK.search(str(raw.iloc[i, 0]))
		if wk:
			v = pd.to_numeric(raw.iloc[i, col], errors="coerce")
			weeks[wk.group(1)] = bool(v and v > 0)
	return unit, weeks


def parse_moh505_file(path):
	"""Read one KHIS MOH 505 export (weeks as rows, disease x age x cases/deaths as columns).
	Returns (unit, rows, skipped_column_names). <5 and >5 are added together.
	A week where every cell is blank produces no rows: the engine treats it as "not reported"."""
	import pandas as pd
	raw = pd.read_excel(path, header=None)
	unit = str(raw.iloc[0, 0]).strip()
	header_row = next((i for i in range(min(10, len(raw))) if str(raw.iloc[i, 0]).strip().lower() == "periodname"), None)
	if header_row is None:
		raise ValueError(f"{path}: no 'periodname' header row found")
	county, sub_county = _unit_location(unit)
	if not sub_county:
		return unit, None, set()  # location pending: caller skips this unit

	columns, skipped = {}, set()
	for j, h in enumerate(raw.iloc[header_row].tolist()[1:], start=1):
		m = MOH505_COLUMN.match(str(h).strip())
		name = m.group("name").strip() if m else str(h)
		key = to_key(name) if m else None
		if not m or MOH505_SKIP.search(name) or key.startswith("other:"):
			skipped.add(name)
			continue
		columns[j] = (key, m.group("kind").lower())

	totals = {}
	for i in range(header_row + 1, len(raw)):
		wk = MOH505_WEEK.search(str(raw.iloc[i, 0]))
		if not wk:
			continue
		for j, (key, kind) in columns.items():
			v = pd.to_numeric(raw.iloc[i, j], errors="coerce")
			if pd.isna(v):
				continue
			t = totals.setdefault((key, wk.group(1)), {"cases": 0, "deaths": 0})
			t[kind] += int(v)

	rows = []
	for (key, week), t in totals.items():
		count = max(t["cases"], t["deaths"]) if key in COUNT_DEATHS_AS_CASES else t["cases"]
		if count == 0 and t["deaths"] == 0:
			continue
		rows.append({"disease": key, "county": county, "sub_county": sub_county, "week_start": week,
			"signals": count, "affected": count, "deaths": t["deaths"]})
	return unit, rows, skipped


def load_moh505(folder):
	"""Load every MOH 505 export under folder as source IDSR. Safe to re-run: replaces all IDSR rows.

	Expects one sub-folder per facility holding yearly case files (2025.xls) and reporting files
	(reporting_25.xls). Reporting files tell a true zero week (facility reported, no cases) apart
	from a week the facility did not report, which the engine leaves out of the baseline.

	bench --site <site> execute surveillance.weekly_counts.load_moh505 --kwargs "{'folder': '/full/path/moh505'}"
	"""
	known = set(frappe.get_all("Alert Threshold Config", pluck="name"))
	files = sorted(glob.glob(os.path.join(folder, "**", "*.xls*"), recursive=True))
	if not files:
		frappe.throw(f"No .xls/.xlsx files found under {folder}")

	rows, skipped, unknown = [], set(), {}
	units, pending = {}, {}
	reported = {}  # unit -> {week: bool}
	for f in files:
		if _is_reporting_file(f):
			unit, weeks = parse_reporting_file(f)
			reported.setdefault(unit, {}).update(weeks)
			continue
		unit, file_rows, file_skipped = parse_moh505_file(f)
		if file_rows is None:
			pending.setdefault(unit, []).append(os.path.basename(f))
			continue
		skipped |= file_skipped
		units.setdefault(unit, []).append(os.path.basename(f))
		for r in file_rows:
			if r["disease"] not in known:
				unknown[r["disease"]] = unknown.get(r["disease"], 0) + r["signals"]
				continue
			rows.append(r)

	# A sub-county week counts as reported when any of its facilities reported. For those weeks,
	# add zero rows so the engine sees a true zero instead of "not reported".
	loc_weeks, loc_diseases = {}, {}
	for unit, weeks in reported.items():
		try:
			county, sub_county = _unit_location(unit)
		except ValueError:
			continue
		if not sub_county:
			continue
		for w, ok in weeks.items():
			if ok:
				loc_weeks.setdefault((county, sub_county), set()).add(str(week_start(w)))
	for r in rows:
		loc_diseases.setdefault((r["county"], r["sub_county"]), set()).add(r["disease"])
	zeros = [{"disease": d, "county": c, "sub_county": sc, "week_start": w, "signals": 0, "affected": 0, "deaths": 0}
		for (c, sc), ws in loc_weeks.items() for w in ws for d in loc_diseases.get((c, sc), ())]

	saved = replace_source("IDSR", rows + zeros)
	weeks = sorted({str(week_start(r["week_start"])) for r in rows})
	print(f"Files read         : {len(files)}")
	for unit, names in units.items():
		rep = reported.get(unit, {})
		rate = f"{sum(rep.values())}/{len(rep)} weeks reported" if rep else "no reporting file"
		print(f"  {unit} -> {' / '.join(_unit_location(unit))}: {len(names)} case files, {rate}")
	for unit, names in pending.items():
		print(f"  SKIPPED {unit}: location pending ({len(names)} case files). Set it in UNIT_LOCATIONS.")
	print(f"Weekly Count rows  : {saved} (source IDSR)")
	if weeks:
		print(f"Weeks covered      : {weeks[0]} to {weeks[-1]}")
	if unknown:
		print("Not loaded (disease not in Alert Threshold Config):", unknown)
	print(f"Columns ignored    : {len(skipped)} (lab tests, separate malaria-death rows, other cases)")
	return saved