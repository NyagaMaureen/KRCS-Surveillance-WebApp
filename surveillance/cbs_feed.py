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


# ---------- CBS volunteer contact, fetched live when an officer clicks "Show contact" ----------
# Only the CBS volunteer/staff member who handled the report (personnel.user): name and phone, plus the region(s)
# they are assigned to (supervisor location). Never the community member's phone number. Nothing is saved:
# it is fetched from CBS, returned to the officer and dropped. Switched off until KRCS approves:
#     bench --site <site> set-config cbs_reporter_contact 1

def contact_enabled():
	return bool(frappe.conf.get("cbs_reporter_contact"))


def _find_report(client, case_number, signal_date=None):
	"""The CBS report with this case number. Tries a direct lookup first, then the newest pages of the list."""
	base = f"{client.base}/api/reports/{client.project_id}"
	for url, params in ((f"{base}/{case_number}", {}), (base, {"caseNumber": case_number}), (base, {"search": case_number})):
		try:
			r = client.s.get(url, params=params, timeout=TIMEOUT)
			if r.status_code != 200:
				continue
			data = r.json()
			rows = data.get("reports") if isinstance(data, dict) and "reports" in data else [data.get("report") or data]
			hit = next((x for x in rows or [] if isinstance(x, dict) and x.get("caseNumber") == case_number), None)
			if hit:
				return hit
		except Exception:
			continue
	for page in range(1, 31):   # fallback: scan up to 30 pages (3,000 reports)
		data = client.get(base, page=page, limit=PAGE_SIZE)
		rows = data.get("reports") or []
		hit = next((x for x in rows if x.get("caseNumber") == case_number), None)
		if hit:
			return hit
		pages = data.get("pages") or (data.get("pagination") or {}).get("pages", 1)
		if page >= pages:
			break
	return None


def _assigned_regions(client, assignments):
	ids = []
	for a in assignments or []:
		reg = a.get("region") if isinstance(a, dict) else a
		rid = _id(reg) if reg else None
		if rid:
			ids.append(rid)
	if not ids:
		return []
	resolve, _ = _region_resolver(client)
	out = []
	for rid in ids:
		county, sub, area, _lat, _lng = resolve(rid)
		label = ", ".join(x for x in (area, sub, county) if x)
		if label and label not in out:
			out.append(label)
	return out


@frappe.whitelist()
def get_reporter_contact(signal):
	"""Live lookup for one CBS signal. Returns {name, phone, assignedTo: [...]} or {available: False, why}."""
	from surveillance.capabilities import require_capability
	require_capability("act_on_events")
	if not contact_enabled():
		return {"available": False, "why": "Showing CBS volunteer contacts is switched off. Use the case number in CBS."}
	s = frappe.db.get_value("Surveillance Signal", signal, ["source", "ref", "signal_date"], as_dict=True)
	if not s or s.source != "CBS" or not s.ref:
		frappe.throw("Not a CBS report")
	try:
		client = CBSClient()
		rep = _find_report(client, s.ref, s.signal_date)
	except Exception:
		frappe.log_error(title="CBS contact lookup failed", message=frappe.get_traceback())
		return {"available": False, "why": "CBS could not be reached. Try again, or use the case number in CBS."}
	if not rep:
		return {"available": False, "why": f"Case {s.ref} was not found in CBS."}
	person = rep.get("personnel") if isinstance(rep.get("personnel"), dict) else {}
	user = person.get("user") if isinstance(person.get("user"), dict) else {}
	# only these three things leave this function; nothing is logged or saved
	out = {"available": True, "name": user.get("fullName") or None, "phone": user.get("phone") or None,
		"assignedTo": _assigned_regions(client, person.get("assignments"))}
	if not (out["name"] or out["phone"]):
		return {"available": False, "why": "CBS has no volunteer contact on this report."}
	return out


@frappe.whitelist()
def get_trend_cbs_reports(event):
	"""Live list of the CBS reports behind an event opened from Epi Trends (same disease, sub-county and weeks).
	Case number, date, place and number of cases always; volunteer contact only when cbs_reporter_contact is on.
	Nothing is saved."""
	from surveillance.capabilities import require_capability
	require_capability("act_on_events")
	alert_name = frappe.db.get_value("Surveillance Event", event, "from_alert")
	a = frappe.db.get_value("Risk Alert", alert_name, ["disease", "sub_county", "week_start", "last_week", "sources"],
		as_dict=True) if alert_name else None
	if not a:
		frappe.throw("This event was not opened from an Epi Trends alert")
	if "CBS" not in (a.sources or ""):
		return {"reports": [], "why": "This trend has no CBS reports (it comes from facility data)."}
	start = frappe.utils.getdate(a.week_start)
	end = frappe.utils.add_days(frappe.utils.getdate(a.last_week or a.week_start), 6)
	sub = (a.sub_county or "").strip().lower()
	show_contact = contact_enabled()
	try:
		client = CBSClient()
		resolve, _ = _region_resolver(client)
		found = []
		for page in range(1, 31):   # newest reports are scanned; up to 3,000
			data = client.get(f"{client.base}/api/reports/{client.project_id}", page=page, limit=PAGE_SIZE)
			for rep in data.get("reports") or []:
				if rep.get("isTest") or "dismiss" in str(rep.get("status", "")).lower() or not rep.get("date"):
					continue
				ev = (rep.get("event") or {}).get("name")
				if not ev or to_key(ev) != a.disease:
					continue
				d = datetime.fromisoformat(str(rep["date"]).replace("Z", "+00:00")).date()
				if not (start <= d <= end):
					continue
				rid = _id(rep.get("region"))
				county, sub_county, area, _lat, _lng = resolve(rid) if rid else (None, None, "", None, None)
				if (sub_county or "").strip().lower() != sub:
					continue
				row = {"case": rep.get("caseNumber"), "date": str(d), "area": area or sub_county, "cases": int(rep.get("noOfCases") or 0)}
				if show_contact:
					person = rep.get("personnel") if isinstance(rep.get("personnel"), dict) else {}
					user = person.get("user") if isinstance(person.get("user"), dict) else {}
					row.update({"name": user.get("fullName") or None, "phone": user.get("phone") or None,
						"assignedTo": _assigned_regions(client, person.get("assignments"))})
				found.append(row)
			pages = data.get("pages") or (data.get("pagination") or {}).get("pages", 1)
			if page >= pages:
				break
	except Exception:
		frappe.log_error(title="CBS trend reports lookup failed", message=frappe.get_traceback())
		return {"reports": [], "why": "CBS could not be reached. Try again later."}
	found.sort(key=lambda r: r["date"])
	return {"reports": found, "contacts": show_contact,
		"why": None if found else "No matching CBS reports found for this disease, place and weeks."}
