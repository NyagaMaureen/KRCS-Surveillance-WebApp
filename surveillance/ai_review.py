"""AI outputs on Review Queue events and their human review (Audit Framework V2.0 cl. 21, 26 and 32; AUD-01, AUD-08).

AI outputs are advisory. For every event, one AI Output Review record keeps:
  - the AI component, the time of the output, the model version and confidence, the suggestions shown in order
    and the risk score (what the officer saw in AI triage, step 3)
  - the data inputs (symptoms, age groups, people, deaths, place; never names or phone numbers)
  - the reviewer, the time, what they did (accepted the top suggestion, chose another disease, discarded, escalated)
    and, when they did not follow the AI, the reason they gave (override reason)

Escalation matrix (AUD-08), set on AI Review Settings (Settings > AI review deadlines):
  L1  Surveillance / County Officer: review within 4 hours (high or very high risk) or 24 hours (medium or low)
  L2  Public Health Manager / Field Supervisor: told when L1 misses the deadline, then has 8 hours
  L3  Public Health Specialist / HQ Admin: told at once when L2 misses its deadline
The clock starts when the output is ready for the officer: when the CHA confirms the verification (step 2) for field
signals, or when the event is created for facility and CBS data. The report stays on record whatever happens; a late
review and every escalation are written to the event's history and the Audit Log.

Hourly (hooks.py): surveillance.ai_review.check_overdue
"""
import frappe
from frappe import _
from frappe.utils import add_to_date, cint, escape_html, flt, get_datetime, get_fullname, now_datetime

DOCTYPE = "AI Output Review"
SETTINGS = "AI Review Settings"
COMPONENT = "AI triage: disease suggestions and risk score"
PENDING = ("Waiting for verification", "Awaiting review")
OPEN_STATUSES = ("New", "Verified")
HIGH_LEVELS = ("High", "Very high")
DEFAULTS = {"enabled": 1, "l1_high_hours": 4, "l1_standard_hours": 24, "l2_hours": 8,
	"l2_roles": "County MOH / PHEOC", "l3_roles": "Public Health HQ\nSystem Administrator", "escalate_from": None}


def settings():
	out = dict(DEFAULTS)
	saved = frappe.db.get_singles_dict(SETTINGS) or {}
	for k in DEFAULTS:
		if saved.get(k) not in (None, ""):
			out[k] = saved[k]
	out["l2_roles"] = [r.strip() for r in str(out["l2_roles"]).splitlines() if r.strip()]
	out["l3_roles"] = [r.strip() for r in str(out["l3_roles"]).splitlines() if r.strip()]
	return out


def _record(event):
	name = frappe.db.get_value(DOCTYPE, {"event": event}, "name")
	return frappe.get_doc(DOCTYPE, name) if name else None


def _field_refs(event):
	return frappe.get_all("Surveillance Signal", filters={"event": event, "source": "Field"}, pluck="ref")


def _inputs(doc, refs):
	"""What the AI worked from, without names or phone numbers."""
	from surveillance.case_definitions import _labels
	labels = _labels()
	parts = []
	for ref in refs:
		if not frappe.db.exists("Case Report", ref):
			continue
		cr = frappe.get_doc("Case Report", ref)
		symptoms = ", ".join(labels["symptom"].get(r.symptom, r.symptom) for r in cr.symptoms if r.symptom) or "no symptoms ticked"
		ages = cr.get("age_groups") or cr.get("age_group") or "age not given"
		parts.append(f"{ref}: {symptoms}; ages {ages}; {cint(cr.affected_count)} affected, {cint(cr.deaths_count)} death{'' if cint(cr.deaths_count) == 1 else 's'}")
	if not parts:
		parts.append(f"{doc.get('source') or 'Facility / CBS'} data: {doc.get('reason') or doc.title or ''}".strip())
	place = ", ".join(x for x in (doc.get("area"), doc.sub_county) if x)
	return "\n".join(parts + ([f"Place: {place}"] if place else []))


def _model_version(refs):
	if not refs:
		return ""
	row = frappe.get_all("AI Prediction", filters={"case_report": ["in", refs], "kind": "Model"},
		fields=["model_version"], order_by="predicted_on desc", limit=1)
	return row[0].model_version if row else ""


def _risk(doc):
	from surveillance.risk import level_for
	score = doc.get("risk_score")
	return (cint(score), level_for(cint(score))) if score is not None else (None, None)


def _review_from(doc, refs):
	from surveillance.investigation import needs_cha
	if refs or needs_cha(doc):   # field and CBS signals: once the CHA has confirmed the verification (KRCS 23 Nov 2026)
		return doc.get("verification_on") or None
	return doc.creation   # facility (EMR) data


def _due(rec, cfg):
	if not rec.review_from:
		return None
	hours = cfg["l1_high_hours"] if rec.risk_level in HIGH_LEVELS else cfg["l1_standard_hours"]
	return add_to_date(get_datetime(rec.review_from), hours=flt(hours))


def _suggestions_from(diseases):
	"""diseases: triage._event_diseases output, in the order the officer sees them."""
	if not diseases:
		return None
	top = diseases[0]
	lines = [f"{i + 1}. {d['name']} ({d.get('level') or ''})" for i, d in enumerate(diseases[:5])]
	return {"ai_suggestion": top["key"], "ai_suggestion_name": top["name"],
		"ai_basis": top.get("level") or "", "ai_confidence": round(flt(top.get("probability")) * 100, 1) if top.get("probability") else None,
		"suggestions": "\n".join(lines)}


def _compute_suggestions(doc, refs):
	"""The suggestions the officer would see, for an output nobody has opened yet (run as the scheduler)."""
	from surveillance import triage
	labels = triage._labels()
	calls = triage._calls(doc)
	sigs = [s for s in triage._field_signals(doc.name) if frappe.db.exists("Case Report", s.ref)]
	reports = [triage._report_entry(doc, s, calls, labels) for s in sigs]
	diseases, _ = triage._event_diseases(reports, triage._queue_diseases())
	return _suggestions_from(diseases)


def record_output(doc, diseases=None, compute=False):
	"""Create or refresh the event's AI Output Review while it is not reviewed yet. Never raises."""
	try:
		rec = _record(doc.name)
		if rec and rec.status not in PENDING:
			return rec
		refs = _field_refs(doc.name)
		cfg = settings()
		rec = rec or frappe.get_doc({"doctype": DOCTYPE, "event": doc.name, "component": COMPONENT,
			"output_on": doc.creation, "status": "Waiting for verification", "escalation_level": 1})
		score, level = _risk(doc)
		rec.risk_score, rec.risk_level = score, level
		rec.inputs = _inputs(doc, refs)
		rec.model_version = _model_version(refs) or rec.model_version or ""
		got = _suggestions_from(diseases) if diseases is not None else None
		if got is None and compute and not rec.ai_suggestion and refs:
			try:
				got = _compute_suggestions(doc, refs)
			except Exception:  # noqa: BLE001 - the AI server may be down; try again next hour
				got = None
		if got:
			rec.update(got)
		elif not refs and not rec.ai_suggestion:
			rec.ai_suggestion, rec.ai_suggestion_name, rec.ai_basis = doc.disease, doc.disease_name, "Facility / CBS data"
		rec.review_from = _review_from(doc, refs)
		rec.review_due = _due(rec, cfg)
		rec.status = "Awaiting review" if rec.review_from else "Waiting for verification"
		rec.save(ignore_permissions=True) if rec.name else rec.insert(ignore_permissions=True)
		return rec
	except Exception:  # noqa: BLE001 - the audit record never blocks the officer
		frappe.log_error(title=f"AI output record failed ({doc.name})", message=frappe.get_traceback())
		return None


def record_from_triage(event, diseases):
	"""Background job: the suggestions an officer has just been shown in AI triage (get_triage is a read)."""
	if frappe.db.exists("Surveillance Event", event):
		record_output(frappe.get_doc("Surveillance Event", event), diseases)
		frappe.db.commit()


def top_suggestion(doc):
	rec = _record(doc.name) or record_output(doc, compute=True)
	return (rec.ai_suggestion, rec.ai_suggestion_name) if rec else (None, None)


def reviewed(doc, action, chosen=None, chosen_name=None, reason=None):
	"""The officer acted on the AI output (step 3). Called once; later actions do not change the review."""
	try:
		rec = _record(doc.name) or record_output(doc)
		if not rec or rec.status not in PENDING:
			return
		now = now_datetime()
		late = bool(rec.review_due and now > get_datetime(rec.review_due))
		rec.reviewed_by, rec.reviewed_on, rec.review_action = frappe.session.user, now, action
		rec.chosen_disease = chosen_name or chosen or None
		rec.override_reason = (reason or "").strip() or None
		rec.status = "Reviewed late" if late else "Reviewed"
		rec.save(ignore_permissions=True)
		if late:
			hours = round((now - get_datetime(rec.review_due)).total_seconds() / 3600, 1)
			frappe.get_doc("Surveillance Event", doc.name).append("actions", {"at": now, "user": frappe.session.user,
				"action": "AI output reviewed late",
				"note": f"{action}. Reviewed {hours:g} hours after the deadline ({_fmt(rec.review_due)})."}).save(ignore_permissions=True)
	except Exception:  # noqa: BLE001
		frappe.log_error(title=f"AI review record failed ({doc.name})", message=frappe.get_traceback())


def closed_without_review(doc, action):
	"""Discarded at verification (step 2) before any officer reviewed the AI output."""
	rec = _record(doc.name)
	if rec and rec.status in PENDING:
		rec.status, rec.review_action = "Closed without review", action
		rec.reviewed_by, rec.reviewed_on = frappe.session.user, now_datetime()
		rec.save(ignore_permissions=True)


# ---------- escalation (AUD-08) ----------

def _fmt(dt):
	return get_datetime(dt).strftime("%d %b %Y %H:%M") if dt else ""


def _role_users(roles, doc, national=False):
	"""Enabled users whose main role is one of these: in the event's area, or national (no area)."""
	if not roles:
		return []
	from surveillance.user_scope import in_area, locked_area
	out = []
	for u in frappe.get_all("User", filters={"enabled": 1, "primary_role": ["in", roles]}, fields=["name", "assigned_region"]):
		if national:
			out.append(u.name)
			continue
		area = locked_area(u.name)
		if area is not None:
			if in_area(area, doc.sub_county):
				out.append(u.name)
		elif not u.get("assigned_region") or not doc.get("region") or u.assigned_region == doc.region:
			out.append(u.name)
	return out


def _officers(doc):
	from surveillance.notifications import _officers as officers, sub_county_users
	return [u.name for u in officers(sub_county_users(doc.sub_county, doc.name))]


def _unclassified(rec):
	"""No disease suggested, or only Unclassified illness: an officer has to choose the suspected disease."""
	key, name = (rec.ai_suggestion or "").lower(), (rec.ai_suggestion_name or "").lower()
	return not key or "unclassified" in key or "unclassified" in name


def _escalate(rec, doc, level, users, deadline_text, told=None, l2_hours=None):
	"""The overdue email, in plain words (KRCS 27 Nov 2026): what the event is, that no officer has checked the AI
	triage (the suggested disease and risk score) in time, and what to do. told: who had the first escalation (L3)."""
	from surveillance.notifications import _button, _in_app, _link, _rows, _send, _suspected
	names = ", ".join(sorted(get_fullname(u) for u in users)) or "nobody: no user has an L%s role for this area" % level
	place = ", ".join(x for x in (doc.get("area"), doc.sub_county) if x) or "an unknown place"
	unclassified = _unclassified(rec)
	what = "Unclassified illness" if unclassified else (_suspected(rec.ai_suggestion_name or doc.disease_name) or doc.title)
	subject = f"Not yet checked by an officer: {what} in {doc.sub_county or 'unknown place'} ({doc.name})"
	if unclassified:
		intro = (f"An event in {escape_html(place)} needs an officer. The system could not suggest a disease for it, and no "
			"officer has checked it in time to choose the suspected disease.")
		ask = "Please make sure an officer opens the event, checks the reports and chooses the suspected disease now."
	else:
		intro = (f"An event in {escape_html(place)} needs an officer. The system suggested a likely disease and a risk score "
			"for it, but no officer has checked the suggestion in time.")
		ask = "Please make sure an officer opens the event and checks the AI triage now."
	if level == 3:
		hours = f"{flt(l2_hours):g} hours ago" if l2_hours else "earlier"
		intro += f" The Public Health Manager was told {hours}; it is now with you."
	else:
		intro += f" It should have been checked by {get_datetime(rec.review_due).strftime('%H:%M') if rec.review_due else 'now'}."
	told_names = ", ".join(sorted(get_fullname(u) for u in (told or []))) if level == 3 else ""
	html = (f"<p>{intro}</p><p><b>{ask}</b></p>"
		+ _rows([("Event", escape_html(doc.name)),
			("Suggested disease", "None yet: an officer should choose one" if unclassified else escape_html(what)),
			("Risk score", f"{rec.risk_score} out of 100 ({escape_html(rec.risk_level or '')})" if rec.risk_score is not None else "—"),
			("Place", escape_html(place)),
			("Waiting since", _fmt(rec.review_from)), ("Should have been checked by", _fmt(rec.review_due)),
			("Already told", escape_html(told_names) if told_names else None)])
		+ _button(_link(doc.name), "Open the event"))
	copy = _officers(doc) if level == 2 else []
	emails = [frappe.db.get_value("User", u, "email") or u for u in set(users) | set(copy)]
	if emails:
		_send(emails, subject, html, doc.name)
		_in_app(list(set(users) | set(copy)), subject, doc.name)
	ev = frappe.get_doc("Surveillance Event", doc.name)
	ev.append("actions", {"at": now_datetime(), "user": "Administrator", "action": f"AI review overdue: escalated to L{level}",
		"note": f"Not reviewed within {deadline_text}. Sent to {names}."})
	ev.save(ignore_permissions=True)
	if level == 2:
		rec.escalation_level, rec.escalated_l2_on = 2, now_datetime()
	else:
		rec.escalation_level, rec.escalated_l3_on = 3, now_datetime()
	rec.save(ignore_permissions=True)


def check_overdue():
	"""Hourly: make sure every open event has its AI output recorded, then escalate the ones past their deadline."""
	cfg = settings()
	if not cfg["escalate_from"]:   # first run: outputs that were already waiting are recorded, not escalated all at once
		frappe.db.set_single_value(SETTINGS, "escalate_from", now_datetime())
		cfg["escalate_from"] = now_datetime()
	since = add_to_date(now_datetime(), days=-60)
	have = set(frappe.get_all(DOCTYPE, pluck="event"))
	for name in frappe.get_all("Surveillance Event", filters={"status": ["in", list(OPEN_STATUSES)], "creation": [">=", since]}, pluck="name"):
		doc = frappe.get_doc("Surveillance Event", name)
		rec = record_output(doc, compute=name not in have or not frappe.db.get_value(DOCTYPE, {"event": name}, "ai_suggestion"))
		if not rec or not cint(cfg["enabled"]) or rec.status != "Awaiting review" or not rec.review_due \
				or get_datetime(rec.review_from) < get_datetime(cfg["escalate_from"]):
			continue
		now = now_datetime()
		due = get_datetime(rec.review_due)
		l1 = cfg["l1_high_hours"] if rec.risk_level in HIGH_LEVELS else cfg["l1_standard_hours"]
		try:
			if now > due and cint(rec.escalation_level) < 2:
				_escalate(rec, doc, 2, _role_users(cfg["l2_roles"], doc), f"{flt(l1):g} hours ({rec.risk_level or 'unknown'} risk)")
			elif now > add_to_date(due, hours=flt(cfg["l2_hours"])) and cint(rec.escalation_level) < 3:
				_escalate(rec, doc, 3, _role_users(cfg["l3_roles"], doc, national=True),
					f"{flt(l1):g} hours plus {flt(cfg['l2_hours']):g} hours at L2",
					told=_role_users(cfg["l2_roles"], doc), l2_hours=cfg["l2_hours"])
		except Exception:  # noqa: BLE001
			frappe.log_error(title=f"AI review escalation failed ({name})", message=frappe.get_traceback())
	frappe.db.commit()


# ---------- settings page ----------

@frappe.whitelist()
def get_settings():
	from surveillance.capabilities import has_capability
	if not (has_capability("settings_ai_config") or has_capability("view_audit_log")):
		frappe.throw(_("You do not have permission to see these settings."), frappe.PermissionError)
	cfg = settings()
	roles = frappe.get_all("Surveillance Role", pluck="name", order_by="name")
	return {**cfg, "roles": roles}


@frappe.whitelist(methods=["POST"])
def save_settings(enabled=1, l1_high_hours=4, l1_standard_hours=24, l2_hours=8, l2_roles=None, l3_roles=None):
	from surveillance.capabilities import require_capability
	require_capability("settings_ai_config")
	for v, label in ((l1_high_hours, "L1 high"), (l1_standard_hours, "L1 standard"), (l2_hours, "L2")):
		if flt(v) <= 0 or flt(v) > 24 * 14:
			frappe.throw(_("{0} deadline must be between 0 and 336 hours.").format(label))
	s = frappe.get_single(SETTINGS)
	if cint(enabled) and not cint(s.enabled):   # switched back on: start from now
		s.escalate_from = now_datetime()
	s.enabled = cint(enabled)
	s.l1_high_hours, s.l1_standard_hours, s.l2_hours = flt(l1_high_hours), flt(l1_standard_hours), flt(l2_hours)
	def as_lines(v):
		v = frappe.parse_json(v) if isinstance(v, str) and v.strip().startswith("[") else v
		return "\n".join(x.strip() for x in (v if isinstance(v, list) else str(v or "").splitlines()) if x and x.strip())
	s.l2_roles, s.l3_roles = as_lines(l2_roles), as_lines(l3_roles)
	if not s.l2_roles or not s.l3_roles:
		frappe.throw(_("Choose at least one role for L2 and for L3."))
	s.save(ignore_permissions=True)
	return get_settings()
