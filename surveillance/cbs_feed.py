"""Daily CBS feed: pull reports from the KRCS CBS platform, keep only weekly counts.

Privacy: report records are read in memory one page at a time and reduced straight
away to (disease, county, sub-county, week) counts. No report, name, phone number,
free text or report ID is ever saved, logged or printed. Only the counts reach the
database (Weekly Count, source CBS).

Credentials go in site config, never in code:
    bench --site <site> set-config cbs_email "<email>"
    bench --site <site> set-config cbs_password "<password>"
Optional: cbs_base_url (default https://cbs.redcross.or.ke)

Run by the scheduler every day before alert detection (hooks: daily_long -> daily()).
Manual run:
    bench --site <site> execute surveillance.cbs_feed.sync
"""
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta

import frappe
import requests

from surveillance.anomaly.diseases import to_key
from surveillance.weekly_counts import replace_source

DEFAULT_BASE = "https://cbs.redcross.or.ke"
PAGE_SIZE = 100
MAX_RETRIES = 5
TIMEOUT = 60


class CBSClient:
	def __init__(self):
		self.base = (frappe.conf.get("cbs_base_url") or DEFAULT_BASE).rstrip("/")
		email, password = frappe.conf.get("cbs_email"), frappe.conf.get("cbs_password")
		if not email or not password:
			frappe.throw("CBS credentials missing: set cbs_email and cbs_password in site config")
		self.s = requests.Session()
		r = self.s.post(f"{self.base}/api/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
		r.raise_for_status()
		self.s.headers["Authorization"] = f"Bearer {r.json()['token']}"
		self.project_id = self.get(f"{self.base}/api/projects")["projects"][0]["_id"]  # CBS National

	def get(self, url, **params):
		for _ in range(MAX_RETRIES):
			r = self.s.get(url, params=params, timeout=TIMEOUT)
			if r.status_code == 429:
				time.sleep(min(int((r.json().get("error") or {}).get("retryAfter", 60)), 300))
				continue
			r.raise_for_status()
			return r.json()
		raise RuntimeError("CBS API kept rate-limiting; try again later")

	def paged(self, url, key):
		page = 1
		while True:
			data = self.get(url, page=page, limit=PAGE_SIZE)
			yield from data.get(key) or []
			pages = data.get("pages") or (data.get("pagination") or {}).get("pages", 1)
			if page >= pages:
				break
			page += 1


def _norm(name):
	if not name:
		return None
	name = re.sub(r"\s+(sub[\s-]?county|county)$", "", str(name).strip(), flags=re.I)
	return name.strip().title() or None


def _id(x):
	return x.get("_id") if isinstance(x, dict) else x


def _region_resolver(client):
	"""region id -> (county, sub_county) by walking up the CBS region tree."""
	regions = {}
	for reg in client.paged(f"{client.base}/api/geo/regions/{client.project_id}", "regions"):
		lvl = reg.get("level") if isinstance(reg.get("level"), dict) else {}
		regions[reg["_id"]] = (reg.get("name"), (lvl.get("name") or ""), _id(reg.get("parent")))
	cache = {}

	def resolve(region_id):
		if region_id not in cache:
			chain, rid, seen = [], region_id, set()
			while rid and rid in regions and rid not in seen:
				seen.add(rid)
				name, level_name, parent = regions[rid]
				chain.append((level_name, name))
				rid = parent
			county = next((n for ln, n in chain if ln.strip().lower() == "county"), None)
			sub = next((n for ln, n in chain if "sub" in ln.lower() and "county" in ln.lower()), None)
			if county is None and chain:
				county = chain[-1][1]
			if sub is None and len(chain) >= 2:
				sub = chain[-2][1]
			cache[region_id] = (_norm(county), _norm(sub))
		return cache[region_id]

	return resolve, len(regions)


def sync():
	"""Pull all CBS reports, reduce to weekly counts, replace the CBS rows in Weekly Count."""
	known = set(frappe.get_all("Alert Threshold Config", pluck="name"))
	client = CBSClient()
	resolve, n_regions = _region_resolver(client)

	totals = defaultdict(lambda: {"signals": 0, "affected": 0})
	stats = defaultdict(int)
	unmapped = defaultdict(int)

	for rep in client.paged(f"{client.base}/api/reports/{client.project_id}", "reports"):
		stats["read"] += 1
		if rep.get("isTest"):
			stats["test"] += 1
			continue
		if "dismiss" in str(rep.get("status", "")).lower():
			stats["dismissed"] += 1
			continue
		event = (rep.get("event") or {}).get("name")
		key = to_key(event) if event else "unclassified-illness"
		if not key or key not in known:
			unmapped[event or "(no event)"] += 1
			continue
		if rep.get("source") == "legacy":
			meta = rep.get("legacyMetadata") or {}
			county, sub_county = _norm(meta.get("county")), _norm(meta.get("subCounty"))
		else:
			rid = _id(rep.get("region"))
			county, sub_county = resolve(rid) if rid else (None, None)
		if not county or not rep.get("date"):
			stats["no location or date"] += 1
			continue
		d = datetime.fromisoformat(str(rep["date"]).replace("Z", "+00:00")).date()
		week = d - timedelta(days=d.weekday())
		t = totals[(key, county, sub_county or "", week)]
		t["signals"] += 1
		t["affected"] += int(rep.get("noOfCases") or 0)
		stats["counted"] += 1

	rows = [{"disease": k, "county": c, "sub_county": sc, "week_start": w,
		"signals": t["signals"], "affected": t["affected"], "deaths": 0}
		for (k, c, sc, w), t in totals.items()]
	saved = replace_source("CBS", rows)

	weeks = sorted({r["week_start"] for r in rows})
	summary = (f"CBS sync: {stats['read']} reports read, {stats['counted']} counted, "
		f"{stats['test']} test, {stats['dismissed']} dismissed, {stats['no location or date']} without location/date, "
		f"{sum(unmapped.values())} with an event not in our disease list | {saved} weekly rows"
		+ (f" | weeks {weeks[0]} to {weeks[-1]}" if weeks else ""))
	print(summary)
	if unmapped:
		print("Events not mapped (add to diseases.py / Alert Threshold Config if needed):",
			dict(sorted(unmapped.items(), key=lambda x: -x[1])))
	return saved


def daily():
	"""Scheduler entry point: refresh CBS counts, then run alert detection on all sources.
	If CBS is unreachable, detection still runs on the data already loaded."""
	from surveillance.alerts import run_detection
	try:
		sync()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="CBS daily sync failed", message=frappe.get_traceback())
	run_detection()