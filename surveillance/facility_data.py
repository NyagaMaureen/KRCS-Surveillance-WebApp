"""Facility Data page: upload KHIS MOH 505 exports (IDSR) and feed them to the outbreak engine.

Flow: the browser uploads the file privately (upload_file) -> preview_upload() reads it and shows what it
contains -> confirm_upload() saves that facility's weeks, rebuilds Weekly Count (source IDSR) and runs
detection in the background. Each upload replaces only the weeks in its own file, for its own facility.

MOH 505 exports are weekly aggregate counts: no names, phone numbers or other personal data.
Who can use it: capability upload_facility_data.
"""
import json

import frappe
from frappe import _
from frappe.utils import add_days, get_fullname, getdate, now_datetime, today

from surveillance.capabilities import require_capability
from surveillance.weekly_counts import (FACILITY, FACILITY_WEEK, REPORTING_WEEK, UnknownFacility, file_kind,
	find_facility, parse_moh505_file, parse_reporting_file, rebuild_idsr, store_cases, store_reporting, week_start)

CAP = "upload_facility_data"
UPLOAD = "IDSR Upload"
ALLOWED = (".xls", ".xlsx")
MAX_MB = 10


def _disease_names():
	return {d.name: d.disease_name or d.name
		for d in frappe.get_all("Alert Threshold Config", fields=["name", "disease_name"])}


def _file(file_url):
	if not file_url:
		frappe.throw(_("No file was uploaded."))
	name = frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not name:
		frappe.throw(_("Uploaded file not found. Please upload it again."))
	f = frappe.get_doc("File", name)
	if not (f.file_name or "").lower().endswith(ALLOWED):
		frappe.throw(_("Please upload the KHIS export as an Excel file (.xls or .xlsx)."))
	if (f.file_size or 0) > MAX_MB * 1024 * 1024:
		frappe.throw(_("The file is larger than {0} MB. Is it the right export?").format(MAX_MB))
	return f


def _analyse(f):
	"""Read the file. Returns (kind, unit, facility or None, parsed, summary dict)."""
	path = f.get_full_path()
	kind = file_kind(path, f.file_name)
	if kind == "Reporting":
		unit, weeks = parse_reporting_file(path)
		parsed = {"weeks": weeks}
		week_list = sorted(weeks)
	else:
		unit, rows, weeks, skipped = parse_moh505_file(path)
		parsed = {"rows": rows, "weeks": weeks}
		week_list = sorted(weeks)

	try:
		facility = find_facility(unit)
	except UnknownFacility:
		facility = None

	summary = {"kind": kind, "unit": unit, "facility": facility,
		"first_week": str(week_list[0]) if week_list else None,
		"last_week": str(week_list[-1]) if week_list else None,
		"weeks": len(week_list), "cases": 0, "deaths": 0, "diseases": [], "not_tracked": [], "ignored_columns": 0,
		"weeks_reported": None, "weeks_not_reported": None, "replaces_weeks": 0}

	if kind == "Reporting":
		summary["weeks_reported"] = sum(1 for v in parsed["weeks"].values() if v)
		summary["weeks_not_reported"] = sum(1 for v in parsed["weeks"].values() if not v)
	else:
		names, by = _disease_names(), {}
		for r in parsed["rows"]:
			d = by.setdefault(r["disease"], {"key": r["disease"], "name": names.get(r["disease"]), "cases": 0, "deaths": 0})
			d["cases"] += r["cases"]
			d["deaths"] += r["deaths"]
		summary["diseases"] = sorted([d for d in by.values() if d["name"]], key=lambda d: -d["cases"])
		summary["not_tracked"] = sorted(k for k, d in by.items() if not d["name"])
		summary["cases"] = sum(d["cases"] for d in summary["diseases"])
		summary["deaths"] = sum(d["deaths"] for d in summary["diseases"])
		summary["ignored_columns"] = len(skipped)

	if facility and week_list:
		dt = REPORTING_WEEK if kind == "Reporting" else FACILITY_WEEK
		summary["replaces_weeks"] = len(set(frappe.get_all(dt,
			filters={"facility": facility, "week_start": ["in", week_list]}, pluck="week_start")))
	return kind, unit, facility, parsed, summary


def _upload_shape(d):
	summary = json.loads(d.summary or "{}")
	return {"name": d.name, "fileName": d.file_name, "fileType": d.file_type, "status": d.status,
		"unit": d.khis_unit, "facility": d.facility, "firstWeek": str(d.first_week or ""), "lastWeek": str(d.last_week or ""),
		"weeks": d.weeks or 0, "cases": d.total_cases or 0, "deaths": d.total_deaths or 0, "error": d.error or "",
		"uploadedBy": get_fullname(d.uploaded_by) if d.uploaded_by else "", "uploadedOn": str(d.creation),
		"ingestedBy": get_fullname(d.ingested_by) if d.ingested_by else "", "ingestedOn": str(d.ingested_on or ""),
		"summary": summary}


@frappe.whitelist(methods=["POST"])
def preview_upload(file_url):
	"""Read an uploaded file and record it as an IDSR Upload, without changing any data yet."""
	require_capability(CAP)
	f = _file(file_url)
	doc = frappe.get_doc({"doctype": UPLOAD, "file": f.file_url, "file_name": f.file_name,
		"status": "Ready", "uploaded_by": frappe.session.user})
	try:
		kind, unit, facility, parsed, summary = _analyse(f)
		doc.update({"file_type": kind, "khis_unit": unit, "facility": facility,
			"first_week": summary["first_week"], "last_week": summary["last_week"], "weeks": summary["weeks"],
			"total_cases": summary["cases"], "total_deaths": summary["deaths"], "summary": json.dumps(summary)})
		if not facility:
			doc.status, doc.error = "Failed", _("We don't recognise the facility '{0}' in this file. Add it under Facilities, then upload again.").format(unit)
		elif not summary["weeks"]:
			doc.status, doc.error = "Failed", _("No weeks with data were found in this file.")
	except Exception as e:
		doc.status, doc.error = "Failed", str(e) or _("Could not read this file.")
	doc.insert(ignore_permissions=True)
	f.db_set({"attached_to_doctype": UPLOAD, "attached_to_name": doc.name, "is_private": 1})
	frappe.db.commit()
	return _upload_shape(doc)


@frappe.whitelist(methods=["POST"])
def confirm_upload(name, run_detection=1):
	"""Save the upload's weeks for its facility, rebuild IDSR weekly counts and (by default) run detection."""
	require_capability(CAP)
	doc = frappe.get_doc(UPLOAD, name)
	if doc.status != "Ready":
		frappe.throw(_("This upload is {0} and can't be confirmed.").format(doc.status.lower()))
	if not frappe.db.count(FACILITY_WEEK) and frappe.db.count("Weekly Count", {"source": "IDSR"}):
		frappe.throw(_("IDSR history hasn't been moved to facility level yet, so this upload would replace it. "
			"An administrator needs to run the one-off load (surveillance.weekly_counts.load_moh505) first."))

	f = _file(doc.file)
	kind, unit, facility, parsed, summary = _analyse(f)
	if not facility:
		frappe.throw(_("We don't recognise the facility '{0}'. Add it under Facilities first.").format(unit))
	if kind == "Reporting":
		store_reporting(facility, parsed["weeks"], upload=doc.name)
	else:
		store_cases(facility, parsed["rows"], parsed["weeks"], upload=doc.name)
	saved = rebuild_idsr()

	doc.update({"status": "Ingested", "facility": facility, "summary": json.dumps(summary),
		"ingested_by": frappe.session.user, "ingested_on": now_datetime()})
	doc.save(ignore_permissions=True)
	frappe.db.commit()

	if int(run_detection or 0):
		frappe.enqueue("surveillance.facility_data.run_detection_after_upload", queue="long",
			job_id="idsr-upload-detection", deduplicate=True, enqueue_after_commit=True)
	return {**_upload_shape(doc), "weeklyRows": saved, "detectionQueued": bool(int(run_detection or 0))}


def run_detection_after_upload():
	from surveillance.alerts import run_detection
	run_detection()
	try:
		from surveillance.events import refresh_links
		refresh_links()
	except Exception:
		frappe.log_error(title="Review Queue refresh after IDSR upload failed", message=frappe.get_traceback())


@frappe.whitelist(methods=["POST"])
def discard_upload(name):
	"""Drop an upload that wasn't confirmed (or failed). Its file is deleted; nothing else changes."""
	require_capability(CAP)
	doc = frappe.get_doc(UPLOAD, name)
	if doc.status == "Ingested":
		frappe.throw(_("This upload is already in the system. Upload a corrected file for the same weeks to replace it."))
	for fname in frappe.get_all("File", filters={"attached_to_doctype": UPLOAD, "attached_to_name": doc.name}, pluck="name"):
		frappe.delete_doc("File", fname, ignore_permissions=True)
	doc.db_set({"status": "Discarded", "file": None})
	frappe.db.commit()
	return _upload_shape(doc)


@frappe.whitelist()
def get_uploads(limit=100):
	require_capability(CAP)
	rows = frappe.get_all(UPLOAD, fields=["*"], order_by="creation desc", limit_page_length=min(int(limit), 500))
	return [_upload_shape(d) for d in rows]


@frappe.whitelist()
def get_coverage(weeks=12):
	"""Per facility, the status of each of the last `weeks` weeks:
	cases (has case data) | zero (reported, no cases) | not_reported (reporting file says missed) | none (nothing uploaded)."""
	require_capability(CAP)
	weeks = max(1, min(int(weeks), 52))
	last = week_start(add_days(today(), -7))  # last complete week
	cols = [add_days(last, -7 * i) for i in reversed(range(weeks))]
	first = cols[0]

	cases, reported = {}, {}
	for r in frappe.db.sql(f"""select facility, week_start, sum(cases) as cases from `tab{FACILITY_WEEK}`
			where week_start >= %s group by facility, week_start""", (first,), as_dict=True):
		cases[(r.facility, getdate(r.week_start))] = int(r.cases or 0)
	for r in frappe.get_all(REPORTING_WEEK, filters={"week_start": [">=", first]}, fields=["facility", "week_start", "reported"], limit_page_length=0):
		reported[(r.facility, getdate(r.week_start))] = bool(r.reported)

	latest = {r.facility: r.last for r in frappe.db.sql(f"""select facility, max(week_start) as last
		from `tab{FACILITY_WEEK}` group by facility""", as_dict=True)}
	last_upload = {r.facility: r.last for r in frappe.db.sql(f"""select facility, max(ingested_on) as last
		from `tab{UPLOAD}` where status = 'Ingested' group by facility""", as_dict=True)}

	out = []
	for f in frappe.get_all(FACILITY, fields=["name", "county", "sub_county_name", "is_active"], order_by="county asc, sub_county_name asc, name asc"):
		cells = []
		for w in cols:
			key = (f.name, w)
			if key in cases:
				status = "cases"
			elif reported.get(key) is True:
				status = "zero"
			elif reported.get(key) is False:
				status = "not_reported"
			else:
				status = "none"
			cells.append({"week": str(w), "status": status, "cases": cases.get(key, 0)})
		out.append({"facility": f.name, "county": f.county, "subCounty": f.sub_county_name, "active": bool(f.is_active),
			"latestWeek": str(latest.get(f.name) or ""), "lastUpload": str(last_upload.get(f.name) or ""), "weeks": cells})
	return {"weeks": [str(w) for w in cols], "facilities": out}


@frappe.whitelist()
def get_facilities():
	require_capability(CAP)
	counts = {r.facility: r.n for r in frappe.db.sql(f"select facility, count(distinct week_start) as n from `tab{FACILITY_WEEK}` group by facility", as_dict=True)}
	return [{"name": f.name, "khisMatch": f.khis_match, "subCounty": f.sub_county, "subCountyName": f.sub_county_name,
		"county": f.county, "active": bool(f.is_active), "weeksLoaded": counts.get(f.name, 0)}
		for f in frappe.get_all(FACILITY, fields=["name", "khis_match", "sub_county", "sub_county_name", "county", "is_active"], order_by="name asc")]


@frappe.whitelist(methods=["POST"])
def save_facility(facility_name, khis_match, sub_county, active=1, name=None):
	"""Create or edit a reporting facility. Renaming is not supported (it is the record's id); deactivate instead."""
	require_capability(CAP)
	facility_name, khis_match = (facility_name or "").strip(), (khis_match or "").strip()
	if not facility_name or not khis_match or not sub_county:
		frappe.throw(_("Facility name, name in KHIS files and sub-county are required."))
	if name:
		doc = frappe.get_doc(FACILITY, name)
	else:
		if frappe.db.exists(FACILITY, facility_name):
			frappe.throw(_("A facility called {0} already exists.").format(facility_name))
		doc = frappe.new_doc(FACILITY)
		doc.facility_name = facility_name
	doc.update({"khis_match": khis_match, "sub_county": sub_county, "is_active": 1 if int(active) else 0})
	doc.save(ignore_permissions=True)
	# a facility moved to another sub-county changes where its cases count
	if name and doc.has_value_changed("sub_county"):
		rebuild_idsr()
	frappe.db.commit()
	return {"name": doc.name}
