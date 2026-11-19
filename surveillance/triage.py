"""AI triage by phone, referrals and closing (KRCS 17 Nov 2026; flow agreed with Allan and Elizabeth).

In AI triage the officer calls each reporter (CHP, FHW or community reporter) and records every attempt (Reached /
No answer). Once a reporter is reached, the questions from every suggested disease are asked in one list
(Yes / No / Didn't know). Answers are saved on the report as confirmed by phone: Yes adds the sign, No records it as
checked and not present. The suggestions update straight away, and the officer chooses the disease once for the
event. The call is the verification of the report (Allan: no separate verification needed).
  - priority disease: on to Verification (questions about the situation), Investigation, as before
  - not a priority disease: the event takes the referral pathway. The officer refers the patient through a CHP (or
    CHA) with an optional follow-up; when they are done the case is ready to close and the officer closes it.
    The case is still counted in Epi Trends (an officer chose the disease).
A reporter who cannot be reached: the case waits (Allan); after 3 attempts the page suggests the unit's CHA.

KRCS 19 Nov 2026: the calls and the symptom questions moved to Verification (step 2), done by the CHA (or an officer)
before the disease is chosen. The CHA sees no diseases. Confirm and save (confirm_verification) tells the officers,
who then choose the disease here in AI triage (step 3). Answers are Yes / No.
Clear-cut common illnesses (e.g. malaria) still skip the queue; an officer can send one to it (send_to_queue).
"""
import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, get_datetime, get_fullname, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability, require_capability

CALL_REACHED, CALL_NO_ANSWER = "Call: reached", "Call: no answer"
ANSWERS = ("Yes", "No")   # "Didn't know" removed (KRCS 19 Nov 2026); older answers still show
TRY_CHA_AFTER = 3
VERIFY = "verify_suspected_disease"


# ---------- report <-> event sync ----------

def held_by_triage(doc):
	"""events.on_case_report: leave the event alone while AI triage updates a report, and for reports on an open
	referral-pathway event (their disease is not a queue disease, but the case stays open until it is closed)."""
	if frappe.flags.get("krcs_triage"):
		return True
	event = frappe.db.get_value("Surveillance Signal", f"Field-{doc.name}", "event")
	if not event:
		return False
	ev = frappe.db.get_value("Surveillance Event", event, ["status", "pathway"], as_dict=True)
	from surveillance.events import OPEN
	return bool(ev and ev.get("pathway") == "Referral" and ev.status in OPEN)


def _save_report(cr):
	frappe.flags.krcs_triage = True
	try:
		cr.save(ignore_permissions=True)
	finally:
		frappe.flags.krcs_triage = False


# ---------- helpers ----------

def _load(event, act=False, step=None):
	from surveillance.investigation import _load as load
	return load(event, act, step)


def _load_verify(event):
	from surveillance.investigation import _load_verify as load
	return load(event)


def _check_unlocked(doc):
	"""Verification answers stay as they were once Confirm and save is used (done once, KRCS 19 Nov 2026), or once
	the officer has chosen the disease (a CHA cannot change them)."""
	from surveillance.investigation import officer_chose
	if doc.get("verification_on"):
		frappe.throw(_("The verification was confirmed and saved, so it can no longer change."))
	if _is_cha() and officer_chose(doc):
		frappe.throw(_("The surveillance officer has already taken this signal on, so the verification can no longer change."))


def _is_cha():
	from surveillance.investigation import viewer_is_cha
	return viewer_is_cha()


def _field_signals(event):
	return frappe.get_all("Surveillance Signal", filters={"event": event, "source": "Field"},
		fields=["name", "ref", "check_reached", "check_status", "signal_date"], order_by="signal_date asc")


def _answers_of(cr):
	try:
		return json.loads(cr.get("phone_answers") or "{}") or {}
	except ValueError:
		return {}


def _labels():
	from surveillance.case_definitions import _labels as labels
	return labels()


def _queue_diseases():
	from surveillance.events import _scope
	return set(_scope()[1] or [])


def _calls(doc):
	"""{signal: [{at, by, outcome}]} from the event timeline."""
	out = {}
	for a in doc.get("actions") or []:
		if a.action in (CALL_REACHED, CALL_NO_ANSWER) and a.note:
			sig = a.note.split(" | ", 1)[0]
			out.setdefault(sig, []).append({"at": str(a.at), "by": get_fullname(a.user) if a.user else None,
				"outcome": "Reached" if a.action == CALL_REACHED else "No answer"})
	return out


def _reporter(cr):
	user = cr.reported_by if cr.reported_by and frappe.db.exists("User", cr.reported_by) else None
	role = frappe.db.get_value("User", user, "primary_role") if user else None
	community = (cr.channel == "WhatsApp" and not role) or not user
	phone = cr.phone_number or (frappe.db.get_value("User", user, "mobile_no") if user else None)
	return {"name": cr.reporter_name or (get_fullname(user) if user else None) or "Reporter",
		"role": role or ("Community reporter" if community else None), "phone": phone or None}


def _unit_cha(unit):
	"""The CHA(s) of a CHU, for the 'try the CHA' tip: [{name, phone}]."""
	if not unit:
		return []
	from surveillance.health_units import CHA_ROLES, CHILD
	users = frappe.get_all(CHILD, filters={"health_unit": unit, "parenttype": "User"}, pluck="parent")
	out = []
	for u in users:
		if frappe.db.get_value("User", u, "enabled") and set(frappe.get_roles(u)) & CHA_ROLES:
			out.append({"name": get_fullname(u), "phone": frappe.db.get_value("User", u, "mobile_no") or None})
	return out


RELATED_ASKS = 6   # most extra signs asked from related case definitions


def _related_signs(cr, labels):
	"""Signs worth asking that tell apart the diseases this report could be, straight from the case definitions
	(KRCS 19 Nov 2026: a report that already meets one definition asked nothing else):
	  - for a definition that is met: the signs that would rule it out (cholera: bloody stool)
	  - for one that shares a reported sign but is not met: its missing signs (dysentery: bloody stool)
	Priority order (Match Order), age groups respected, at most RELATED_ASKS. [(symptom id, disease name)]"""
	from surveillance.case_definitions import _ages, absent_of, get_definitions, matches
	have = {r.symptom for r in cr.symptoms if r.symptom}
	if not have:
		return []
	skip = have | absent_of(cr)
	age = cr.get("age_groups") or cr.get("age_group")
	out, seen = [], set()
	for d in get_definitions():
		if d["ages"] and age and not (_ages(age) & d["ages"]):
			continue
		if matches(d, have, age, cr.get("animal_exposure")):
			signs = sorted(d["excluded_symptoms"])
		elif (d["required_symptoms"] | d["any_of_symptoms"]) & have and not (d["excluded_symptoms"] & have):
			signs = sorted(d["required_symptoms"] - have)
			if d["any_of_symptoms"] and not (d["any_of_symptoms"] & have):
				signs += sorted(d["any_of_symptoms"])
		else:
			continue
		name = labels["disease"].get(d["disease"], d["disease"])
		for sid in signs:
			if sid in skip:
				continue
			if "infant" in labels["symptom"].get(sid, "").lower() and age and "under 1" not in _ages(age):
				continue   # e.g. bulging soft spot: only asked when babies are affected
			if sid not in seen and len(seen) >= RELATED_ASKS:
				continue
			seen.add(sid)
			out.append((sid, name))
	return out


def _questions(cr, cands, labels):
	"""One list of questions for this report: the signs every suggested disease asks about, plus the ones already
	answered by phone (kept on the list so the officer sees the answer). [{symptom, name, diseases, answer, source}]"""
	from surveillance.case_definitions import absent_of
	by_name = {v: k for k, v in labels["symptom"].items()}
	answers = _answers_of(cr)
	absent = absent_of(cr)
	present = {r.symptom for r in cr.symptoms if r.symptom}
	order, diseases = [], {}
	for sid in answers:
		if sid not in order:
			order.append(sid)
	for sid in sorted(absent):   # signs the reporter already said No to: shown answered, not asked again
		if sid not in order:
			order.append(sid)
	for c in (cands.get("candidates") or []) + (cands.get("modelOther") or []):
		for name in (c.get("why") or {}).get("ask") or []:
			sid = by_name.get(name)
			if not sid:
				continue   # e.g. "age group": asked on the report form, not a sign
			if sid not in order:
				order.append(sid)
			diseases.setdefault(sid, [])
			label = c.get("name") or c.get("disease")
			if label and label not in diseases[sid]:
				diseases[sid].append(label)
	for sid, label in _related_signs(cr, labels):
		if sid not in order:
			order.append(sid)
		diseases.setdefault(sid, [])
		if label not in diseases[sid]:
			diseases[sid].append(label)
	out = []
	for sid in order:
		a = answers.get(sid) or {}
		answer, source = a.get("a"), "phone" if a.get("a") else None
		if not answer and sid in absent:
			answer, source = "No", "report"
		elif not answer and sid in present:
			answer, source = "Yes", "report"
		out.append({"symptom": sid, "name": labels["symptom"].get(sid, sid), "diseases": diseases.get(sid, []),
			"answer": answer, "source": source, "by": a.get("by"), "at": a.get("at")})
	return out


def _report_entry(doc, sig, calls, labels, with_candidates=True):
	from surveillance.events import _report_media
	from surveillance.health_units import unit_name
	cr = frappe.get_doc("Case Report", sig.ref)
	cands = {}
	if with_candidates and (has_capability(VERIFY) or _is_cha()):   # the CHA gets the questions, never the diseases
		from surveillance.ai_classifier import get_report_candidates
		frappe.flags.krcs_cha_questions = True   # the CHA gets the symptoms to ask; the diseases are removed in get_triage
		try:
			cands = get_report_candidates(cr.name)
		except Exception:  # noqa: BLE001 - the AI server may be down; the case definitions still work
			frappe.log_error(title=f"Triage suggestions failed for {cr.name}")
			cands = {}
		finally:
			frappe.flags.krcs_cha_questions = False
	attempts = calls.get(sig.name, [])
	unit = cr.get("community_health_unit")
	no_answer = sum(1 for a in attempts if a["outcome"] == "No answer")
	return {
		"signal": sig.name, "ref": cr.name, "channel": cr.channel, "date": str(cr.creation),
		"reporter": _reporter(cr), "unit": unit_name(unit) if unit else None,
		"place": ", ".join(x for x in [cr.location_name, frappe.db.get_value("Sub County", cr.sub_county, "sub_county_name") if cr.sub_county else None] if x),
		"symptoms": [labels["symptom"].get(r.symptom, r.symptom) for r in cr.symptoms if r.symptom],
		"people": cint(cr.affected_count), "deaths": cint(cr.deaths_count), "ages": cr.get("age_groups") or cr.get("age_group"),
		"notes": cr.additional_notes or None,
		"media": _report_media(cr.name),
		"reached": sig.check_reached == "Yes",
		"attempts": attempts, "noAnswer": no_answer,
		"tryCha": _unit_cha(unit) if no_answer >= TRY_CHA_AFTER and sig.check_reached != "Yes" else [],
		"questions": _questions(cr, cands or {}, labels),
		"candidates": cands or None,
		"current": cr.suspected_disease or None, "decidedBy": cr.classified_by or None,
		"triesLeft": max(0, TRY_CHA_AFTER - no_answer) if sig.check_reached != "Yes" else 0,
	}


RANK = {"Case definition": 0, "Possible": 1, "Model": 2}
LEVEL = {0: "Meets the case definition", 1: "Possible · definition not fully met", 3: "Less likely"}


PRIORITY_LEVEL = {"critical": 0, "high": 1, "medium": 2}


def _level(key, cache={}):
	"""How serious a disease is (Alert Threshold Config priority): critical 0, high 1, medium 2, other 3."""
	if key not in cache:
		cache[key] = PRIORITY_LEVEL.get(str(frappe.db.get_value("Alert Threshold Config", key, "priority") or "").lower(), 3)
	return cache[key]


def _first(name):
	return (name or "Reporter").split(" ")[0]


def _event_diseases(reports, queue):
	"""The possible diseases for the whole event, from every report's suggestions: the strongest finding per disease,
	who supports it and with which signs, what is against it and what is still to ask. Priority diseases that match or
	are possible come first (so they cannot be missed), then by strength. Also the reports' conflict, if their best
	suggestions differ: the report to split off is the one pointing to the lower-priority disease (KRCS 17 Nov 2026:
	split, investigate the priority / higher-risk one first, come back to the other)."""
	out, best_of = {}, {}
	for r in reports:
		cands = r.get("candidates") or {}
		who = _first((r.get("reporter") or {}).get("name"))
		unknown = {q["name"] for q in r.get("questions") or [] if q.get("answer") == "Didn't know" and q.get("source") == "phone"}
		items = list(cands.get("candidates") or []) + [
			{"key": o.get("key"), "name": o.get("disease"), "source": "Model", "probability": o.get("probability"), "why": o.get("why")}
			for o in (cands.get("modelOther") or []) if o.get("key")]
		for c in items:
			key = c.get("key")
			if not key:
				continue
			rank = 3 if c.get("unlikely") else RANK.get(c.get("source"), 2)
			why = c.get("why") or {}
			d = out.setdefault(key, {"key": key, "name": c.get("name"), "priority": key in queue, "rank": rank,
				"probability": None, "support": [], "against": [], "ask": [], "unknown": [], "rulesOut": [], "record": None,
				"ageFor": None, "ageAgainst": None})
			d["rank"] = min(d["rank"], rank)
			if c.get("probability") is not None:
				d["probability"] = max(d["probability"] or 0, c["probability"])
			signs = [x for x in (why.get("for") or []) if not str(x).startswith("age ")]
			if signs:
				d["support"].append({"who": who, "ref": r["ref"], "signs": signs})
			# the model lists the age group like a sign: shown on its own line, as a pattern in past clinic visits
			d["ageFor"] = d["ageFor"] or next((str(x)[4:] for x in (why.get("for") or []) if str(x).startswith("age ")), None)
			for x in why.get("against") or []:
				if str(x).startswith("age "):
					d["ageAgainst"] = d["ageAgainst"] or str(x)[4:]
					continue
				x = str(x).replace("reporter said no", f"{who} said no")
				if x not in d["against"]:
					d["against"].append(x)
			for x in why.get("ask") or []:
				if x in unknown:   # asked by phone, the reporter did not know: an open point, not a question to ask
					label = f"{x} ({who} didn't know)"
					if label not in d["unknown"]:
						d["unknown"].append(label)
					continue
				label = f"{x} ({who})" if len(reports) > 1 else x
				if label not in d["ask"]:
					d["ask"].append(label)
			for x in why.get("rulesOut") or []:
				if x not in d["rulesOut"]:
					d["rulesOut"].append(x)
			if why.get("record") and not d["record"]:
				rec = why["record"]
				if rec.get("right_when_shown") is not None:
					d["record"] = round(rec["right_when_shown"] * 10)
			cur = best_of.get(r["ref"])
			order = (rank, not (key in queue), _level(key), -(c.get("probability") or 0))
			if rank < 3 and (cur is None or order < cur[0]):
				best_of[r["ref"]] = (order, key, c.get("name"))
	for d in out.values():
		d["level"] = (f"AI model · {round((d['probability'] or 0) * 100)}%" if d["rank"] == 2
			else LEVEL[d["rank"]] + (f" · AI model also {round(d['probability'] * 100)}%" if d["probability"] and d["rank"] < 2 else ""))
	diseases = sorted(out.values(), key=lambda d: (not (d["priority"] and d["rank"] <= 1), _level(d["key"]) if d["priority"] else 3,
		d["rank"], -(d["probability"] or 0)))
	conflict = None
	tops = {ref: v for ref, v in best_of.items()}
	if len({v[1] for v in tops.values()}) > 1:
		names = {r["ref"]: (r.get("reporter") or {}).get("name") for r in reports}
		ordered = sorted(tops.items(), key=lambda kv: kv[1][0])   # the strongest / priority first: it stays
		split = ordered[-1][0]
		sig = next((r["signal"] for r in reports if r["ref"] == split), None)
		conflict = {"reports": [{"ref": ref, "name": names.get(ref), "disease": v[2], "priority": v[1] in queue} for ref, v in ordered],
			"split": {"ref": split, "signal": sig, "name": names.get(split), "disease": tops[split][2]}}
	return diseases, conflict


# ---------- API ----------

@frappe.whitelist()
def get_triage(event):
	"""Everything the AI triage step shows for an event's field reports."""
	doc = _load(event)
	labels = _labels()
	calls = _calls(doc)
	reports = [_report_entry(doc, s, calls, labels) for s in _field_signals(doc.name) if frappe.db.exists("Case Report", s.ref)]
	from surveillance.events import allowed_steps
	from surveillance.investigation import can_verify, officer_chose, verification_done
	# Verification can no longer change: Confirm and save is done once (KRCS 19 Nov 2026)
	locked = bool(doc.get("verification_on")) or officer_chose(doc) or doc.status not in ("New", "Verifying")
	verified = {"by": get_fullname(doc.verification_by) if doc.get("verification_by") else None,
		"on": str(doc.verification_on)} if doc.get("verification_on") else None
	if _is_cha():   # Verification only: the symptoms to ask, never the diseases (KRCS 19 Nov 2026)
		for r in reports:
			r["candidates"], r["current"], r["decidedBy"] = None, None, None
			for q in r["questions"]:
				q["diseases"] = []
		return {"event": doc.name, "status": doc.status, "pathway": None, "disease": None, "diseaseName": None,
			"reports": reports, "reachedAny": any(r["reached"] for r in reports), "confirmed": False, "queueDiseases": [],
			"diseases": [], "conflict": None, "current": None, "canAct": False, "canChoose": False,
			"canVerify": can_verify(), "isCha": True, "verified": verified, "verificationDone": verification_done(doc), "locked": locked,
			"tryChaAfter": TRY_CHA_AFTER}
	queue = _queue_diseases()
	diseases, conflict = _event_diseases(reports, queue)
	return {
		"event": doc.name, "status": doc.status, "pathway": doc.get("pathway") or None,
		"disease": doc.disease, "diseaseName": doc.disease_name,
		"reports": reports, "reachedAny": any(r["reached"] for r in reports),
		"confirmed": any(s.check_status == "Verified" for s in _field_signals(doc.name)),   # disease confirmed by phone
		"queueDiseases": sorted(queue),
		"diseases": diseases, "conflict": conflict,
		"current": next((r["current"] for r in reports if r["decidedBy"] == "Officer"), None),
		"canAct": has_capability("act_on_events"), "canChoose": has_capability(VERIFY) and 3 in allowed_steps(),
		"canVerify": can_verify(), "isCha": False, "verified": verified,
		"verificationDone": verification_done(doc), "locked": locked,
		"tryChaAfter": TRY_CHA_AFTER,
	}


@frappe.whitelist(methods=["POST"])
def log_call(event, signal, outcome):
	"""One call attempt to a report's reporter: outcome 'reached' or 'no_answer'. Reached counts as reaching the
	reporter for verification; every attempt goes on the event timeline (who, when). By the CHA or an officer."""
	doc = _load_verify(event)
	from surveillance.events import OPEN
	if doc.status not in OPEN:
		frappe.throw(_("This event is closed."))
	_check_unlocked(doc)
	sig = frappe.db.get_value("Surveillance Signal", signal, ["name", "event", "source", "ref"], as_dict=True)
	if not sig or sig.event != doc.name or sig.source != "Field":
		frappe.throw(_("This report is not part of this event."))
	if outcome not in ("reached", "no_answer"):
		frappe.throw(_("Unknown call outcome."))
	cr = frappe.get_doc("Case Report", sig.ref)
	who = _reporter(cr)["name"]
	if outcome == "reached":
		frappe.db.set_value("Surveillance Signal", sig.name, {"check_reached": "Yes", "check_status": "Unconfirmed",
			"checked_by": frappe.session.user, "checked_on": now_datetime()}, update_modified=False)
	doc.append("actions", {"at": now_datetime(), "user": frappe.session.user,
		"action": CALL_REACHED if outcome == "reached" else CALL_NO_ANSWER, "note": f"{sig.name} | {who} ({cr.name})"})
	if doc.status == "New":
		doc.status = "Verifying"
		doc.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": "Verification started",
			"note": "Reporter called in AI triage"})
	doc.save(ignore_permissions=True)
	return get_triage(doc.name)


@frappe.whitelist(methods=["POST"])
def answer(event, report, symptom, value=None):
	"""What the reporter said about one sign, in Verification (the CHA or an officer). Yes adds it to the report, No
	records it as checked and not present, empty clears the answer. Saved on the report (Update history: 'Asked by
	phone') and the case definitions are run again, so the officer's suggestions change straight away. The questions
	can be answered before the call is recorded (KRCS 19 Nov 2026). A new sign the reporter mentions is added the same
	way."""
	from surveillance.case_definitions import absent_of
	from surveillance.events import OPEN
	doc = _load_verify(event)
	if doc.status not in OPEN:
		frappe.throw(_("This event is closed."))
	_check_unlocked(doc)
	sig = f"Field-{report}"
	if frappe.db.get_value("Surveillance Signal", sig, "event") != doc.name:
		frappe.throw(_("This report is not part of this event."))
	if value not in ANSWERS + ("", None):
		frappe.throw(_("Answer Yes or No."))
	if not frappe.db.exists("Symptom", symptom):
		frappe.throw(_("Unknown sign."))
	cr = frappe.get_doc("Case Report", report)
	labels = _labels()
	name = labels["symptom"].get(symptom, symptom)
	answers = _answers_of(cr)
	before = (answers.get(symptom) or {}).get("a") or "—"
	present = [r.symptom for r in cr.symptoms if r.symptom]
	absent = absent_of(cr)
	if value == "Yes":
		if symptom not in present:
			cr.append("symptoms", {"symptom": symptom})
		absent.discard(symptom)
	elif value == "No":
		cr.set("symptoms", [r for r in cr.symptoms if r.symptom != symptom])
		absent.add(symptom)
	else:   # Didn't know / cleared: neither present nor ruled out by this answer
		absent.discard(symptom)
	cr.absent_symptoms = json.dumps(sorted(absent)) if absent else None
	if value:
		answers[symptom] = {"a": value, "by": get_fullname(frappe.session.user), "at": str(now_datetime())}
	else:
		answers.pop(symptom, None)
	cr.phone_answers = json.dumps(answers)
	cr.append("changes", {"at": now_datetime(), "user": frappe.session.user, "by_name": get_fullname(frappe.session.user),
		"field_label": "Asked by phone", "old_value": f"{name}: {before}", "new_value": f"{name}: {value or '—'}"})
	_save_report(cr)
	return get_triage(doc.name)   # the whole event: the possible diseases combine every report


@frappe.whitelist(methods=["POST"])
def confirm_disease(event, disease):
	"""The officer's disease for the whole event, after talking to the reporter(s). Saved on every field report.
	Priority disease: the event continues to verification. Otherwise: the referral pathway (refer, follow up, close)."""
	from surveillance.events import OPEN, _relabel_event, recompute_event
	doc = _load(event, step=3)
	require_capability(VERIFY)
	if doc.status not in ("New", "Verifying", "Verified"):
		frappe.throw(_("The disease is chosen in AI triage, before the field investigation."))
	if not disease or not frappe.db.exists("Alert Threshold Config", disease):
		frappe.throw(_("Choose a disease."))
	sigs = _field_signals(doc.name)
	if sigs and not doc.get("verification_on") and not any(s.check_reached == "Yes" for s in sigs):
		frappe.throw(_("Verification is not finished yet: the CHA (or you) must call the reporter and use Confirm and save first."))
	labels = _labels()
	disease_name = labels["disease"].get(disease, disease)
	who, today = get_fullname(frappe.session.user), frappe.utils.format_date(nowdate())
	for s in sigs:
		if not frappe.db.exists("Case Report", s.ref):
			continue
		cr = frappe.get_doc("Case Report", s.ref)
		old = cr.suspected_disease
		cr.suspected_disease, cr.classified_by = disease, "Officer"
		cr.classification_reason = f"Set to {disease_name} by {who} on {today}, after a phone call with the reporter."
		if old != disease:
			cr.append("changes", {"at": now_datetime(), "user": frappe.session.user, "by_name": who,
				"field_label": "Suspected disease", "old_value": labels["disease"].get(old, old) if old else "—",
				"new_value": f"{disease_name} (AI triage)"})
		_save_report(cr)
		frappe.db.set_value("Surveillance Signal", s.name, {"disease": disease,
			"check_case_definition": "Yes" if s.check_reached == "Yes" else None,
			"check_status": "Verified" if s.check_reached == "Yes" else s.check_status}, update_modified=False)
	doc.reload()
	if doc.disease != disease:
		first = frappe.get_doc("Surveillance Signal", sigs[0].name) if sigs else None
		if first:
			_relabel_event(doc.name, disease, first)
		doc.reload()
	sub = doc.sub_county
	from surveillance.events import in_scope
	priority = in_scope(disease, sub, "Field")
	if priority:
		if doc.status == "New":
			doc.status = "Verifying"
		doc.pathway = None
		doc.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": "Disease confirmed by phone",
			"note": f"{disease_name}: a priority disease. Answer its own questions, then start the field investigation."})
		from surveillance.investigation import ensure_investigation
		ensure_investigation(doc)   # the disease's own questions, without the ones the CHA already asked
	else:
		doc.pathway, doc.status = "Referral", "Confirmed"
		doc.decision, doc.decision_reason = "Confirmed", f"{disease_name}, confirmed by phone with the reporter in AI triage."
		doc.decided_by, doc.decided_on = frappe.session.user, now_datetime()
		doc.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": "Disease confirmed by phone",
			"note": f"{disease_name}: not a priority disease. Referral pathway: refer the patient, follow up, then close."})
	doc.save(ignore_permissions=True)
	recompute_event(doc.name)
	from surveillance.investigation import sync_reports
	sync_reports(doc, "confirm" if not priority else "start", "")
	return {"pathway": "Referral" if not priority else "Verification", "status": doc.status,
		"disease": disease, "diseaseName": disease_name}


@frappe.whitelist(methods=["POST"])
def confirm_verification(event):
	"""Confirm and save (Verification, step 2): every reporter was reached or did not answer after 3 tries, and the
	questions every event has are answered. Done once (KRCS 19 Nov 2026): the event becomes Verified and the answers
	can no longer change. When the person confirming cannot do AI triage (the CHA), the sub-county officers are
	emailed and the event waits for them in AI triage."""
	from surveillance.events import OPEN
	from surveillance.investigation import CHA, ensure_investigation, officer_chose, stage_of
	doc = _load_verify(event)
	if doc.status not in OPEN or doc.status not in ("New", "Verifying"):
		frappe.throw(_("Verification is already finished for this event."))
	if doc.get("verification_on"):
		frappe.throw(_("The verification was already confirmed and saved."))
	if officer_chose(doc) and _field_signals(doc.name):
		frappe.throw(_("The officer has already chosen the disease. Verification can no longer change."))
	ensure_investigation(doc)
	calls = _calls(doc)
	waiting = []
	for s in _field_signals(doc.name):
		if s.check_reached == "Yes":
			continue
		misses = sum(1 for a in calls.get(s.name, []) if a["outcome"] == "No answer")
		if misses < TRY_CHA_AFTER:
			waiting.append(s.ref)
	if waiting:
		frappe.throw(_("Call the reporter of {0}: mark them Reached, or No answer after {1} tries.").format(
			", ".join(waiting), TRY_CHA_AFTER))
	open_q = [a.question_no for a in doc.get("verification") or [] if stage_of(a) == CHA and not a.answer]
	if open_q:
		frappe.throw(_("Answer every question about the signal first."))
	doc.verification_by, doc.verification_on = frappe.session.user, now_datetime()
	doc.status = "Verified"
	reached = sum(1 for s in _field_signals(doc.name) if s.check_reached == "Yes")
	total = len(_field_signals(doc.name))
	doc.append("actions", {"at": now_datetime(), "user": frappe.session.user,
		"action": "Verification confirmed",
		"note": f"{reached} of {total} reporter(s) reached" if total else "Questions answered"})
	doc.save(ignore_permissions=True)
	from surveillance.events import allowed_steps
	if 3 not in allowed_steps():   # the CHA (or anyone without AI triage): the officers take it from here
		from surveillance import notifications
		notifications.on_verified(doc.name)
	return get_triage(doc.name)


# ---------- referral pathway ----------

@frappe.whitelist()
def referral_people(event):
	"""Who can refer the patient: the reporting CHP(s) first, then the other CHPs in their unit(s), then the unit's
	CHA, then other CHPs and CHAs in the sub-county."""
	from surveillance.health_units import CHA_ROLES, CHP_ROLES, CHILD, unit_name, units_of
	doc = _load(event, step=6)
	out, seen = [], set()

	def add(user, group):
		if not user or user in seen or user in ("Administrator", "Guest") or not frappe.db.get_value("User", user, "enabled"):
			return
		seen.add(user)
		roles = set(frappe.get_roles(user))
		units = units_of(user)
		out.append({"user": user, "name": get_fullname(user), "group": group,
			"role": "CHA" if roles & CHA_ROLES else "CHP" if roles & CHP_ROLES else frappe.db.get_value("User", user, "primary_role"),
			"unit": ", ".join(unit_name(u) for u in units) or None, "phone": frappe.db.get_value("User", user, "mobile_no") or None})

	units = []
	for s in _field_signals(doc.name):
		cr = frappe.db.get_value("Case Report", s.ref, ["reported_by", "community_health_unit"], as_dict=True)
		if not cr:
			continue
		if cr.reported_by and set(frappe.get_roles(cr.reported_by)) & CHP_ROLES:
			add(cr.reported_by, "Sent the report")
		if cr.community_health_unit and cr.community_health_unit not in units:
			units.append(cr.community_health_unit)
	members = {u: frappe.get_all(CHILD, filters={"health_unit": u, "parenttype": "User"}, pluck="parent") for u in units}
	for u in units:
		for user in members[u]:
			if set(frappe.get_roles(user)) & CHP_ROLES and not set(frappe.get_roles(user)) & CHA_ROLES:
				add(user, f"CHPs in {unit_name(u)}")
	for u in units:
		for user in members[u]:
			if set(frappe.get_roles(user)) & CHA_ROLES:
				add(user, f"CHA of {unit_name(u)}")
	from surveillance.notifications import sub_county_users
	for u in sub_county_users(doc.sub_county):
		roles = set(frappe.get_roles(u.name))
		if roles & (CHP_ROLES | CHA_ROLES):
			add(u.name, f"Others in {doc.sub_county}")
	return out


@frappe.whitelist(methods=["POST"])
def refer(event, assigned_to, facility, due_date=None, urgency=None, instructions=None, people=None, age_group=None,
		sex=None, followup_days=None):
	"""Referral pathway: the CHP (or CHA) refers the patient to a facility; optionally one follow-up after N days.
	Both are tasks for that person (Referrals / Follow-ups pages), with a notification."""
	from surveillance.event_tasks import AGE_GROUPS, _insert, get_event_tasks, notify_assigned
	doc = _load(event, step=6)
	if doc.get("pathway") != "Referral" or doc.status != "Confirmed":
		frappe.throw(_("Referrals are made after a disease that is not a priority disease is confirmed in AI triage."))
	if age_group and age_group not in AGE_GROUPS:
		frappe.throw(_("Unknown age group."))
	if sex and sex not in ("Female", "Male"):
		frappe.throw(_("Unknown sex."))
	refs = [s.ref for s in _field_signals(doc.name)]
	reason = (instructions or "").strip() or f"{doc.disease_name}: refer the patient to {facility}."
	t = _insert(doc, "Referral", f"Refer to {(facility or '').strip()}", assigned_to, due_date or nowdate(), reason,
		facility, urgency or "Routine")
	t.db_set({"case_report": refs[0] if refs else None, "patient_age_group": age_group or None,
		"patient_sex": sex or None, "people_referred": cint(people) or None, "reason": reason})
	notes = [f"Referral to {facility} → {get_fullname(assigned_to)}"]
	days = cint(followup_days)
	if days > 0:
		f = _insert(doc, "Follow-up", f"Day {days} follow-up: did the patient reach {facility}, are they better, any new cases?",
			assigned_to, add_days(nowdate(), days), None)
		notes.append(f"follow-up after {days} days")
		notify_assigned(f.name)
	doc.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": "Referral made", "note": ", ".join(notes)})
	doc.save(ignore_permissions=True)
	notify_assigned(t.name)
	return get_event_tasks(doc.name)


def _ready(event_tasks):
	"""Ready to close: at least one referral, and every referral and follow-up finished (done or could not)."""
	from surveillance.event_tasks import OPEN_STATUSES
	refs = [t for t in event_tasks if t.task_type == "Referral"]
	return bool(refs) and not any(t.status in OPEN_STATUSES for t in event_tasks if t.task_type in ("Referral", "Follow-up"))


@frappe.whitelist()
def get_referral_state(event):
	"""For the event page: the referral pathway's tasks and whether the case can be closed."""
	from surveillance.event_tasks import DOCTYPE
	doc = _load(event)
	tasks = frappe.get_all(DOCTYPE, filters={"event": doc.name}, fields=["name", "task_type", "status", "outcome", "facility", "assigned_to"])
	ready = doc.get("pathway") == "Referral" and doc.status == "Confirmed" and _ready(tasks)
	done = [t for t in tasks if t.task_type == "Referral" and t.status not in ("Assigned", "In progress", "Blocked")]
	summary = "; ".join(f"Referral to {t.facility or 'a facility'} by {get_fullname(t.assigned_to)}: {t.status.lower()}"
		+ (f" ({t.outcome})" if t.outcome else "") for t in done)
	return {"ready": ready, "hasReferral": any(t.task_type == "Referral" for t in tasks),
		"summary": f"{doc.disease_name}, confirmed by phone. {summary}." if summary else ""}


@frappe.whitelist(methods=["POST"])
def close_case(event, note):
	"""Close a referral-pathway case once its referral (and follow-up) are done."""
	from surveillance.events import set_status
	doc = _load(event, step=6)
	if doc.get("pathway") != "Referral":
		frappe.throw(_("Close this case from its event page."))
	return set_status(doc.name, "close", note)


# ---------- Referrals page (officers, CHAs, HQ) ----------

def _referral_scope():
	"""Filter for the Referrals page: CHA -> their CHU(s); officers / FHWs -> their sub-county; region officers ->
	their region; HQ and admins -> everything. Returns (kind, value)."""
	from surveillance.health_units import cha_scope
	from surveillance.user_scope import locked_area
	scope = cha_scope()
	if scope is not None:
		return "cha", scope
	area = locked_area()
	if area:
		return "sub_county", area
	from surveillance.events import _user_region
	region = _user_region() if has_capability("view_review_queue") else None
	if region:
		return "region", region
	return "all", None


@frappe.whitelist()
def get_referrals(limit=1000):
	"""Every referral in the user's area, with its follow-up and whether its case can be closed."""
	from surveillance.event_tasks import DOCTYPE, FIELDS, OPEN_STATUSES, _overdue, _shape
	from surveillance.health_units import report_ok, unit_name, units_for_reports, visible_events
	from surveillance.user_scope import locked_area
	if not (has_capability("view_review_queue") or locked_area()):
		frappe.throw(_("You do not have permission to see referrals."), frappe.PermissionError)
	kind, value = _referral_scope()
	filters = {"task_type": "Referral"}
	if kind == "region":
		filters["region"] = value
	rows = frappe.get_all(DOCTYPE, filters=filters, fields=FIELDS + ["people_referred"], order_by="creation desc",
		limit_page_length=min(cint(limit) or 1000, 3000))
	unit_of = units_for_reports([r.case_report for r in rows if r.case_report])
	if kind == "cha":
		vis = visible_events()
		rows = [r for r in rows if (r.event and r.event in vis) or (not r.event and r.case_report and unit_of.get(r.case_report)
			and report_ok(value, unit_of.get(r.case_report)))]
	elif kind == "sub_county":   # their sub-county or sub-counties (KRCS 19 Nov 2026)
		from surveillance.user_scope import in_area
		rows = [r for r in rows if in_area(value, r.sub_county)]
	events = {e.name: e for e in frappe.get_all("Surveillance Event", filters={"name": ["in", list({r.event for r in rows if r.event}) or [""]]},
		fields=["name", "status", "pathway", "title", "disease_name"], limit_page_length=0)}
	followups = {}
	tasks_by_event = {}
	for t in frappe.get_all(DOCTYPE, filters={"event": ["in", list(events) or [""]]},
			fields=["name", "event", "task_type", "status", "due_date", "assigned_to"], limit_page_length=0):
		tasks_by_event.setdefault(t.event, []).append(t)
		if t.task_type == "Follow-up":
			followups.setdefault(t.event, []).append(t)
	can_act = has_capability("act_on_events")
	subs = {s.name: s.sub_county_name for s in frappe.get_all("Sub County", fields=["name", "sub_county_name"])}
	out = []
	for r in rows:
		ev = events.get(r.event)
		fu = followups.get(r.event, [])
		if not fu:
			follow = None
		elif any(t.status in OPEN_STATUSES for t in fu):
			nxt = min((t for t in fu if t.status in OPEN_STATUSES), key=lambda t: t.due_date or getdate(nowdate()))
			follow = {"state": "overdue" if _overdue(nxt) else "due", "due": str(nxt.due_date) if nxt.due_date else None}
		else:
			follow = {"state": "done", "due": None}
		open_task = r.status in OPEN_STATUSES
		if ev and ev.status in ("Closed", "Discarded"):
			state = "closed"
		elif open_task or (follow and follow["state"] != "done"):
			state = "ongoing"
		elif ev and ev.pathway == "Referral" and ev.status == "Confirmed":
			state = "ready"
		elif ev:
			state = "ongoing"   # a priority-disease case: closed from its event page when the response is done
		else:
			state = "closed"   # a CHP's own referral, not linked to a Review Queue case
		x = _shape(r)
		x.update({"state": state, "overdue": bool(_overdue(r)), "followup": follow,
			"eventStatus": ev.status if ev else None, "pathway": ev.pathway if ev else None,
			"canClose": state == "ready" and can_act,
			"unit": unit_name(unit_of.get(r.case_report)) if r.case_report and unit_of.get(r.case_report) else None,
			"unitId": unit_of.get(r.case_report) if r.case_report else None,
			"subCountyName": subs.get(r.sub_county) or r.sub_county})
		out.append(x)
	month = getdate(nowdate()).replace(day=1)
	closed_month = 0
	for x in out:
		if x["state"] == "closed" and x.get("completedOn") and getdate(x["completedOn"]) >= month:
			closed_month += 1
	return {"referrals": out, "canAct": can_act, "scope": kind,
		"counts": {"ongoing": sum(1 for x in out if x["state"] == "ongoing"),
			"overdue": sum(1 for x in out if x["state"] == "ongoing" and (x["overdue"] or (x["followup"] or {}).get("state") == "overdue")),
			"ready": sum(1 for x in out if x["state"] == "ready"), "closedMonth": closed_month}}


# ---------- Signals Captured: send a clear-cut report to the queue ----------

@frappe.whitelist(methods=["POST"])
def send_to_queue(report):
	"""A clear-cut common illness (e.g. malaria) skipped the Review Queue; an officer wants a closer look."""
	require_capability("act_on_events")
	cr = frappe.get_doc("Case Report", report)
	if not frappe.has_permission("Case Report", "read", doc=cr):
		frappe.throw(_("This report is outside your area."), frappe.PermissionError)
	if frappe.db.get_value("Surveillance Signal", f"Field-{cr.name}", "event"):
		frappe.throw(_("This report is already in the Review Queue."))
	cr.force_review = 1
	cr.append("changes", {"at": now_datetime(), "user": frappe.session.user, "by_name": get_fullname(frappe.session.user),
		"field_label": "Review Queue", "old_value": "Not reviewed (clear-cut)", "new_value": "Sent to the Review Queue"})
	cr.save(ignore_permissions=True)   # events.on_case_report puts it in the queue (force_review)
	event = frappe.db.get_value("Surveillance Signal", f"Field-{cr.name}", "event")
	if not event:
		frappe.throw(_("The report could not be added to the Review Queue (its sub-county may be outside the queue)."))
	return {"event": event}
