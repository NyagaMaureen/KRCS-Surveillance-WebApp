"""Completeness rules for new Case Reports (data quality feedback, Oct 2026).

A new report is rejected unless it has: reporter phone, region, sub-county,
GPS (latitude and longitude) (location name only needed without GPS), number of people affected (1 or more), onset date, report date,
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
	ref = (doc.get("client_ref") or "").strip()
	doc.client_ref = ref or None   # empty must be NULL: the column is unique
	if ref:
		existing = frappe.db.get_value("Case Report", {"client_ref": ref}, "name")
		if existing:
			frappe.throw(_("This report was already received as {0}.").format(existing), frappe.DuplicateEntryError,
				title=_("Already received"))
	_check_media_consent(doc)
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
	for field, label in (("region", "Region"), ("sub_county", "Sub-county"),
			("onset_date", "Onset date"), ("report_date", "Report date")):
		if not doc.get(field):
			missing.append(_(label))
	no_gps = doc.latitude in (None, "", 0) or doc.longitude in (None, "", 0)
	if no_gps:
		missing.append(_("GPS location"))
	if no_gps and not (doc.location_name or "").strip():   # the place name is optional when GPS is given
		missing.append(_("Location"))
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

# ---------- media consent (photos and voice notes), Kenya Data Protection Act 2019 ----------
# Each photo / voice note says whether people are shown or recorded (people_shown) and, if so, who agreed
# (consent: Person agreed / Parent or guardian agreed). People shown without consent is refused.
MEDIA = ("Photo", "Voice Note")
CONSENTS = ("No one", "Person agreed", "Parent or guardian agreed")
# WhatsApp does not ask the consent question yet; its media rows are accepted until it does.
CONSENT_EXEMPT_CHANNELS = ("WhatsApp",)


def check_consent(attachment_type, people_shown=None, consent=None):
	"""Returns (people_shown, consent, recorded_on) to store. Throws if people are shown without consent."""
	from frappe.utils import cint, now_datetime
	if attachment_type not in MEDIA:
		return 0, None, None
	shown = cint(people_shown) if people_shown not in (None, "") else (0 if consent == "No one" else None)
	if consent and consent not in CONSENTS:
		frappe.throw(_("Consent must be one of: {0}.").format(", ".join(CONSENTS)))
	if shown is None:
		frappe.throw(_("For photos and voice notes, say whether any person is shown or recorded."), title=_("Consent needed"))
	if shown and consent not in ("Person agreed", "Parent or guardian agreed"):
		frappe.throw(_("A person is shown or recorded: record that they (or their parent or guardian) agreed, or remove it."),
			title=_("Consent needed"))
	return shown, (consent if shown else "No one"), now_datetime()


def _check_media_consent(doc):
	if doc.get("channel") in CONSENT_EXEMPT_CHANNELS:
		return
	for row in doc.get("attachments") or []:
		if row.attachment_type in MEDIA:
			row.people_shown, row.consent, recorded = check_consent(row.attachment_type, row.get("people_shown"), row.get("consent"))
			row.consent_recorded_on = row.get("consent_recorded_on") or recorded
