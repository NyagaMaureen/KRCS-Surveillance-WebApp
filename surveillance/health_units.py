"""Community Health Units (KRCS, 17 Nov 2026).

- A CHP belongs to exactly one CHU. A CHA heads one or more CHUs (User.health_units, chosen when the user is added).
- A report sent by a CHP carries the CHP's CHU (Case Report.community_health_unit), set when it is submitted.
- A CHA sees, in their sub-county only: reports from CHPs in the CHU(s) they head, and every report that does not come
  from a CHU (CBS, WhatsApp community reports, facility and officer reports). Nothing from other CHUs.
  Applied to the Review Queue, Signals Captured, their dashboard and the map.
- The CHU registry is managed in Users -> Community Health Units (Manage Users). For existing users, each sub-county got
  one CHU ("<sub-county> Health Unit") until the real CHUs are added (patches/health_units_setup.py).
"""
import frappe
from frappe import _

from surveillance.capabilities import has_capability, require_capability

DT, CHILD = "Community Health Unit", "User Health Unit"
CHP_ROLES = {"CHP", "Community Health Promoter"}
CHA_ROLES = {"CHA", "Community Health Assistant"}


def _ready():
	return bool(frappe.db.table_exists(DT) and frappe.db.table_exists(CHILD)
		and frappe.db.has_column("Case Report", "community_health_unit"))


def _cache():
	if not hasattr(frappe.local, "krcs_chu_cache"):
		frappe.local.krcs_chu_cache = {}
	return frappe.local.krcs_chu_cache


def units_of(user):
	"""The CHU ids on a user's account (a CHP has one, a CHA one or more)."""
	if not user or not _ready():
		return []
	return [r[0] for r in frappe.db.sql(
		f"select health_unit from `tab{CHILD}` where parent=%s and parenttype='User' and parentfield='health_units' "
		"and ifnull(health_unit,'')!='' order by idx", user)]


def cha_scope(user=None):
	"""None when the user is not limited by CHU. For a CHA: {units, sub_county (id), sub_county_name}."""
	user = user or frappe.session.user
	if user in ("Administrator", "Guest") or not _ready():
		return None
	key = ("scope", user)
	cache = _cache()
	if key not in cache:
		from surveillance.user_scope import user_workspace
		scope = None
		if user_workspace(user) == "cha":
			sc = frappe.db.get_value("User", user, "assigned_sub_county")
			name = frappe.db.get_value("Sub County", sc, "sub_county_name") if sc else None
			scope = frappe._dict(units=units_of(user), sub_county=sc, sub_county_name=name or sc or "")
		cache[key] = scope
	return cache[key]


def report_ok(scope, unit):
	"""May this CHA scope see a report from this CHU? Reports from no CHU (CBS, WhatsApp community, facility) are seen."""
	return scope is None or not unit or unit in scope.units


def visible_events(user=None, fresh=False):
	"""None when not limited; for a CHA the set of Review Queue events they may see: in their sub-county, with at least
	one report from their CHU(s) or not from any CHU."""
	scope = cha_scope(user)
	if scope is None:
		return None
	key = ("events", user or frappe.session.user)
	cache = _cache()
	if fresh or key not in cache:
		rows = frappe.db.sql("""
			select s.event, s.source, cr.community_health_unit as chu
			from `tabSurveillance Signal` s
			join `tabSurveillance Event` e on e.name = s.event
			left join `tabCase Report` cr on s.source = 'Field' and cr.name = s.ref
			where ifnull(s.event, '') != '' and lower(trim(ifnull(e.sub_county, ''))) = %s
		""", ((scope.sub_county_name or "").strip().lower(),), as_dict=True) if scope.sub_county_name else []
		cache[key] = {r.event for r in rows if r.source != "Field" or report_ok(scope, r.chu)}
	return cache[key]


def event_visible(event, user=None):
	vis = visible_events(user, fresh=True)
	return vis is None or event in vis


def filter_signals(signals, user=None):
	"""Event detail: a CHA does not see the reports of other CHUs inside a shared event."""
	scope = cha_scope(user)
	if scope is None:
		return signals
	refs = [s.get("ref") for s in signals if s.get("source") == "Field" and s.get("ref")]
	unit_of = dict(frappe.get_all("Case Report", filters={"name": ["in", refs]}, fields=["name", "community_health_unit"],
		as_list=True)) if refs else {}
	return [s for s in signals if s.get("source") != "Field" or report_ok(scope, unit_of.get(s.get("ref")))]


def report_condition(user=None):
	"""SQL for Case Report lists (Signals Captured): '' when not limited."""
	scope = cha_scope(user)
	if scope is None:
		return ""
	units = ", ".join(frappe.db.escape(u) for u in scope.units)
	cond = "ifnull(`tabCase Report`.community_health_unit, '') = ''"
	return f"({cond} or `tabCase Report`.community_health_unit in ({units}))" if units else f"({cond})"


# ---------- when a report is submitted ----------

def set_report_unit(doc, method=None):
	"""Case Report validate: a new report from a CHP takes the CHP's CHU."""
	if not doc.is_new() or doc.get("community_health_unit") or not frappe.db.table_exists(CHILD):
		return
	user = doc.get("reported_by") or doc.owner
	if not user or user in ("Administrator", "Guest"):
		return
	if not (set(frappe.get_roles(user)) & CHP_ROLES):
		return
	units = units_of(user)
	if units:
		doc.community_health_unit = units[0]


# ---------- users ----------

def _role_kind(doc):
	roles = {r.role for r in (doc.get("roles") or [])}
	if doc.get("primary_role"):
		roles.add(doc.primary_role)
	if roles & CHA_ROLES:
		return "cha"
	if roles & CHP_ROLES:
		return "chp"
	return None


def validate_user(doc, method=None):
	"""User validate: a CHP needs exactly one CHU, a CHA at least one, all in their assigned sub-county.
	Checked only once the user has a sub-county, so older accounts without one can still be saved."""
	if not frappe.db.table_exists(DT) or not doc.meta.has_field("health_units"):
		return
	kind = _role_kind(doc)
	units = [r.health_unit for r in (doc.get("health_units") or []) if r.health_unit]
	if not kind:
		return
	if not doc.get("assigned_sub_county"):
		return
	if not units:
		frappe.throw(_("Choose the Community Health Unit for this {0}.").format("CHP" if kind == "chp" else "CHA"),
			title=_("Community Health Unit required"))
	if kind == "chp" and len(set(units)) > 1:
		frappe.throw(_("A CHP belongs to one Community Health Unit only."), title=_("One Community Health Unit"))
	wrong = [u for u in set(units) if frappe.db.get_value(DT, u, "sub_county") != doc.assigned_sub_county]
	if wrong:
		frappe.throw(_("{0} is not in this user's sub-county.").format(", ".join(
			frappe.db.get_value(DT, u, "health_unit_name") or u for u in wrong)), title=_("Wrong sub-county"))


# ---------- the registry (Users -> Community Health Units) ----------

def _counts():
	rows = frappe.db.sql(f"""
		select h.health_unit, u.name, u.primary_role, u.enabled
		from `tab{CHILD}` h join `tabUser` u on u.name = h.parent
		where h.parenttype = 'User' and h.parentfield = 'health_units'
	""", as_dict=True)
	out = {}
	for r in rows:
		c = out.setdefault(r.health_unit, {"chps": 0, "chas": []})
		roles = set(frappe.get_roles(r.name)) | {r.primary_role}
		if roles & CHA_ROLES:
			c["chas"].append(frappe.utils.get_fullname(r.name))
		elif roles & CHP_ROLES:
			c["chps"] += 1
	return out


@frappe.whitelist()
def get_units(sub_county=None, active_only=0):
	"""The CHU list, for the user form (a sub-county's active CHUs) and the registry (all, with CHP / CHA counts)."""
	if not frappe.db.table_exists(DT):
		return []
	filters = {}
	if sub_county:
		filters["sub_county"] = sub_county
	if frappe.utils.cint(active_only):
		filters["is_active"] = 1
	rows = frappe.get_all(DT, filters=filters, fields=["name", "health_unit_name", "sub_county", "region", "is_active"],
		order_by="health_unit_name asc", limit_page_length=0)
	if sub_county or not has_capability("view_users"):
		return [{"id": r.name, "name": r.health_unit_name, "subCounty": r.sub_county, "active": bool(r.is_active)} for r in rows]
	counts = _counts()
	subs = {s.name: s.sub_county_name for s in frappe.get_all("Sub County", fields=["name", "sub_county_name"])}
	regions = {r.name: r.region_name for r in frappe.get_all("Region", fields=["name", "region_name"])}
	return [{"id": r.name, "name": r.health_unit_name, "subCounty": r.sub_county, "subCountyName": subs.get(r.sub_county) or r.sub_county,
		"region": r.region, "regionName": regions.get(r.region) or r.region, "active": bool(r.is_active),
		"chps": (counts.get(r.name) or {}).get("chps", 0), "chas": (counts.get(r.name) or {}).get("chas", [])} for r in rows]


@frappe.whitelist(methods=["POST"])
def save_unit(name=None, health_unit_name=None, sub_county=None, is_active=1):
	require_capability("manage_users")
	title = (health_unit_name or "").strip()
	if not title:
		frappe.throw(_("Give the Community Health Unit a name."))
	if not sub_county or not frappe.db.exists("Sub County", sub_county):
		frappe.throw(_("Choose the sub-county."))
	dup = frappe.db.get_value(DT, {"health_unit_name": title, "sub_county": sub_county, "name": ["!=", name or ""]})
	if dup:
		frappe.throw(_("{0} already exists in this sub-county.").format(title))
	if name:
		doc = frappe.get_doc(DT, name)
		if doc.sub_county != sub_county and frappe.db.exists(CHILD, {"health_unit": name, "parenttype": "User"}):
			frappe.throw(_("Users belong to this CHU, so its sub-county cannot change. Add a new CHU instead."))
	else:
		doc = frappe.new_doc(DT)
	doc.health_unit_name, doc.sub_county = title, sub_county
	doc.region = frappe.db.get_value("Sub County", sub_county, "region")
	doc.is_active = 1 if frappe.utils.cint(is_active) else 0
	doc.save(ignore_permissions=True)
	return {"id": doc.name, "name": doc.health_unit_name}


@frappe.whitelist()
def get_user_units():
	"""{user: [{id, name}]} for the Users table."""
	require_capability("view_users")
	if not frappe.db.table_exists(CHILD):
		return {}
	names = {r.name: r.health_unit_name for r in frappe.get_all(DT, fields=["name", "health_unit_name"], limit_page_length=0)}
	out = {}
	for r in frappe.db.sql(f"select parent, health_unit from `tab{CHILD}` where parenttype='User' and parentfield='health_units' order by idx",
			as_dict=True):
		out.setdefault(r.parent, []).append({"id": r.health_unit, "name": names.get(r.health_unit) or r.health_unit})
	return out


# ---------- showing the CHU on Signals Captured and the Review Queue (KRCS 17 Nov 2026) ----------

def _names():
	key = ("names",)
	cache = _cache()
	if key not in cache:
		cache[key] = dict(frappe.get_all(DT, fields=["name", "health_unit_name"], as_list=True, limit_page_length=0)) \
			if frappe.db.table_exists(DT) else {}
	return cache[key]


def units_for_reports(refs):
	"""{report: CHU id} for Case Reports with a CHU."""
	refs = [r for r in refs if r]
	if not refs or not _ready():
		return {}
	return {name: unit for name, unit in frappe.get_all("Case Report", filters={"name": ["in", refs],
		"community_health_unit": ["is", "set"]}, fields=["name", "community_health_unit"], as_list=True, limit_page_length=0)}


def units_for_events(events, user=None):
	"""{event: [{id, name}]}: the CHUs of the CHP reports in each event. A CHA sees only their own CHU(s)."""
	if not events or not _ready():
		return {}
	sigs = frappe.get_all("Surveillance Signal", filters={"event": ["in", list(events)], "source": "Field"},
		fields=["event", "ref"], order_by="signal_date asc", limit_page_length=0)
	unit_of = units_for_reports([s.ref for s in sigs])
	scope, names, out = cha_scope(user), _names(), {}
	for s in sigs:
		unit = unit_of.get(s.ref)
		if not unit or (scope is not None and unit not in scope.units):
			continue
		row = out.setdefault(s.event, [])
		if not any(u["id"] == unit for u in row):
			row.append({"id": unit, "name": names.get(unit) or unit})
	return out


def unit_name(unit):
	return _names().get(unit) or unit if unit else None


@frappe.whitelist()
def get_unit_options():
	"""Units for the Health unit filters and to show names: every unit (id, name, sub-county), and which ones this user
	can filter by (a CHA: the units they head; officers, FHWs and CHAs' areas: their sub-county; others: all)."""
	if not frappe.db.table_exists(DT):
		return {"units": [], "options": []}
	rows = frappe.get_all(DT, fields=["name", "health_unit_name", "sub_county", "region", "is_active"],
		order_by="health_unit_name asc", limit_page_length=0)
	scope = cha_scope()
	if scope is not None:
		options = [r.name for r in rows if r.name in scope.units]
	else:
		from surveillance.user_scope import locked_area
		area = locked_area()
		sc = frappe.db.get_value("User", frappe.session.user, "assigned_sub_county") if area else None
		options = [r.name for r in rows if not sc or r.sub_county == sc]
	return {"units": [{"id": r.name, "name": r.health_unit_name, "subCounty": r.sub_county, "active": bool(r.is_active)} for r in rows],
		"options": options}
