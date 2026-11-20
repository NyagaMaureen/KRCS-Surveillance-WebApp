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
	return any(has_capability(c) for c in ("view_review_queue", "view_alerts", "view_reports", "view_context_data", MANAGE))


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
		people = int(people)
		out["per10k"] = round(people * 10000 / p.population_count, 2)
		if people > 0:
			one_in = p.population_count / people
			nice = round(one_in, -3) if one_in >= 10000 else round(one_in, -2) if one_in >= 1000 else round(one_in)
			out["proportionText"] = (f"{people:,} {'person' if people == 1 else 'people'} affected out of about "
				f"{p.population_count:,} (about 1 in {int(nice):,})")
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


# ---------- What the context means, per disease (fixed rules, not AI) ----------
# Keys are Alert Threshold Config names. Each rule says why the factor matters for the disease and what to check next.
# Edit these lists if KRCS wants different links. Population is shown for every disease.
# Context is background only: it never changes the risk score, severity or the alert engine.

_FLOOD_WATER = ("Heavy rain and flooding can wash sewage into water points and latrines.",
	"Check latrines and water points near the cases for flooding or overflow.")
_SHORT_WATER = ("When water is short, people use unsafe sources and wash their hands less.",
	"Find out where the cases collect water and whether there is enough for drinking and handwashing.")
_DIRTY_WATER = "Check the cases' water source and handwashing at home, and ask the WASH team to test chlorine there."

# Rain above usual
RAIN_WET = {
	"malaria": ("More rain means more places for mosquitoes to breed; malaria cases usually rise 2 to 6 weeks later.",
		"Expect more cases in the coming weeks: check malaria test (RDT) and drug stock at nearby facilities, and bed net use where the cases live."),
	"rift-valley-fever": ("Heavy rain floods low ground where the mosquitoes that carry Rift Valley fever breed; animals are usually affected first.",
		"Ask about sick livestock and animal abortions near the cases, and inform the veterinary team."),
	"dengue": ("Standing water in containers lets the mosquitoes that carry dengue breed.",
		"Look for water containers, tyres and other standing water around the cases' homes."),
	"yellow-fever": ("Standing water lets the mosquitoes that carry yellow fever breed.",
		"Look for standing water around the cases' homes and check their yellow fever vaccination status."),
	"awd-cholera": _FLOOD_WATER,
	"typhoid": _FLOOD_WATER,
	"dysentery": _FLOOD_WATER,
}
# Rain below usual (and, for meningitis, the usual dry season too)
RAIN_DRY = {
	"awd-cholera": _SHORT_WATER,
	"typhoid": _SHORT_WATER,
	"dysentery": _SHORT_WATER,
	"acute-malnutrition": ("Below-usual rain can cut food and milk supplies.",
		"Share with the nutrition team and check when MUAC screening was last done in the area."),
	"meningococcal-meningitis": ("Meningitis outbreaks are more common in the hot, dry, dusty season.",
		"Watch closely for more cases and check the cases' meningitis vaccination status."),
}
DRY_SEASON_COUNTS = {"meningococcal-meningitis"}
# Poor water and sanitation: (why, next step, which WASH fields count; None = all five)
WASH_RULES = {
	"awd-cholera": ("Unsafe water and poor sanitation are how cholera spreads.",
		"Find out if the cases share a water source and ask the WASH team to test chlorine there.", None),
	"dysentery": ("Dysentery spreads through dirty water, food and hands.", _DIRTY_WATER, None),
	"typhoid": ("Typhoid spreads through dirty water and food.", _DIRTY_WATER, None),
	"acute-jaundice": ("Hepatitis A and E, the usual causes of jaundice in camps, spread through dirty water and poor sanitation.",
		_DIRTY_WATER, None),
	"afp-polio": ("Poliovirus spreads through faeces where sanitation and handwashing are poor.",
		"Check polio vaccination coverage in the area and handwashing and latrine use where the cases live.", None),
	"acute-malnutrition": ("Diarrhoea from unsafe water makes malnutrition worse.",
		"Share with the nutrition and WASH teams.", None),
	"guinea-worm": ("Guinea worm spreads through drinking unfiltered water from ponds and other surface water.",
		"Find the water the cases drink and make sure it is filtered.", ["water_source_type"]),
}
CROWDING = {"measles": "Measles spreads very fast where many people live close together.",
	"meningococcal-meningitis": "Meningitis spreads more easily where many people live close together.",
	"covid-sari": "Respiratory infections spread more easily where many people live close together.",
	"mpox": "Mpox spreads through close contact, which is common in crowded shelters."}
SHORT_NAMES = {"awd-cholera": "cholera", "guinea-worm": "guinea worm", "covid-sari": "COVID-19 / SARI", "afp-polio": "AFP / polio",
	"meningococcal-meningitis": "meningitis", "rift-valley-fever": "Rift Valley fever", "acute-jaundice": "acute jaundice",
	"vhf": "viral haemorrhagic fever", "mdr-tb": "MDR/XDR TB"}
WEATHER_STALE_DAYS = 3
# kept for anything else that imports them
RAIN_DISEASES = set(RAIN_WET) | set(RAIN_DRY)
WASH_DISEASES = set(WASH_RULES)


def _disease_names(disease):
	full = frappe.db.get_value("Alert Threshold Config", disease, "disease_name") or disease
	short = SHORT_NAMES.get(disease)
	if not short:
		short = full[len("Suspected "):] if full.lower().startswith("suspected ") else full
		short = " ".join(w if w.isupper() or w in ("Rift", "Valley", "Guinea", "Ebola", "Marburg", "Lassa") else w.lower()
			for w in short.split(" (")[0].split())
	return full, short


def _ratio_text(w):
	if w.get("ratio") is None or w.get("level") == "dry":
		return None
	if w["ratio"] >= 2:
		return f"{w['ratio']:g}× usual"
	if w["ratio"] <= 0.5:
		return f"{w['ratio']:g}× usual, much drier"
	return f"{w['changePct']:+d}% vs usual" if w.get("changePct") is not None else None


def _rain_headline(w):
	if w.get("level") == "dry":
		return "Dry, as usual for this time of year"
	if w.get("usualMm") is None:
		return f"{w['rainfallMm']:g} mm"
	if w.get("level") == "above":
		return w.get("ratioText") or f"{w['changePct']}% above usual"
	if w.get("level") == "below":
		return w.get("ratioText") or f"{abs(w['changePct'])}% below usual"
	return "About usual"


def _rain_detail(w):
	if w.get("usualMm") is None:
		return "Rain in the last 4 weeks. There are no earlier years to compare with yet."
	return (f"{w['rainfallMm']:g} mm in the last 4 weeks, usual {w['usualMm']:g} mm "
		f"({w['yearsCompared']} earlier year{'' if w['yearsCompared'] == 1 else 's'}). {w['last7RainMm']:g} mm this week.")


def _fmt(d):
	return getdate(d).strftime("%-d %b %Y") if d else ""


def _rain_finding(ctx, disease, short):
	w = ctx.get("weather")
	row = {"key": "weather", "factor": "Rainfall"}
	if not w:
		return {**row, "mark": "check", "headline": "No rainfall data yet", "detail": "", "source": "",
			"means": f"Rainfall can't be checked for {short} until the daily weather import has data for this sub-county.",
			"next": "Ask the system administrator to check the weather import (Context Data, Weather tab)."}
	row.update({"headline": _rain_headline(w), "detail": _rain_detail(w) if w.get("level") != "dry" else
		f"{w['rainfallMm']:g} mm in the last 4 weeks, usual {w['usualMm']:g} mm.", "source": f"Open-Meteo, up to {_fmt(w['lastDate'])}"})
	old = date_diff(getdate(nowdate()), w["lastDate"]) > WEATHER_STALE_DAYS
	wet, dry = RAIN_WET.get(disease), RAIN_DRY.get(disease)
	level = w.get("level")
	if level == "above" and wet:
		row.update(mark="supports", supports=True, means=wet[0], next=wet[1])
	elif dry and (level == "below" or (level == "dry" and disease in DRY_SEASON_COUNTS)):
		row.update(mark="supports", supports=True, means=dry[0], next=dry[1])
	else:
		if level is None:
			means = "There are no earlier years to compare with yet, so it can't say whether rain is unusual."
		elif wet and dry:
			means = f"Rain is neither well above nor well below usual, so it does not point to {short} on its own."
		elif wet:
			means = f"Rain is not above usual, so it does not point to more {short} on its own."
		else:
			means = f"Rain is not below usual, so it does not point to more {short} on its own."
		row.update(mark="background", means=means, next="No action from rainfall.")
	if old:
		row["mark"] = "check"
		row["source"] += " · not updated recently"
		row["next"] = row["next"] + " Weather data has not been updated since " + _fmt(w["lastDate"]) + "."
	return row


def _wash_finding(ctx, disease, short):
	wash = ctx.get("wash")
	why, nxt, fields = WASH_RULES[disease]
	row = {"key": "wash", "factor": "Water and sanitation"}
	place = ctx.get("subCountyName") or "this sub-county"
	if not wash:
		return {**row, "mark": "check", "headline": "No assessment recorded", "detail": "", "source": "", "means": why,
			"next": f"Ask the WASH team to record an assessment for {place} in Context Data."}
	items = [i for i in wash["items"] if fields is None or i["key"] in fields]
	poor = [i for i in items if i["rating"] == "poor"]
	fair = [i for i in items if i["rating"] == "fair"]
	total = len(fields) if fields else len(WASH_FIELDS)
	src = f"WASH assessment {_fmt(wash['date'])}" + (f", {wash['site']}" if wash.get("site") else "") + (f", by {wash['by']}" if wash.get("by") else "")
	if wash.get("stale"):
		src += f" · {round(wash['ageDays'] / 30)} months old"
	lower = lambda xs: ", ".join(i["value"][:1].lower() + i["value"][1:] for i in xs)
	cap = lambda t: t[:1].upper() + t[1:]
	if poor:
		head = poor[0]["label"] + ": " + poor[0]["value"].lower() if total == 1 else f"{len(poor)} of {total} poor"
		detail = "" if total == 1 else cap(lower(poor)) + "."
		if fair:
			detail += f" Fair: {lower(fair)}."
		row.update(mark="supports", supports=True, headline=head, detail=detail.strip(), source=src, means=why, next=nxt)
	else:
		head = "Not poor" if total == 1 else "None poor"
		detail = f"Fair: {lower(fair)}." if fair else ""
		row.update(mark="background", headline=head, detail=detail, source=src,
			means=f"Water and sanitation were not poor at the last assessment, so they do not point to {short} on their own.",
			next="No action from this, unless conditions have changed since the assessment.")
	if wash.get("stale"):
		row["mark"] = "check"
		row["next"] = row["next"] + f" The assessment is {round(wash['ageDays'] / 30)} months old: ask for a new one."
	return row


def _population_finding(ctx, disease, short, people):
	p = ctx.get("population")
	row = {"key": "population", "factor": "Population"}
	means = CROWDING.get(disease, "Shows how big the event is compared with everyone living in the sub-county." if people
		else "Used to compare case numbers between sub-counties of different sizes.")
	if not p:
		return {**row, "mark": "check", "headline": "No population figure recorded", "detail": "", "source": "",
			"means": means, "next": "Add the latest UNHCR, IOM or KNBS figure in Context Data so rates can be worked out."}
	src = f"{p['source']}, as of {_fmt(p['asOf'])}" + (f", {p['site']}" if p.get("site") else "")
	if people:
		people = int(people)
		head = f"{people:,} {'person' if people == 1 else 'people'} affected"
		detail = f"That is {p['per10k']:g} per 10,000 of about {p['population']:,} people" + (f" ({p['proportionText'].split('(')[-1]}" if p.get("proportionText") else "") + "."
	else:
		head, detail = f"About {p['population']:,} people", ""
	row.update(mark="background", headline=head, detail=detail, source=src, means=means, next="No action from this.")
	if p.get("stale"):
		row.update(mark="check", source=src + " · over a year old",
			next="Ask for the latest population bulletin before relying on these rates.")
	return row


def findings(ctx, disease, people=None):
	"""Rows for the context table: factor, what the data shows, what it means for this disease, next step."""
	full, short = _disease_names(disease)
	rows = []
	if disease in RAIN_WET or disease in RAIN_DRY:
		rows.append(_rain_finding(ctx, disease, short))
	if disease in WASH_RULES:
		rows.append(_wash_finding(ctx, disease, short))
	rows.append(_population_finding(ctx, disease, short, people))
	hidden = [n for n, linked in (("rainfall", disease in RAIN_WET or disease in RAIN_DRY), ("water and sanitation", disease in WASH_RULES)) if not linked]
	plural = len(hidden) > 1 or hidden == ["water and sanitation"]
	note = (f"{' and '.join(hidden).capitalize()} {'are' if plural else 'is'} not linked to {short}, so "
		f"{'they are' if plural else 'it is'} not shown.") if hidden else ""
	return {"diseaseName": full, "diseaseShort": short, "rows": rows, "notShown": note}


def watch_list(ctx):
	"""Diseases these conditions are known to favour, grouped by reason (Context Data overview)."""
	label = lambda k: _disease_names(k)[1]
	out = []
	w, wash = ctx.get("weather"), ctx.get("wash")
	if w and w.get("level") == "above":
		out.append({"reason": "rain above usual", "diseases": [label(k) for k in RAIN_WET]})
	if w and w.get("level") == "below":
		out.append({"reason": "rain below usual", "diseases": [label(k) for k in RAIN_DRY]})
	elif w and w.get("level") == "dry":
		out.append({"reason": "dry season", "diseases": [label(k) for k in DRY_SEASON_COUNTS]})
	if wash:
		poor = {i["key"] for i in wash["items"] if i["rating"] == "poor"}
		ds = [label(k) for k, (_, _, f) in WASH_RULES.items() if poor and (f is None or poor & set(f))]
		if ds:
			out.append({"reason": "poor water and sanitation" + (" (old assessment)" if wash.get("stale") else ""), "diseases": ds})
	return out


def _context(sc, people=None, disease=None):
	today = getdate(nowdate())
	info = frappe.db.get_value(SUB_COUNTY, sc, ["sub_county_name", "county"], as_dict=True) or {}
	ctx = {"subCounty": sc, "subCountyName": info.get("sub_county_name"), "county": info.get("county"),
		"weather": _rain_context(sc, today), "population": _population_context(sc, today, people),
		"wash": _wash_context(sc, today)}
	if ctx["weather"]:
		ctx["weather"]["ratioText"] = _ratio_text(ctx["weather"])
		ctx["weather"]["headline"] = _rain_headline(ctx["weather"])
	if disease:
		ctx["disease"] = disease
		ctx.update(findings(ctx, disease, people))
	else:
		ctx["watch"] = watch_list(ctx)
	return ctx


@frappe.whitelist()
def get_context(sub_county=None, county=None, people=None, disease=None):
	"""Context for one place. sub_county may be the record id or its name (then pass county too).
	disease (Alert Threshold Config key) adds the rows: what the data shows, what it means for it, next step."""
	_require_view()
	sc = resolve_sub_county(sub_county, county)
	if not sc:
		return {"subCounty": None, "subCountyName": sub_county, "county": county, "weather": None, "population": None,
			"wash": None, "unknownLocation": True, "rows": []}
	return _context(sc, people, disease)


def _area_sub_counties(only=None):
	from surveillance.events import _scope, _user_region
	from surveillance.user_scope import in_area, locked_area
	subs, _ = _scope()
	region = _user_region()
	area = locked_area()
	filters = {"is_active": 1}
	if region:
		filters["region"] = region
	rows = frappe.get_all(SUB_COUNTY, filters=filters, fields=["name", "sub_county_name"], order_by="county, sub_county_name")
	out = []
	for s in rows:
		n = (s.sub_county_name or "").strip().lower()
		if n not in subs or not in_area(area, s.name):
			continue
		if only and only.strip().lower() not in (n, s.name.lower()):
			continue
		out.append(s)
	return out


@frappe.whitelist()
def get_area_context():
	"""Context for every pilot sub-county in the user's area (Context Data overview), with the diseases to watch."""
	_require_view()
	return [_context(s.name) for s in _area_sub_counties()]


@frappe.whitelist()
def get_disease_context(disease, sub_county=None):
	"""Epi Trends: what the context means for one disease, for each sub-county in the user's area (or one)."""
	_require_view()
	if not frappe.db.exists("Alert Threshold Config", disease):
		frappe.throw(_("Unknown disease."))
	full, short = _disease_names(disease)
	places = []
	for s in _area_sub_counties(sub_county):
		c = _context(s.name, None, disease)
		places.append({"subCounty": s.name, "subCountyName": c["subCountyName"], "rows": c["rows"]})
	f = findings({}, disease)
	why = []
	if disease in RAIN_WET:
		why.append({"factor": "Rain above usual", "text": RAIN_WET[disease][0]})
	if disease in RAIN_DRY:
		why.append({"factor": "Rain below usual" + (" or dry season" if disease in DRY_SEASON_COUNTS else ""), "text": RAIN_DRY[disease][0]})
	if disease in WASH_RULES:
		why.append({"factor": "Poor water and sanitation", "text": WASH_RULES[disease][0]})
	if disease in CROWDING:
		why.append({"factor": "Population", "text": CROWDING[disease]})
	return {"disease": disease, "diseaseName": full, "diseaseShort": short, "notShown": f["notShown"],
		"factors": [{"key": r["key"], "factor": r["factor"]} for r in f["rows"]], "why": why, "places": places}


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
