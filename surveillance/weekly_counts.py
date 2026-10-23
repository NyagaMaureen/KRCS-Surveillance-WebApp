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
#
# Facility-level data is kept in two tables, filled by uploads (Facility Data page) or by load_moh505:
#   IDSR Facility Week   facility, disease, week, cases, deaths
#   IDSR Reporting Week  facility, week, reported yes/no (from KHIS reporting-rate files)
# An upload replaces only the weeks in that file for that facility. rebuild_idsr() then rolls the
# facilities up to sub-county weeks in Weekly Count (source IDSR), which is what the engine reads.

FACILITY = "Reporting Facility"
FACILITY_WEEK = "IDSR Facility Week"
REPORTING_WEEK = "IDSR Reporting Week"

# Starting list for Reporting Facility (after_migrate adds any that are missing; edits in the app are kept).
# (facility name, words/regex found in the KHIS organisation unit name, county, sub-county)
DEFAULT_FACILITIES = [
	# DRO (Dadaab)
	("Ifo", r"\bifo\b", "Garissa", "Dadaab"),
	("Abaqalaan", r"abaqalaan", "Garissa", "Dadaab"),
	("Balaambal", r"balaambal", "Garissa", "Dadaab"),
	("Darkenley", r"darkenley", "Garissa", "Dadaab"),
	("Wadajir", r"wadajir", "Garissa", "Dadaab"),
	# KRO (Kalobeyei)
	("Naregae", r"naregae", "Turkana", "Turkana West"),
	("Natukobenyo", r"natukobenyo", "Turkana", "Turkana West"),
]
MOH505_COLUMN = re.compile(r"^(?:MOH[ _]505[^_]*_)?(?:IDSR )?(?P<name>.+?)\s*(?P<age>[<>]5 yrs)?,\s*(?P<kind>Cases|Deaths)$", re.I)
MOH505_WEEK = re.compile(r"Week \d+ (\d{4}-\d{2}-\d{2})")
# Lab test rows and the separate malaria-death rows are not case counts for the engine
MOH505_SKIP = re.compile(r"^deaths due to|other cases|tested|positive", re.I)
COUNT_DEATHS_AS_CASES = {"maternal-death", "neonatal-death"}  # the event itself is the death


class UnknownFacility(ValueError):
	def __init__(self, unit):
		self.unit = unit
		super().__init__(f"Unknown organisation unit '{unit}'. Add it under Facility Data > Facilities.")


def seed_reporting_facilities():
	"""after_migrate: add missing default facilities. Never changes facilities edited in the app."""
	subs = {((s.county or "").lower(), (s.sub_county_name or "").lower()): s.name
		for s in frappe.get_all("Sub County", fields=["name", "county", "sub_county_name"])}
	for name, match, county, sub_county in DEFAULT_FACILITIES:
		if frappe.db.exists(FACILITY, name):
			continue
		sc = subs.get((county.lower(), sub_county.lower()))
		if not sc:
			print(f"Reporting Facility {name} skipped: no Sub County {county} / {sub_county}")
			continue
		frappe.get_doc({"doctype": FACILITY, "facility_name": name, "khis_match": match,
			"sub_county": sc, "is_active": 1}).insert(ignore_permissions=True)
	frappe.db.commit()


def find_facility(unit):
	"""The Reporting Facility whose 'Name in KHIS files' matches the unit. Raises UnknownFacility."""
	for f in frappe.get_all(FACILITY, filters={"is_active": 1}, fields=["name", "khis_match"]):
		pattern = (f.khis_match or "").strip()
		if not pattern:
			continue
		try:
			hit = re.search(pattern, unit or "", re.I)
		except re.error:
			hit = pattern.lower() in (unit or "").lower()
		if hit:
			return f.name
	raise UnknownFacility(unit)


def _read_sheet(path):
	"""(unit, raw dataframe, header row index) for a KHIS export."""
	import pandas as pd
	raw = pd.read_excel(path, header=None)
	unit = str(raw.iloc[0, 0]).strip()
	header_row = next((i for i in range(min(10, len(raw))) if str(raw.iloc[i, 0]).strip().lower() == "periodname"), None)
	if header_row is None:
		raise ValueError("This doesn't look like a KHIS export: no 'periodname' row in the first 10 rows.")
	return unit, raw, header_row


def file_kind(path, file_name=None):
	"""'Reporting' for a KHIS reporting-rate export, 'Cases' for an MOH 505 cases export."""
	if os.path.basename(file_name or path).lower().startswith("reporting"):
		return "Reporting"
	_, raw, header_row = _read_sheet(path)
	headers = [str(h).strip() for h in raw.iloc[header_row].tolist()]
	return "Reporting" if any(re.search(r"actual reports$", h, re.I) for h in headers) else "Cases"


def parse_reporting_file(path):
	"""Read one KHIS reporting-rate export. Returns (unit, {week_start: reported(bool)})."""
	import pandas as pd
	unit, raw, header_row = _read_sheet(path)
	headers = [str(h) for h in raw.iloc[header_row].tolist()]
	col = next((j for j, h in enumerate(headers) if re.search(r"actual reports$", h.strip(), re.I)), None)
	if col is None:
		raise ValueError("No 'Actual reports' column found in this reporting-rate file.")
	weeks = {}
	for i in range(header_row + 1, len(raw)):
		wk = MOH505_WEEK.search(str(raw.iloc[i, 0]))
		if wk:
			v = pd.to_numeric(raw.iloc[i, col], errors="coerce")
			weeks[week_start(wk.group(1))] = bool(v and v > 0)
	return unit, weeks


def parse_moh505_file(path):
	"""Read one KHIS MOH 505 export (weeks as rows, disease x age x cases/deaths as columns). <5 and >5 are added.

	Returns (unit, rows, weeks_with_data, skipped_column_names):
	  rows: [{disease, week_start, cases, deaths}] for diseases we map (zero rows left out)
	  weeks_with_data: weeks with at least one filled cell. These are the weeks an upload replaces;
	  a week where every cell is blank counts as "not reported" and is left alone."""
	import pandas as pd
	unit, raw, header_row = _read_sheet(path)

	columns, skipped = {}, set()
	for j, h in enumerate(raw.iloc[header_row].tolist()[1:], start=1):
		m = MOH505_COLUMN.match(str(h).strip())
		name = m.group("name").strip() if m else str(h)
		key = to_key(name) if m else None
		if not m or MOH505_SKIP.search(name) or key.startswith("other:"):
			skipped.add(name)
			continue
		columns[j] = (key, m.group("kind").lower())

	totals, weeks = {}, set()
	for i in range(header_row + 1, len(raw)):
		wk = MOH505_WEEK.search(str(raw.iloc[i, 0]))
		if not wk:
			continue
		week = week_start(wk.group(1))
		for j, (key, kind) in columns.items():
			v = pd.to_numeric(raw.iloc[i, j], errors="coerce")
			if pd.isna(v):
				continue
			weeks.add(week)
			t = totals.setdefault((key, week), {"cases": 0, "deaths": 0})
			t[kind] += int(v)

	rows = []
	for (key, week), t in totals.items():
		cases = max(t["cases"], t["deaths"]) if key in COUNT_DEATHS_AS_CASES else t["cases"]
		if cases == 0 and t["deaths"] == 0:
			continue
		rows.append({"disease": key, "week_start": week, "cases": cases, "deaths": t["deaths"]})
	return unit, rows, weeks, skipped


def _replace_facility_rows(doctype, facility, weeks, values, fields):
	"""Delete one facility's rows for the given weeks, then insert values. Other weeks and facilities untouched."""
	if weeks:
		frappe.db.delete(doctype, {"facility": facility, "week_start": ["in", sorted(weeks)]})
	if values:
		frappe.db.bulk_insert(doctype, fields, values, chunk_size=2000)


_BASE_FIELDS = ["name", "creation", "modified", "owner", "modified_by", "docstatus"]


def store_cases(facility, rows, weeks, upload=None):
	"""Save one facility's case rows, replacing only the weeks in `weeks`."""
	ts, user = now(), frappe.session.user
	values = [(hashlib.sha1(f"{facility}|{r['disease']}|{r['week_start']}".encode()).hexdigest()[:20], ts, ts, user, user, 0,
		facility, r["disease"], r["week_start"], r["cases"], r["deaths"], upload) for r in rows]
	_replace_facility_rows(FACILITY_WEEK, facility, weeks, values,
		_BASE_FIELDS + ["facility", "disease", "week_start", "cases", "deaths", "upload"])


def store_reporting(facility, weeks, upload=None):
	"""Save one facility's reported/not-reported weeks ({week: bool}), replacing only those weeks."""
	ts, user = now(), frappe.session.user
	values = [(hashlib.sha1(f"{facility}|{w}".encode()).hexdigest()[:20], ts, ts, user, user, 0,
		facility, w, 1 if ok else 0, upload) for w, ok in weeks.items()]
	_replace_facility_rows(REPORTING_WEEK, facility, set(weeks), values,
		_BASE_FIELDS + ["facility", "week_start", "reported", "upload"])


def rebuild_idsr():
	"""Roll facility weeks up into Weekly Count (source IDSR): sum per sub-county, disease and week.

	A sub-county week counts as reported when any of its facilities reported. For those weeks, zero rows
	are added so the engine sees a true zero instead of "not reported". Only diseases in Alert Threshold
	Config are passed on (a disease added there later is picked up at the next rebuild)."""
	known = set(frappe.get_all("Alert Threshold Config", pluck="name"))
	loc = {f.name: (f.county, f.sub_county_name)
		for f in frappe.get_all(FACILITY, fields=["name", "county", "sub_county_name"]) if f.sub_county_name}

	rows, loc_diseases, loc_weeks = [], {}, {}
	for r in frappe.get_all(FACILITY_WEEK, fields=["facility", "disease", "week_start", "cases", "deaths"], limit_page_length=0):
		if r.facility not in loc or r.disease not in known:
			continue
		county, sub_county = loc[r.facility]
		rows.append({"disease": r.disease, "county": county, "sub_county": sub_county, "week_start": r.week_start,
			"signals": r.cases or 0, "affected": r.cases or 0, "deaths": r.deaths or 0})
		loc_diseases.setdefault((county, sub_county), set()).add(r.disease)
	for r in frappe.get_all(REPORTING_WEEK, filters={"reported": 1}, fields=["facility", "week_start"], limit_page_length=0):
		if r.facility in loc:
			loc_weeks.setdefault(loc[r.facility], set()).add(r.week_start)
	zeros = [{"disease": d, "county": c, "sub_county": sc, "week_start": w, "signals": 0, "affected": 0, "deaths": 0}
		for (c, sc), ws in loc_weeks.items() for w in ws for d in loc_diseases.get((c, sc), ())]
	return replace_source("IDSR", rows + zeros)


def load_moh505(folder):
	"""Load every MOH 505 export under a folder (cases and reporting files, any sub-folders), then rebuild IDSR.
	Safe to re-run: each file replaces only its own facility's weeks. Also used once to bring existing
	history into the facility tables before the Facility Data page is used.

	bench --site <site> execute surveillance.weekly_counts.load_moh505 --kwargs "{'folder': '/full/path/moh505'}"
	"""
	files = sorted(glob.glob(os.path.join(folder, "**", "*.xls*"), recursive=True))
	if not files:
		frappe.throw(f"No .xls/.xlsx files found under {folder}")

	done, unknown, failed, skipped = {}, {}, {}, set()
	for f in files:
		name = os.path.basename(f)
		try:
			if file_kind(f) == "Reporting":
				unit, weeks = parse_reporting_file(f)
				facility = find_facility(unit)
				store_reporting(facility, weeks)
				done.setdefault(facility, []).append(f"{name} (reporting, {sum(weeks.values())}/{len(weeks)} weeks reported)")
			else:
				unit, rows, weeks, file_skipped = parse_moh505_file(f)
				facility = find_facility(unit)
				skipped |= file_skipped
				store_cases(facility, rows, weeks)
				done.setdefault(facility, []).append(f"{name} ({len(weeks)} weeks, {sum(r['cases'] for r in rows)} cases)")
		except UnknownFacility as e:
			unknown.setdefault(e.unit, []).append(name)
		except Exception as e:
			failed[name] = str(e)
	frappe.db.commit()

	saved = rebuild_idsr()
	print(f"Files read         : {len(files)}")
	for facility, names in done.items():
		print(f"  {facility}: " + "; ".join(names))
	for unit, names in unknown.items():
		print(f"  SKIPPED '{unit}': not in Reporting Facility ({len(names)} files). Add it, then re-run.")
	for name, err in failed.items():
		print(f"  FAILED {name}: {err}")
	print(f"Weekly Count rows  : {saved} (source IDSR)")
	print(f"Columns ignored    : {len(skipped)} (lab tests, separate malaria-death rows, other cases)")
	return saved
