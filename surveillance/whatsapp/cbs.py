"""Community WhatsApp reports written to the KRCS CBS platform (AI/ML §6.6).

A community member's report is created in CBS through its REST API, and CBS's own escalation workflow takes it from
there; staff reports stay in Frappe and keep the WhatsApp desk alert. Each community report gets one CBS Write-back
record: Queued until CBS accepts it, then Sent with the CBS case number. If CBS refuses it, or is still unreachable
after the last retry, the record is Failed and the WhatsApp desk is alerted instead, so no report is lost.

Sent to CBS: event, region (the CBS sub-county with the same name, else the county), number of people, date, the
reporter's number (a CHA verifies each CBS signal by phone), the sub-county centre rather than the reporter's own
point (SRS R4), and a description with names and numbers taken out of the reporter's notes. Not sent: the reporter's
name and photos (CBS keeps uploads publicly readable and never deletes them).

Configuration: WhatsApp Settings, "CBS Write-back". With no URL there, it uses the CBS feed's site config
(cbs_base_url, cbs_email, cbs_password). A URL set there (a CBS staging server, for example)
needs its own account there too, so the CBS account is never sent to another server. The account must be allowed
to create reports in CBS: CBS API keys can only read.
Retries: retry_due, every 5 minutes (hooks.py scheduler_events cron).
"""

import hashlib
import json

import frappe
import requests
from frappe.utils import add_to_date, cint, now_datetime

from surveillance.anomaly.diseases import to_key
from surveillance.cbs_feed import DEFAULT_BASE
from surveillance.cbs_feed import _norm as norm_place
from surveillance.whatsapp import data
from surveillance.whatsapp.redact import redact

WRITEBACK = "CBS Write-back"
COMMUNITY_SIGNAL = "Community Signal"
TIMEOUT = 30
TOKEN_SECONDS = 23 * 3600  # CBS tokens last 24 hours
CATALOG_SECONDS = 3600
# Minutes before each retry; after the last one the report is Failed and the desk is alerted.
BACKOFF_MINUTES = (1, 5, 30, 120, 360)
REMOVED_TEXT = "Removed at the reporter's request (KRCS data protection)."


class Retry(Exception):
	"""CBS is unreachable or busy: try again later."""

	def __init__(self, message, after=0):
		super().__init__(message)
		self.after = after


class Rejected(Exception):
	"""CBS refused the report, or it can't be mapped to CBS: trying again won't help."""


class Expired(Exception):
	"""The CBS token is no longer accepted."""


def enabled():
	return cint(data.settings().cbs_writeback)


def writes_back(report):
	"""Community reports go to CBS when the write-back is on. Staff reports never do."""
	return bool(enabled()) and frappe.db.get_value("Case Report", report, "signal_type") == COMMUNITY_SIGNAL


def session():
	return requests.Session()


class Client:
	def __init__(self, base, email, password, project=None):
		self.base = base.rstrip("/")
		self.email, self.password, self.project = email, password, project
		self.s = session()
		self.key = "cbs_writeback:" + hashlib.sha1(f"{self.base}|{email}".encode()).hexdigest()[:16]

	@classmethod
	def from_settings(cls):
		st = data.settings()
		password = st.get_password("cbs_writeback_password", raise_exception=False)
		if st.cbs_writeback_url:
			email = st.cbs_writeback_email
			if not email or not password:
				raise Rejected(
					"A CBS URL is set in WhatsApp Settings without its own CBS account email and password."
				)
			return cls(st.cbs_writeback_url, email, password, st.cbs_project)
		email = st.cbs_writeback_email or frappe.conf.get("cbs_email")
		password = password or frappe.conf.get("cbs_password")
		if not email or not password:
			raise Rejected(
				"No CBS account: set one in WhatsApp Settings, or cbs_email and cbs_password in site config."
			)
		return cls(frappe.conf.get("cbs_base_url") or DEFAULT_BASE, email, password, st.cbs_project)

	def token(self, renew=False):
		# expires=True: a miss is not remembered for the rest of the request.
		token = None if renew else frappe.cache.get_value(self.key + ":token", expires=True)
		if not token:
			token = self.send(
				"POST", "/api/auth/login", json={"email": self.email, "password": self.password}
			).get("token")
			if not token:
				raise Rejected("CBS login returned no token.")
			frappe.cache.set_value(self.key + ":token", token, expires_in_sec=TOKEN_SECONDS)
		return token

	def call(self, method, path, **kwargs):
		try:
			return self.send(method, path, token=self.token(), **kwargs)
		except Expired:
			return self.send(method, path, token=self.token(renew=True), **kwargs)

	def send(self, method, path, token=None, json=None, params=None):
		headers = {"Authorization": f"Bearer {token}"} if token else {}
		try:
			r = self.s.request(
				method, self.base + path, json=json, params=params, headers=headers, timeout=TIMEOUT
			)
		except requests.RequestException as e:
			raise Retry(f"CBS unreachable ({e.__class__.__name__})") from e
		try:
			body = r.json()
		except ValueError:
			body = {}
		body = body if isinstance(body, dict) else {"data": body}
		error = body.get("error") if isinstance(body.get("error"), dict) else {}
		what = " ".join(
			str(x)
			for x in (f"CBS {r.status_code}", error.get("code"), error.get("message") or body.get("message"))
			if x
		)
		if r.status_code == 401:
			if token:
				raise Expired(what)
			raise Rejected(f"CBS login refused: {what}")
		if r.status_code == 429:
			raise Retry(what, after=cint(error.get("retryAfter")) or 60)
		if r.status_code >= 500:
			raise Retry(what)
		if r.status_code >= 400:
			raise Rejected(what)
		return body

	def paged(self, path, key):
		page = 1
		while True:
			body = self.call("GET", path, params={"page": page, "limit": 100})
			yield from body.get(key) or []
			pages = body.get("pages") or (body.get("pagination") or {}).get("pages") or 1
			if page >= cint(pages):
				break
			page += 1

	def catalog(self, refresh=False):
		"""The CBS project, its events and its regions, cached for an hour."""
		cached = None if refresh else frappe.cache.get_value(self.key + ":catalog", expires=True)
		if cached:
			return cached
		project = self.project or ((self.call("GET", "/api/projects").get("projects") or [{}])[0]).get("_id")
		if not project:
			raise Rejected("The CBS account has no project.")
		raw = list(self.paged(f"/api/geo/regions/{project}", "regions"))
		levels = None
		if any(not isinstance(r.get("level"), dict) for r in raw):
			levels = {
				lv.get("_id"): lv.get("name")
				for lv in self.call("GET", f"/api/geo/levels/{project}").get("levels") or []
			}
		catalog = {
			"project": project,
			"events": [
				{"_id": e.get("_id"), "name": e.get("name") or "", "code": e.get("code") or ""}
				for e in self.paged(f"/api/events/{project}", "events")
			],
			"regions": regions_of(raw, levels),
		}
		frappe.cache.set_value(self.key + ":catalog", catalog, expires_in_sec=CATALOG_SECONDS)
		return catalog


def _id(value):
	return value.get("_id") if isinstance(value, dict) else value


def regions_of(raw, levels=None):
	"""CBS regions as a flat list: id, name, kind (county, sub_county or other) and the county above each."""
	flat = {}

	def add(region, parent=None):
		level = region.get("level")
		level_name = level.get("name") if isinstance(level, dict) else (levels or {}).get(level)
		level_name = (level_name or "").strip().lower()
		kind = (
			"county"
			if level_name == "county"
			else "sub_county"
			if "sub" in level_name and "county" in level_name
			else "other"
		)
		flat[region["_id"]] = {
			"id": region["_id"],
			"name": region.get("name") or "",
			"kind": kind,
			"parent": _id(region.get("parent")) or parent,
		}
		for child in region.get("children") or []:
			add(child, region["_id"])

	for region in raw:
		add(region)
	for region in flat.values():
		node, seen = region, set()
		while node and node["kind"] != "county" and node["id"] not in seen:
			seen.add(node["id"])
			node = flat.get(node["parent"])
		region["county"] = node["name"] if node and node["kind"] == "county" else ""
	return list(flat.values())


def pick_region(regions, sub_county, county):
	"""The CBS sub-county of the same name (under the same county when there are two), else the county."""
	subs = [
		r for r in regions if r["kind"] == "sub_county" and norm_place(r["name"]) == norm_place(sub_county)
	]
	if len(subs) > 1:
		subs = [r for r in subs if norm_place(r["county"]) == norm_place(county)] or subs[:1]
	if subs:
		return subs[0], "sub-county"
	counties = [r for r in regions if r["kind"] == "county" and norm_place(r["name"]) == norm_place(county)]
	return (counties[0], "county") if counties else (None, None)


def pick_event(events, disease, category, deaths):
	"""The CBS event for the suspected disease (matched as the CBS feed matches them, surveillance.anomaly.diseases),
	else CBS's unusual illness or death event for people or animals, else its unusual event."""
	by_key = {}
	for e in events:
		for name in (e["name"], e["code"]):
			by_key.setdefault(to_key(name), e)
	who = "animals" if "animal" in (category or "").lower() else "people"
	first, second = ("death", "illness") if deaths else ("illness", "death")
	for key in (disease, f"unusual-{first}-{who}", f"unusual-{second}-{who}", "unusual-event"):
		if key and key in by_key:
			return by_key[key]
	return None


def describe(doc, danger_signs=None):
	"""What a CBS responder reads. The reporter's notes lose names, numbers and IDs (redact.py)."""
	parts = [f"KRCS WhatsApp community report {doc.name}."]
	if doc.symptom_tags:
		parts.append(f"Signs: {doc.symptom_tags}.")
	people = f"People affected: {cint(doc.affected_count)}"
	parts.append(people + (f", deaths: {cint(doc.deaths_count)}." if cint(doc.deaths_count) else "."))
	if doc.onset_date:
		parts.append(f"Started: {doc.onset_date}.")
	if doc.suspected_disease:
		label = frappe.db.get_value("Alert Threshold Config", doc.suspected_disease, "disease_name")
		parts.append(
			f"Suspected ({(doc.classified_by or 'rules').lower()}, not confirmed): {label or doc.suspected_disease}."
		)
	if danger_signs:
		parts.append(f"Danger signs: {', '.join(danger_signs)}.")
	if doc.additional_notes:
		parts.append(f"Reporter's notes: {redact(doc.additional_notes)}")
	return " ".join(parts)[:2000]


def build_payload(doc, catalog, danger_signs=None):
	"""The CBS report for a Case Report, and where its region came from."""
	place = (
		frappe.db.get_value(
			"Sub County", doc.sub_county, ["sub_county_name", "county", "latitude", "longitude"], as_dict=True
		)
		or frappe._dict()
	)
	region, matched = pick_region(catalog["regions"], place.sub_county_name or doc.sub_county, place.county)
	if not region:
		raise Rejected(
			f"No CBS region for {place.sub_county_name or doc.sub_county} ({place.county or 'no county'})."
		)
	event = pick_event(catalog["events"], doc.suspected_disease, doc.category, cint(doc.deaths_count))
	if not event:
		raise Rejected(
			"No CBS event for this report, and CBS has no unusual illness, death or event to use instead."
		)
	location = {"name": ", ".join(x for x in (doc.location_name, place.sub_county_name, place.county) if x)}
	if place.latitude and place.longitude:
		location["coordinates"] = [place.longitude, place.latitude]  # CBS stores [longitude, latitude]
	payload = {
		"project": catalog["project"],
		"event": event["_id"],
		"region": region["id"],
		"noOfCases": cint(doc.affected_count),
		"date": str(doc.report_date),
		"phoneNumber": doc.phone_number,
		"description": describe(doc, danger_signs),
		"location": location,
	}
	return payload, matched


def masked(payload):
	"""The payload as kept on the CBS Write-back record: the number is not stored a second time."""
	phone = str(payload.get("phoneNumber") or "")
	return json.dumps(
		{**payload, "phoneNumber": f"{phone[:4]}…{phone[-3:]}" if phone else ""}, indent=1, ensure_ascii=False
	)


def queue(report, danger_signs=None):
	"""jobs.after_submit, for a community report: record it and send it."""
	if not frappe.db.exists(WRITEBACK, report):
		frappe.get_doc(
			{
				"doctype": WRITEBACK,
				"case_report": report,
				"status": "Queued",
				"danger_signs": json.dumps(list(danger_signs or [])),
				# Not picked up by retry_due while this first attempt runs.
				"next_attempt": add_to_date(now_datetime(), minutes=10),
			}
		).insert(ignore_permissions=True)
		frappe.db.commit()  # nosemgrep
	return push(report)


def push(report):
	"""One attempt to create the report in CBS. Returns the record's status."""
	# Locks the row, so the scheduler and this job never send the same report twice.
	if frappe.db.get_value(WRITEBACK, report, "status", for_update=True) != "Queued":
		return frappe.db.get_value(WRITEBACK, report, "status")
	row = frappe.get_doc(WRITEBACK, report)
	row.attempts = cint(row.attempts) + 1
	danger_signs = json.loads(row.danger_signs or "[]")
	try:
		client = Client.from_settings()
		doc = frappe.get_doc("Case Report", report)
		try:
			payload, matched = build_payload(doc, client.catalog(), danger_signs)
		except Rejected:  # a region or event added in CBS since the catalog was cached
			payload, matched = build_payload(doc, client.catalog(refresh=True), danger_signs)
		row.payload = masked(payload)
		created = client.call("POST", "/api/reports", json=payload).get("report") or {}
	except Rejected as e:
		_failed(row, str(e))
	except Retry as e:
		_later(row, str(e), e.after)
	except Exception:
		frappe.log_error(title=f"CBS write-back error on {report}")
		_later(row, "Unexpected error: see the Error Log.", 0)
	else:
		row.update(
			{
				"status": "Sent",
				"cbs_case_number": created.get("caseNumber"),
				"cbs_report_id": created.get("_id"),
				"sent_on": now_datetime(),
				"next_attempt": None,
				"message": f"Created in CBS (region matched at {matched} level)."
				+ ("" if created.get("caseNumber") else " CBS returned no case number."),
			}
		)
	row.save(ignore_permissions=True)
	frappe.db.commit()  # nosemgrep
	if row.status == "Failed":
		_alert_desk(row, danger_signs)
	return row.status


def _later(row, message, after_seconds):
	if row.attempts > len(BACKOFF_MINUTES):
		_failed(row, f"Gave up after {row.attempts} attempts. Last: {message}")
		return
	wait = max(BACKOFF_MINUTES[row.attempts - 1] * 60, cint(after_seconds))
	row.update({"next_attempt": add_to_date(now_datetime(), seconds=wait), "message": message})


def _failed(row, message):
	row.update({"status": "Failed", "next_attempt": None, "message": message})


def _alert_desk(row, danger_signs):
	"""The report didn't reach CBS, so the WhatsApp desk gets it as staff reports do."""
	from surveillance.whatsapp.jobs import notify_desk

	phone = (frappe.db.get_value("Case Report", row.case_report, "phone_number") or "").lstrip("+")
	try:
		notify_desk(row.case_report, phone, None, danger_signs)
		frappe.db.set_value(WRITEBACK, row.name, "desk_alerted", 1, update_modified=False)
	except Exception:
		frappe.log_error(title=f"CBS write-back failed and the desk alert failed too on {row.case_report}")
	frappe.db.commit()  # nosemgrep


def retry_due():
	"""Scheduler (cron, every 5 minutes): reports waiting for another attempt. Turning the write-back off holds them."""
	if not enabled():
		return
	for name in frappe.get_all(
		WRITEBACK,
		filters={"status": "Queued", "next_attempt": ["<=", now_datetime()]},
		order_by="next_attempt asc",
		pluck="name",
		limit=50,
	):
		push(name)


def forget(report):
	"""retention.anonymise_reporter: the CBS copy loses its description and number too. A failure is logged for the
	Data Protection Officer to follow up with the CBS team; it doesn't stop the removal in Frappe."""
	if not frappe.db.exists(WRITEBACK, report):
		return None
	row = frappe.get_doc(WRITEBACK, report)
	row.payload = None
	if row.status == "Queued":
		row.update(
			{
				"status": "Cancelled",
				"next_attempt": None,
				"message": "Not sent: the reporter's details were removed first.",
			}
		)
	elif row.status == "Sent" and row.cbs_report_id:
		try:
			Client.from_settings().call(
				"PUT",
				f"/api/reports/{row.cbs_report_id}",
				json={"description": REMOVED_TEXT, "phoneNumber": ""},
			)
			row.message = "Description and number cleared in CBS at the reporter's request."
		except Exception as e:
			row.message = f"CBS copy NOT cleared ({e}). Ask the CBS team to clear {row.cbs_case_number or row.cbs_report_id}."
			frappe.log_error(title=f"CBS copy of {report} not cleared after a data removal request")
	elif row.status == "Sent":
		row.message = (
			f"CBS returned no report ID. Ask the CBS team to clear {row.cbs_case_number or 'the CBS copy'}."
		)
	row.save(ignore_permissions=True)
	return row.status


@frappe.whitelist()
def check():
	"""Before turning the write-back on (System Manager): log in, read the CBS catalog and show how each active
	sub-county and disease would be matched.
	bench --site <site> execute surveillance.whatsapp.cbs.check"""
	frappe.only_for("System Manager")
	client = Client.from_settings()
	catalog = client.catalog(refresh=True)
	sub_counties = {}
	for s in frappe.get_all(
		"Sub County", filters={"is_active": 1}, fields=["name", "sub_county_name", "county"]
	):
		region, matched = pick_region(catalog["regions"], s.sub_county_name, s.county)
		sub_counties[s.name] = f"{region['name']} ({matched})" if region else "NO MATCH"
	diseases = {}
	for d in frappe.get_all("Alert Threshold Config", fields=["name", "category"]):
		event = pick_event(catalog["events"], d.name, d.category, 0)
		diseases[d.name] = event["name"] if event else "NO MATCH"
	return {
		"url": client.base,
		"project": catalog["project"],
		"events": len(catalog["events"]),
		"regions": len(catalog["regions"]),
		"sub_counties": sub_counties,
		"diseases": diseases,
	}
