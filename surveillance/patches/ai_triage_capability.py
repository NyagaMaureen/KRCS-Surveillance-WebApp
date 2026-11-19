"""See AI Triage and Diseases (KRCS 19 Nov 2026): a Review Queue permission. Without it a user gets Signal captured and
Verification only, with no diseases or risk score (the CHA view), even if the role can act on events.
Given here to every role that already works the Review Queue, except the CHA roles, so nobody else loses anything.
Change it later in Roles & Permissions. Safe to run again."""
import frappe

CHA_ROLES = {"CHA", "Community Health Assistant"}


def execute():
	rows = frappe.get_all("Role Capability", fields=["role", "capability"])
	caps = {}
	for r in rows:
		caps.setdefault(r.role, set()).add(r.capability)
	for role, have in caps.items():
		if role in CHA_ROLES or "cha_workspace" in have or "ai_triage" in have:
			continue
		if have & {"view_review_queue", "act_on_events"}:
			frappe.get_doc({"doctype": "Role Capability", "role": role, "capability": "ai_triage"}).insert(ignore_permissions=True)
	frappe.db.commit()
