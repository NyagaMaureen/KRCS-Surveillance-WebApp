"""Contextual reference data: weather, population and WASH per sub-county.

Context only: shown to officers next to events, Epi Trends alerts and on the Dashboard.
It is never used by the outbreak engine or any AI model (TOR scope, AI/ML Design Specifications).

  Weather Snapshot            daily rainfall/temperature, imported from Open-Meteo (free, no key).
                              Only sub-county coordinates are sent; none of our data leaves the system.
  Population Bulletin Import  published figures (UNHCR ODP, IOM DTM, KNBS), entered by staff
  Camp WASH Assessment        dated officer assessments; never overwritten, latest is shown

Scheduler (hooks.py, daily): surveillance.context.import_weather
One-off history for the "usual rainfall" comparison:
    bench --site <site> execute surveillance.context.backfill_weather --kwargs "{'years': 5}"
"""
import hashlib

import frappe
import requests
from frappe import _
from frappe.utils import add_days, date_diff, flt, get_fullname, getdate, now, nowdate

from surveillance.capabilities import has_capability, require_capability

MANAGE = "manage_context_data"
WEATHER = "Weather Snapshot"
POPULATION = "Population Bulletin Import"
WASH = "Camp WASH Assessment"
SUB_COUNTY = "Sub County"

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
DAILY = "precipitation_sum,temperature_2m_mean,temperature_2m_max,temperature_2m_min"
TIMEOUT = 30

RAIN_WINDOW_DAYS = 28        # compare the last 4 weeks of rain with the same 4 weeks in earlier years
WASH_STALE_DAYS = 180
POPULATION_STALE_DAYS = 365

# How each WASH answer reads: good / fair / poor (drives the colour of the chip)
WASH_FIELDS = [
	("water_source_type", "Water source", {"Piped on premises": "good", "Protected borehole or well": "good",
		"Trucked": "fair", "Unprotected surface water": "poor"}),
	("water_availability", "Water availability", {"Consistent": "good", "Intermittent": "fair",
		"Distant collection required": "poor"}),
	("sanitation_facility_type", "Sanitation", {"Flush toilet": "good", "VIP latrine": "good",
		"Basic pit latrine": "fair", "Open defecation": "poor"}),
	("waste_management", "Waste management", {"Properly treated": "good", "Partial containment": "fair",
		"Overflowing or untreated": "poor"}),
	("handwashing_access", "Handwashing", {"Station with soap & water": "good", "Water only": "fair",
		"None available": "poor"}),
]


def _can_view():
	return any(has_capability(c) for c in ("view_review_queue", "view_alerts", "view_reports", MANAGE))


def _require_view():
	if not _can_view():
		frappe.throw(_("You do not have permission to view context data."), frappe.PermissionError)


# ---------- weather import ----------

def _store_weather(sub_county, daily):
	"""Replace this sub-county's rows for the dates in `daily` (Open-Meteo daily block)."""
	dates = daily.get("time") or []
	if not dates:
		return 0
	rain, mean = daily.get("precipitation_sum") or [], daily.get("temperature_2m_mean") or []
	tmax, tmin = daily.get("temperature_2m_max") or [], daily.get("temperature_2m_min") or []
	ts, user = now(), frappe.session.user
	values = []
	for i, d in enumerate(dates):
		if i >= len(rain) or rain[i] is None:
			continue  # not available yet (archive lags a few days)
		values.append((hashlib.sha1(f"{sub_county}|{d}".encode()).hexdigest()[:20], ts, ts, user, user, 0,
			sub_county, d, flt(rain[i], 2), flt(mean[i], 1) if i < len(mean) and mean[i] is not None else None,
			flt(tmax[i], 1) if i < len(tmax) and tmax[i] is not None else None,
			flt(tmin[i], 1) if i < len(tmin) and tmin[i] is not None else None, "Open-Meteo", ts))
	if not values:
		return 0
	frappe.db.delete(WEATHER, {"sub_county": sub_county, "date": ["in", [v[7] for v in values]]})
	frappe.db.bulk_insert(WEATHER, ["name", "creation", "modified", "owner", "modified_by", "docstatus",
		"sub_county", "date", "rainfall_mm", "temperature_c", "temperature_max_c", "temperature_min_c", "source",
		"import_timestamp"], values, chunk_size=2000)
	return len(values)


def _located_sub_counties():
	return frappe.get_all(SUB_COUNTY, filters={"is_active": 1, "latitude": ["is", "set"], "longitude": ["is", "set"]},
		fields=["name", "sub_county_name", "latitude", "longitude"])


def import_weather(past_days=14):
	"""Daily job: refresh the last `past_days` days for every active sub-county with coordinates."""
	saved, failed = 0, []
	for sc in _located_sub_counties():
		try:
			r = requests.get(FORECAST_URL, params={"latitude": sc.latitude, "longitude": sc.longitude, "daily": DAILY,
				"past_days": int(past_days), "forecast_days": 1, "timezone": "Africa/Nairobi"}, timeout=TIMEOUT)
			r.raise_for_status()
			saved += _store_weather(sc.name, r.json().get("daily") or {})
		except Exception:
			failed.append(sc.sub_county_name)
			frappe.log_error(title=f"Weather import failed: {sc.sub_county_name}", message=frappe.get_traceback())
	frappe.db.commit()
	print(f"Weather rows saved: {saved}" + (f" | failed: {', '.join(failed)}" if failed else ""))
	return {"saved": saved, "failed": failed}


def backfill_weather(years=5):
	"""One-off: daily history for the 'usual rainfall' comparison. Safe to re-run."""
	start = add_days(getdate(nowdate()), -365 * int(years))
	end = add_days(getdate(nowdate()), -1)
	saved = 0
	for sc in _located_sub_counties():
		r = requests.get(ARCHIVE_URL, params={"latitude": sc.latitude, "longitude": sc.longitude, "daily": DAILY,
			"start_date": str(start), "end_date": str(end), "timezone": "Africa/Nairobi"}, timeout=120)
		r.raise_for_status()
		n = _store_weather(sc.name, r.json().get("daily") or {})
		frappe.db.commit()
		print(f"  {sc.sub_county_name}: {n} days")
		saved += n
	print(f"Weather history saved: {saved} days from {start} to {end}")
	return saved


@frappe.whitelist(methods=["POST"])
def refresh_weather():
	require_capability(MANAGE)
	return import_weather()


# ---------- context for one sub-county ----------

def resolve_sub_county(sub_county=None, county=None):
	"""Sub County record id from either its id or its name (+ county). Events and alerts store names."""
	if not sub_county:
		return None
	if frappe.db.exists(SUB_COUNTY, sub_county):
		return sub_county
	filters = {"sub_county_name": sub_county}
	if county:
		filters["county"] = county
	return frappe.db.get_value(SUB_COUNTY, filters, "name")


def _rain_context(sc, today):
	end = add_days(today, -1)
	start = add_days(end, -(RAIN_WINDOW_DAYS - 1))
	recent = frappe.db.sql(f"""select count(*) n, sum(rainfall_mm) rain, avg(temperature_c) temp,
		max(temperature_max_c) tmax, max(date) last from `tab{WEATHER}` where sub_county=%s and date between %s and %s""",
		(sc, start, end), as_dict=True)[0]
	if not recent.n:
		return None
	usual = []
	for y in range(1, 6):
		s, e = add_days(start, -365 * y), add_days(end, -365 * y)
		row = frappe.db.sql(f"""select count(*) n, sum(rainfall_mm) rain from `tab{WEATHER}`
			where sub_county=%s and date between %s and %s""", (sc, s, e), as_dict=True)[0]
		if row.n >= RAIN_WINDOW_DAYS * 0.8:
			usual.append(flt(row.rain))
	week = frappe.db.sql(f"""select sum(rainfall_mm) rain, avg(temperature_c) temp from `tab{WEATHER}`
		where sub_county=%s and date between %s and %s""", (sc, add_days(end, -6), end), as_dict=True)[0]
	rain = flt(recent.rain, 1)
	avg_usual = round(sum(usual) / len(usual), 1) if usual else None
	pct = round((rain - avg_usual) * 100 / avg_usual) if avg_usual else None
	level = None
	if avg_usual is not None:
		level = "above" if pct is not None and pct >= 25 else "below" if pct is not None and pct <= -25 else "usual"
		if avg_usual < 5 and rain < 5:
			level, pct = "dry", None   # both tiny: a % would be noise
	ratio = round(rain / avg_usual, 1) if avg_usual else None
	return {"windowDays": RAIN_WINDOW_DAYS, "from": str(start), "to": str(end), "rainfallMm": rain,
		"usualMm": avg_usual, "yearsCompared": len(usual), "changePct": pct, "ratio": ratio, "level": level,
		"last7RainMm": flt(week.rain, 1), "last7TempC": flt(week.temp, 1) if week.temp is not None else None,
		"maxTempC": flt(recent.tmax, 1) if recent.tmax is not None else None, "lastDate": str(recent.last)}


def _population_context(sc, today, people=None):
	row = frappe.get_all(POPULATION, filters={"sub_county": sc}, fields=["population_count", "reporting_period", "source",
		"bulletin_reference", "site_name"], order_by="reporting_period desc, creation desc", limit=1)
	if not row:
		return None
	p = row[0]
	out = {"population": p.population_count, "asOf": str(p.reporting_period), "source": p.source,
		"reference": p.bulletin_reference, "site": p.site_name,
		"stale": date_diff(today, p.reporting_period) > POPULATION_STALE_DAYS}
	if people is not None and p.population_count:
		out["per10k"] = round(int(people) * 10000 / p.population_count, 2)
	return out


def _wash_context(sc, today):
	row = frappe.get_all(WASH, filters={"sub_county": sc}, fields=["*"], order_by="assessment_date desc, creation desc", limit=1)
	if not row:
		return None
	w = row[0]
	items = [{"key": k, "label": label, "value": w.get(k), "rating": ratings.get(w.get(k))}
		for k, label, ratings in WASH_FIELDS if w.get(k)]
	age = date_diff(today, w.assessment_date)
	return {"id": w.name, "date": str(w.assessment_date), "ageDays": age, "stale": age > WASH_STALE_DAYS,
		"by": get_fullname(w.assessed_by) if w.assessed_by else None, "site": w.site_name, "items": items,
		"poor": sum(1 for i in items if i["rating"] == "poor"), "notes": w.narrative_notes or ""}


# Which context is relevant to which disease (fixed rules, not AI). Population is shown for every disease.
# Keys are Alert Threshold Config names. Change these lists if KRCS wants different links.
RAIN_DISEASES = {"malaria", "awd-cholera", "rift-valley-fever", "dengue", "yellow-fever"}
WASH_DISEASES = {"awd-cholera", "dysentery", "typhoid", "acute-jaundice", "unclassified-illness"}
RAIN_WHY = {"malaria": "more breeding sites for mosquitoes, usually 2-6 weeks before cases rise",
	"awd-cholera": "flooding can contaminate water sources and latrines",
	"rift-valley-fever": "heavy rain is the classic trigger for mosquito-borne spread",
	"dengue": "standing water increases mosquito breeding",
	"yellow-fever": "standing water increases mosquito breeding"}


def _ratio_text(w):
	if w.get("ratio") is None or w.get("level") == "dry":
		return None
	if w["ratio"] >= 2:
		return f"{w['ratio']:g}× usual"
	if w["ratio"] <= 0.5:
		return f"{w['ratio']:g}× usual (much drier)"
	return f"{w['changePct']:+d}% vs usual" if w.get("changePct") is not None else None


def _supports(ctx, disease):
	"""Short, rule-based lines saying how the context relates to this disease. Never changes severity."""
	out = []
	w, wash, pop = ctx.get("weather"), ctx.get("wash"), ctx.get("population")
	if disease in RAIN_DISEASES and w and w.get("level") == "above":
		out.append({"kind": "weather", "text": f"Rainfall {_ratio_text(w)} in the last 4 weeks ({w['rainfallMm']} mm vs usual {w['usualMm']} mm)",
			"why": RAIN_WHY.get(disease, "")})
	if disease in WASH_DISEASES and wash and wash.get("poor"):
		poor = [i["value"].lower() for i in wash["items"] if i["rating"] == "poor"]
		age = f", {round(wash['ageDays'] / 30)} months old" if wash.get("stale") else ""
		out.append({"kind": "wash", "text": f"Latest WASH assessment ({wash['date']}{age}): " + ", ".join(poor),
			"why": "poor water and sanitation help diarrhoeal and water-borne diseases spread"})
	if pop and pop.get("per10k") is not None:
		out.append({"kind": "population", "text": f"{pop['per10k']:g} affected per 10,000 people (population {pop['population']:,}, {pop['source']})",
			"why": "puts the number of cases in proportion to the population"})
	return out


def _context(sc, people=None, disease=None):
	today = getdate(nowdate())
	info = frappe.db.get_value(SUB_COUNTY, sc, ["sub_county_name", "county"], as_dict=True) or {}
	ctx = {"subCounty": sc, "subCountyName": info.get("sub_county_name"), "county": info.get("county"),
		"weather": _rain_context(sc, today), "population": _population_context(sc, today, people),
		"wash": _wash_context(sc, today)}
	if disease:
		ctx["disease"] = disease
		ctx["show"] = {"weather": disease in RAIN_DISEASES, "wash": disease in WASH_DISEASES, "population": True}
		ctx["supports"] = _supports(ctx, disease)
		ctx["rainWhy"] = RAIN_WHY.get(disease)
	else:
		ctx["show"] = {"weather": True, "wash": True, "population": True}
		ctx["supports"] = []
	if ctx["weather"]:
		ctx["weather"]["ratioText"] = _ratio_text(ctx["weather"])
	return ctx


@frappe.whitelist()
def get_context(sub_county=None, county=None, people=None, disease=None):
	"""Context for one place. sub_county may be the record id or its name (then pass county too).
	disease (Alert Threshold Config key) limits the context to what's relevant and adds the 'supports' lines."""
	_require_view()
	sc = resolve_sub_county(sub_county, county)
	if not sc:
		return {"subCounty": None, "subCountyName": sub_county, "county": county, "weather": None, "population": None,
			"wash": None, "unknownLocation": True, "show": {}, "supports": []}
	return _context(sc, people, disease)


@frappe.whitelist()
def get_area_context():
	"""Context for every pilot sub-county in the user's area (Dashboard)."""
	_require_view()
	from surveillance.events import _scope, _user_region
	subs, _ = _scope()
	region = _user_region()
	filters = {"is_active": 1}
	if region:
		filters["region"] = region
	rows = [s for s in frappe.get_all(SUB_COUNTY, filters=filters, fields=["name", "sub_county_name"], order_by="county, sub_county_name")
		if (s.sub_county_name or "").strip().lower() in subs]
	return [_context(s.name) for s in rows]


# ---------- Context Data page ----------

@frappe.whitelist()
def get_weather(sub_county, days=90):
	_require_view()
	sc = resolve_sub_county(sub_county)
	start = add_days(getdate(nowdate()), -int(days))
	return frappe.get_all(WEATHER, filters={"sub_county": sc, "date": [">=", start]},
		fields=["date", "rainfall_mm", "temperature_c", "temperature_max_c", "temperature_min_c"], order_by="date asc",
		limit_page_length=0)


@frappe.whitelist()
def get_weather_status():
	_require_view()
	return [{"subCounty": s.name, "subCountyName": s.sub_county_name, "county": s.county,
		"hasCoordinates": bool(s.latitude and s.longitude),
		"lastDate": str(frappe.db.get_value(WEATHER, {"sub_county": s.name}, "max(date)") or ""),
		"days": frappe.db.count(WEATHER, {"sub_county": s.name}),
		"lastImport": str(frappe.db.get_value(WEATHER, {"sub_county": s.name}, "max(import_timestamp)") or "")}
		for s in frappe.get_all(SUB_COUNTY, filters={"is_active": 1}, fields=["name", "sub_county_name", "county", "latitude", "longitude"],
			order_by="county, sub_county_name")]


def _list(doctype, sub_county=None, limit=200):
	filters = {"sub_county": resolve_sub_county(sub_county)} if sub_county else {}
	date_field = "assessment_date" if doctype == WASH else "reporting_period"
	return frappe.get_all(doctype, filters=filters, fields=["*"], order_by=f"{date_field} desc, creation desc",
		limit_page_length=min(int(limit), 500))


@frappe.whitelist()
def get_wash_assessments(sub_county=None, limit=200):
	_require_view()
	out = []
	for w in _list(WASH, sub_county, limit):
		d = {k: w.get(k) for k in ("name", "sub_county", "sub_county_name", "county", "site_name", "assessment_date",
			"narrative_notes") + tuple(f for f, _, _ in WASH_FIELDS)}
		d["assessment_date"] = str(w.assessment_date)
		d["assessed_by"] = get_fullname(w.assessed_by) if w.assessed_by else None
		d["ratings"] = {f: r.get(w.get(f)) for f, _, r in WASH_FIELDS}
		out.append(d)
	return out


@frappe.whitelist(methods=["POST"])
def save_wash_assessment(sub_county, assessment_date, water_source_type=None, water_availability=None,
		sanitation_facility_type=None, waste_management=None, handwashing_access=None, site_name=None, narrative_notes=None):
	"""Always creates a new dated record; earlier assessments are kept as history."""
	require_capability(MANAGE)
	if getdate(assessment_date) > getdate(nowdate()):
		frappe.throw(_("The assessment date can't be in the future."))
	doc = frappe.get_doc({"doctype": WASH, "sub_county": sub_county, "assessment_date": assessment_date,
		"assessed_by": frappe.session.user, "site_name": (site_name or "").strip() or None,
		"water_source_type": water_source_type or None, "water_availability": water_availability or None,
		"sanitation_facility_type": sanitation_facility_type or None, "waste_management": waste_management or None,
		"handwashing_access": handwashing_access or None, "narrative_notes": (narrative_notes or "").strip() or None})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"name": doc.name}


@frappe.whitelist()
def get_population_figures(sub_county=None, limit=200):
	_require_view()
	return [{"name": p.name, "sub_county": p.sub_county, "sub_county_name": frappe.db.get_value(SUB_COUNTY, p.sub_county, "sub_county_name"),
		"site_name": p.site_name, "reporting_period": str(p.reporting_period), "population_count": p.population_count,
		"source": p.source, "bulletin_reference": p.bulletin_reference, "import_date": str(p.import_date or ""),
		"entered_by": get_fullname(p.entered_by) if p.entered_by else None} for p in _list(POPULATION, sub_county, limit)]


@frappe.whitelist(methods=["POST"])
def save_population_figure(sub_county, reporting_period, population_count, source, bulletin_reference=None, site_name=None):
	require_capability(MANAGE)
	count = int(population_count or 0)
	if count <= 0:
		frappe.throw(_("Population must be a positive number."))
	doc = frappe.get_doc({"doctype": POPULATION, "sub_county": sub_county, "reporting_period": reporting_period,
		"population_count": count, "source": source, "bulletin_reference": (bulletin_reference or "").strip() or None,
		"site_name": (site_name or "").strip() or None, "import_date": nowdate(), "entered_by": frappe.session.user})
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def delete_context_record(doctype, name):
	"""For mistakes only (wrong sub-county, typo). Corrections should normally be a new record."""
	require_capability(MANAGE)
	if doctype not in (WASH, POPULATION):
		frappe.throw(_("Only WASH assessments and population figures can be deleted here."))
	frappe.delete_doc(doctype, name, ignore_permissions=True)
	frappe.db.commit()
	return {"deleted": name}


@frappe.whitelist()
def get_options():
	"""Dropdown values for the forms, straight from the DocTypes so they stay in one place."""
	_require_view()
	meta = frappe.get_meta(WASH)
	return {"wash": {f: [o for o in (meta.get_field(f).options or "").split("\n") if o] for f, _, _ in WASH_FIELDS},
		"washLabels": {f: label for f, label, _ in WASH_FIELDS},
		"populationSources": [o for o in (frappe.get_meta(POPULATION).get_field("source").options or "").split("\n") if o],
		"canManage": has_capability(MANAGE)}
