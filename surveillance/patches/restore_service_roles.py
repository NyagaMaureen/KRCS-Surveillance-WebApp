"""Restore the two service roles used by other systems (not people):

    Knowledge Base Client   the chatbot / knowledge base service: Use Knowledge Base, Knowledge base service access
    WhatsApp Bot            the WhatsApp reporting channel: Create Reports, Manage Regions & Symptoms, View Users

Each is created if missing (an existing role with the same name in other capitals is reused), registered on the
Roles & Permissions list, and given its permissions. The WhatsApp community user (WhatsApp Settings) gets the
WhatsApp Bot role back. Safe to run again.
"""
import frappe

SERVICE_ROLES = {
	"Knowledge Base Client": ["use_knowledge_base", "kb_service"],
	"WhatsApp Bot": ["create_reports", "manage_reference_data", "view_users"],
}
CAP = "Role Capability"


def _role(name):
	"""The existing role with this name in any capitals, else a new one."""
	for r in frappe.get_all("Role", pluck="name"):
		if r.lower().replace(" ", "") == name.lower().replace(" ", ""):
			return r
	frappe.get_doc({"doctype": "Role", "role_name": name, "desk_access": 0}).insert(ignore_permissions=True)
	print(f"role created: {name}")
	return name


def _give(user, role):
	if user and frappe.db.exists("User", user) and role not in frappe.get_roles(user):
		u = frappe.get_doc("User", user)
		u.append("roles", {"role": role})
		u.save(ignore_permissions=True)
		print(f"user {user}: given {role}")


def execute():
	for name, keys in SERVICE_ROLES.items():
		role = _role(name)
		if frappe.db.exists("DocType", "Surveillance Role") and not frappe.db.exists("Surveillance Role", role):
			frappe.get_doc({"doctype": "Surveillance Role", "role": role}).insert(ignore_permissions=True)
		have = set(frappe.get_all(CAP, filters={"role": role}, pluck="capability"))
		for key in keys:
			if key not in have:
				frappe.get_doc({"doctype": CAP, "role": role, "capability": key}).insert(ignore_permissions=True)
		print(f"{role}: permissions {', '.join(keys)}")
		if name == "WhatsApp Bot" and frappe.db.exists("DocType", "WhatsApp Settings"):
			_give(frappe.db.get_single_value("WhatsApp Settings", "community_user"), role)

	from surveillance.capabilities import sync_all_role_permissions
	sync_all_role_permissions()
	frappe.clear_cache()
	frappe.db.commit()
	print("If the knowledge base service has its own user, give it the Knowledge Base Client role in User Management.")
