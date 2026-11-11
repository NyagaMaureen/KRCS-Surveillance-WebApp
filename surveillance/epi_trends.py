"""Epi Trends: weekly cases per disease, split by where they came from, with unusual rises marked.

What is counted (agreed with KRCS, Nov 2026)
    Confirmed cases (shown by default)
      Mobile, WhatsApp, Web, SMS, USSD   field reports an officer verified: the officer chose or confirmed the
                                         disease, or the event moved past verification; plus clear-cut common
                                         illnesses that go straight to Epi Trends by design (never in the queue)
      CBS                                every community signal not dismissed (CBS does not share a verified status)
      MOH 505 (IDSR)                     weekly facility totals (diagnosed at the facility)
      EMR                                facility records, once connected
    Unconfirmed (the "Include unconfirmed" switch)
      field reports still waiting for an officer (in the Review Queue, not yet verified)
    Never counted
      reports discarded as a false alarm, and unclassified reports marked "Not a disease of concern"
Cases = people affected (a report of 3 sick children counts 3).

Unusual rises are the alert engine's flags (Risk Alert: threshold, well above usual, statistical rise). The engine
looks at every reported case so a rise shows as early as possible; the officer opens a flagged week to see why it
was flagged and to start an investigation in the Review Queue.
Pilot sub-counties only; officers see their own region (as in the Review Queue).
"""
from collections import defaultdict

import frappe
from frappe.utils import add_days, cint, getdate, today

from surveillance.capabilities import require_capability

SOURCES = [   # fixed order = fixed colour on every chart
	("Mobile", "Mobile app"), ("WhatsApp", "WhatsApp"), ("Web", "Web app"),
	("CBS", "Community (CBS)"), ("IDSR", "Facilities (MOH 505)"), ("EMR", "Facilities (EMR)"),
]
FIELD_CHANNELS = {"Mobile": "Mobile", "WhatsApp": "WhatsApp", "Web": "Web", "SMS": "Mobile", "USSD": "Mobile"}
VERIFIED_EVENT = {"Investigating", "Confirmed", "Escalated", "Closed"}   # past verification
USUAL_WEEKS = 8
# two panels per disease: they differ in size by 100x (facility totals vs single reports), and the engine checks them
# separately, so each has its own scale, usual level and flagged rises
COMMUNITY = ["Mobile", "WhatsApp", "Web", "CBS"]
FACILITY = ["IDSR", "EMR"]
FACILITY_SOURCES = {"IDSR", "EMR"}
PERIODS = {"8w": 8, "12w": 12, "6m": 26, "12m": 52}
UNCLASSIFIED = "unclassified-illness"


def _monday(d):
	d = getdate(d)
	return add_days(d, -d.weekday())


def _sub_counties():
	"""Pilot sub-counties this user may see: {name_lower: {"id", "name", "region"}}."""
	from surveillance.events import _scope, _user_region
	subs, _ = _scope()
	region = _user_region()
	out = {}
	for s in frappe.get_all("Sub County", fields=["name", "sub_county_name", "region", "county"]):
		n = (s.sub_county_name or s.name or "").strip()
		if n.lower() in subs and (not region or s.region == region):
			out[n.lower()] = {"id": s.name, "name": n, "region": s.region, "county": s.county}
	return out


def _field_reports(first, last, subs):
	"""(disease, sub_county, week, source, confirmed, cases) for app reports in the window."""
	by_id = {v["id"]: k for k, v in subs.items()}
	reports = frappe.get_all("Case Report", filters={"sub_county": ["in", list(by_id) or [""]]},
		fields=["name", "suspected_disease", "review_outcome", "sub_county", "onset_date", "report_date", "creation",
			"affected_count", "channel", "classified_by"], limit_page_length=0)
	if not reports:
		return []
	signals = {s.ref: s.event for s in frappe.get_all("Surveillance Signal",
		filters={"source": "Field", "ref": ["in", [r.name for r in reports]]}, fields=["ref", "event"], limit_page_length=0)}
	events = {e.name: e.status for e in frappe.get_all("Surveillance Event",
		filters={"name": ["in", list({v for v in signals.values() if v}) or [""]]}, fields=["name", "status"],
		limit_page_length=0)}
	out = []
	for r in reports:
		week = _monday(r.onset_date or r.report_date or r.creation)
		if week < first or week > last:
			continue
		if r.review_outcome == "Not a disease of concern":
			continue
		event_status = events.get(signals.get(r.name)) if r.name in signals else None
		if event_status == "Discarded":
			continue   # false alarm
		disease = r.suspected_disease or UNCLASSIFIED
		in_queue = r.name in signals
		confirmed = (r.classified_by == "Officer" or not in_queue or event_status in VERIFIED_EVENT)
		out.append((disease, by_id[r.sub_county], week, FIELD_CHANNELS.get(r.channel or "", "Web"), confirmed,
			max(cint(r.affected_count), 1)))
	return out


def _weekly_counts(first, last, subs, reported=None):
	"""(disease, sub_county, week, source, cases) from CBS, MOH 505 and EMR weekly tables.
	reported (a dict) collects {source: set(weeks)} the source sent anything for (MOH 505 rows include zeros)."""
	rows = frappe.get_all("Weekly Count", filters={"source": ["in", ["CBS", "IDSR", "EMR"]],
		"week_start": ["between", [first, add_days(last, 6)]]},
		fields=["source", "disease", "sub_county", "week_start", "signals", "affected"], limit_page_length=0)
	out = []
	for r in rows:
		sc = (r.sub_county or "").strip().lower()
		if sc not in subs:
			continue
		if reported is not None:
			reported.setdefault(r.source, set()).add(_monday(r.week_start))
			reported.setdefault(("sc", sc), set()).add(_monday(r.week_start)) if r.source in ("IDSR", "EMR") else None
		n = cint(r.affected) or cint(r.signals)
		if n:
			out.append((r.disease, sc, _monday(r.week_start), r.source, n))
	return out


def _flags(first, last, subs, disease=None):
	"""Unusual rises (Risk Alert) touching the window: {(disease, week): [flag, ...]}."""
	filters = {"last_week": [">=", first], "week_start": ["<=", add_days(last, 6)], "status": ["!=", "Rejected"]}
	if disease:
		filters["disease"] = disease
	out = defaultdict(list)
	for a in frappe.get_all("Risk Alert", filters=filters, fields=["name", "disease", "disease_name", "sub_county",
			"week_start", "last_week", "severity", "status", "signals", "peak_signals", "peak_week", "rules",
			"possible_reporting_surge", "sources"], limit_page_length=0):
		sc = (a.sub_county or "").strip().lower()
		if sc not in subs:
			continue
		w, end = _monday(a.week_start), _monday(a.last_week or a.week_start)
		while w <= end:
			if first <= w <= last:
				srcs = {x.strip() for x in (a.sources or "").split(",") if x.strip()}
				group = "facility" if srcs and srcs <= FACILITY_SOURCES else "community"
				out[(a.disease, w)].append({"alert": a.name, "subCounty": subs[sc]["name"], "severity": a.severity, "group": group,
					"status": a.status, "rules": [x for x in (a.rules or "").split(",") if x],
					"surge": bool(a.possible_reporting_surge)})
			w = add_days(w, 7)
	return out


@frappe.whitelist()
def get_trends(period="12w", sub_county=None, disease=None, start=None, end=None):
	"""Everything the Epi Trends page draws, for the chosen period, sub-county and disease.
	Each disease has two panels, each with its own scale, usual level and flagged rises:
	  community  Mobile, WhatsApp, Web, CBS: confirmed per source per week, unconfirmed per week, usual level
	             (confirmed, and confirmed + unconfirmed)
	  facility   MOH 505 and EMR: weekly totals; weeks with no facility report are null ("not reported"), and the
	             usual level averages only reported weeks
	Usual level = the average of the 8 weeks before that week. Plus 'Rising now': rises flagged in the last 2 weeks."""
	require_capability("view_alerts")
	if start:   # the rise page: the weeks around one rise
		last = min(_monday(end or today()), _monday(today()))
		first = min(_monday(start), last)
		n_weeks = (last - first).days // 7 + 1
	else:
		n_weeks = PERIODS.get(period, 12)
		last = _monday(today())
		first = add_days(last, -7 * (n_weeks - 1))
	hist_first = add_days(first, -7 * USUAL_WEEKS)
	subs = _sub_counties()
	if sub_county:
		key = sub_county.strip().lower()
		subs = {key: subs[key]} if key in subs else {}
	weeks = [add_days(first, 7 * i) for i in range(n_weeks)]
	hist_weeks = [add_days(hist_first, 7 * i) for i in range(n_weeks + USUAL_WEEKS)]
	idx = {w: i for i, w in enumerate(hist_weeks)}

	confirmed = defaultdict(lambda: defaultdict(lambda: [0] * len(hist_weeks)))   # disease -> source -> weeks
	unconfirmed = defaultdict(lambda: [0] * len(hist_weeks))
	# the same per sub-county, for the 'Rising now' cards (a rise is flagged in one sub-county)
	sc_com = defaultdict(lambda: [0] * len(hist_weeks))
	sc_unc = defaultdict(lambda: [0] * len(hist_weeks))
	sc_fac = defaultdict(lambda: [0] * len(hist_weeks))
	for d, sc, w, src, ok, n in _field_reports(hist_first, last, subs):
		if disease and d != disease:
			continue
		if ok:
			confirmed[d][src][idx[w]] += n
			sc_com[(d, sc)][idx[w]] += n
		else:
			unconfirmed[d][idx[w]] += n
			sc_unc[(d, sc)][idx[w]] += n
	reported = {}
	for d, sc, w, src, n in _weekly_counts(hist_first, last, subs, reported):
		if (disease and d != disease) or w not in idx:
			continue
		confirmed[d][src][idx[w]] += n
		(sc_fac if src in FACILITY_SOURCES else sc_com)[(d, sc)][idx[w]] += n
	# facility weeks with no MOH 505 / EMR report at all are "not reported" (null), never zero
	fac_reported = [w in reported.get("IDSR", set()) | reported.get("EMR", set()) for w in hist_weeks]

	def usual_of(values, known=None):
		"""Usual level for each shown week: the average of the 8 weeks before it (only weeks with data, for facilities)."""
		out = []
		for i in range(USUAL_WEEKS, len(hist_weeks)):
			prev = [values[j] for j in range(i - USUAL_WEEKS, i) if known is None or known[j]]
			out.append(round(sum(prev) / len(prev), 1) if len(prev) >= (2 if known is not None else 1) else None)
		return out

	meta = {d.name: d for d in frappe.get_all("Alert Threshold Config",
		fields=["name", "disease_name", "priority", "threshold"])}
	flags = _flags(first, last, subs, disease)
	recent = {add_days(_monday(today()), -7), _monday(today())}
	shown = slice(USUAL_WEEKS, len(hist_weeks))
	series, rising = [], []
	for d in sorted(set(confirmed) | set(unconfirmed) | {k for k, _ in flags}):
		week_flags = [flags.get((d, w), []) for w in weeks]
		m = meta.get(d)
		name = (m.disease_name if m else None) or ("Unclassified illness" if d == UNCLASSIFIED else d)

		com_total = [sum(confirmed[d][s][i] for s in COMMUNITY) for i in range(len(hist_weeks))]
		com_all = [com_total[i] + unconfirmed[d][i] for i in range(len(hist_weeks))]
		fac_total = [sum(confirmed[d][s][i] for s in FACILITY) for i in range(len(hist_weeks))]
		community = {
			"bySource": {s: confirmed[d][s][shown] for s in COMMUNITY if any(confirmed[d][s][shown])},
			"unconfirmed": unconfirmed[d][shown],
			"usual": usual_of(com_total), "usualAll": usual_of(com_all),
			"flags": [[f for f in fl if f["group"] == "community"] for fl in week_flags],
		}
		facility = {
			"bySource": {s: [v if fac_reported[USUAL_WEEKS + i] else None for i, v in enumerate(confirmed[d][s][shown])]
				for s in FACILITY if any(confirmed[d][s][shown])},
			"reported": fac_reported[shown],
			"usual": [u if ok else None for u, ok in zip(usual_of(fac_total, fac_reported), fac_reported[shown])],
			"flags": [[f for f in fl if f["group"] == "facility"] for fl in week_flags],
		}
		com_conf = sum(sum(v) for v in community["bySource"].values())
		fac_conf = sum(sum(x or 0 for x in v) for v in facility["bySource"].values())
		unconf_total = sum(community["unconfirmed"])
		if not (com_conf or fac_conf or unconf_total or any(week_flags)):
			continue
		item = {"disease": d, "name": name, "priority": (m.priority if m else None) or "Normal",
			"community": community, "facility": facility, "flags": week_flags,
			"communityTotal": com_conf, "facilityTotal": fac_conf, "unconfirmedTotal": unconf_total,
			"confirmedTotal": com_conf + fac_conf}
		item["risingNow"] = any(fl for w, fl in zip(weeks, week_flags) if w in recent)
		series.append(item)
		for i, (w, fl) in enumerate(zip(weeks, week_flags)):
			if w not in recent:
				continue
			for f in fl:
				# the numbers of the sub-county the rise was flagged in, not of every place shown
				sc = f["subCounty"].strip().lower()
				j = USUAL_WEEKS + i
				if f["group"] == "facility":
					known = [wk in reported.get(("sc", sc), set()) for wk in hist_weeks]
					cases, unc, usual = sc_fac[(d, sc)][j], 0, usual_of(sc_fac[(d, sc)], known)[i]
				else:
					cases, unc, usual = sc_com[(d, sc)][j], sc_unc[(d, sc)][j], usual_of(sc_com[(d, sc)])[i]
				rising.append({"disease": d, "name": name, "week": str(w), "subCounty": f["subCounty"], "group": f["group"],
					"alert": f["alert"], "severity": f["severity"], "status": f["status"], "surge": f["surge"],
					"cases": cases, "unconfirmed": unc, "usual": usual})
	order = {"critical": 0, "high": 1, "standard": 2}
	series.sort(key=lambda x: (not x["risingNow"], -(x["confirmedTotal"] + x["unconfirmedTotal"])))
	rising.sort(key=lambda x: x["week"], reverse=True)          # latest week first ...
	rising.sort(key=lambda x: order.get(x["severity"], 3))       # ... then by severity (stable)
	seen, unique = set(), []
	for r in rising:   # one card per flagged rise (a rise spanning both recent weeks shows its latest week)
		if r["alert"] in seen:
			continue
		seen.add(r["alert"])
		unique.append(r)

	all_subs = _sub_counties()
	return {"weeks": [str(w) for w in weeks], "currentWeek": str(last),
		"sources": [{"key": k, "label": label} for k, label in SOURCES],
		"series": series, "rising": unique,
		"subCounties": sorted(v["name"] for v in all_subs.values()),
		"diseases": sorted(({"key": k, "name": v.disease_name or k} for k, v in meta.items()), key=lambda x: x["name"])}
