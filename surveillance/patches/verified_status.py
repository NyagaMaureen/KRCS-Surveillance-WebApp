"""Verified status (KRCS 19 Nov 2026): Confirm and save in Verification makes the event Verified. Events already
confirmed and still waiting for AI triage move from Verifying to Verified. Safe to run again."""
import frappe


def execute():
	frappe.reload_doc("surveillance", "doctype", "surveillance_event")
	frappe.db.sql("""update `tabSurveillance Event` set status = 'Verified'
		where status = 'Verifying' and verification_on is not null""")
	frappe.db.commit()
