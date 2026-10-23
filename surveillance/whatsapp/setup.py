"""after_migrate: the account shown as Reported by on community WhatsApp reports.

A Website User with no password and no roles, so it cannot log in. Reuses an account already set in
WhatsApp Settings; otherwise creates (or reuses) COMMUNITY_USER and sets it there.
"""

import frappe

COMMUNITY_USER = "whatsapp-community@krcs.local"


def after_migrate():
	current = frappe.db.get_single_value("WhatsApp Settings", "community_user")
	if current and frappe.db.exists("User", current):
		return
	if not frappe.db.exists("User", COMMUNITY_USER):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": COMMUNITY_USER,
				"first_name": "WhatsApp",
				"last_name": "Community Reporter",
				"user_type": "Website User",
				"send_welcome_email": 0,
			}
		).insert(ignore_permissions=True)
	frappe.db.set_single_value("WhatsApp Settings", "community_user", COMMUNITY_USER)
	# after_migrate, like seed_sub_counties: keep the account even if a later hook fails.
	frappe.db.commit()  # nosemgrep
