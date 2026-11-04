"""What the WhatsApp conversation reads from and writes to Frappe (passed to it as ctx.data).

Lists come from the DocTypes, so the bot keeps none of its own: Select options from Case Report,
regions, sub-counties and symptoms from their DocTypes. They are cached for 10 minutes and cleared
when a Region, Sub County or Symptom is saved (hooks.py doc_events).

Staff are recognised by WhatsApp number = User.mobile_no (any format), if the user is enabled and
account_status is Active or empty. The phone index is cleared whenever a User is saved.
"""

import frappe
from frappe import _
from frappe.utils import add_days, cint, today
from frappe.utils.caching import redis_cache

from surveillance.locations import get_sub_counties, is_field_staff
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


@redis_cache(ttl=600)
def sub_county_centres():
	"""Active sub-counties with their region and approximate centre, to place a community reporter's GPS pin."""
	return [
		dict(x)
		for x in frappe.get_all(
			"Sub County", filters={"is_active": 1}, fields=["name", "region", "latitude", "longitude"]
		)
	]


@redis_cache(ttl=600)
def community_advice(lang):
	"""Approved Community Advice by key (the keys of content.ADVICE), in `lang` or else English, as
	protocols.get_community_advice gives it. Keys with no approved text keep the bot's draft."""
	if not frappe.db.exists("DocType", "Community Advice"):
		return {}
	rows = frappe.get_all(
		"Community Advice",
		filters={"status": "Approved", "language": ["in", list({lang, "en"})]},
		fields=["key", "language", "text"],
		order_by="modified desc",
	)
	out = {}
	for want in (lang, "en"):
		for r in rows:
			key, value = (r.key or "").strip(), (r.text or "").strip()
			if r.language == want and key and value and key not in out:
				out[key] = value
	return out


def clear_catalog_cache(doc=None, method=None):
	"""doc_events on Region, Sub County, Symptom and Community Advice."""
	community_advice.clear_cache()
	catalog.clear_cache()
	sub_counties.clear_cache()
	sub_county_centres.clear_cache()


@redis_cache(ttl=600)
def _staff_index():
	"""normalised phone -> active users with that mobile number."""
	fields = ["name", "full_name", "mobile_no", "primary_role", "assigned_region", "account_status"]
	if frappe.get_meta("User").has_field("assigned_sub_county"):
		fields.append("assigned_sub_county")
	users = frappe.get_all("User", filters={"enabled": 1, "mobile_no": ["is", "set"]}, fields=fields)
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
		"sub_county": u.get("assigned_sub_county") or None,
		# CHPs and Facility Health Workers report only for their assigned area (Case Report validate)
		"area_locked": is_field_staff(u.name),
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
		if existing:  # the same WhatsApp message was processed twice: reuse the report
			return _row(
				frappe.get_doc("Case Report", existing).as_dict(),
				[*REPORT_FIELDS, "reporter_name", "latitude", "longitude", "suspected_disease"],
			)
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
	"""Next steps for a staff reporter, as the mobile app gets them (protocols.get_reporter_advice): the
	approved protocol's steps ticked 'Show to reporters' (the unusual-event protocol's when the disease has
	none, or no disease was suggested) and the general lines in Reporter Advice Settings.
	Steps for the users get_reporter_advice serves (reporters, follow-up receivers, protocol viewers); the
	others get the disease name and the general lines."""
	from surveillance.capabilities import has_capability
	from surveillance.field_api import UNUSUAL_EVENT, advice_steps
	from surveillance.protocols import MANAGE, VIEW, approved_for

	label = None
	if disease:
		label = frappe.db.get_value("Alert Threshold Config", disease, "disease_name") or disease
	steps = []
	if any(has_capability(c, user) for c in ("create_reports", "receive_tasks", VIEW, MANAGE)):
		steps = advice_steps(approved_for(disease)) if disease else []
		steps = steps or advice_steps(approved_for(UNUSUAL_EVENT))
	return {
		"disease": label,
		"steps": [{"step": s["step"], "timeframe": s["timeframe"] or ""} for s in steps],
		"general": general_advice(),
	}


def general_advice():
	"""The lines in Reporter Advice Settings, shown after every staff report (empty: the bot's own lines)."""
	if not frappe.db.exists("DocType", "Reporter Advice Settings"):
		return []
	value = frappe.db.get_single_value("Reporter Advice Settings", "general_advice") or ""
	return [line.strip() for line in value.splitlines() if line.strip()]


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
