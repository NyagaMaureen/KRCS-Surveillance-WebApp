"""CHPs no longer get event alerts or see suspected diseases in their notices; FHWs get no event alerts for now
(KRCS 19 Nov 2026). This clears what they already have in the bell:
- event alerts (new signal, disease changed, resolved in Epi Trends, escalation copy) are deleted;
- task notices ("New task: ... (Cholera, Dadaab)", "Due today: ...", "Overdue: ...") keep the task, lose the disease;
- "Your report RPT-060 (Cholera) was checked and closed" loses the disease, for every reporter.
Safe to run again."""
import re

import frappe

TASK_NOTICE = re.compile(r"^((?:New task|Due today|Overdue): .*) \(([^()]*), ([^()]*)\)$")
REPORT_NOTICE = re.compile(r"^(Your report \S+) \([^()]*\) (was .*)$")


def execute():
	from surveillance.user_scope import user_workspace
	staff = {u: user_workspace(u) for u in frappe.get_all("User", filters={"enabled": 1, "user_type": "System User"}, pluck="name")
		if u not in ("Administrator", "Guest")}
	users = [u for u, ws in staff.items() if ws == "chp"]
	no_alerts = [u for u, ws in staff.items() if ws in ("chp", "fhw")]
	deleted = renamed = 0
	if no_alerts:
		alerts = frappe.get_all("Notification Log", filters={"for_user": ["in", no_alerts], "document_type": "Surveillance Event"},
			pluck="name")
		for name in alerts:
			frappe.delete_doc("Notification Log", name, ignore_permissions=True, force=True)
		deleted = len(alerts)
	if users:
		for n in frappe.get_all("Notification Log", filters={"for_user": ["in", users], "document_type": "Event Task"},
				fields=["name", "subject"]):
			m = TASK_NOTICE.match(n.subject or "")
			if m:
				frappe.db.set_value("Notification Log", n.name, "subject", f"{m.group(1)} ({m.group(3)})", update_modified=False)
				renamed += 1
	for n in frappe.get_all("Notification Log", filters={"document_type": "Case Report", "subject": ["like", "Your report %"]},
			fields=["name", "subject"]):
		m = REPORT_NOTICE.match(n.subject or "")
		if m:
			frappe.db.set_value("Notification Log", n.name, "subject", f"{m.group(1)} {m.group(2)}", update_modified=False)
			renamed += 1
	frappe.db.commit()
	print(f"CHP/FHW notices: {deleted} event alerts deleted, {renamed} notices without the disease name")
