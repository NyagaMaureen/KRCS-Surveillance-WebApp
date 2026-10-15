"""Daily CBS feed: pull reports from the KRCS CBS platform.

Saves two things, both without personal data:
  - weekly counts per disease, county, sub-county (Weekly Count, source CBS) for the alert engine
  - one de-identified signal per report from the last SIGNAL_DAYS days (Surveillance Signal) for
    the Review Queue: CBS case number, date, disease, Community Health Unit, number of people.
    Approved by KRCS (Elizabeth) on 14 Oct 2026.
Never saved, logged or printed: reporter name, phone number, description, photos, form answers.

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
from frappe.utils import convert_utc_to_system_timezone

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
	"""region id -> (county, sub_county, area, lat, lng) by walking up the CBS region tree.
	area = the region's own name when it sits below sub-county (e.g. a Community Health Unit).
	lat/lng = the nearest region in the chain that has coordinates (the CHU first)."""
	regions = {}
	for reg in client.paged(f"{client.base}/api/geo/regions/{client.project_id}", "regions"):
		lvl = reg.get("level") if isinstance(reg.get("level"), dict) else {}
		regions[reg["_id"]] = (reg.get("name"), (lvl.get("name") or ""), _id(reg.get("parent")),
			reg.get("latitude"), reg.get("longitude"))
	cache = {}

	def resolve(region_id):
		if region_id not in cache:
			chain, coords, rid, seen = [], [], region_id, set()
			while rid and rid in regions and rid not in seen:
				seen.add(rid)
				name, level_name, parent, lat, lng = regions[rid]
				chain.append((level_name, name))
				coords.append((lat, lng))
				rid = parent
			county = next((n for ln, n in chain if ln.strip().lower() == "county"), None)
			sub = next((n for ln, n in chain if "sub" in ln.lower() and "county" in ln.lower()), None)
			if county is None and chain:
				county = chain[-1][1]
			if sub is None and len(chain) >= 2:
				sub = chain[-2][1]
			own_level, own_name = chain[0] if chain else ("", None)
			below_sub = own_level.strip().lower() != "county" and not ("sub" in own_level.lower() and "county" in own_level.lower())
			area = own_name.strip() if (own_name and below_sub and own_name != county and own_name != sub) else ""
			lat, lng = next(((a, b) for a, b in coords if a and b), (None, None))
			cache[region_id] = (_norm(county), _norm(sub), area, lat, lng)
		return cache[region_id]

	return resolve, len(regions)


def sync():
	"""Pull all CBS reports: replace the CBS rows in Weekly Count and refresh recent CBS signals."""
	from surveillance.events import SIGNAL_DAYS, sync_cbs_signals
	known = set(frappe.get_all("Alert Threshold Config", pluck="name"))
	client = CBSClient()
	resolve, n_regions = _region_resolver(client)

	totals = defaultdict(lambda: {"signals": 0, "affected": 0})
	stats = defaultdict(int)
	unmapped = defaultdict(int)
	signals = []
	signal_since = datetime.now().date() - timedelta(days=SIGNAL_DAYS)

	for rep in client.paged(f"{client.base}/api/reports/{client.project_id}", "reports"):
		stats["read"] += 1
		if rep.get("isTest"):
			stats["test"] += 1
			continue
		if "dismiss" in str(rep.get("status", "")).lower():
			stats["dismissed"] += 1
			continue
		event = (rep.get("event") or {}).get("name")
		key = to_key(event) if event else None
		if not key or key not in known:
			unmapped[event or "(no event)"] += 1
			continue
		if rep.get("source") == "legacy":
			meta = rep.get("legacyMetadata") or {}
			county, sub_county, area, lat, lng = _norm(meta.get("county")), _norm(meta.get("subCounty")), "", None, None
		else:
			rid = _id(rep.get("region"))
			county, sub_county, area, lat, lng = resolve(rid) if rid else (None, None, "", None, None)
		if not county or not rep.get("date"):
			stats["no location or date"] += 1
			continue
		d = datetime.fromisoformat(str(rep["date"]).replace("Z", "+00:00")).date()
		week = d - timedelta(days=d.weekday())
		t = totals[(key, county, sub_county or "", week)]
		t["signals"] += 1
		t["affected"] += int(rep.get("noOfCases") or 0)
		stats["counted"] += 1
		if d >= signal_since and rep.get("caseNumber"):
			# only these fields leave this loop: no reporter, phone, description or media
			signals.append({"ref": rep["caseNumber"], "disease": key, "reported": event,
				"signal_date": convert_utc_to_system_timezone(
					datetime.fromisoformat(str(rep["date"]).replace("Z", "+00:00"))).replace(tzinfo=None),
				"county": county, "sub_county": sub_county or "", "area": area,
				"people": int(rep.get("noOfCases") or 0), "deaths": 0, "reason": "",
				"latitude": lat, "longitude": lng})

	rows = [{"disease": k, "county": c, "sub_county": sc, "week_start": w,
		"signals": t["signals"], "affected": t["affected"], "deaths": 0}
		for (k, c, sc, w), t in totals.items()]
	saved = replace_source("CBS", rows)
	n_signals = sync_cbs_signals(signals)

	weeks = sorted({r["week_start"] for r in rows})
	summary = (f"CBS sync: {stats['read']} reports read, {stats['counted']} counted, "
		f"{stats['test']} test, {stats['dismissed']} dismissed, {stats['no location or date']} without location/date, "
		f"{sum(unmapped.values())} with an event not in our disease list | {saved} weekly rows"
		+ (f" | weeks {weeks[0]} to {weeks[-1]}" if weeks else "")
		+ f" | {n_signals} recent signals for the Review Queue")
	print(summary)
	if unmapped:
		print("Events not mapped (add to diseases.py / Alert Threshold Config if needed):",
			dict(sorted(unmapped.items(), key=lambda x: -x[1])))
	return saved


def hourly():
	"""Scheduler (hourly_long): pull CBS so the Review Queue and map stay current."""
	try:
		sync()
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="CBS hourly sync failed", message=frappe.get_traceback())


def daily():
	"""Scheduler (daily_long): run alert detection on all sources (CBS is already pulled hourly),
	then refresh the outbreak-alert links on open Review Queue events."""
	from surveillance.alerts import run_detection
	run_detection()
	try:
		from surveillance.events import refresh_links
		refresh_links()
	except Exception:
		frappe.log_error(title="Review Queue refresh failed", message=frappe.get_traceback())
