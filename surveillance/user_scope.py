"""Where a user's dashboard looks (KRCS, 16 Nov 2026).

Surveillance Officers, Facility Health Workers and CHAs see the dashboard limited to their assigned sub-county
(User.assigned_sub_county, required when the user is created). An officer can also have other sub-counties
(User.other_sub_counties, KRCS 19 Nov 2026): the Review Queue, Signals Captured and alerts then cover all of them. System Administrator and other full-menu roles see every place
they are allowed to (their region, or national with View All Regions).
"""
import frappe

from surveillance.capabilities import WORKSPACES, get_user_capabilities

SCOPED_WORKSPACES = {"officer", "fhw", "cha"}


def user_workspace(user=None):
	caps = get_user_capabilities(user or frappe.session.user)
	return next((name for key, name in WORKSPACES if key in caps), "full")


OTHER_FIELD, OTHER_CHILD = "other_sub_counties", "User Sub County"   # more sub-counties for an officer (KRCS 19 Nov 2026)


def user_sub_counties(user=None):
	"""The Sub County ids a user works in: their assigned sub-county first, then any others (officers, KRCS 19 Nov 2026)."""
	user = user or frappe.session.user
	if user in ("Guest",) or not frappe.get_meta("User").has_field("assigned_sub_county"):
		return []
	ids = [frappe.db.get_value("User", user, "assigned_sub_county")]
	if frappe.get_meta("User").has_field(OTHER_FIELD):
		ids += frappe.get_all(OTHER_CHILD, filters={"parent": user, "parenttype": "User", "parentfield": OTHER_FIELD},
			order_by="idx asc", pluck="sub_county")
	out = []
	for i in ids:
		if i and i not in out:
			out.append(i)
	return out


def _area_cache():
	"""Per request: locked_area is asked many times while one page loads."""
	cache = getattr(frappe.local, "krcs_area_cache", None)
	if cache is None:
		cache = frappe.local.krcs_area_cache = {}
	return cache


def locked_area(user=None):
	"""Officers, FHWs and CHAs: the sub-county or sub-counties they work in; None for everyone else.
	sub_county / region: the first (assigned) one; sub_counties: every name; ids: every Sub County id."""
	user = user or frappe.session.user
	if user in ("Administrator", "Guest") or user_workspace(user) not in SCOPED_WORKSPACES:
		return None
	cache = _area_cache()
	key = ("area", user)
	if key in cache:
		return cache[key]
	ids = user_sub_counties(user)
	area = None
	if ids:
		region = frappe.db.get_value("User", user, "assigned_region")
		rows = {r.name: r for r in frappe.get_all("Sub County", filters={"name": ["in", ids]},
			fields=["name", "sub_county_name", "region"])}
		names = [(rows[i].sub_county_name if i in rows else None) or i for i in ids]
		regions = [rows[i].region for i in ids if i in rows and rows[i].region]
		area = frappe._dict(sub_county=names[0], region=(regions[0] if regions else None) or region,
			sub_counties=names, ids=ids, regions=sorted(set(regions)) or ([region] if region else []))
	cache[key] = area
	return area


def in_area(area, sub_county):
	"""Is this sub-county (name or id) one of the area's?"""
	if not area:
		return True
	v = (sub_county or "").strip().lower()
	return bool(v) and (v in {n.strip().lower() for n in area.sub_counties} or v in {i.lower() for i in area.ids})


def pick_sub_county(area, wanted=None):
	"""The one sub-county a dashboard shows for this area: the one asked for, if it is theirs, else the first."""
	if wanted and in_area(area, wanted):
		w = wanted.strip().lower()
		for n, i in zip(area.sub_counties, area.ids):
			if w in (n.strip().lower(), i.lower()):
				return n
	return area.sub_county


@frappe.whitelist()
def get_my_area():
	"""The places a user works in, for the filters: locked (officers, FHWs and CHAs) and their sub-counties."""
	area = locked_area()
	if not area:
		return {"locked": False, "subCounties": [], "regions": []}
	return {"locked": True, "regions": area.regions,
		"subCounties": [{"id": i, "name": n} for i, n in zip(area.ids, area.sub_counties)]}


@frappe.whitelist()
def get_users_other_sub_counties():
	"""{user: [Sub County id]} for the Users table and the user form."""
	from surveillance.capabilities import require_capability
	require_capability("view_users")
	if not frappe.get_meta("User").has_field(OTHER_FIELD):
		return {}
	out = {}
	for r in frappe.get_all(OTHER_CHILD, filters={"parenttype": "User", "parentfield": OTHER_FIELD},
			fields=["parent", "sub_county"], order_by="idx asc", limit_page_length=0):
		out.setdefault(r.parent, []).append(r.sub_county)
	return out


def validate_other_sub_counties(doc, method=None):
	"""User validate: the other sub-counties never repeat the assigned one; CHPs and CHAs work in one sub-county."""
	_area_cache().pop(("area", doc.name), None)   # the places may change with this save
	if not doc.meta.has_field(OTHER_FIELD):
		return
	from surveillance.health_units import _role_kind
	rows, seen = [], {doc.get("assigned_sub_county")}
	if not doc.get("assigned_sub_county") or _role_kind(doc):
		doc.set(OTHER_FIELD, [])
		return
	for r in doc.get(OTHER_FIELD) or []:
		if r.sub_county and r.sub_county not in seen:
			seen.add(r.sub_county)
			rows.append(r)
	doc.set(OTHER_FIELD, rows)
