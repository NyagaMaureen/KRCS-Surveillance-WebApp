"""Where a user's dashboard looks (KRCS, 16 Nov 2026).

Surveillance Officers, Facility Health Workers and CHAs see the dashboard limited to their assigned sub-county
(User.assigned_sub_county, required when the user is created). System Administrator and other full-menu roles see every place
they are allowed to (their region, or national with View All Regions).
"""
import frappe

from surveillance.capabilities import WORKSPACES, get_user_capabilities

SCOPED_WORKSPACES = {"officer", "fhw", "cha"}


def user_workspace(user=None):
	caps = get_user_capabilities(user or frappe.session.user)
	return next((name for key, name in WORKSPACES if key in caps), "full")


def locked_area(user=None):
	"""{"sub_county": name, "region": id} for officers, FHWs and CHAs; None for everyone else."""
	user = user or frappe.session.user
	if user in ("Administrator", "Guest") or user_workspace(user) not in SCOPED_WORKSPACES:
		return None
	if not frappe.get_meta("User").has_field("assigned_sub_county"):
		return None
	sc_id, region = frappe.db.get_value("User", user, ["assigned_sub_county", "assigned_region"])
	if not sc_id:
		return None
	name, sc_region = frappe.db.get_value("Sub County", sc_id, ["sub_county_name", "region"]) or (sc_id, None)
	return frappe._dict(sub_county=name or sc_id, region=sc_region or region)
