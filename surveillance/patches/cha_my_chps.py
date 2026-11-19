"""CHAs see the CHPs in the Community Health Unit(s) they head (KRCS 18 Nov 2026): View CHPs in My CHU for the CHA
role(s). Adds only; change it later in Roles & Permissions."""
import frappe

ROLES = ("CHA", "Community Health Assistant")
CAP = "view_my_chps"


def execute():
	from surveillance.capabilities import sync_role_permissions
	for role in ROLES:
		if frappe.db.exists("Role", role) and not frappe.db.exists("Role Capability", {"role": role, "capability": CAP}):
			frappe.get_doc({"doctype": "Role Capability", "role": role, "capability": CAP}).insert(ignore_permissions=True)
			sync_role_permissions(role)
			print(f"{role}: View CHPs in My CHU added")
	frappe.db.commit()
