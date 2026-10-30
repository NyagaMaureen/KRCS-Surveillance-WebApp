"""What the WhatsApp conversation reads from and writes to Frappe (passed to it as ctx.data).

Lists come from the DocTypes, so the bot keeps none of its own: Select options from Case Report,
regions, sub-counties and symptoms from their DocTypes. They are cached for 10 minutes and cleared
when a Region, Sub County or Symptom is saved (hooks.py doc_events).

Staff are recognised by WhatsApp number = User.mobile_no (any format), if the user is enabled and
account_status is Active or empty. The phone index is cleared whenever a User is saved.
"""

import re

import frappe
from frappe import _
from frappe.utils import add_days, cint, today
from frappe.utils.caching import redis_cache

from surveillance.locations import get_sub_counties
from surveillance.whatsapp.conversation import normalize_phone

SETTINGS = "WhatsApp Settings"
REPORT_FIELDS = [
	"name",
	"status",
	"symptom_tags",
	"region",
	"sub_county",
	"location_name",
	"affected_count",
	"report_date",
	"reported_by",
	"phone_number",
	"creation",
]
DUPLICATE_DAYS = 3
# Protocol steps a reporter can act on; the same test as the mobile app's forReporters.
REPORTER_STEP = re.compile(r"\b(chps?|community|volunteers?)\b", re.IGNORECASE)
IGNORED_ROLES = {"All", "Guest", "Desk User"}


def settings():
	return frappe.get_cached_doc(SETTINGS)


def country_code():
	return settings().country_code or "254"


@redis_cache(ttl=600)
def catalog():
	meta = frappe.get_meta("Case Report")
	options = {
		f.fieldname: [o.strip() for o in (f.options or "").split("\n") if o.strip()]
		for f in meta.fields
		if f.fieldtype == "Select"
	}
	regions = frappe.get_all("Region", fields=["name", "region_name"], order_by="region_name asc")
	symptoms = frappe.get_all(
		"Symptom", fields=["name", "symptom_name", "category"], order_by="symptom_name asc"
	)
	return {
		"options": options,
		"required": [f.fieldname for f in meta.fields if f.reqd],
		"regions": [{"name": r.name, "label": (r.region_name or r.name).strip()} for r in regions],
		"symptoms": [
			{"name": s.name, "label": (s.symptom_name or s.name).strip(), "category": s.category or "Other"}
			for s in symptoms
		],
	}


@redis_cache(ttl=600)
def sub_counties(region):
	return [
		{"name": x.name, "label": x.sub_county_name, "county": x.county} for x in get_sub_counties(region)
	]


def clear_catalog_cache(doc=None, method=None):
	"""doc_events on Region, Sub County and Symptom."""
	catalog.clear_cache()
	sub_counties.clear_cache()


@redis_cache(ttl=600)
def _staff_index():
	"""normalised phone -> active users with that mobile number."""
	users = frappe.get_all(
		"User",
		filters={"enabled": 1, "mobile_no": ["is", "set"]},
		fields=["name", "full_name", "mobile_no", "primary_role", "assigned_region", "account_status"],
	)
	cc = country_code()
	index = {}
	for u in users:
		if u.account_status and u.account_status != "Active":
			continue
		index.setdefault(normalize_phone(u.mobile_no, cc), []).append(u)
	shared = {phone: [u.name for u in rows] for phone, rows in index.items() if len(rows) > 1}
	if shared:
		frappe.log_error(
			title="WhatsApp: users share a mobile number",
			message="These numbers are treated as community members until only one active user has them:\n"
			+ "\n".join(f"{phone}: {', '.join(names)}" for phone, names in shared.items()),
		)
	return index


def clear_staff_cache(doc=None, method=None):
	"""doc_events on User, and WhatsApp Settings on_update (country code)."""
	_staff_index.clear_cache()


def find_staff(phone):
	matches = _staff_index().get(normalize_phone(phone, country_code())) or []
	if len(matches) != 1:
		return None
	u = matches[0]
	return {
		"user": u.name,
		"full_name": u.full_name or u.name,
		"role": u.primary_role or None,
		"region": u.assigned_region or None,
	}


def roles_of(user):
	return [r for r in frappe.get_roles(user) if r not in IGNORED_ROLES]


def community_user():
	user = settings().community_user
	if not user:
		frappe.throw(_("Set the Community Reporter Account in WhatsApp Settings."))
	return user


def create_report(doc):
	"""Insert as the reporter, so Created by (owner) and the audit trail show who reported.
	Committed at once: the reporter is told the reference right after this."""
	if doc.get("client_ref"):
		existing = frappe.db.get_value("Case Report", {"client_ref": doc["client_ref"]}, "name")
		if existing:   # the same WhatsApp message was processed twice: reuse the report
			return _row(frappe.get_doc("Case Report", existing).as_dict(),
				[*REPORT_FIELDS, "reporter_name", "latitude", "longitude", "suspected_disease"])
	previous = frappe.session.user
	# The reporter was identified by their WhatsApp number (or is the community account); acting as them
	# makes them the owner. The previous user is always restored.
	frappe.set_user(doc["reported_by"])  # nosemgrep
	try:
		report = frappe.get_doc(doc).insert(ignore_permissions=True)
	finally:
		frappe.set_user(previous)  # nosemgrep
	# Commit before the reporter is sent the reference, so a later error in this job can't undo the report.
	frappe.db.commit()  # nosemgrep
	return _row(
		report.as_dict(), [*REPORT_FIELDS, "reporter_name", "latitude", "longitude", "suspected_disease"]
	)


def reporter_advice(disease, user):
	"""Next steps for a staff reporter, as the mobile app shows them (src/frappe/advice.ts): the steps of the
	approved Response Protocol for the suspected disease that are for CHPs, the community or volunteers.
	Steps only for users who may view protocols; the others get the disease name alone."""
	from surveillance.capabilities import has_capability
	from surveillance.protocols import MANAGE, VIEW, approved_for

	if not disease:
		return None
	label = frappe.db.get_value("Alert Threshold Config", disease, "disease_name") or disease
	if not (has_capability(VIEW, user) or has_capability(MANAGE, user)):
		return {"disease": label, "steps": []}
	from surveillance.field_api import UNUSUAL_EVENT, advice_steps
	steps = advice_steps(approved_for(disease)) or advice_steps(approved_for(UNUSUAL_EVENT))
	return {"disease": label, "steps": [{"step": s["step"], "timeframe": s["timeframe"] or ""} for s in steps]}


def find_duplicate(region, symptoms, days=DUPLICATE_DAYS):
	"""An open report in the same region, from the last `days` days, sharing at least one symptom."""
	if not region or not symptoms:
		return None
	rows = frappe.get_all(
		"Case Report",
		filters=[
			["region", "=", region],
			["report_date", ">=", add_days(today(), -days)],
			["status", "!=", "Closed"],
			["Case Report Symptom", "symptom", "in", list(symptoms)],
		],
		fields=REPORT_FIELDS,
		order_by="creation desc",
		limit=1,
	)
	return _row(rows[0]) if rows else None


def my_reports(user=None, phone=None, limit=9):
	filters = (
		{"reported_by": user}
		if user
		else {"phone_number": f"+{normalize_phone(phone, country_code())}", "channel": "WhatsApp"}
	)
	return [
		_row(r)
		for r in frappe.get_all(
			"Case Report", filters=filters, fields=REPORT_FIELDS, order_by="creation desc", limit=cint(limit)
		)
	]


def get_report(name):
	row = frappe.db.get_value("Case Report", name, REPORT_FIELDS, as_dict=True)
	return _row(row) if row else None


def _row(row, fields=REPORT_FIELDS):
	"""Plain JSON-friendly dict (dates as YYYY-MM-DD) that can be kept in the session."""
	return {f: (str(row.get(f)) if hasattr(row.get(f), "isoformat") else row.get(f)) for f in fields}
