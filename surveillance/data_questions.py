"""Surveillance data questions: the "Surveillance data" tab of the KRCS Data Assistant (KRCS 26 Nov 2026).

A user asks, for example, "show me trends of cholera in my region in the last 4 weeks", and gets a table and a chart.

1. Understand. The question is turned into a fixed form: diseases, places, period, measure (cases, people affected,
   deaths), what to break it down by (week, month, sub-county, county, disease, source) and data sources.
   The AI model (Ollama, site config kb_llm_url / kb_llm_model, the same as the Knowledge Base) may read the
   question and the lists of disease and place NAMES to fill the form. It never sees any figure, report or record.
   When the model is off, slow or gives something that does not fit, simple word rules fill the form instead.
   Site config dq_use_model = 0 switches the model off for this tab.
2. Check. Every value must come from the allowed lists. The user's own area is always added (data_explorer._area:
   CHA, officer and FHW their sub-county, region users their region, national users everything), so asking about a
   place outside it returns nothing from that place.
3. Answer. The server runs its own SQL on Weekly Count (data_explorer), the same data as Data Explorer: field
   reports, CBS and MOH 505, counted per disease, sub-county and week.

Access: ask_surveillance_data (Roles & Permissions: KRCS Data Assistant -> Ask About Surveillance Data).
"""
import json
import re

import frappe
from frappe.utils import add_days, add_months, cint, get_first_day, getdate, nowdate

from surveillance import data_explorer as de
from surveillance.capabilities import has_capability, require_capability

CAPABILITY = "ask_surveillance_data"
BY = {"week": "Week", "month": "Month", "sub_county": "Sub-county", "county": "County", "disease": "Disease", "source": "Data source"}
MEASURES = {"affected": "People affected", "count": "Cases and reports", "deaths": "Deaths"}   # people affected first (KRCS 26 Nov 2026)
SOURCE_WORDS = [("CBS", r"\bcbs\b|community[- ]based|community volunteers?"),
	("IDSR", r"facilit|moh ?505|idsr|clinic|hospital|health cent"),
	("Case Report", r"field reports?|\bchps?\b|mobile app|whatsapp|web reports?")]
NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
	"eleven": 11, "twelve": 12, "a": 1, "an": 1}
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
	"december"]
# words for a disease that its name does not contain (English and Kiswahili)
EXTRA_WORDS = {"awd-cholera": ["kipindupindu", "watery diarrhoea", "watery diarrhea", "awd"], "measles": ["surua"],
	"covid-sari": ["covid", "corona", "sari"], "vhf": ["ebola", "marburg", "lassa", "cchf", "haemorrhagic", "hemorrhagic"],
	"afp-polio": ["polio", "afp"], "meningococcal-meningitis": ["meningitis"], "malaria": ["malaria"],
	"rabies": ["dog bite", "kichaa cha mbwa"], "mpox": ["monkeypox", "mpox"]}
PLACE_WORDS = {"kalobeyei": "Turkana West", "kakuma": "Turkana West"}   # settlements inside a sub-county
MODEL_DOWN = "krcs:dq_model_down"
DEFAULT_WEEKS = 12


# ---------- what may be asked about ----------

def _vocab():
	from surveillance.alert_thresholds import active_diseases
	active = set(active_diseases())
	diseases = {}
	for d in frappe.get_all("Alert Threshold Config", fields=["name", "disease_name", "synonyms"]):
		if d.name not in active:
			continue
		name = (d.disease_name or d.name).strip()
		plain = re.sub(r"^suspected\s+", "", name, flags=re.I)
		words = {plain.lower()}
		for part in re.split(r"[/()]", plain):
			part = part.strip().lower()
			if len(part) >= 3:
				words.add(part)
		words.update(w.strip().lower() for w in (d.synonyms or "").replace("\n", ",").split(",") if len(w.strip()) >= 3)
		words.update(EXTRA_WORDS.get(d.name, []))
		diseases[d.name] = {"name": plain, "words": sorted(words, key=len, reverse=True)}
	subs = frappe.get_all("Sub County", filters={"is_active": 1}, fields=["sub_county_name", "county"])
	return diseases, sorted({s.sub_county_name for s in subs if s.sub_county_name}), sorted({s.county for s in subs if s.county})


# ---------- 1a. word rules ----------

def _rules(q, diseases, places, counties):
	t = " " + re.sub(r"\s+", " ", (q or "").lower()) + " "
	form = {}
	hits = [k for k, d in diseases.items() if any(re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", t) for w in d["words"])]
	if not hits:   # spelling slips such as "measels" or "cholra", when the AI model is not there to read them
		import difflib
		single = {w: k for k, d in diseases.items() for w in d["words"] if " " not in w and len(w) >= 5}
		for word in set(re.findall(r"[a-z]{5,}", t)):
			close = difflib.get_close_matches(word, list(single), n=1, cutoff=0.8)
			if close and single[close[0]] not in hits:
				hits.append(single[close[0]])
	if hits:
		form["diseases"] = hits
	got = [p for p in places if re.search(rf"(?<![a-z]){re.escape(p.lower())}(?![a-z])", t)]
	got += [p for w, p in PLACE_WORDS.items() if w in t and p in places and p not in got]
	if got:
		form["places"] = got
	cty = [c for c in counties if re.search(rf"(?<![a-z]){re.escape(c.lower())}(?![a-z])", t) and c not in got]
	if cty and not got:
		form["counties"] = cty[:1]
	form.update(_rule_period(t))
	if re.search(r"death|died|dead|deceased|vifo", t):
		form["measure"] = "deaths"
	elif re.search(r"people affected|affected|how many people|persons", t):
		form["measure"] = "affected"
	for by, pat in (("month", r"monthly|per month|by month|each month|month by month"),
			("week", r"trend|over time|weekly|per week|by week|each week|week by week|over the (?:last|past)"),
			("sub_county", r"by sub[- ]?count|per sub[- ]?count|which sub[- ]?count|by place|by location|where\b"),
			("county", r"by county|per county|which county"),
			("source", r"by source|per source|which source|by channel"),
			("disease", r"by disease|per disease|which disease|what disease|top disease|most common|diseases\b")):
		if re.search(pat, t):
			form["by"] = by
			break
	srcs = [s for s, pat in SOURCE_WORDS if re.search(pat, t)]
	if srcs:
		form["sources"] = srcs
	return form


def _rule_period(t):
	today = getdate(nowdate())
	m = re.search(r"(?:last|past|previous)\s+(\d+|[a-z]+)\s+(day|week|month|year)s?", t)
	if m:
		n = cint(m.group(1)) if m.group(1).isdigit() else NUMBERS.get(m.group(1), 0)
		if n:
			return {"period": {"last": n, "unit": m.group(2)}}
	m = re.search(r"\b(siku|wiki|mwezi|miezi|mwaka|miaka)\s+(\d+|[a-z]+)", t)   # Kiswahili: wiki 6 zilizopita
	if m:
		sw = {"moja": 1, "mbili": 2, "tatu": 3, "nne": 4, "tano": 5, "sita": 6, "saba": 7, "nane": 8, "tisa": 9, "kumi": 10}
		n = cint(m.group(2)) if m.group(2).isdigit() else sw.get(m.group(2), 0)
		unit = {"siku": "day", "wiki": "week", "mwezi": "month", "miezi": "month", "mwaka": "year", "miaka": "year"}[m.group(1)]
		if n:
			return {"period": {"last": n, "unit": unit}}
	m = re.search(r"(?:last|past|previous)\s+(day|week|month|year)\b", t)
	if m:
		return {"period": {"last": 1, "unit": m.group(1)}}
	if "this week" in t:
		return {"period": {"from": str(add_days(today, -today.weekday())), "to": str(today)}}
	if "this month" in t:
		return {"period": {"from": str(get_first_day(today)), "to": str(today)}}
	if "this year" in t:
		return {"period": {"from": f"{today.year}-01-01", "to": str(today)}}
	for i, name in enumerate(MONTHS, 1):
		m = re.search(rf"\b(?:in|during|for)\s+{name}(?:\s+(\d{{4}}))?", t)
		if m:
			year = cint(m.group(1)) or (today.year if i <= today.month else today.year - 1)
			first = getdate(f"{year}-{i:02d}-01")
			return {"period": {"from": str(first), "to": str(add_days(add_months(first, 1), -1))}}
	return {}


# ---------- 1b. the AI model, question only ----------

def _model(q, diseases, places, counties):
	"""The form from the AI model, or None. Only the question and the lists of names are sent."""
	if not cint(frappe.conf.get("dq_use_model", 1)) or frappe.cache().get_value(MODEL_DOWN):
		return None
	import requests
	from surveillance.knowledge_base import DEFAULT_LLM, _conf, _strip_think
	system = (
		"You turn one question about disease surveillance figures into JSON. Reply with JSON only.\n"
		"Fields (leave a field out when the question does not say it):\n"
		f"  diseases: list of keys from {json.dumps({k: v['name'] for k, v in diseases.items()})}\n"
		f"  places: list of sub-county names from {json.dumps(places)}\n"
		f"  counties: list of county names from {json.dumps(counties)}\n"
		'  period: {"last": number, "unit": "day"|"week"|"month"|"year"} or {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}\n'
		'  measure: "count" (cases or reports), "affected" (people affected) or "deaths"\n'
		'  by: "week", "month", "sub_county", "county", "disease" or "source" (what to break the figures down by; '
		'"trend" or "over time" means "week")\n'
		'  sources: list from ["Case Report", "CBS", "IDSR"] (field reports, community-based surveillance, MOH 505 facility reports)\n'
		'"My region", "my area", "here" mean the user\'s own area: leave places out. '
		f"Today is {nowdate()}. The question may be in English or Kiswahili.")
	body = {"model": _conf("kb_llm_model", DEFAULT_LLM), "stream": False, "format": "json", "think": False,
		"options": {"temperature": 0}, "keep_alive": "30m",
		"messages": [{"role": "system", "content": system}, {"role": "user", "content": q[:500]}]}
	try:
		url = _conf("kb_llm_url", "http://localhost:11434").rstrip("/") + "/api/chat"
		r = requests.post(url, json=body, timeout=cint(frappe.conf.get("dq_model_timeout", 25)))
		r.raise_for_status()
		out = json.loads(_strip_think(r.json()["message"]["content"]))
		return out if isinstance(out, dict) else None
	except Exception:
		frappe.cache().set_value(MODEL_DOWN, 1, expires_in_sec=120)   # do not wait on it again for 2 minutes
		return None


# ---------- 2. check ----------

def _clean(raw, diseases, places, counties):
	"""Keep only values from the allowed lists. Anything else is dropped."""
	raw = raw if isinstance(raw, dict) else {}
	f = {}
	lower = {p.lower(): p for p in places}
	f["diseases"] = [d for d in (raw.get("diseases") or []) if isinstance(d, str) and d in diseases][:8]
	f["places"] = [lower[p.lower()] for p in (raw.get("places") or []) if isinstance(p, str) and p.lower() in lower][:10]
	cl = {c.lower(): c for c in counties}
	f["counties"] = [cl[c.lower()] for c in (raw.get("counties") or []) if isinstance(c, str) and c.lower() in cl][:1]
	f["measure"] = raw.get("measure") if raw.get("measure") in MEASURES else None
	f["by"] = raw.get("by") if raw.get("by") in BY else None
	f["sources"] = [s for s in (raw.get("sources") or []) if s in de.SOURCES]
	f["period"] = _period(raw.get("period"))
	return f


def _period(p):
	"""(from, to) dates from a form period, or None."""
	if not isinstance(p, dict):
		return None
	today = getdate(nowdate())
	try:
		if p.get("from") or p.get("to"):
			start = getdate(p.get("from")) if p.get("from") else add_days(today, -7 * DEFAULT_WEEKS)
			end = min(getdate(p.get("to")), today) if p.get("to") else today
			return (start, end) if start <= end else (end, start)
		n, unit = min(max(cint(p.get("last")), 1), 520), p.get("unit")
		if unit == "week":   # this week and the n-1 before it, so "last 4 weeks" is 4 weeks
			return add_days(today, -today.weekday() - 7 * (n - 1)), today
		days = {"day": n, "month": 30 * n, "year": 365 * n}.get(unit)
		return (add_days(today, -(days - 1)), today) if days else None
	except Exception:
		return None


def _said(name, q):
	"""True when the place name, or a settlement inside it, is written in the question."""
	t = (q or "").lower()
	if re.search(rf"(?<![a-z]){re.escape(name.lower())}(?![a-z])", t):
		return True
	return any(p == name and w in t for w, p in PLACE_WORDS.items())


def _guard_places(model, q):
	"""Places and counties from the model only when the question names them (KRCS 26 Nov 2026: a CHA asked about
	measles and the model added Garissa). Diseases are kept, so spelling slips such as "measels" still work."""
	model["places"] = [p for p in model.get("places") or [] if _said(p, q)]
	model["counties"] = [c for c in model.get("counties") or [] if _said(c, q)]
	return model


def _merge(model, rules):
	"""The model's form, with any field it left empty taken from the word rules."""
	out = dict(model)
	for k, v in rules.items():
		if not out.get(k):
			out[k] = v
	return out


# ---------- 3. answer ----------

@frappe.whitelist(methods=["POST"])
def ask(question):
	require_capability(CAPABILITY)
	q = (question or "").strip()
	if not q:
		frappe.throw("Type a question, for example: cholera cases by week in the last 8 weeks.")
	diseases, places, counties = _vocab()
	rules = _clean(_rules(q, diseases, places, counties), diseases, places, counties)
	raw = _model(q, diseases, places, counties)
	model = _guard_places(_clean(raw, diseases, places, counties), q) if raw else None
	form, how = (_merge(model, rules), "model") if model and any(model.values()) else (rules, "rules")
	return _answer(q, form, how, diseases)


@frappe.whitelist(methods=["POST"])
def rerun(form):
	"""The same answer with other choices from the controls under it (By, Split by, Measure). No AI model: the form
	is checked against the allowed lists and the user's area again, like a new question."""
	require_capability(CAPABILITY)
	raw = json.loads(form) if isinstance(form, str) else (form or {})
	if not isinstance(raw, dict):
		frappe.throw("Could not read the choices.")
	diseases, places, counties = _vocab()
	f = _clean({**raw, "period": {"from": raw.get("date_from"), "to": raw.get("date_to")}}, diseases, places, counties)
	f["split"] = raw.get("split") if raw.get("split") in BY else ""
	f["picked"] = True
	return _answer(str(raw.get("question") or "")[:500], f, raw.get("how") if raw.get("how") in ("model", "rules") else "rules",
		diseases)


def _answer(q, form, how, diseases):
	notes = []
	allowed, area_words = de._area()
	asked_places = form.get("places") or []
	places = [p for p in asked_places if allowed is None or p.lower() in allowed]
	outside = [p for p in asked_places if p not in places]
	if outside:
		notes.append(f"You can see {area_words}. {', '.join(outside)} {'is' if len(outside) == 1 else 'are'} outside it, "
			"so nothing from there is shown.")
	start, end = form.get("period") or (add_days(getdate(nowdate()), -(7 * DEFAULT_WEEKS - 1)), getdate(nowdate()))
	if not form.get("period") and not form.get("picked"):
		notes.append(f"No period in the question, so this is the last {DEFAULT_WEEKS} weeks.")
	start = add_days(start, -start.weekday())   # counts are weekly: from the Monday of the first week
	chosen = form.get("diseases") or []
	by = form.get("by") or ("week" if chosen else "disease")
	if by == "week" and (end - start).days > 400:
		by = "month"
	measure = form.get("measure") or "affected"
	if form.get("picked"):   # chosen in the controls under the answer
		split = form.get("split") if form.get("split") and form.get("split") != by else None
	else:
		split = "disease" if by in ("week", "month") and len(chosen) != 1 else None

	a = frappe._dict(diseases=chosen, sub_counties=places, county=(form.get("counties") or [None])[0],
		sources=form.get("sources") or [], date_from=str(start), date_to=str(end), pilot_only=1,
		group_by=by, split_by=split, metric=measure)
	names = de._disease_names()
	if outside and not places:
		chart = {"labels": [], "series": [], "totals": []}
		where, values = "1=0", {}
	else:
		where, values = de._counts_where(a, names)
		chart = de._chart_counts(a, names, where, values)

	# the table: one row per week / place / disease, a column per disease when split, and the total
	cols = [BY[by]] + ([s["name"] for s in chart["series"]] if split else []) + [MEASURES[measure]]
	rows = []
	for i, label in enumerate(chart["labels"]):
		rows.append([label] + ([s["data"][i] for s in chart["series"]] if split else []) + [chart["totals"][i]])
	total = sum(chart["totals"])

	place_words = ", ".join(places) if places else (form.get("counties") or [None])[0] or area_words or "all areas"
	disease_words = ", ".join(diseases[d]["name"] for d in chosen) if chosen else "All diseases"
	source_words = ", ".join(de.SOURCES[s] for s in form.get("sources") or []) or "Reports (web, mobile, WhatsApp), CBS and MOH 505"
	understood = [
		{"label": "Disease", "value": disease_words},
		{"label": "Place", "value": place_words[0].upper() + place_words[1:]},
		{"label": "Period", "value": f"{start.strftime('%-d %b %Y')} to {end.strftime('%-d %b %Y')}"},
		{"label": "Measure", "value": MEASURES[measure]},
		{"label": "By", "value": BY[by]},
		{"label": "Sources", "value": source_words},
	]
	if not chosen and not places and not form.get("period") and not form.get("by") and not form.get("picked"):
		notes.insert(0, "I could not find a disease, place or period in the question, so this shows all diseases. "
			"Try: cholera cases by week in Dadaab in the last 8 weeks.")
	if not total:
		notes.append("Nothing was reported for this.")
	if not (form.get("sources") or []) and "source" not in (by, split):
		notes.append("Reports (web, mobile, WhatsApp), CBS and MOH 505 are added together. Ask \"by source\" to see them apart.")
	return {
		"question": q, "understood": understood, "understoodBy": how, "notes": notes,
		"title": f"{MEASURES[measure]}: {disease_words} in {place_words}, by {BY[by].lower()}"
			+ (f", split by {BY[split].lower()}" if split else ""),
		"chart": {"type": "bar", "labels": chart["labels"],   # bars first (KRCS 26 Nov 2026)
			"series": chart["series"] if split else [{"name": MEASURES[measure], "data": chart["totals"]}]},
		"table": {"columns": cols, "rows": rows, "total": total},
		"sql": _sql(by, split, measure, where, values),
		"explorer": {"diseases": chosen, "sub_counties": places, "date_from": str(start), "date_to": str(end),
			"group_by": by, "split_by": split or "", "metric": measure, "sources": form.get("sources") or []},
		"canExport": has_capability(de.EXPORT),
		"canExplorer": has_capability(de.VIEW),
		"form": {"question": q, "how": how, "diseases": chosen, "places": places, "counties": form.get("counties") or [],
			"sources": form.get("sources") or [], "date_from": str(start), "date_to": str(end), "by": by,
			"split": split or "", "measure": measure},
		"choices": {"by": [{"value": k, "label": v} for k, v in BY.items()],
			"measure": [{"value": k, "label": v} for k, v in MEASURES.items()]},
	}


def _sql(by, split, measure, where, values):
	"""The query that was run, readable, so the answer can be checked."""
	metric = {"count": "signals", "affected": "affected", "deaths": "deaths"}[measure]
	cols = de.COUNT_COLS[by] + (f", {de.COUNT_COLS[split]}" if split else "")

	def lit(v):
		if isinstance(v, (list, tuple)):
			return "(" + ", ".join(lit(x) for x in v) + ")"
		return frappe.db.escape(str(v))

	text = f"select {cols}, sum({metric})\nfrom `tabWeekly Count`\nwhere {where}\ngroup by {cols}"
	text = re.sub(r"%\((\w+)\)s", lambda m: lit(values.get(m.group(1), "")), text)
	return text.replace("%%", "%").replace(" and ", "\n  and ")
