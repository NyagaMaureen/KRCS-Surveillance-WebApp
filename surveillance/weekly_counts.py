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
# Add a line here when KRCS sends files for new facilities.
UNIT_LOCATIONS = [
	(r"\bifo\b|dagahaley|hagadera|dadaab", "Garissa", "Dadaab"),
	(r"naregae|natukobenyo|kalobeyei", "Turkana", "Turkana West"),
]
MOH505_COLUMN = re.compile(r"^(?:MOH[ _]505[^_]*_)?(?:IDSR )?(?P<name>.+?)\s*(?P<age>[<>]5 yrs)?,\s*(?P<kind>Cases|Deaths)$", re.I)
MOH505_WEEK = re.compile(r"Week \d+ (\d{4}-\d{2}-\d{2})")
# Lab test rows and the separate malaria-death rows are not case counts for the engine
MOH505_SKIP = re.compile(r"^deaths due to|other cases|tested|positive", re.I)
COUNT_DEATHS_AS_CASES = {"maternal-death", "neonatal-death"}  # the event itself is the death


def _unit_location(unit):
	for rx, county, sub_county in UNIT_LOCATIONS:
		if re.search(rx, unit or "", re.I):
			return county, sub_county
	return None, None


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
		raise ValueError(f"{path}: unknown organisation unit '{unit}'. Add it to UNIT_LOCATIONS.")

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
	"""Load every MOH 505 export (.xls/.xlsx) under folder as source IDSR. Safe to re-run: replaces all IDSR rows.

	bench --site <site> execute surveillance.weekly_counts.load_moh505 --kwargs "{'folder': '/full/path/moh505'}"
	"""
	known = set(frappe.get_all("Alert Threshold Config", pluck="name"))
	files = sorted(glob.glob(os.path.join(folder, "**", "*.xls*"), recursive=True))
	if not files:
		frappe.throw(f"No .xls/.xlsx files found under {folder}")
	rows, skipped, units, unknown = [], set(), {}, {}
	for f in files:
		unit, file_rows, file_skipped = parse_moh505_file(f)
		skipped |= file_skipped
		for r in file_rows:
			if r["disease"] not in known:
				unknown[r["disease"]] = unknown.get(r["disease"], 0) + r["signals"]
				continue
			rows.append(r)
		units.setdefault(unit, []).append(os.path.basename(f))

	saved = replace_source("IDSR", rows)
	weeks = sorted({str(week_start(r["week_start"])) for r in rows})
	print(f"Files read         : {len(files)}")
	for unit, names in units.items():
		print(f"  {unit} -> {' / '.join(_unit_location(unit))}: {', '.join(names)}")
	print(f"Weekly Count rows  : {saved} (source IDSR)")
	if weeks:
		print(f"Weeks covered      : {weeks[0]} to {weeks[-1]}")
	if unknown:
		print("Not loaded (disease not in Alert Threshold Config):", unknown)
	print(f"Columns ignored    : {len(skipped)} (lab tests, separate malaria-death rows, other cases)")
	return saved