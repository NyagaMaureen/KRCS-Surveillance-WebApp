"""Shorter name, matching SCDSC: County Disease Surveillance Coordinator -> CDSC (also from County Officer, if a site
never ran the earlier clean-up). Users, permissions and links follow the rename. Safe to run again."""
import frappe

from surveillance.patches.roles_cleanup_2026_11_v2 import _rename


def execute():
	for old in ("County Disease Surveillance Coordinator", "County Officer"):
		_rename(old, "CDSC")
	frappe.clear_cache()
	frappe.db.commit()
