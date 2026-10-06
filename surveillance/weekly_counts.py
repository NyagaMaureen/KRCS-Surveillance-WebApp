"""Weekly Count: the standard weekly table every data source is converted into.

One row = one source, one disease, one sub-county, one week (weeks start on Monday).
The anomaly engine reads only this table, so adding a source (EMR, IDSR) never changes the engine.
Rows are aggregates only: no names, phone numbers or other personal data.
"""
import csv
import hashlib

import frappe
from frappe.utils import add_days, getdate, now

from surveillance.anomaly.diseases import to_key

DOCTYPE = "Weekly Count"
SOURCES = ("CBS", "Case Report", "EMR")
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
		print("Skipped (no matching priority disease):")
		for name, n in sorted(unmapped.items(), key=lambda x: -x[1]):
			print(f"  {n:5}  {name}")
	return saved
