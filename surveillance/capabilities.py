"""
Capabilities: business-level permissions for the KRCS surveillance app.

Sources of truth:
  - WHAT capabilities exist   -> CAPABILITIES below (code, in git)
  - WHO has which capability  -> "Role Capability" records (data, edited in the Roles & Permissions page)
  - Frappe DocType permissions for managed DocTypes are DERIVED from those two by
    sync_role_permissions(). Do not edit them by hand in Role Permissions Manager:
    the next sync (every `bench migrate`) overwrites them.
"""
import frappe
from frappe import _
from frappe.permissions import setup_custom_perms

ROLE_CAPABILITY = "Role Capability"
RESERVED_ROLES = {"Administrator", "System Manager", "Guest", "All"}

# What working on an event step needs (the same as Act on Events gives)
STEP_GRANTS = {"Surveillance Event": ["read", "write"], "Surveillance Signal": ["read"], "Event Task": ["read", "write", "create"]}

# key -> definition. "grants" = Frappe permissions this capability gives on each DocType.
# Grants on DocTypes that don't exist yet are skipped and applied automatically once the DocType exists.
CAPABILITIES = [
	# Case Reports
	{"key": "view_reports", "name": "View Reports", "category": "Case Reports",
	 "description": "View all case reports in the user's area", "grants": {"Case Report": ["read"]}},
	{"key": "view_own_reports", "name": "View Own Reports", "category": "Case Reports",
	 "description": "View only the reports the user submitted (e.g. CHPs)", "grants": {"Case Report": ["read"]}},
	{"key": "create_reports", "name": "Create Reports", "category": "Case Reports",
	 "description": "Submit new case reports",
	 "grants": {"Case Report": ["read", "create"], "Region": ["read"], "Symptom": ["read"], "Sub County": ["read"]}},
	{"key": "edit_reports", "name": "Update Reports", "category": "Case Reports",
	 "description": "Update existing reports; every change is kept in the report's Update history and the Audit Log",
	 "grants": {"Case Report": ["read", "write"]}},
	# Delete Reports was removed (KRCS 17 Nov 2026): reports are never deleted, only viewed and updated
	{"key": "export_reports", "name": "Export Reports", "category": "Case Reports",
	 "description": "Export case reports to file", "grants": {"Case Report": ["read", "export"]}},
	{"key": "verify_suspected_disease", "name": "Verify Suspected Disease", "category": "Case Reports",
	 "description": "Confirm or change the suspected disease on a case report", "grants": {"Case Report": ["read"]}},
	{"key": "see_suspected_disease", "name": "See Suspected Disease After Reporting", "category": "Case Reports",
	 "description": "See the suspected disease on the screen after sending a report (the advice is shown to everyone)",
	 "grants": {}},

	# Alerts & Risk
	{"key": "view_alerts", "name": "View Alerts", "category": "Alerts & Risk",
	 "description": "View alerts and signals", "grants": {"Risk Alert": ["read"]}},
	{"key": "manage_alert_thresholds", "name": "Manage Alert Thresholds", "category": "Alerts & Risk",
	 "description": "Add diseases and change alert thresholds",
	 "grants": {"Alert Threshold Config": ["read", "write", "create"],
	            "Alert Threshold Settings": ["read", "write"]}},
	{"key": "investigate_alerts", "name": "Investigate Alerts", "category": "Alerts & Risk",
	 "description": "Change alert status and add investigation notes", "grants": {"Risk Alert": ["read", "write"]}},
    

		# Review Queue
	{"key": "view_review_queue", "name": "View Review Queue", "category": "Review Queue",
	 "description": "See reported events for your region",
	 "grants": {"Surveillance Event": ["read"], "Surveillance Signal": ["read"]}},
	{"key": "act_on_events", "name": "Act on Events", "category": "Review Queue",
	 "description": "Merge related events, act on alerts and CBS cases, send reports to the queue and plan response "
	 "actions. What a user does on an event's steps is set by the Step boxes",
	 "grants": {"Surveillance Event": ["read", "write"], "Event Task": ["read", "write", "create"]}},
	# The event steps (KRCS 19 Nov 2026): each box shows that step on an event and lets the user work on it
	{"key": "step_signal", "name": "Step 1: Signal Captured", "category": "Review Queue",
	 "description": "See the reports behind an event; discard a known false alarm and add what was picked from a voice note",
	 "grants": STEP_GRANTS},
	{"key": "step_verification", "name": "Step 2: Verification", "category": "Review Queue",
	 "description": "Call the reporter, check the symptoms, answer the verification questions and Confirm and save",
	 "grants": STEP_GRANTS},
	{"key": "ai_triage", "name": "Step 3: AI Triage", "category": "Review Queue",
	 "description": "See the possible diseases and the risk score, choose the disease and answer its questions. Without it "
	 "the user never sees diseases or the risk score, and steps 4 to 6 stay hidden (CHAs)", "grants": STEP_GRANTS},
	{"key": "step_investigation", "name": "Step 4: Field Investigation", "category": "Review Queue",
	 "description": "Work through the protocol's investigation steps, findings and evidence", "grants": STEP_GRANTS},
	{"key": "step_decision", "name": "Step 5: Decision", "category": "Review Queue",
	 "description": "Confirm the outbreak, find no event, or escalate", "grants": STEP_GRANTS},
	{"key": "step_response", "name": "Step 6: Response & Close", "category": "Review Queue",
	 "description": "Response steps, referrals and follow-ups for non-priority diseases, and closing the event",
	 "grants": STEP_GRANTS},
	{"key": "view_event_tasks", "name": "See Event Tasks", "category": "Review Queue",
	 "description": "See the Tasks section on an event (field visits, referrals, samples, follow-ups)",
	 "grants": {"Event Task": ["read"]}},
	{"key": "assign_event_tasks", "name": "Assign Event Tasks", "category": "Review Queue",
	 "description": "Assign tasks on an event, and change or remove them", "grants": {"Event Task": ["read", "write", "create"]}},
	{"key": "view_all_tasks", "name": "View All Tasks", "category": "Review Queue",
	 "description": "See every task assigned in your region and whether it was completed (e.g. SCDSC)",
	 "grants": {"Event Task": ["read"]}},
	{"key": "receive_tasks", "name": "Receive Tasks", "category": "Review Queue",
	 "description": "Get follow-ups and referrals from officers and record referrals (e.g. CHPs)",
	 "grants": {"Event Task": ["read"]}},

	 
	# Response
	{"key": "view_response_protocols", "name": "View Response Protocols", "category": "Response",
	 "description": "View response protocols", "grants": {"Response Protocol": ["read"]}},
	{"key": "manage_response_protocols", "name": "Manage Response Protocols", "category": "Response",
	 "description": "Create, edit and approve response protocols",
	 "grants": {"Response Protocol": ["read", "write", "create", "delete"]}},
	{"key": "view_chatbot_logs", "name": "View Chatbot Query Log", "category": "Response",
	 "description": "View questions asked to the response chatbot", "grants": {"Chatbot Query Log": ["read"]}},
	{"key": "handle_chatbot_escalations", "name": "Handle Chatbot Escalations", "category": "Response",
	 "description": "Follow up questions the chatbot escalated to a person", "grants": {"Chatbot Query Log": ["read", "write"]}},

	# Users & Roles
	{"key": "view_users", "name": "View Users", "category": "Users & Roles",
	 "description": "View user accounts", "grants": {"User": ["read"], "Surveillance Role": ["read"]}},
	{"key": "manage_users", "name": "Manage Users", "category": "Users & Roles",
	 "description": "Create and edit user accounts", "grants": {"User": ["read", "write", "create"], "Surveillance Role": ["read"]}},
	{"key": "manage_roles", "name": "Manage Roles & Permissions", "category": "Users & Roles",
	 "description": "Change which capabilities each role has, and add roles",
	 "grants": {"Role": ["read", "create"], "Surveillance Role": ["read", "write", "create"]}},
	{"key": "view_my_chps", "name": "View CHPs in My CHU", "category": "Users & Roles",
	 "description": "CHAs: see the CHPs in the Community Health Unit(s) they head, with their phone and recent activity",
	 "grants": {}},
    {"key": "view_all_regions", "name": "View All Regions", "category": "Users & Roles",
	 "description": "See events and dashboard figures for every region, even if the user has a region assigned",
	 "grants": {}},

	# Analytics
	{"key": "view_analytics", "name": "View Analytics", "category": "Analytics",
	 "description": "View analytics dashboards", "grants": {}},
	{"key": "view_surveillance_map", "name": "View Surveillance Map", "category": "Analytics",
	 "description": "View the surveillance map", "grants": {}},
	{"key": "export_data", "name": "Export Data", "category": "Analytics",
	 "description": "Export analytics data", "grants": {}},

	# Audit
	{"key": "view_audit_log", "name": "View Audit Log", "category": "Audit",
	 "description": "View the change history of records", "grants": {"Version": ["read"]}},

	# Reference Data
	{"key": "manage_reference_data", "name": "Manage Regions & Symptoms", "category": "Reference Data",
	 "description": "Add and edit regions and symptoms",
	 "grants": {"Region": ["read", "write", "create"], "Symptom": ["read", "write", "create"],
	            "Sub County": ["read", "write", "create"]}},

	{"key": "view_context_data", "name": "View Context Data", "category": "Reference Data",
	 "description": "Open the Context Data page (weather, population, WASH). Context next to events and Epi Trends is shown anyway",
	 "grants": {}},
	{"key": "view_reporting_channels", "name": "View Reporting Channels", "category": "Reference Data",
	 "description": "Open the Reporting Channels page (reports per channel, CBS and MOH 505 loads)", "grants": {}},
	{"key": "manage_context_data", "name": "Manage Context Data", "category": "Reference Data",
	 "description": "Record WASH assessments and population figures, and refresh weather",
	 "grants": {"Camp WASH Assessment": ["read"], "Population Bulletin Import": ["read"], "Weather Snapshot": ["read"]}},

    # Facility Data
	{"key": "upload_facility_data", "name": "Upload Facility Data", "category": "Facility Data",
	 "description": "Upload MOH 505 (IDSR) exports from KHIS and manage the reporting facility list",
	 "grants": {"Reporting Facility": ["read"], "IDSR Upload": ["read"]}},

	# Knowledge Base
	{"key": "manage_knowledge_base", "name": "Manage Knowledge Base", "category": "Knowledge Base",
	 "description": "Upload, reindex and delete AI knowledge base documents", "grants": {"Knowledge Document": ["read", "write", "create", "delete"]}},
	{"key": "approve_knowledge_base", "name": "Approve Knowledge Base", "category": "Knowledge Base",
	 "description": "Approve or retire knowledge base documents", "grants": {"Knowledge Document": ["read", "write"]}},
	{"key": "use_knowledge_base", "name": "Use Knowledge Base", "category": "Knowledge Base",
	 "description": "Search approved knowledge base documents for your own role", "grants": {}},
	{"key": "kb_service", "name": "Knowledge Base Service Access", "category": "Knowledge Base",
	 "description": "Search on behalf of another role (chatbot service account only)", "grants": {}},
	{"key": "view_sensitive_kb", "name": "View Sensitive Knowledge Base Content", "category": "Knowledge Base",
	 "description": "Read Knowledge Base documents marked Sensitive", "grants": {}},
	{"key": "view_restricted_kb", "name": "View Restricted Knowledge Base Content", "category": "Knowledge Base",
	 "description": "Read Knowledge Base documents with audience class Restricted", "grants": {}},
	{"key": "kb_national_scope", "name": "Knowledge Base National Scope", "category": "Knowledge Base",
	 "description": "Read Knowledge Base documents for every region and sub-county (national staff)", "grants": {}},
]
CAPABILITIES += [
	# Workspaces: which simple dashboard and menu a role gets. Admins never get these automatically.
	{"key": "chp_workspace", "name": "CHP Workspace", "category": "Workspaces",
	 "description": "Simple CHP dashboard and menu: report, follow-ups, referrals, AI assistant, feedback",
	 "grants": {}},
	{"key": "fhw_workspace", "name": "Facility Health Worker Workspace", "category": "Workspaces",
	 "description": "Facility dashboard and menu: report when the EMR is down, referrals to my facility, alerts nearby",
	 "grants": {}},
	{"key": "cha_workspace", "name": "CHA Workspace", "category": "Workspaces",
	 "description": "CHA dashboard (their sub-county) and menu: Referrals, My Tasks, plus what their permissions allow",
	 "grants": {}},
	{"key": "receive_referrals", "name": "Confirm Referrals to My Facility", "category": "Review Queue",
	 "description": "See referrals CHPs make to the user's assigned facility and mark whether the people arrived",
	 "grants": {}},
	{"key": "dataai_workspace", "name": "Data & AI Admin Workspace", "category": "Workspaces",
	 "description": "Data & AI Admin dashboard and menu: AI performance, integrations, system health, data quality, users, "
	 "roles, security and settings. No case or patient data", "grants": {}},
	{"key": "officer_workspace", "name": "Surveillance Officer Workspace", "category": "Workspaces",
	 "description": "Officer dashboard and menu: Review Queue, Epi Trends, map, response, event lifecycle, data quality",
	 "grants": {}},
	{"key": "view_data_quality", "name": "View Data Quality", "category": "Analytics",
	 "description": "See and check data quality issues (missing places, late or duplicate reports, facility completeness)",
	 "grants": {}},
	# Feedback
	{"key": "view_feedback", "name": "Settings: Feedback", "category": "Settings",
	 "description": "See the Feedback tab: read and resolve feedback from users (and be told when new feedback comes in)",
	 "grants": {}},
	# Settings tabs (KRCS review, Nov 2026): Profile is for everyone; each other tab is given per role
	{"key": "settings_notifications", "name": "Settings: Notifications", "category": "Settings",
	 "description": "See the Notifications tab in Settings", "grants": {}},
	{"key": "settings_system", "name": "Settings: System", "category": "Settings",
	 "description": "See the System tab in Settings", "grants": {}},
	{"key": "settings_alert_thresholds", "name": "Settings: Alert Thresholds", "category": "Settings",
	 "description": "See the Alert Thresholds tab (changing them needs Manage Alert Thresholds)", "grants": {}},
	{"key": "settings_ai_config", "name": "Settings: AI Config", "category": "Settings",
	 "description": "See the AI Config tab (risk score weights, red-flag symptoms)", "grants": {}},
	{"key": "settings_data", "name": "Settings: Data", "category": "Settings",
	 "description": "See the Data tab in Settings", "grants": {}},
	{"key": "settings_security", "name": "Settings: Security", "category": "Settings",
	 "description": "See the Security tab in Settings", "grants": {}},
	# Monitoring Reports (SRS D.5, KRCS 16 Nov 2026)
	{"key": "view_monitoring_reports", "name": "View Monitoring Reports", "category": "Monitoring Reports",
	 "description": "Open Monitoring Reports (R34 to R40b) for the user's own area: HQ their region or national; officers, FHWs and CHAs their sub-county",
	 "grants": {}},
	{"key": "export_monitoring_reports", "name": "Export Monitoring Reports", "category": "Monitoring Reports",
	 "description": "Export Monitoring Reports as Excel, CSV, PDF or JPEG (every export is recorded in the Audit Log)", "grants": {}},
	{"key": "push_model_metrics", "name": "Send AI Model Measures", "category": "Monitoring Reports",
	 "description": "For the AI server's user only: send model measures from MLflow (e.g. speech-to-text word error rate)", "grants": {}},
]

# Roles & Permissions: headings and names follow the main menu, in the menu's order (KRCS 17 Nov 2026).
# Only what people see changes; the keys (and every check in the code) stay the same.
STEPS_TAB = "Event Steps & Tasks"   # the event page's steps and Tasks section (KRCS 19 Nov 2026)
MENU_LABELS = {
	"view_analytics": ("Dashboard", "View Dashboard"), "view_alerts": ("Dashboard", "View Epidemiological Trends"),
	"view_surveillance_map": ("Dashboard", "View Surveillance Map"), "export_data": ("Dashboard", "Export Data"),
	"view_reports": ("Signals Captured", "View All Signals"), "view_own_reports": ("Signals Captured", "View Own Signals"),
	"create_reports": ("Signals Captured", "Create Reports"), "edit_reports": ("Signals Captured", "Update Signals"),
	"export_reports": ("Signals Captured", "Export Signals"),
	"verify_suspected_disease": ("Signals Captured", "Verify Suspected Disease"),
	"see_suspected_disease": ("Signals Captured", "See Suspected Disease After Reporting"),
	"view_review_queue": ("Review Queue", "View Review Queue"), "act_on_events": ("Review Queue", "Act on Events"),
	"step_signal": (STEPS_TAB, "Step 1: Signal Captured"), "step_verification": (STEPS_TAB, "Step 2: Verification"),
	"ai_triage": (STEPS_TAB, "Step 3: AI Triage"), "step_investigation": (STEPS_TAB, "Step 4: Field Investigation"),
	"step_decision": (STEPS_TAB, "Step 5: Decision"), "step_response": (STEPS_TAB, "Step 6: Response & Close"),
	"view_event_tasks": (STEPS_TAB, "See Event Tasks"), "assign_event_tasks": (STEPS_TAB, "Assign Event Tasks"),
	"view_all_tasks": ("Review Queue", "View All Tasks"), "receive_tasks": ("Review Queue", "Receive Tasks"),
	"receive_referrals": ("Review Queue", "Confirm Referrals to My Facility"),
	"investigate_alerts": ("Review Queue", "Investigate Alerts"),
	"use_knowledge_base": ("KRCS Data Assistant", "Use the Data Assistant"),
	"view_restricted_kb": ("KRCS Data Assistant", "See Restricted Content"),
	"view_sensitive_kb": ("KRCS Data Assistant", "See Sensitive Content"),
	"kb_national_scope": ("KRCS Data Assistant", "National Scope"),
	"kb_service": ("KRCS Data Assistant", "Service Access (chatbot)"),
	"view_monitoring_reports": ("Monitoring Reports", "View Monitoring Reports"),
	"export_monitoring_reports": ("Monitoring Reports", "Export Monitoring Reports"),
	"push_model_metrics": ("Monitoring Reports", "Send AI Model Measures"),
	"view_data_quality": ("Data Quality", "View Data Quality"),
	"view_response_protocols": ("Response Protocols", "View Response Protocols"),
	"manage_response_protocols": ("Response Protocols", "Manage Response Protocols"),
	"upload_facility_data": ("MOH 505 Facility Reports", "Upload MOH 505 Files"),
	"view_context_data": ("Context Data", "View Context Data"), "manage_context_data": ("Context Data", "Manage Context Data"),
	"settings_ai_config": ("AI Risk Engine", "AI Risk Engine Settings"),
	"manage_knowledge_base": ("AI Knowledge Base", "Manage Knowledge Base"),
	"approve_knowledge_base": ("AI Knowledge Base", "Approve Knowledge Base"),
	"view_chatbot_logs": ("AI Assistant Query Log", "View Query Log"),
	"handle_chatbot_escalations": ("AI Assistant Query Log", "Handle Escalations"),
	"settings_alert_thresholds": ("Alert Thresholds", "Open Alert Thresholds"),
	"manage_alert_thresholds": ("Alert Thresholds", "Manage Alert Thresholds"),
	"view_reporting_channels": ("Reporting Channels", "View Reporting Channels"),
	"settings_data": ("Data and Database", "Data and Database Settings"),
	"manage_reference_data": ("Data and Database", "Manage Regions & Symptoms"),
	"view_users": ("Users and Roles", "View Users"), "manage_users": ("Users and Roles", "Manage Users"),
	"manage_roles": ("Users and Roles", "Manage Roles & Permissions"), "view_all_regions": ("Users and Roles", "View All Regions"),
	"view_my_chps": ("Users and Roles", "View CHPs in My CHU"),
	"view_audit_log": ("Audit Log", "View Audit Log"),
	"settings_security": ("Security Settings", "Security Settings"),
	"view_feedback": ("Feedback Received", "View Feedback Received"),
	"settings_notifications": ("Notifications and System", "Notification Settings"),
	"settings_system": ("Notifications and System", "System Settings"),
}
CATEGORY_ORDER = ["Dashboard", "Signals Captured", "Review Queue", STEPS_TAB, "KRCS Data Assistant", "Monitoring Reports", "Data Quality",
	"Response Protocols", "MOH 505 Facility Reports", "Context Data", "AI Risk Engine", "AI Knowledge Base",
	"AI Assistant Query Log", "Alert Thresholds", "Reporting Channels", "Data and Database", "Users and Roles", "Audit Log",
	"Security Settings", "Feedback Received", "Notifications and System", "Workspaces"]
for _c in CAPABILITIES:
	if _c["key"] in MENU_LABELS:
		_c["category"], _c["name"] = MENU_LABELS[_c["key"]]
_ORDER = list(MENU_LABELS)
CAPABILITIES.sort(key=lambda c: (CATEGORY_ORDER.index(c["category"]) if c["category"] in CATEGORY_ORDER else len(CATEGORY_ORDER),
	_ORDER.index(c["key"]) if c["key"] in _ORDER else len(_ORDER)))
CAPABILITY_MAP = {c["key"]: c for c in CAPABILITIES}

# Not given to Administrator / System Manager automatically: these change what the user sees
# (a field worker's menu and dashboard), not what they are allowed to do.
NOT_AUTO_FOR_ADMIN = {"chp_workspace", "officer_workspace", "fhw_workspace", "cha_workspace", "dataai_workspace", "receive_tasks",
	"view_own_reports", "view_my_chps"}

# Workspace for each workspace capability, checked in order. Users without one get the full app.
WORKSPACES = [("chp_workspace", "chp"), ("officer_workspace", "officer"), ("fhw_workspace", "fhw"), ("cha_workspace", "cha"),
	("dataai_workspace", "dataai")]

# Data & AI Administrator (KRCS 18 Nov 2026): one role for the Data & AI Admin and ICT Admin designs. Runs the system
# (AI, data, integrations, users, roles, security, settings) and sees no case or patient data. Set by data_ai_admin_setup.
DATA_AI_CAPABILITIES = ["dataai_workspace", "view_users", "manage_users", "manage_roles", "view_audit_log",
	"settings_security", "settings_data", "settings_ai_config", "settings_alert_thresholds", "manage_alert_thresholds",
	"settings_notifications", "settings_system", "manage_reference_data", "manage_knowledge_base", "approve_knowledge_base",
	"use_knowledge_base", "kb_national_scope", "view_chatbot_logs", "view_reporting_channels", "upload_facility_data",
	"view_context_data", "manage_context_data", "view_data_quality", "view_monitoring_reports", "export_monitoring_reports",
	"view_feedback", "view_all_regions"]   # national: the region set on the user (required by the form) does not limit it

# Capabilities set for the CHP role by setup_chp_role (run once; adjust later in Roles & Permissions)
CHP_CAPABILITIES = ["chp_workspace", "create_reports", "view_own_reports", "receive_tasks", "use_knowledge_base"]

# Applied on migrate ONLY to roles that have no capabilities yet, so fresh environments
# (staging, production, KRCS handover) come preconfigured. Add your other roles here.
DEFAULT_ROLE_CAPABILITIES = {
	"System Administrator": [c["key"] for c in CAPABILITIES if c["key"] not in NOT_AUTO_FOR_ADMIN],   # no workspace: the full app
}


# ---------- checking ----------

def get_user_capabilities(user=None):
	user = user or frappe.session.user
	if user == "Guest":
		return set()
	roles = set(frappe.get_roles(user))
	if user == "Administrator" or "System Manager" in roles:
		return set(CAPABILITY_MAP) - NOT_AUTO_FOR_ADMIN
	keys = frappe.get_all(ROLE_CAPABILITY, filters={"role": ["in", list(roles)]}, pluck="capability")
	return {k for k in keys if k in CAPABILITY_MAP}


def has_capability(key, user=None):
	return key in get_user_capabilities(user)


def require_capability(key):
	"""Use at the top of any whitelisted API that changes data."""
	if not has_capability(key):
		frappe.throw(_("You do not have permission to perform this action."), frappe.PermissionError)


# ---------- syncing to Frappe permissions ----------

def _managed_doctypes():
	return {dt for c in CAPABILITIES for dt in c.get("grants", {})}


# Fields at permission level 1 (KRCS 18 Nov 2026): a user's roles are level 1 on User, so whoever manages users
# needs it to see and set roles without being a System Manager (Data & AI Administrator).
LEVEL1_GRANTS = {"view_users": {"User": ["read"]}, "manage_users": {"User": ["read", "write"]}}


def sync_role_permissions(role):
	"""Rebuild this role's Frappe permissions on managed DocTypes from its capabilities."""
	if role in RESERVED_ROLES:
		return

	desired = {}
	for key in frappe.get_all(ROLE_CAPABILITY, filters={"role": role}, pluck="capability"):
		for dt, ptypes in CAPABILITY_MAP.get(key, {}).get("grants", {}).items():
			desired.setdefault(dt, set()).update(ptypes)

	for dt in _managed_doctypes():
		if not frappe.db.exists("DocType", dt):
			continue
		setup_custom_perms(dt)  # copies standard rules first, so System Manager etc. keep access
		frappe.db.delete("Custom DocPerm", {"parent": dt, "role": role, "permlevel": 0, "if_owner": 0})

		ptypes = desired.get(dt)
		if ptypes:
			ptypes = set(ptypes) | {"read", "report"}  # any access needs read; report enables list/report view
			frappe.get_doc({
				"doctype": "Custom DocPerm",
				"parent": dt,
				"parenttype": "DocType",
				"parentfield": "permissions",
				"role": role,
				"permlevel": 0,
				**{p: 1 for p in ptypes},
			}).insert(ignore_permissions=True)

		frappe.clear_cache(doctype=dt)

	keys = set(frappe.get_all(ROLE_CAPABILITY, filters={"role": role}, pluck="capability"))
	level1 = {}
	for key, grants in LEVEL1_GRANTS.items():
		if key in keys:
			for dt, ptypes in grants.items():
				level1.setdefault(dt, set()).update(ptypes)
	for dt in {d for g in LEVEL1_GRANTS.values() for d in g}:
		frappe.db.delete("Custom DocPerm", {"parent": dt, "role": role, "permlevel": 1, "if_owner": 0})
		if level1.get(dt):
			frappe.get_doc({"doctype": "Custom DocPerm", "parent": dt, "parenttype": "DocType", "parentfield": "permissions",
				"role": role, "permlevel": 1, **{p: 1 for p in level1[dt]}}).insert(ignore_permissions=True)
		frappe.clear_cache(doctype=dt)


def sync_all_role_permissions():
	roles = set(frappe.get_all(ROLE_CAPABILITY, pluck="role"))
	for dt in _managed_doctypes():
		roles |= set(frappe.get_all("Custom DocPerm", filters={"parent": dt}, pluck="role"))
	for role in roles - RESERVED_ROLES:
		sync_role_permissions(role)


# ---------- API ----------

@frappe.whitelist()
def get_my_capabilities():
	user = frappe.session.user
	primary_role = frappe.db.get_value("User", user, "primary_role") if user != "Guest" else None
	caps = get_user_capabilities(user)
	workspace = next((name for key, name in WORKSPACES if key in caps), "full")
	return {
		"capabilities": sorted(caps),
		"primary_role": primary_role or "User",
		"workspace": workspace,
		"names": {k: CAPABILITY_MAP[k]["name"] for k in caps},
	}


@frappe.whitelist()
def get_capability_catalog():
	return [{k: c[k] for k in ("key", "name", "category", "description")} for c in CAPABILITIES]


@frappe.whitelist()
def get_role_capabilities(role):
	require_capability("manage_roles")
	enabled = set(frappe.get_all(ROLE_CAPABILITY, filters={"role": role}, pluck="capability"))
	return {
		"role": role,
		"locked": role in RESERVED_ROLES,
		"capabilities": [
			{
				"key": c["key"],
				"name": c["name"],
				"category": c["category"],
				"description": c["description"],
				"enabled": role == "System Manager" or c["key"] in enabled,
			}
			for c in CAPABILITIES
		],
	}


def _truthy(value):
	return str(value).strip().lower() in ("1", "true", "yes", "on")


@frappe.whitelist(methods=["POST"])
def set_role_capability(role, capability, enabled):
	require_capability("manage_roles")

	if role in RESERVED_ROLES:
		frappe.throw(_("{0} is a system role and cannot be changed here").format(role))
	if not frappe.db.exists("Role", role):
		frappe.throw(_("Role {0} does not exist").format(role))
	if capability not in CAPABILITY_MAP:
		frappe.throw(_("Unknown capability: {0}").format(capability))

	enabled = _truthy(enabled)

	# Stop admins from removing their own last route to managing roles
	if capability == "manage_roles" and not enabled and role in frappe.get_roles():
		user_roles = set(frappe.get_roles()) - {role}
		if "System Manager" not in user_roles and not frappe.db.exists(
			ROLE_CAPABILITY, {"role": ["in", list(user_roles) or [""]], "capability": "manage_roles"}
		):
			frappe.throw(_("You can't remove your own access to Roles & Permissions"))

	existing = frappe.db.exists(ROLE_CAPABILITY, {"role": role, "capability": capability})
	if enabled and not existing:
		frappe.get_doc({"doctype": ROLE_CAPABILITY, "role": role, "capability": capability}).insert(
			ignore_permissions=True
		)
	elif not enabled and existing:
		frappe.delete_doc(ROLE_CAPABILITY, existing, ignore_permissions=True)

	sync_role_permissions(role)
	return get_role_capabilities(role)


# ---------- setup ----------

def after_migrate():
	for role, keys in DEFAULT_ROLE_CAPABILITIES.items():
		if not frappe.db.exists("Role", role) or frappe.db.exists(ROLE_CAPABILITY, {"role": role}):
			continue
		for key in keys:
			frappe.get_doc({"doctype": ROLE_CAPABILITY, "role": role, "capability": key}).insert(
				ignore_permissions=True
			)
	sync_all_role_permissions()
	frappe.db.commit()


def setup_chp_role(role="CHP"):
	"""Give the CHP role exactly the CHP capabilities (removes others, e.g. View Reports for all reports).
	bench --site <site> execute surveillance.capabilities.setup_chp_role"""
	if not frappe.db.exists("Role", role):
		frappe.throw(f"Role {role} does not exist")
	before = set(frappe.get_all(ROLE_CAPABILITY, filters={"role": role}, pluck="capability"))
	frappe.db.delete(ROLE_CAPABILITY, {"role": role})
	for key in CHP_CAPABILITIES:
		frappe.get_doc({"doctype": ROLE_CAPABILITY, "role": role, "capability": key}).insert(ignore_permissions=True)
	sync_role_permissions(role)
	frappe.db.commit()
	print(f"{role}: removed {sorted(before - set(CHP_CAPABILITIES)) or 'nothing'}; now {CHP_CAPABILITIES}")


OFFICER_CAPABILITIES = ["officer_workspace", "view_review_queue", "act_on_events", "step_signal", "step_verification",
	"ai_triage", "step_investigation", "step_decision", "step_response", "view_event_tasks", "assign_event_tasks", "view_alerts", "investigate_alerts",
	"view_surveillance_map", "view_response_protocols", "view_analytics", "view_reports", "verify_suspected_disease",
	"view_data_quality", "use_knowledge_base"]


def setup_officer_role(role="Surveillance Officer"):
	"""Give the Surveillance Officer role the officer workspace capabilities (keeps any others it already has).
	bench --site <site> execute surveillance.capabilities.setup_officer_role"""
	if not frappe.db.exists("Role", role):
		frappe.throw(f"Role {role} does not exist")
	have = set(frappe.get_all(ROLE_CAPABILITY, filters={"role": role}, pluck="capability"))
	added = [k for k in OFFICER_CAPABILITIES if k not in have]
	for key in added:
		frappe.get_doc({"doctype": ROLE_CAPABILITY, "role": role, "capability": key}).insert(ignore_permissions=True)
	sync_role_permissions(role)
	frappe.db.commit()
	print(f"{role}: added {added or 'nothing'}; now has {sorted(have | set(added))}")


def reset_managed_permissions():
	"""ONE-TIME cleanup in dev: removes Custom DocPerms created by the old Server Scripts, then rebuilds."""
	for dt in _managed_doctypes():
		frappe.db.delete("Custom DocPerm", {"parent": dt})
		frappe.clear_cache(doctype=dt)
	after_migrate()