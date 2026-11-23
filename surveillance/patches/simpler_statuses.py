"""Fewer statuses, the same on events and their reports (KRCS 20 Nov 2026).

Events: New, Verified, Investigating, Confirmed, Escalated, Closed. Why a closed event ended is its outcome:
Responded, Not confirmed, Discarded or Referred.
  Verifying -> New (or Verified, once the CHA confirmed the verification)
  Discarded -> Closed, outcome Discarded
  Closed -> outcome Not confirmed / Referred / Responded
  Confirmed on the referral pathway -> Closed, outcome Referred (when the referral was sent), else Verified
Field reports then take their event's status (investigation.REPORT_STATUS).
"""
import frappe


def execute():
	frappe.reload_doc("surveillance", "doctype", "surveillance_event")
	frappe.reload_doc("surveillance", "doctype", "case_report")
	E = "`tabSurveillance Event`"
	frappe.db.sql(f"update {E} set status = if(verification_on is not null, 'Verified', 'New') where status = 'Verifying'")
	frappe.db.sql(f"update {E} set status = 'Closed', outcome = 'Discarded' where status = 'Discarded'")
	referred = set(frappe.get_all("Event Task", filters={"task_type": "Referral"}, pluck="event"))
	for e in frappe.get_all("Surveillance Event", filters={"status": "Confirmed", "pathway": "Referral"}, pluck="name"):
		if e in referred:
			frappe.db.sql(f"update {E} set status = 'Closed', outcome = 'Referred', closed_on = ifnull(closed_on, now()) where name = %s", e)
		else:
			frappe.db.sql(f"update {E} set status = 'Verified', decision = null where name = %s", e)
	frappe.db.sql(f"""update {E} set outcome = case
		when decision = 'Not confirmed' then 'Not confirmed'
		when pathway = 'Referral' then 'Referred'
		else 'Responded' end
		where status = 'Closed' and ifnull(outcome, '') = ''""")
	from surveillance.investigation import REPORT_STATUS
	for s in frappe.db.sql("""select s.ref, e.status from `tabSurveillance Signal` s
			join `tabSurveillance Event` e on e.name = s.event where s.source = 'Field'""", as_dict=True):
		status = REPORT_STATUS.get(s.status)
		if status:
			frappe.db.sql("update `tabCase Report` set status = %s where name = %s and status not in ('Recorded', 'Reviewed')",
				(status, s.ref))
	frappe.db.commit()
