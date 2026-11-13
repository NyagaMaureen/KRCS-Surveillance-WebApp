"""Report statuses simplified (13 Nov 2026): Awaiting review (stored as Submitted), Investigating, Closed, Recorded.
Recorded = a common illness counted in Epi Trends, whether the rules or an officer decided.
Converts 'Not for review' and 'Reviewed' (and any 'Submitted' report that is not in the Review Queue)."""
import frappe

NOT_OF_CONCERN = "Not a disease of concern"


def execute():
	rows = frappe.get_all("Case Report", filters={"status": ["in", ["Not for review", "Reviewed", "Submitted"]]},
		fields=["name", "status", "suspected_disease", "review_outcome"])
	n = 0
	for r in rows:
		if r.status == "Submitted" and frappe.db.exists("Surveillance Signal", f"Field-{r.name}"):
			continue   # still waiting in the Review Queue
		new = "Closed" if (r.review_outcome == NOT_OF_CONCERN and not r.suspected_disease) else "Recorded"
		frappe.db.set_value("Case Report", r.name, "status", new, update_modified=False)
		n += 1
	frappe.db.commit()
	print(f"Report statuses updated: {n}")
