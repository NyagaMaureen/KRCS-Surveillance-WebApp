"""Completeness rules for new Case Reports (data quality feedback, Oct 2026).

A new report is rejected unless it has: reporter phone, region, sub-county, location name,
GPS (latitude and longitude), number of people affected (1 or more), onset date, report date,
at least one symptom OR an animal exposure. Photos and voice notes are optional (encouraged, not required),
so reporters with basic phones or no data can still report.
Existing reports are not re-checked when edited, so old records stay editable.

hooks.py:  doc_events = {"Case Report": {"validate": "surveillance.case_report_rules.validate_complete", ...}}
"""
import re

import frappe
from frappe import _
from frappe.utils import cint, getdate, today

IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".heic")
AUDIO_EXT = (".webm", ".ogg", ".mp3", ".m4a", ".wav", ".aac", ".amr")
PHONE = re.compile(r"^\+?\d{9,13}$")


def _attachment_urls(doc):
	"""Every file URL in the Attachments table, whatever the child field is called."""
	urls = []
	for row in doc.get("attachments") or []:
		for value in row.as_dict().values():
			if isinstance(value, str) and ("/files/" in value or value.startswith(("http", "/private"))):
				urls.append(value.lower().split("?")[0])
	return urls


def validate_complete(doc, method=None):
	if not doc.is_new():
		return
	if not doc.phone_number:
		# same as the form: use the reporter's own phone from their user profile
		user = doc.get("reported_by") or frappe.session.user
		doc.phone_number = frappe.db.get_value("User", user, "mobile_no") or frappe.db.get_value("User", user, "phone")
	missing = []
	phone = re.sub(r"[\s-]", "", doc.phone_number or "")
	if not phone:
		missing.append(_("Phone number (add a mobile number to your user profile)"))
	elif not PHONE.match(phone):
		frappe.throw(_("Phone number looks invalid. Use a format like 0712345678 or +254712345678."))
	for field, label in (("region", "Region"), ("sub_county", "Sub-county"), ("location_name", "Location"),
			("onset_date", "Onset date"), ("report_date", "Report date")):
		if not doc.get(field):
			missing.append(_(label))
	if doc.latitude in (None, "", 0) or doc.longitude in (None, "", 0):
		missing.append(_("GPS location"))
	if cint(doc.affected_count) < 1:
		missing.append(_("Number of people affected (at least 1)"))
	exposure = doc.get("animal_exposure")
	if not (doc.get("symptoms") or (exposure and exposure != "None")):
		missing.append(_("At least one symptom or an animal exposure"))
	if missing:
		frappe.throw(_("Please complete before submitting: {0}").format(", ".join(missing)), title=_("Report incomplete"))

	if doc.onset_date and getdate(doc.onset_date) > getdate(today()):
		frappe.throw(_("Onset date cannot be in the future."))
	if doc.report_date and doc.onset_date and getdate(doc.onset_date) > getdate(doc.report_date):
		frappe.throw(_("Onset date cannot be after the report date."))