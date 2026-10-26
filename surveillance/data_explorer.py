"""Data Explorer: search and filter surveillance data, see it as a table or a chart, export it.

Two datasets:
  counts   Weekly Count: one row per source, disease, sub-county and week. Covers every source:
           Field reports (Case Report), CBS and MOH 505 (IDSR). No personal data.
  reports  Individual field Case Reports (web, mobile, WhatsApp). Reporter names, phone numbers
           and free-text notes are never returned.

Access: capability view_analytics; export needs export_data.
Region: officers see the sub-counties of their region; users with View All Regions or no region see
everything. "Pilot sites only" (default on) limits to the Review Queue sub-counties.
"""
import json
from collections import OrderedDict

import frappe

from frappe.utils import cint, getdate

from surveillance.capabilities import has_capability, require_capability

VIEW = "view_analytics"
EXPORT = "export_data"
SOURCES = OrderedDict([("Case Report", "Field reports"), ("CBS", "Community (CBS)"), ("IDSR", "Health facilities (MOH 505)")])
GROUPS = {"disease", "week", "month", "sub_county", "county", "source", "status", "channel"}
METRICS = {"count", "affected", "deaths"}
MAX_EXPORT = 20000
MAX_SERIES = 8


# ---------- shared helpers ----------

def _args(params):
	p = json.loads(params) if isinstance(params, str) else (params or {})
	return frappe._dict(p)


def _list(v):
	if not v:
		return []
	return [x for x in (v if isinstance(v, (list, tuple)) else [v]) if x not in (None, "")]


def _disease_names():
	return {d.name: d.disease_name or d.name for d in frappe.get_all("Alert Threshold Config", fields=["name", "disease_name"])}


def _allowed_sub_counties(pilot_only):
	"""Lower-case sub-county names this user may see, or None for no limit."""
	from surveillance.events import _scope, _user_region
	allowed = None
	region = _user_region()
	if region:
		allowed = {(n or "").strip().lower() for n in frappe.get_all("Sub County", filters={"region": region}, pluck="sub_county_name")}
	if pilot_only:
		pilot, _ = _scope()
		allowed = pilot if allowed is None else allowed & pilot
	return allowed


def _match_diseases(text, names):
	t = (text or "").strip().lower()
	return [k for k, v in names.items() if t and (t in k.lower() or t in (v or "").lower())]


def _epi(d):
	y, w, _ = getdate(d).isocalendar()
	return y, w


def _bucket_label(group, value, names):
	if value in (None, ""):
		return "Not recorded"
	if group == "disease":
		return names.get(value, value)
	if group == "source":
		return SOURCES.get(value, value)
	if group == "week":
		y, w = _epi(value)
		return f"W{w} {y} ({getdate(value).strftime('%-d %b')})"
	if group == "month":
		return getdate(f"{value}-01").strftime("%b %Y")
	return str(value)


# ---------- options for the filter bar ----------

def _select_options(field):
	"""Choices of a Case Report Select field, straight from the DocType (falls back to values in use)."""
	f = frappe.get_meta("Case Report").get_field(field)
	if f and f.fieldtype == "Select" and f.options:
		return [o for o in f.options.split("\n") if o]
	return sorted({v for v in frappe.get_all("Case Report", pluck=field, distinct=True) if v})


@frappe.whitelist()
def get_options():
	require_capability(VIEW)
	names = _disease_names()
	from surveillance.events import _user_region
	region = _user_region()
	sc_filters = {"is_active": 1}
	if region:
		sc_filters["region"] = region
	subs = frappe.get_all("Sub County", filters=sc_filters, fields=["name", "sub_county_name", "county"], order_by="county, sub_county_name")
	bounds = frappe.db.sql("select min(week_start), max(week_start) from `tabWeekly Count`")[0]
	return {
		"diseases": [{"value": k, "label": v} for k, v in sorted(names.items(), key=lambda x: x[1] or "")],
		"sources": [{"value": k, "label": v} for k, v in SOURCES.items()],
		"subCounties": [{"value": s.sub_county_name, "label": f"{s.sub_county_name} · {s.county}", "county": s.county} for s in subs],
		"counties": sorted({s.county for s in subs if s.county}),
		"statuses": _select_options("status"),
		"channels": _select_options("channel"),
		"firstWeek": str(bounds[0]) if bounds[0] else None,
		"lastWeek": str(bounds[1]) if bounds[1] else None,
		"limitedToRegion": bool(region),
		"canExport": has_capability(EXPORT),
	}


# ---------- weekly counts ----------

def _counts_where(a, names):
	where, values = ["1=1"], {}
	sources = [s for s in _list(a.sources) if s in SOURCES] or list(SOURCES)
	where.append("source in %(sources)s")
	values["sources"] = tuple(sources)
	diseases = _list(a.diseases)
	if a.search:
		hits = _match_diseases(a.search, names)
		like = f"%{a.search.strip()}%"
		where.append("(disease in %(search_d)s or sub_county like %(like)s or county like %(like)s)")
		values.update({"search_d": tuple(hits) or ("",), "like": like})
	if diseases:
		where.append("disease in %(diseases)s")
		values["diseases"] = tuple(diseases)
	if _list(a.sub_counties):
		where.append("sub_county in %(subs)s")
		values["subs"] = tuple(_list(a.sub_counties))
	if a.county:
		where.append("county = %(county)s")
		values["county"] = a.county
	if a.date_from:
		where.append("week_start >= %(df)s")
		values["df"] = getdate(a.date_from)
	if a.date_to:
		where.append("week_start <= %(dt)s")
		values["dt"] = getdate(a.date_to)
	allowed = _allowed_sub_counties(cint(a.pilot_only) if a.pilot_only is not None else 1)
	if allowed is not None:
		where.append("lower(trim(sub_county)) in %(allowed)s")
		values["allowed"] = tuple(allowed) or ("",)
	return " and ".join(where), values


COUNT_COLS = {"disease": "disease", "week": "week_start", "month": "date_format(week_start, '%%Y-%%m')",
	"sub_county": "sub_county", "county": "county", "source": "source"}


def _query_counts(a, names, paged=True):
	where, values = _counts_where(a, names)
	totals = frappe.db.sql(f"""select count(*) n, coalesce(sum(signals),0) c, coalesce(sum(affected),0) af,
		coalesce(sum(deaths),0) de from `tabWeekly Count` where {where}""", values, as_dict=True)[0]

	sort = {"week": "week_start", "count": "signals", "affected": "affected", "deaths": "deaths",
		"disease": "disease", "sub_county": "sub_county"}.get(a.sort or "week", "week_start")
	order = "asc" if (a.order or "desc") == "asc" else "desc"
	size = min(cint(a.page_size) or 25, 200)
	limit = f"limit {size} offset {max(cint(a.page), 0) * size}" if paged else f"limit {MAX_EXPORT}"
	rows = frappe.db.sql(f"""select source, disease, county, sub_county, week_start, signals, affected, deaths
		from `tabWeekly Count` where {where} order by {sort} {order}, week_start desc {limit}""", values, as_dict=True)
	out = []
	for r in rows:
		y, w = _epi(r.week_start)
		out.append({"source": r.source, "sourceLabel": SOURCES.get(r.source, r.source), "disease": r.disease,
			"diseaseName": names.get(r.disease, r.disease), "county": r.county, "subCounty": r.sub_county,
			"week": str(r.week_start), "epiWeek": f"W{w} {y}", "count": r.signals or 0,
			"affected": r.affected or 0, "deaths": r.deaths or 0})
	return out, {"rows": totals.n, "count": int(totals.c), "affected": int(totals.af), "deaths": int(totals.de)}, where, values


def _chart_counts(a, names, where, values):
	group = a.group_by if a.group_by in COUNT_COLS else "disease"
	split = a.split_by if a.split_by in COUNT_COLS and a.split_by != group else None
	metric = {"count": "signals", "affected": "affected", "deaths": "deaths"}.get(a.metric or "count", "signals")
	gcol, scol = COUNT_COLS[group], COUNT_COLS[split] if split else "''"
	rows = frappe.db.sql(f"""select {gcol} g, {scol} s, coalesce(sum({metric}),0) v from `tabWeekly Count`
		where {where} group by g, s""", values, as_dict=True)
	return _build_chart(rows, group, split, names)


# ---------- individual field reports ----------

REPORT_COLS = {"disease": "cr.suspected_disease", "week": "subdate(date(coalesce(cr.report_date, cr.creation)), weekday(coalesce(cr.report_date, cr.creation)))",
	"month": "date_format(coalesce(cr.report_date, cr.creation), '%%Y-%%m')", "sub_county": "sc.sub_county_name",
	"county": "sc.county", "status": "cr.status", "channel": "cr.channel", "source": "'Case Report'"}


def _reports_where(a, names):
	where, values = ["1=1"], {}
	if a.search:
		hits = _match_diseases(a.search, names)
		like = f"%{a.search.strip()}%"
		where.append("(cr.name like %(like)s or cr.suspected_disease in %(search_d)s or sc.sub_county_name like %(like)s "
			"or sc.county like %(like)s or cr.location_name like %(like)s)")
		values.update({"like": like, "search_d": tuple(hits) or ("",)})
	if _list(a.diseases):
		where.append("cr.suspected_disease in %(diseases)s")
		values["diseases"] = tuple(_list(a.diseases))
	if _list(a.sub_counties):
		where.append("sc.sub_county_name in %(subs)s")
		values["subs"] = tuple(_list(a.sub_counties))
	if a.county:
		where.append("sc.county = %(county)s")
		values["county"] = a.county
	if _list(a.statuses):
		where.append("cr.status in %(statuses)s")
		values["statuses"] = tuple(_list(a.statuses))
	if _list(a.channels):
		where.append("cr.channel in %(channels)s")
		values["channels"] = tuple(_list(a.channels))
	if a.date_from:
		where.append("date(coalesce(cr.report_date, cr.creation)) >= %(df)s")
		values["df"] = getdate(a.date_from)
	if a.date_to:
		where.append("date(coalesce(cr.report_date, cr.creation)) <= %(dt)s")
		values["dt"] = getdate(a.date_to)
	allowed = _allowed_sub_counties(cint(a.pilot_only) if a.pilot_only is not None else 1)
	if allowed is not None:
		# reports with no sub-county are shown only to users without a region limit
		where.append("lower(trim(sc.sub_county_name)) in %(allowed)s")
		values["allowed"] = tuple(allowed) or ("",)
	return " and ".join(where), values


REPORT_FROM = "`tabCase Report` cr left join `tabSub County` sc on sc.name = cr.sub_county"


def _query_reports(a, names, paged=True):
	where, values = _reports_where(a, names)
	totals = frappe.db.sql(f"""select count(*) n, coalesce(sum(cr.affected_count),0) af, coalesce(sum(cr.deaths_count),0) de
		from {REPORT_FROM} where {where}""", values, as_dict=True)[0]
	sort = {"week": "coalesce(cr.report_date, cr.creation)", "affected": "cr.affected_count", "deaths": "cr.deaths_count",
		"disease": "cr.suspected_disease", "sub_county": "sc.sub_county_name"}.get(a.sort or "week", "cr.creation")
	order = "asc" if (a.order or "desc") == "asc" else "desc"
	size = min(cint(a.page_size) or 25, 200)
	limit = f"limit {size} offset {max(cint(a.page), 0) * size}" if paged else f"limit {MAX_EXPORT}"
	rows = frappe.db.sql(f"""select cr.name, cr.report_date, cr.creation, cr.suspected_disease, cr.status, cr.channel,
			cr.signal_type, cr.affected_count, cr.deaths_count, cr.location_name, sc.sub_county_name, sc.county
		from {REPORT_FROM} where {where} order by {sort} {order}, cr.creation desc {limit}""", values, as_dict=True)
	out = [{"id": r.name, "date": str(r.report_date or getdate(r.creation)), "disease": r.suspected_disease,
		"diseaseName": names.get(r.suspected_disease, r.suspected_disease) if r.suspected_disease else "Not classified",
		"status": r.status, "channel": r.channel, "signalType": r.signal_type, "affected": r.affected_count or 0,
		"deaths": r.deaths_count or 0, "location": r.location_name, "subCounty": r.sub_county_name, "county": r.county}
		for r in rows]
	return out, {"rows": totals.n, "count": totals.n, "affected": int(totals.af), "deaths": int(totals.de)}, where, values


def _chart_reports(a, names, where, values):
	group = a.group_by if a.group_by in REPORT_COLS else "disease"
	split = a.split_by if a.split_by in REPORT_COLS and a.split_by != group else None
	metric = {"count": "count(*)", "affected": "coalesce(sum(cr.affected_count),0)",
		"deaths": "coalesce(sum(cr.deaths_count),0)"}.get(a.metric or "count", "count(*)")
	scol = REPORT_COLS[split] if split else "''"
	rows = frappe.db.sql(f"""select {REPORT_COLS[group]} g, {scol} s, {metric} v from {REPORT_FROM}
		where {where} group by g, s""", values, as_dict=True)
	return _build_chart(rows, group, split, names)


# ---------- chart shaping ----------

def _build_chart(rows, group, split, names):
	keys = sorted({r.g for r in rows}, key=lambda k: (k is None, str(k)))
	if group not in ("week", "month"):
		totals = {}
		for r in rows:
			totals[r.g] = totals.get(r.g, 0) + float(r.v or 0)
		keys = sorted(keys, key=lambda k: -totals.get(k, 0))[:30]   # biggest first, at most 30 bars
	series_keys = [""]
	if split:
		stot = {}
		for r in rows:
			stot[r.s] = stot.get(r.s, 0) + float(r.v or 0)
		series_keys = sorted(stot, key=lambda k: -stot[k])[:MAX_SERIES]
	data = {(r.g, r.s if split else ""): float(r.v or 0) for r in rows}
	return {
		"groupBy": group, "splitBy": split,
		"labels": [_bucket_label(group, str(k) if k is not None else None, names) for k in keys],
		"series": [{"name": _bucket_label(split, s, names) if split else "Total",
			"data": [int(data.get((k, s), 0)) for k in keys]} for s in series_keys],
		"truncated": group not in ("week", "month") and len({r.g for r in rows}) > 30,
	}


# ---------- API ----------

@frappe.whitelist()
def query(params=None):
	"""params (JSON): dataset counts|reports, search, diseases[], sources[], sub_counties[], county, statuses[],
	channels[], date_from, date_to, pilot_only (default 1), group_by, split_by, metric count|affected|deaths,
	sort, order, page, page_size."""
	require_capability(VIEW)
	a = _args(params)
	names = _disease_names()
	if (a.dataset or "counts") == "reports":
		rows, summary, where, values = _query_reports(a, names)
		chart = _chart_reports(a, names, where, values)
	else:
		rows, summary, where, values = _query_counts(a, names)
		chart = _chart_counts(a, names, where, values)
	size = min(cint(a.page_size) or 25, 200)
	return {"dataset": a.dataset or "counts", "rows": rows, "summary": summary, "chart": chart,
		"page": max(cint(a.page), 0), "pageSize": size, "pages": max(1, -(-summary["rows"] // size))}


@frappe.whitelist()
def export(params=None):
	"""All matching rows (up to 20,000) for CSV/JSON download. Needs Export Data."""
	require_capability(VIEW)
	require_capability(EXPORT)
	a = _args(params)
	names = _disease_names()
	if (a.dataset or "counts") == "reports":
		rows, summary, _, _ = _query_reports(a, names, paged=False)
	else:
		rows, summary, _, _ = _query_counts(a, names, paged=False)
	return {"rows": rows, "total": summary["rows"], "truncated": summary["rows"] > MAX_EXPORT}
