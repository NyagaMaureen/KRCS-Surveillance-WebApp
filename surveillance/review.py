"""Review list for unclassified Case Reports (no suspected disease).

An officer with verify_suspected_disease either picks a disease (existing
case_definitions.set_suspected_disease) or marks the report "Not a disease of concern".
Reports still unclassified and not dismissed are counted by the alert engine as
"unclassified-illness", so a sudden cluster raises an alert before anyone knows the disease.
"""
import frappe
from frappe import _
from frappe.utils import now_datetime

from surveillance.capabilities import require_capability

NOT_OF_CONCERN = "Not a disease of concern"


def is_unclassified(report):
	return not report.get("suspected_disease") and report.get("review_outcome") != NOT_OF_CONCERN


@frappe.whitelist()
def get_unclassified(limit=200):
	"""Reports waiting for classification, newest first."""
	require_capability("verify_suspected_disease")
	return frappe.get_all("Case Report",
		filters={"suspected_disease": ["is", "not set"], "review_outcome": ["!=", NOT_OF_CONCERN]},
		fields=["name", "creation", "region", "sub_county", "location_name", "affected_count", "classification_reason"],
		order_by="creation desc", limit_page_length=int(limit))


@frappe.whitelist(methods=["POST"])
def mark_not_of_concern(report, note=None):
	"""Remove a report from the review list and from the unclassified-illness count."""
	require_capability("verify_suspected_disease")
	doc = frappe.get_doc("Case Report", report)
	if doc.suspected_disease:
		frappe.throw(_("This report already has a suspected disease."))
	doc.review_outcome = NOT_OF_CONCERN
	doc.reviewed_by = frappe.session.user
	doc.reviewed_on = now_datetime()
	if note:
		doc.add_comment("Comment", note)
	doc.save(ignore_permissions=True)
	return {"review_outcome": doc.review_outcome, "reviewed_by": doc.reviewed_by}


@frappe.whitelist(methods=["POST"])
def reopen_review(report):
	"""Undo 'Not a disease of concern'."""
	require_capability("verify_suspected_disease")
	doc = frappe.get_doc("Case Report", report)
	doc.review_outcome = ""
	doc.save(ignore_permissions=True)
	return {"review_outcome": ""}