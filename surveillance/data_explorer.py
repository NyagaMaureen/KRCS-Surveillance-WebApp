"""Data Explorer: search and filter surveillance data, see it as a table or a chart, export it.

Two datasets:
  counts   Weekly Count: one row per source, disease, sub-county and week. Covers every source:
           Reports (web, mobile, WhatsApp; Case Report), CBS and MOH 505 (IDSR). No personal data.
  reports  Individual field Case Reports (web, mobile, WhatsApp). Reporter names, phone numbers
           and free-text notes are never returned.

Access: capability view_data_explorer; export needs export_data.
Area (KRCS 26 Nov 2026): CHAs, Surveillance Officers and FHWs see their own sub-county or sub-counties (the same as
their Review Queue); users limited to a region see that region; users with View All Regions see everything.
"Pilot sites only" (default on) limits to the sub-counties in our Sub County list (the Dadaab and Kalobeyei regions).
Charts: weeks and months with nothing reported are shown as 0 (not skipped), the smaller split groups are added up
as "Other" so the bars still add up to the totals, and a pie always shows totals.
"""
import json
from collections import OrderedDict

import frappe

from frappe.utils import add_days, cint, getdate

from surveillance.capabilities import has_capability, require_capability

VIEW = "view_data_explorer"
EXPORT = "export_data"
SOURCES = OrderedDict([("Case Report", "Reports (web, mobile, WhatsApp)"), ("CBS", "CBS"), ("IDSR", "MOH 505")])
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


def _area():
	"""(lower-case sub-county names this user is limited to or None, words for it). Sub-county users (CHA, officer,
	FHW) first, then a region, else everything."""
	from surveillance.events import _user_region
	from surveillance.user_scope import locked_area
	area = locked_area()
	if area:
		names = sorted({(n or "").strip() for n in area.sub_counties if n})
		return {n.lower() for n in names}, "your sub-count" + ("ies" if len(names) > 1 else "y") + f" ({', '.join(names)})"
	region = _user_region()
	if region:
		subs = frappe.get_all("Sub County", filters={"region": region}, pluck="sub_county_name")
		names = sorted({(n or "").strip() for n in subs if n})
		return {n.lower() for n in names}, f"your region ({_region_label(region)}: {', '.join(names)})"
	return None, ""


def _region_label(region):
	title = frappe.get_meta("Region").title_field
	return (frappe.get_cached_value("Region", region, title) if title else None) or region


def _pilot():
	"""Pilot sites (KRCS 26 Nov 2026): the sub-counties in our Sub County list, i.e. the Dadaab and Kalobeyei regions
	(Dadaab, Fafi, Liboi, Lokichogio, Turkana West). CBS also sends other counties (Migori, Makueni...): left out."""
	return {(n or "").strip().lower() for n in frappe.get_all("Sub County", filters={"is_active": 1}, pluck="sub_county_name") if n}


def _allowed_sub_counties(pilot_only):
	"""Lower-case sub-county names this user may see, or None for no limit."""
	allowed, _words = _area()
	if pilot_only:
		pilot = _pilot()
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
	allowed, words = _area()
	subs = [s for s in frappe.get_all("Sub County", filters={"is_active": 1}, fields=["name", "sub_county_name", "county"],
		order_by="county, sub_county_name") if allowed is None or (s.sub_county_name or "").strip().lower() in allowed]
	bounds = frappe.db.sql("select min(week_start), max(week_start) from `tabWeekly Count`")[0]
	return {
		"diseases": [{"value": k, "label": v} for k, v in sorted(names.items(), key=lambda x: (x[1] or "").lower().removeprefix("suspected ")) if k in _active()],
		"sources": [{"value": k, "label": v} for k, v in SOURCES.items()],
		"subCounties": [{"value": s.sub_county_name, "label": f"{s.sub_county_name} · {s.county}", "county": s.county} for s in subs],
		"counties": sorted({s.county for s in subs if s.county}),
		"statuses": _select_options("status"),
		"channels": _select_options("channel"),
		"firstWeek": str(bounds[0]) if bounds[0] else None,
		"lastWeek": str(bounds[1]) if bounds[1] else None,
		"limitedToRegion": allowed is not None,
		"limitedTo": words,
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
	from surveillance.alert_thresholds import active_diseases
	where.append("disease in %(active)s")   # weekly counts: only diseases ticked Active
	values["active"] = tuple(active_diseases()) or ("",)
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
	metric = {"count": "signals", "affected": "affected", "deaths": "deaths"}.get(a.metric or "affected", "affected")
	gcol, scol = COUNT_COLS[group], COUNT_COLS[split] if split else "''"
	rows = frappe.db.sql(f"""select {gcol} g, {scol} s, coalesce(sum({metric}),0) v from `tabWeekly Count`
		where {where} group by g, s""", values, as_dict=True)
	return _build_chart(rows, group, split, names, a)


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
	return _build_chart(rows, group, split, names, a)


# ---------- chart shaping ----------

def _time_keys(keys, group, a):
	"""Every week (Monday) or month between the first and last, so weeks with nothing reported show as 0 and a line
	never jumps over a gap. Uses the date filter when one is set."""
	if group == "week":
		have = [getdate(k) for k in keys if k]
		start = getdate(a.date_from) if a.date_from else (min(have) if have else None)
		end = getdate(a.date_to) if a.date_to else (max(have) if have else None)
		if not start or not end:
			return keys
		start = add_days(start, -start.weekday())
		out, d = [], start
		while d <= end and len(out) < 260:
			out.append(d)
			d = add_days(d, 7)
		return out
	have = sorted(str(k) for k in keys if k)
	start = str(a.date_from)[:7] if a.date_from else (have[0] if have else None)
	end = str(a.date_to)[:7] if a.date_to else (have[-1] if have else None)
	if not start or not end:
		return keys
	out, (y, m) = [], (int(start[:4]), int(start[5:7]))
	while f"{y:04d}-{m:02d}" <= end and len(out) < 120:
		out.append(f"{y:04d}-{m:02d}")
		y, m = (y + 1, 1) if m == 12 else (y, m + 1)
	return out


def _fill(a, col):
	"""What a chart always lists, at 0 when nothing was reported (KRCS 26 Nov 2026): every sub-county (or county) the
	user can see within the filters, so a CHA sees their sub-county and a County MOH all the sub-counties of their
	region; and every data source chosen. None for the other groupings (only what was reported is listed)."""
	if col in ("sub_county", "county"):
		allowed = _allowed_sub_counties(cint(a.pilot_only) if a.pilot_only is not None else 1)
		want = {x.lower() for x in _list(a.sub_counties)}
		subs = [x for x in frappe.get_all("Sub County", filters={"is_active": 1}, fields=["sub_county_name", "county"])
			if x.sub_county_name and (allowed is None or x.sub_county_name.strip().lower() in allowed)
			and (not want or x.sub_county_name.strip().lower() in want) and (not a.county or x.county == a.county)]
		return sorted({(x.sub_county_name.strip() if col == "sub_county" else x.county) for x in subs
			if col == "sub_county" or x.county})
	if col == "source":
		return [x for x in (_list(a.sources) or list(SOURCES)) if x in SOURCES]
	return None


def _build_chart(rows, group, split, names, a=None):
	a = a or frappe._dict()
	time = group in ("week", "month")
	gfill = _fill(a, group)
	sfill = _fill(a, split) if split else None
	gcanon = {str(k).lower(): k for k in gfill or []}
	scanon = {str(k).lower(): k for k in sfill or []}

	def norm(k):
		if group == "week":
			return getdate(k) if k else None
		return gcanon.get(str(k).lower(), str(k)) if k is not None else None

	totals = {k: 0 for k in gfill or []}
	for r in rows:
		r.g = norm(r.g)
		if split and r.s is not None:
			r.s = scanon.get(str(r.s).lower(), r.s)
		totals[r.g] = totals.get(r.g, 0) + float(r.v or 0)
	if time:
		keys = _time_keys(list(totals), group, a)
		truncated = False
	elif group == "source" and gfill:   # sources in their usual order
		keys = [k for k in gfill] + [k for k in totals if k not in gfill]
		truncated = False
	else:
		keys = sorted(totals, key=lambda k: (-totals[k], str(k)))
		truncated = len(keys) > 30
		keys = keys[:30]   # biggest first, at most 30 bars
	series_keys, other = [""], False
	if split:
		stot = {k: 0 for k in sfill or []}
		for r in rows:
			stot[r.s] = stot.get(r.s, 0) + float(r.v or 0)
		ordered = list(sfill) + [k for k in sorted(stot, key=lambda k: -stot[k]) if k not in sfill] if split == "source" and sfill \
			else sorted(stot, key=lambda k: (-stot[k], str(k)))
		series_keys, other = ordered[:MAX_SERIES], len(ordered) > MAX_SERIES
	data = {}
	for r in rows:
		s_key = (r.s if r.s in series_keys else "__other") if split else ""
		data[(r.g, s_key)] = data.get((r.g, s_key), 0) + float(r.v or 0)
	series = [{"name": _bucket_label(split, s, names) if split else "Total", "data": [int(data.get((k, s), 0)) for k in keys]}
		for s in series_keys]
	if other:   # the rest added up, so the stacks still match the totals
		series.append({"name": "Other", "data": [int(data.get((k, "__other"), 0)) for k in keys]})
	return {
		"groupBy": group, "splitBy": split,
		"labels": [_bucket_label(group, str(k) if k is not None else None, names) for k in keys],
		"series": series,
		"totals": [int(totals.get(k, 0)) for k in keys],
		"truncated": truncated,
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


def _active():
	from surveillance.alert_thresholds import active_diseases
	return active_diseases()
