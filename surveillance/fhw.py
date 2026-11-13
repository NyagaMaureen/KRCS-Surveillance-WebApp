"""Facility Health Worker (FHW) workspace (Nov 2026, from Allan): an FHW reports cases from their facility when the EMR
is down, confirms whether patients referred to their facility arrived, and sees alerts near the facility.

Each FHW has an assigned facility (User.assigned_facility, from the MOH 505 Reporting Facility list). Referrals a CHP
makes to that facility (Event Task, task_type Referral, facility = the facility name) show on the FHW's Referrals page;
the FHW marks them Arrived / Did not arrive, and the CHP sees it on their own Referrals page.

Referrals are stored as Event Tasks; the referral number follows the task number (TSK-00009 -> REF-009). FHWs can
open the linked report read-only.
"""
import frappe
from frappe import _
from frappe.utils import add_days, cint, get_fullname, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability, require_capability

TASK = "Event Task"
FACILITY = "Reporting Facility"
CONFIRM = "receive_referrals"
OPEN_EVENT = ["New", "Verifying", "Investigating", "Confirmed", "Escalated"]
REFERRAL_STATUS = {"Assigned": "Pending", "In progress": "Pending", "Done": "Arrived", "Could not complete": "Did not arrive"}
REPORT_STATUS = {"Submitted": "Awaiting review"}
TASK_FIELDS = ["name", "people_referred", "reason", "instructions", "facility", "assigned_to", "case_report", "creation",
	"status", "outcome", "patient_age_group", "patient_sex", "disease_name"]


def _my_facility():
	"""(facility name, Sub County id, sub-county name) for the logged-in FHW, or (None, None, None)."""
	user = frappe.session.user
	fac = frappe.db.get_value("User", user, "assigned_facility") if frappe.get_meta("User").has_field("assigned_facility") else None
	sc = frappe.db.get_value("User", user, "assigned_sub_county")
	if fac:
		sc = frappe.db.get_value(FACILITY, fac, "sub_county") or sc
	sc_name = frappe.db.get_value("Sub County", sc, "sub_county_name") if sc else None
	return fac, sc, sc_name


def _week(d):
	d = getdate(d)
	return add_days(d, -d.weekday())


def ref_no(t):
	"""The referral number people use: the task number, TSK-00009 -> REF-009."""
	try:
		return f"REF-{int(str(t.name).rsplit('-', 1)[-1]):03d}"
	except ValueError:
		return t.name


def _disease_name(key):
	return (frappe.db.get_value("Alert Threshold Config", key, "disease_name") or key) if key else ""


def _report_summaries(names):
	"""Short details of the linked reports, for the referral list: disease, symptoms, place."""
	names = [n for n in set(names) if n]
	if not names:
		return {}
	meta = frappe.get_meta("Case Report")
	fields = ["name", "suspected_disease", "location_name", "sub_county", "affected_count", "age_group", "severity"]
	if meta.has_field("age_groups"):
		fields.append("age_groups")
	out = {}
	for r in frappe.get_all("Case Report", filters={"name": ["in", names]}, fields=fields):
		syms = frappe.get_all("Case Report Symptom", filters={"parent": r.name, "parenttype": "Case Report"}, pluck="symptom")
		out[r.name] = {
			"disease": _disease_name(r.suspected_disease),
			"symptoms": [frappe.db.get_value("Symptom", s, "symptom_name") or s for s in syms],
			"place": ", ".join(x for x in [r.location_name, frappe.db.get_value("Sub County", r.sub_county, "sub_county_name") if r.sub_county else ""] if x),
			"ageGroups": r.get("age_groups") or r.age_group or "",
			"severity": r.severity or "",
		}
	return out


def _referral(t, reports=None):
	rep = (reports or {}).get(t.case_report) or {}
	patient = " · ".join(x for x in [t.get("patient_age_group"), t.get("patient_sex")] if x)
	return {
		"id": t.name, "ref": ref_no(t), "people": cint(t.get("people_referred")) or None,
		"reason": t.reason or t.instructions or "", "facility": t.facility,
		"from": get_fullname(t.assigned_to) if t.assigned_to else "",
		"caseReport": t.case_report or None, "date": str(t.creation),
		"status": REFERRAL_STATUS.get(t.status, t.status), "note": t.outcome or "",
		"patient": patient or rep.get("ageGroups", ""),
		"condition": rep.get("disease") or t.get("disease_name") or "",
		"symptoms": rep.get("symptoms", []), "place": rep.get("place", ""),
	}


def _referrals(fac, limit=500):
	rows = frappe.get_all(TASK, filters={"task_type": "Referral", "facility": fac}, order_by="creation desc",
		fields=TASK_FIELDS, limit_page_length=limit) if fac else []
	reports = _report_summaries([r.case_report for r in rows])
	return [_referral(r, reports) for r in rows]


@frappe.whitelist()
def referral_facilities():
	"""Active facilities, for the CHP referral list and the FHW facility in User Management. New facilities added on
	the MOH 505 Facility Reports page appear here straight away."""
	return [{"name": f.name, "subCounty": f.sub_county_name or ""}
		for f in frappe.get_all(FACILITY, filters={"is_active": 1}, fields=["name", "sub_county_name"], order_by="name asc")]


def _facility_trend(fac):
	"""MOH 505 cases at this facility, for the last 8 weeks that were uploaded (the weeks as in the files), with the
	top diseases each week for the tooltip."""
	if not fac:
		return {"labels": [], "titles": [], "cases": [], "top": []}
	from surveillance.alerts import epi_label, epi_week
	weeks = frappe.db.sql_list("""select distinct week_start from `tabIDSR Facility Week` where facility = %s
		order by week_start desc limit 8""", fac)[::-1]
	if not weeks:
		return {"labels": [], "titles": [], "cases": [], "top": []}
	per = {w: {} for w in weeks}
	for r in frappe.get_all("IDSR Facility Week", filters={"facility": fac, "week_start": ["in", weeks]},
			fields=["week_start", "disease", "cases"], limit_page_length=0):
		if cint(r.cases) > 0 and r.week_start in per:
			per[r.week_start][r.disease] = per[r.week_start].get(r.disease, 0) + cint(r.cases)
	names = {}
	def name(key):
		if key not in names:
			names[key] = _disease_name(key)
		return names[key]
	return {
		"labels": [f"W{epi_week(w)[1]}" for w in weeks], "titles": [epi_label(w) for w in weeks],
		"cases": [sum(per[w].values()) for w in weeks],
		"top": [[{"disease": name(k), "cases": n} for k, n in sorted(per[w].items(), key=lambda x: -x[1])[:3]] for w in weeks],
	}


@frappe.whitelist()
def get_dashboard():
	"""Everything on the FHW dashboard: the facility, four counts, facility case trend, referrals, alerts."""
	require_capability("fhw_workspace")
	user = frappe.session.user
	fac, sc, sc_name = _my_facility()
	since = add_days(nowdate(), -30)

	my_reports = frappe.db.count("Case Report", {"reported_by": user, "creation": [">=", since]})
	events = frappe.get_all("Surveillance Event", filters={"status": ["in", OPEN_EVENT], "sub_county": sc_name},
		fields=["name", "title", "disease_name", "severity", "status", "area", "people", "last_reported"],
		order_by="last_reported desc", limit_page_length=50) if sc_name else []
	referrals = _referrals(fac, 200)
	pending = sum(1 for r in referrals if r["status"] == "Pending")
	tasks = frappe.db.count(TASK, {"assigned_to": user, "status": ["in", ["Assigned", "In progress"]],
		"task_type": ["!=", "Referral"]})

	# unusual rises flagged in the area in the last 4 weeks, active diseases only
	rises = []
	if sc_name:
		from surveillance.alert_thresholds import active_diseases
		active = active_diseases()
		for a in frappe.get_all("Risk Alert", filters={"status": ["in", ["Pending", "Investigating", "Confirmed"]],
				"last_week": [">=", add_days(_week(nowdate()), -28)]},
				fields=["name", "disease", "disease_name", "severity", "status", "location", "sub_county", "last_week", "signals"],
				order_by="last_week desc", limit_page_length=50):
			if (a.sub_county or a.location or "").strip().lower() == sc_name.strip().lower() and a.disease in active:
				rises.append({"id": a.name, "title": f"{a.disease_name} rising", "severity": a.severity, "status": a.status,
					"week": str(a.last_week), "cases": cint(a.signals), "kind": "rise"})

	return {
		"facility": fac, "subCounty": sc_name,
		"cards": {"reports": my_reports, "suspected": len(events), "pendingReferrals": pending, "tasks": tasks},
		"facilityTrend": _facility_trend(fac),
		"referrals": referrals[:5],
		"alerts": rises[:5] + [{"id": e.name, "title": e.title or e.disease_name, "severity": e.severity, "status": e.status,
			"area": e.area, "people": cint(e.people), "date": str(e.last_reported or ""), "kind": "event"} for e in events[:5]],
		"canConfirm": has_capability(CONFIRM),
		"canSeeAlerts": has_capability("view_alerts"),
	}


@frappe.whitelist()
def facility_referrals():
	"""Referrals CHPs made to the logged-in FHW's facility, newest first."""
	require_capability(CONFIRM)
	fac, _sc, _n = _my_facility()
	return {"facility": fac, "referrals": _referrals(fac) if fac else []}


def _my_referral(task):
	fac, _sc, _n = _my_facility()
	t = frappe.get_doc(TASK, task)
	if t.task_type != "Referral" or not fac or t.facility != fac:
		frappe.throw(_("This referral is not to your facility."), frappe.PermissionError)
	return t, fac


@frappe.whitelist()
def referral_report(task):
	"""The full report behind a referral to the FHW's facility, read-only. Reporter phone is left out."""
	require_capability(CONFIRM)
	t, _fac = _my_referral(task)
	out = {"referral": _referral(t, _report_summaries([t.case_report])), "report": None}
	if not t.case_report or not frappe.db.exists("Case Report", t.case_report):
		return out
	r = frappe.get_doc("Case Report", t.case_report)
	syms = [frappe.db.get_value("Symptom", s.symptom, "symptom_name") or s.symptom for s in (r.symptoms or [])]
	absent = [x.strip() for x in (r.absent_symptom_tags or r.absent_symptoms or "").split(",") if x.strip()]
	notes = []
	for a in r.attachments or []:
		if a.attachment_type == "Text Note" and a.text_content:
			notes.append({"kind": "Text note", "text": a.text_content})
		elif a.attachment_type == "Voice Note" and a.transcript:
			notes.append({"kind": "Voice note (transcript)", "text": a.transcript})
	files = sum(1 for a in (r.attachments or []) if a.attachment_type in ("Photo", "Attachment") or (a.attachment_type == "Voice Note" and not a.transcript))
	out["report"] = {
		"id": r.name, "status": REPORT_STATUS.get(r.status, r.status),
		"disease": _disease_name(r.suspected_disease), "alsoConsistentWith": r.also_consistent_with or "",
		"category": r.category or "", "signalType": r.signal_type or "", "severity": r.severity or "",
		"symptoms": syms, "absentSymptoms": absent,
		"onset": str(r.onset_date or ""), "reported": str(r.creation),
		"ageGroups": r.get("age_groups") or r.age_group or "", "people": cint(r.affected_count), "deaths": cint(r.deaths_count),
		"animalExposure": r.animal_exposure if r.animal_exposure and r.animal_exposure != "None" else "",
		"place": r.location_name or "",
		"subCounty": frappe.db.get_value("Sub County", r.sub_county, "sub_county_name") if r.sub_county else "",
		"reporter": r.reporter_name or (get_fullname(r.reported_by) if r.reported_by else ""),
		"channel": r.channel or "", "notes": r.additional_notes or "", "attachmentNotes": notes, "otherFiles": files,
		"updates": [{"at": str(u.at), "by": get_fullname(u.user) if u.user else "", "note": u.note} for u in (r.updates or []) if u.note],
	}
	return out


@frappe.whitelist(methods=["POST"])
def confirm_referral(task, arrived, note=None):
	"""The FHW at the receiving facility says whether the referred people arrived. The CHP who referred them is told."""
	require_capability(CONFIRM)
	t, fac = _my_referral(task)
	arrived = cint(arrived) == 1
	note = (note or "").strip()
	who = get_fullname(frappe.session.user)
	t.status = "Done" if arrived else "Could not complete"
	t.outcome = (f"{'Arrived' if arrived else 'Did not arrive'} at {fac} (confirmed by {who})" + (f": {note}" if note else ""))[:1000]
	t.completed_on = now_datetime()
	t.save(ignore_permissions=True)
	if t.assigned_to and t.assigned_to != frappe.session.user:
		try:
			frappe.get_doc({"doctype": "Notification Log", "for_user": t.assigned_to, "type": "Alert",
				"document_type": TASK, "document_name": t.name, "from_user": frappe.session.user,
				"subject": f"Referral {ref_no(t)} to {fac}: {'arrived' if arrived else 'did not arrive'}"}).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(title="Referral confirmation notice failed", message=frappe.get_traceback())
	return _referral(t, _report_summaries([t.case_report]))
