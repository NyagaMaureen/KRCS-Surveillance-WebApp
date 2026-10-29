"""CHP workspace: the simple dashboard and account page for Community Health Promoters.

Everything here is about the logged-in user only (their own reports, follow-ups and referrals).
"""
import frappe
from frappe import _
from frappe.utils import add_days, add_months, cint, get_datetime, get_first_day, getdate, nowdate

from surveillance.capabilities import CAPABILITY_MAP, get_user_capabilities

TASK = "Event Task"
OPEN = ["Assigned", "In progress"]


def _own_reports_filter(user):
	return {"or_filters": {"reported_by": user, "owner": user}}


def _count_reports(user, start, end):
	return len(frappe.get_all("Case Report", filters={"creation": ["between", [start, end]]},
		or_filters={"reported_by": user, "owner": user}, pluck="name"))


def _on_time(user, start, end):
	"""Share of reports with an onset date that were sent within 24 hours (same or next day)."""
	rows = frappe.get_all("Case Report", filters={"creation": ["between", [start, end]], "onset_date": ["is", "set"]},
		or_filters={"reported_by": user, "owner": user}, fields=["creation", "onset_date"])
	if not rows:
		return None
	ok = sum(1 for r in rows if getdate(r.creation) <= add_days(getdate(r.onset_date), 1))
	return round(100.0 * ok / len(rows), 1)


def _pct_change(now, before):
	if now is None or before in (None, 0):
		return None
	return round(100.0 * (now - before) / before, 1)


def _period():
	today = getdate(nowdate())
	start = get_first_day(today)
	prev_start = add_months(start, -1)
	prev_end = add_days(start, -1)
	return (str(start), f"{today} 23:59:59"), (str(prev_start), f"{prev_end} 23:59:59")


def _stats(user):
	(cur_s, cur_e), (prev_s, prev_e) = _period()

	def tasks_done(kind, s, e):
		f = {"assigned_to": user, "status": "Done", "completed_on": ["between", [s, e]]}
		f["task_type"] = "Referral" if kind == "ref" else ["!=", "Referral"]
		return frappe.db.count(TASK, f)

	def referrals(s, e):
		return frappe.db.count(TASK, {"assigned_to": user, "task_type": "Referral", "creation": ["between", [s, e]]})

	cur = {"reports": _count_reports(user, cur_s, cur_e), "followups": tasks_done("fu", cur_s, cur_e),
		"referrals": referrals(cur_s, cur_e), "onTime": _on_time(user, cur_s, cur_e)}
	prev = {"reports": _count_reports(user, prev_s, prev_e), "followups": tasks_done("fu", prev_s, prev_e),
		"referrals": referrals(prev_s, prev_e), "onTime": _on_time(user, prev_s, prev_e)}
	return [
		{"key": "reports", "label": "Reports sent", "value": cur["reports"], "change": _pct_change(cur["reports"], prev["reports"])},
		{"key": "followups", "label": "Follow-ups done", "value": cur["followups"], "change": _pct_change(cur["followups"], prev["followups"])},
		{"key": "referrals", "label": "Referrals made", "value": cur["referrals"], "change": _pct_change(cur["referrals"], prev["referrals"])},
		{"key": "onTime", "label": "Reported on time", "value": cur["onTime"], "unit": "%",
			"change": _pct_change(cur["onTime"], prev["onTime"]),
			"hint": "Reports sent within 24 hours of symptoms starting"},
	]


@frappe.whitelist()
def get_chp_dashboard():
	from surveillance.event_tasks import FIELDS, _shape
	user = frappe.session.user
	followups = frappe.get_all(TASK, filters={"assigned_to": user, "status": ["in", OPEN], "task_type": ["!=", "Referral"]},
		fields=FIELDS, order_by="due_date asc", limit_page_length=3)
	referrals = frappe.get_all(TASK, filters={"assigned_to": user, "task_type": "Referral"},
		fields=FIELDS, order_by="creation desc", limit_page_length=3)
	reports = frappe.get_all("Case Report", or_filters={"reported_by": user, "owner": user},
		fields=["name", "symptom_tags", "location_name", "sub_county", "status", "creation", "signal_type",
			"suspected_disease", "affected_count", "deaths_count"],
		order_by="creation desc", limit_page_length=3)
	diseases = {r.suspected_disease for r in reports if r.suspected_disease}
	names = {d: (frappe.db.get_value("Alert Threshold Config", d, "disease_name") or d) for d in diseases}
	return {
		"stats": _stats(user),
		"period": "This month, compared with last month",
		"followups": [_shape(t) for t in followups],
		"referrals": [_shape(t) for t in referrals],
		"reports": [{"id": r.name, "disease": names.get(r.suspected_disease),
			"symptoms": [s.strip() for s in (r.symptom_tags or "").split(",") if s.strip()],
			"place": ", ".join(x for x in [r.location_name, r.sub_county] if x), "people": cint(r.affected_count),
			"deaths": cint(r.deaths_count), "status": r.status, "createdOn": str(r.creation)}
			for r in reports],
	}


# ---------- account (Settings for CHPs) ----------

def _name(doctype, value, field):
	return frappe.db.get_value(doctype, value, field) if value else None


@frappe.whitelist()
def get_my_account():
	user = frappe.session.user
	u = frappe.get_doc("User", user)
	caps = sorted(get_user_capabilities(user))
	return {
		"id": u.name, "firstName": u.first_name or "", "lastName": u.last_name or "", "fullName": u.full_name,
		"email": u.email, "phone": u.mobile_no or "", "photo": u.user_image or None,
		"role": u.get("primary_role") or "User", "status": u.get("account_status") or ("Active" if u.enabled else "Disabled"),
		"region": _name("Region", u.get("assigned_region"), "region_name"),
		"subCounty": _name("Sub County", u.get("assigned_sub_county"), "sub_county_name"),
		"joined": str(u.creation)[:10], "lastLogin": str(u.last_login) if u.last_login else None,
		"lastPasswordReset": str(u.last_password_reset_date) if u.get("last_password_reset_date") else None,
		"permissions": [{"key": k, "name": CAPABILITY_MAP[k]["name"], "description": CAPABILITY_MAP[k]["description"]}
			for k in caps if k in CAPABILITY_MAP],
		"stats": _stats(user),
	}


@frappe.whitelist(methods=["POST"])
def update_my_profile(phone=None, photo=None):
	"""Users may change only their own phone number and photo. Everything else is managed by an admin."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	u = frappe.get_doc("User", user)
	if phone is not None:
		phone = phone.strip()
		digits = "".join(c for c in phone if c.isdigit())
		if phone and not (9 <= len(digits) <= 13):
			frappe.throw(_("Enter a valid phone number."))
		u.mobile_no = phone
	if photo is not None:
		u.user_image = photo or None
	u.flags.ignore_permissions = True
	u.save()
	return get_my_account()
