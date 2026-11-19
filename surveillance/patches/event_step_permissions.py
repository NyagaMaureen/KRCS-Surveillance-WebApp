"""Event steps and tasks in Roles & Permissions (KRCS 19 Nov 2026): one box per step (Signal captured, Verification,
AI triage, Field investigation, Decision, Response & close), plus See Event Tasks and Assign Event Tasks.
Set here so nothing changes for anyone:
- CHA roles: Signal captured, Verification and See Event Tasks
- every other role that works the Review Queue: all six steps and See Event Tasks, plus Assign Event Tasks if it can
  act on events
Change them later in Roles & Permissions. Only adds; safe to run again."""
import frappe

CHA_ROLES = {"CHA", "Community Health Assistant"}
ALL_STEPS = ["step_signal", "step_verification", "ai_triage", "step_investigation", "step_decision", "step_response"]


def execute():
	from surveillance.capabilities import sync_role_permissions
	caps = {}
	for r in frappe.get_all("Role Capability", fields=["role", "capability"]):
		caps.setdefault(r.role, set()).add(r.capability)
	for role, have in caps.items():
		if not have & {"view_review_queue", "act_on_events"}:
			continue
		if role in CHA_ROLES or "cha_workspace" in have:
			add = ["step_signal", "step_verification", "view_event_tasks"]
		else:
			add = ALL_STEPS + ["view_event_tasks"] + (["assign_event_tasks"] if "act_on_events" in have else [])
		new = [k for k in add if k not in have]
		for key in new:
			frappe.get_doc({"doctype": "Role Capability", "role": role, "capability": key}).insert(ignore_permissions=True)
		if new:
			sync_role_permissions(role)
	frappe.db.commit()
