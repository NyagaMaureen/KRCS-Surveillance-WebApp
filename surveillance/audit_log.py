"""One audit trail for the whole system (SRS D.6 R57; Audit Framework V2.0 cl. 21, 26, 32; AUD-01, AUD-08).

Sources, newest first:
  - records created, changed and deleted (Frappe Version and Deleted Document) for signals, users, roles and
    permissions, settings, protocols, case definitions, health units, tasks and referrals, context data, the knowledge
    base, data imports and Epi Trends alerts
  - every action on a Review Queue event (its history: calls, answers, steps, evidence, decisions, escalations,
    closures, splits, notes); the event page no longer shows this, it is here (KRCS 20 Nov 2026)
  - AI: every AI output on an event (component, time, model version, confidence, data inputs) and its review
    (reviewer, action, override reason, late reviews and escalations), AI model predictions, voice note
    transcriptions, voice note symptom suggestions and the knowledge base assistant's answers
  - Epi Trends notes, Monitoring Reports viewed and exported
  - sign-ins (succeeded or failed) and sign-outs, only when asked for (include_logins), as they crowd the list
"""
import json

import frappe
from frappe.utils import add_days, cint, get_datetime, get_fullname, now_datetime

from surveillance.capabilities import require_capability

# doctype -> category. Created / changed / deleted records of these are logged.
TRACKED = {
	"Case Report": "Signal", "Surveillance Event": "Investigation",
	"User": "User", "Surveillance Role": "Permission", "Role Capability": "Permission",
	"Symptom": "Config", "Region": "Config", "Sub County": "Config", "Community Health Unit": "Config",
	"Reporting Facility": "Config", "Response Protocol": "Config", "Case Definition": "Config",
	"Escalation Contact": "Config", "Alert Threshold Config": "Config",
	"Risk Alert": "Alert", "Event Task": "Task",
	"Camp WASH Assessment": "Context data", "Population Bulletin Import": "Context data",
	"Knowledge Document": "Knowledge base", "KB Trusted Source": "Knowledge base",
	"IDSR Upload": "Data import", "Data Quality Dismissal": "Data quality", "User Feedback": "Feedback",
	"Device Key": "Auth",
}
# settings pages (single records): only changes
SETTINGS = {"Alert Threshold Settings": "Config", "Risk Score Settings": "AI", "AI Review Settings": "AI",
	"Reporter Advice Settings": "Config", "WhatsApp Settings": "Config", "System Settings": "Security"}
# created by the system or people in bulk: changes and deletions only, the create is covered elsewhere
NO_CREATE = {"Case Report", "Surveillance Event", "Role Capability"}
CREATED_LABEL = {"Risk Alert": "Alert raised", "Event Task": "Task created", "Surveillance Event": "Event created"}
TITLE_FIELDS = {"Symptom": "symptom_name", "Region": "region_name", "User": "full_name", "Response Protocol": "title",
	"Escalation Contact": "contact_name", "Risk Alert": "disease_name", "Sub County": "sub_county_name",
	"Event Task": "title", "Knowledge Document": "title", "Community Health Unit": "health_unit_name",
	"Reporting Facility": "facility_name", "Surveillance Event": "title"}
LINKS = {"Case Report": "/reports/{}", "Surveillance Event": "/alerts-signals/{}", "Risk Alert": "/epi-trends/{}"}
SECRET_TYPES = {"Password"}


def _short(value, n=200):
	text = "" if value is None else str(value)
	return text if len(text) <= n else text[:n] + "…"


class _Ctx:
	def __init__(self):
		self.roles, self.names, self.labels, self.titles, self.secret = {}, {}, {}, {}, {}

	def role(self, user):
		if user not in self.roles:
			self.roles[user] = frappe.db.get_value("User", user, "primary_role") or (
				"System" if user in ("Administrator", "Guest", None, "", "System") else "—")
		return self.roles[user]

	def name(self, user):
		if not user:
			return "System"
		if user not in self.names:
			self.names[user] = "System" if user == "System" else "Administrator" if user == "Administrator" else (get_fullname(user) or user)
		return self.names[user]

	def label(self, doctype, field):
		self._meta(doctype)
		return self.labels[doctype].get(field) or field

	def is_secret(self, doctype, field):
		self._meta(doctype)
		return field in self.secret[doctype]

	def _meta(self, doctype):
		if doctype not in self.labels:
			try:
				meta = frappe.get_meta(doctype)
				self.labels[doctype] = {df.fieldname: df.label for df in meta.fields}
				self.secret[doctype] = {df.fieldname for df in meta.fields if df.fieldtype in SECRET_TYPES
					or "token" in df.fieldname or "secret" in df.fieldname or "password" in df.fieldname}
			except Exception:  # noqa: BLE001 - a doctype removed since
				self.labels[doctype], self.secret[doctype] = {}, set()

	def title(self, doctype, name, value=None):
		field = TITLE_FIELDS.get(doctype)
		if not field:
			return name
		key = (doctype, name)
		if key not in self.titles:
			try:
				self.titles[key] = value if value is not None else frappe.db.get_value(doctype, name, field)
			except Exception:  # noqa: BLE001
				self.titles[key] = None
		t = self.titles[key]
		return f"{t} ({name})" if t and doctype in ("Risk Alert", "Event Task", "Surveillance Event") else (t or name)


def _entry(c, name, at, category, action, user, details, link=None, changes=None, record=None, outcome=None):
	return {"name": name, "timestamp": at, "category": category, "action": action, "user": user or "System",
		"userName": c.name(user), "role": c.role(user), "details": details, "link": link, "changes": changes or None,
		"record": record or None, "outcome": outcome}


def _cap_name(key):
	from surveillance.capabilities import CAPABILITIES
	for cap in CAPABILITIES:
		if cap.get("key") == key:
			return cap.get("name") or key
	return key


@frappe.whitelist()
def get_audit_logs(limit=1000, days=None, include_logins=0):
	require_capability("view_audit_log")
	limit = min(cint(limit) or 1000, 5000)
	since = add_days(now_datetime(), -cint(days)) if days else None
	c = _Ctx()
	out = []
	sf = lambda f="creation": {f: [">=", since]} if since else {}
	exists = lambda dt: frappe.db.exists("DocType", dt) and frappe.db.table_exists(dt)

	# --- created records ---
	for doctype, category in TRACKED.items():
		if doctype in NO_CREATE or not exists(doctype):
			continue
		field = TITLE_FIELDS.get(doctype)
		fields = ["name", "owner", "creation"] + ([field] if field else [])
		for r in frappe.get_all(doctype, filters=sf(), fields=fields, order_by="creation desc", limit_page_length=limit):
			label = c.title(doctype, r.name, r.get(field) if field else None)
			out.append(_entry(c, f"create-{doctype}-{r.name}", r.creation, category, CREATED_LABEL.get(doctype, "Created"),
				r.owner, f"{doctype} {label}", (LINKS.get(doctype) or "").format(r.name) or None))

	# permissions given (Roles & Permissions): one line per box ticked
	if exists("Role Capability"):
		for r in frappe.get_all("Role Capability", filters=sf(), fields=["name", "owner", "creation", "role", "capability"],
				order_by="creation desc", limit_page_length=limit):
			out.append(_entry(c, f"perm-{r.name}", r.creation, "Permission", "Permission given", r.owner,
				f"{r.role}: {_cap_name(r.capability)}"))

	# --- Signals Captured updates: one entry per update, every field from -> to (KRCS 17 Nov 2026) ---
	edited = []
	if exists("Case Report Change"):
		cond = "and c.`at` >= %(since)s" if since else ""
		rows = frappe.db.sql(f"""select c.parent, c.`at`, c.`user`, c.field_label, c.old_value, c.new_value
			from `tabCase Report Change` c where c.parenttype = 'Case Report' {cond}
			order by c.`at` desc, c.idx asc limit %(limit)s""", {"since": since, "limit": limit * 5}, as_dict=True)
		grouped = {}
		for r in rows:
			grouped.setdefault((r.parent, r.at, r.user), []).append({"field": r.field_label, "from": _short(r.old_value), "to": _short(r.new_value)})
		for (parent, at, user), changes in grouped.items():
			edited.append((parent, user or "Administrator", get_datetime(at)))
			names = list(dict.fromkeys(x["field"] for x in changes))
			out.append(_entry(c, f"edit-{parent}-{at}", at, "Signal", "Signal updated", user,
				f"Updated {', '.join(names[:3])}{f' and {len(names) - 3} more' if len(names) > 3 else ''} on {parent}",
				f"/reports/{parent}", changes))

	def same_edit(v):   # the Version Frappe saves for the same update: shown once, from the entry above
		if v.ref_doctype != "Case Report":
			return False
		when = get_datetime(v.creation)
		return any(p == v.docname and u == v.owner and abs((when - at).total_seconds()) < 30 for p, u, at in edited)

	# --- changes (Version) ---
	watched = {**TRACKED, **SETTINGS}
	for v in frappe.get_all("Version", filters={"ref_doctype": ["in", list(watched)], **sf()},
			fields=["name", "ref_doctype", "docname", "owner", "creation", "data"], order_by="creation desc", limit_page_length=limit):
		if same_edit(v):
			continue
		try:
			data = json.loads(v.data) if v.data else {}
		except Exception:  # noqa: BLE001
			data = {}
		changes = [{"field": c.label(v.ref_doctype, x[0]),
			"from": "(hidden)" if c.is_secret(v.ref_doctype, x[0]) else _short(x[1]),
			"to": "(hidden)" if c.is_secret(v.ref_doctype, x[0]) else _short(x[2])}
			for x in data.get("changed", []) if x and x[0] not in ("modified", "modified_by")]
		for key, verb in (("added", "Added"), ("removed", "Removed")):
			for row in data.get(key, []) or []:
				table = c.label(v.ref_doctype, row[0]) if row else ""
				changes.append({"field": f"{table} ({verb.lower()})", "from": "" if verb == "Added" else "row", "to": "row" if verb == "Added" else ""})
		if not changes:
			continue
		category = watched[v.ref_doctype]
		label = v.ref_doctype if v.ref_doctype in SETTINGS else f"{v.ref_doctype} {c.title(v.ref_doctype, v.docname)}"
		names = list(dict.fromkeys(x["field"] for x in changes))
		status = next((x for x in changes if x["field"] == "Status"), None)
		action = f"Status: {status['from']} → {status['to']}" if status and len(changes) == 1 else ("Settings changed" if v.ref_doctype in SETTINGS else "Updated")
		out.append(_entry(c, v.name, v.creation, category, action, v.owner,
			f"Changed {', '.join(names[:3])}{f' and {len(names) - 3} more' if len(names) > 3 else ''} on {label}",
			(LINKS.get(v.ref_doctype) or "").format(v.docname) or None, changes))

	# --- deletions ---
	if exists("Deleted Document"):
		for d in frappe.get_all("Deleted Document", filters={"deleted_doctype": ["in", list(TRACKED)], **sf()},
				fields=["name", "deleted_doctype", "deleted_name", "owner", "creation", "data"], order_by="creation desc", limit_page_length=limit):
			try:
				data = json.loads(d.data) if d.data else {}
			except Exception:  # noqa: BLE001
				data = {}
			if d.deleted_doctype == "Role Capability":
				out.append(_entry(c, f"del-{d.name}", d.creation, "Permission", "Permission removed", d.owner,
					f"{data.get('role', '')}: {_cap_name(data.get('capability', ''))}"))
				continue
			field = TITLE_FIELDS.get(d.deleted_doctype)
			title = data.get(field) if field else None
			out.append(_entry(c, f"del-{d.name}", d.creation, TRACKED[d.deleted_doctype], "Deleted", d.owner,
				f"Deleted {d.deleted_doctype} {f'{title} ({d.deleted_name})' if title else d.deleted_name}"))

	# --- every action on a Review Queue event ---
	if exists("Surveillance Event Action"):
		cond = "and a.`at` >= %(since)s" if since else ""
		for a in frappe.db.sql(f"""select a.name, a.parent, a.`at`, a.`user`, a.action, a.note, e.title
				from `tabSurveillance Event Action` a left join `tabSurveillance Event` e on e.name = a.parent
				where a.parenttype = 'Surveillance Event' {cond} order by a.`at` desc limit %(limit)s""",
				{"since": since, "limit": limit}, as_dict=True):
			act = a.action or "Updated"
			out.append(_entry(c, f"event-{a.name}", a.at, "AI" if act.startswith("AI ") else "Investigation", act,
				"System" if act.startswith("AI review overdue") else a.user,
				f"{a.parent}" + (f" · {a.title}" if a.title else "") + (f": {_short(a.note, 300)}" if a.note else ""),
				f"/alerts-signals/{a.parent}"))

	_ai(c, out, since, limit, exists)

	# --- Epi Trends notes ---
	if exists("Risk Alert Note"):
		cond = "and n.created_at >= %(since)s" if since else ""
		for n in frappe.db.sql(f"""select n.name, n.parent, n.created_at, n.added_by, n.note, r.disease_name, r.sub_county
				from `tabRisk Alert Note` n left join `tabRisk Alert` r on r.name = n.parent
				where n.parenttype = 'Risk Alert' {cond} order by n.created_at desc limit %(limit)s""",
				{"since": since, "limit": limit}, as_dict=True):
			text = n.note or ""
			action = ("Investigation opened" if text.startswith("Investigation opened") else "Reviewed" if text.startswith("Reviewed")
				else "Reopened" if text.startswith("Reopened") else "Status changed" if text.startswith("Status ") else "Note")
			out.append(_entry(c, f"alertnote-{n.name}", n.created_at, "Alert", action, n.added_by,
				f"{n.parent} · {n.disease_name or ''}{', ' + n.sub_county if n.sub_county else ''}: {_short(text)}", f"/epi-trends/{n.parent}"))

	# --- exports from every page, and Monitoring Reports viewed and exported (SRS R46), with their filters ---
	if exists("Report Run Log"):
		for g in frappe.get_all("Report Run Log", filters=sf("at"), fields=["name", "report", "report_title", "action", "format",
				"filters", "scope", "rows", "user", "at"], order_by="at desc", limit_page_length=limit):
			page = (g.report or "").startswith("/")
			flt = g.filters if g.filters and not g.filters.startswith("{") else (g.scope or "")
			exported = g.action == "Exported"
			fmt = "Download" if g.format == "FILE" else g.format
			record = [{"label": k, "value": v} for k, v in (("Page", g.report_title or g.report),
				("Format", fmt), ("Filters", flt or "None: everything shown"), ("Rows", str(g.rows or 0)))]
			out.append(_entry(c, f"report-{g.name}", g.at, "Export" if exported else "Monitoring report",
				(f"Exported ({fmt})" if exported else "Report viewed"), g.user,
				f"{g.report_title or g.report} · Filters: {flt or 'none'}" + (f" · {g.rows} rows" if g.rows else ""),
				g.report if page and not g.report.startswith("/knowledge-base/") else ("/knowledge-base" if page else f"/monitoring-reports?report={g.report}"),
				record=record if exported else None))

	# --- sign-ins and sign-outs (only when asked for) ---
	if cint(include_logins):
		for l in frappe.get_all("Activity Log", filters={"operation": ["in", ["Login", "Logout"]], **sf()},
				fields=["name", "user", "operation", "creation", "status", "subject", "ip_address"], order_by="creation desc", limit_page_length=limit):
			ok = (l.status or "Success") == "Success"
			action = "Sign-out" if l.operation == "Logout" else "Sign-in succeeded" if ok else "Sign-in failed"
			why = "" if ok or not l.subject else f": {_short(l.subject, 120)}"
			out.append(_entry(c, l.name, l.creation, "Auth", action, l.user,
				f"{action}{why}" + (f" · from {l.ip_address}" if l.ip_address else ""), outcome="Success" if ok else "Failed"))

	out = [r for r in out if r["timestamp"]]
	out.sort(key=lambda r: get_datetime(r["timestamp"]), reverse=True)
	return out[:limit]


def _dt(v):
	return get_datetime(v).strftime("%d %b %Y, %H:%M") if v else None


def _pct(v):
	return f"{round(float(v) * 100 if float(v) <= 1 else float(v), 1):g}%" if v not in (None, "") else "—"


def _ai(c, out, since, limit, exists):
	"""AI outputs and what people did with them (AUD-01)."""
	sf = lambda f: {f: [">=", since]} if since else {}

	# the AI output on each Review Queue event, then its review
	if exists("AI Output Review"):
		for r in frappe.get_all("AI Output Review", filters=sf("creation"), fields=["*"], order_by="creation desc", limit_page_length=limit):
			record = [("AI component", r.component), ("Output time", _dt(r.output_on)),
				("Model version", r.model_version or "Case definitions only (no model output)"),
				("Top suggestion", f"{r.ai_suggestion_name or '—'}" + (f" ({r.ai_basis})" if r.ai_basis else "")),
				("Model confidence", _pct(r.ai_confidence / 100) if r.ai_confidence else "—"),
				("Suggestions shown, in order", r.suggestions or "—"),
				("Risk score", f"{r.risk_score} ({r.risk_level})" if r.risk_score is not None else "—"),
				("Data inputs", r.inputs or "—"),
				("Ready for review from", _dt(r.review_from) or "Waiting for the CHA's verification"),
				("Review due", _dt(r.review_due) or "—"),
				("Status", r.status),
				("Escalated", ", ".join(x for x in (f"L2 on {_dt(r.escalated_l2_on)}" if r.escalated_l2_on else "",
					f"L3 on {_dt(r.escalated_l3_on)}" if r.escalated_l3_on else "") if x) or "No"),
				("Reviewer", c.name(r.reviewed_by) if r.reviewed_by else "—"),
				("Reviewed on", _dt(r.reviewed_on) or "—"),
				("Reviewer action", r.review_action or "—"),
				("Disease chosen", r.chosen_disease or "—"),
				("Override reason", r.override_reason or "—")]
			record = [{"label": k, "value": v} for k, v in record]
			base = f"{r.event} · {r.ai_suggestion_name or 'no suggestion yet'}" + (f" · risk {r.risk_score} {r.risk_level}" if r.risk_score is not None else "")
			out.append(_entry(c, f"aiout-{r.name}", r.output_on or r.creation, "AI", "AI output", "System",
				base, f"/alerts-signals/{r.event}", record=record))
			if r.reviewed_on:
				action = ("Closed without review" if r.status == "Closed without review"
					else "AI suggestion overridden" if r.override_reason else "AI output reviewed late" if r.status == "Reviewed late"
					else "AI output reviewed")
				out.append(_entry(c, f"aireview-{r.name}", r.reviewed_on, "AI", action, r.reviewed_by,
					f"{r.event} · {r.review_action or ''}" + (f" · chose {r.chosen_disease}" if r.chosen_disease else "")
					+ (f" · reason: {_short(r.override_reason)}" if r.override_reason else ""), f"/alerts-signals/{r.event}", record=record))

	# AI model predictions for single reports (the disease model on the AI server)
	if exists("AI Prediction"):
		for p in frappe.get_all("AI Prediction", filters={"kind": "Model", "case_report": ["is", "set"], "top_group": ["is", "set"], **sf("predicted_on")}, fields=["name", "case_report",
				"predicted_on", "model_version", "age_group", "top_group", "top_probability", "predicted_disease", "top3_diseases"],
				order_by="predicted_on desc", limit_page_length=limit):
			record = [{"label": k, "value": v} for k, v in (("AI component", "Disease model (AI server)"), ("Time", _dt(p.predicted_on)),
				("Model version", p.model_version or "—"), ("Data inputs", f"Symptoms and age group ({p.age_group or '—'}) of {p.case_report}"),
				("Top result", f"{p.top_group} → {p.predicted_disease or 'not a Review Queue disease'}"),
				("Confidence", _pct(p.top_probability)), ("Top 3", p.top3_diseases or "—"),
				("Reviewer and action", "Reviewed with the event's AI triage (see its AI output entry)"))]
			out.append(_entry(c, f"aipred-{p.name}", p.predicted_on, "AI", "AI model prediction", "System",
				f"{p.case_report} · {p.top_group} {_pct(p.top_probability)} · model {p.model_version or '—'}",
				f"/reports/{p.case_report}", record=record))

	# voice notes to text (speech-to-text on the AI server)
	if exists("Case Report Attachment"):
		cond = "and a.transcribed_on >= %(since)s" if since else ""
		for a in frappe.db.sql(f"""select a.name, a.parent, a.transcribed_on, a.transcript_status, a.transcript_language,
				a.spoken_language from `tabCase Report Attachment` a where a.parenttype = 'Case Report'
				and a.transcribed_on is not null {cond} order by a.transcribed_on desc limit %(limit)s""",
				{"since": since, "limit": limit}, as_dict=True):
			record = [{"label": k, "value": v} for k, v in (("AI component", "Speech to text (Whisper, AI server)"),
				("Time", _dt(a.transcribed_on)), ("Data inputs", f"Voice note on {a.parent} (language given: {a.spoken_language or 'not given'})"),
				("Result", a.transcript_status), ("Language detected", a.transcript_language or "—"),
				("Reviewer and action", "Officers read the text next to the original audio; nothing is decided from it alone"))]
			out.append(_entry(c, f"stt-{a.name}", a.transcribed_on, "AI", f"Voice note transcribed ({a.transcript_status})", "System",
				f"{a.parent} · {a.transcript_status}" + (f" · {a.transcript_language}" if a.transcript_language else ""),
				f"/reports/{a.parent}", record=record))

	# symptoms suggested from voice notes, and what the reviewer kept
	if exists("Voice Extraction Review"):
		for v in frappe.get_all("Voice Extraction Review", filters=sf("reviewed_on"), fields=["name", "case_report", "reviewed_by",
				"reviewed_on", "offered", "accepted", "offered_items", "accepted_items"], order_by="reviewed_on desc", limit_page_length=limit):
			rejected = cint(v.offered) - cint(v.accepted)
			record = [{"label": k, "value": v_} for k, v_ in (("AI component", "Symptoms from the voice note transcript"),
				("Data inputs", f"Voice note transcript on {v.case_report}"), ("Suggested", v.offered_items or str(v.offered)),
				("Reviewer", c.name(v.reviewed_by)), ("Reviewed on", _dt(v.reviewed_on)), ("Kept", v.accepted_items or str(v.accepted)),
				("Not kept", str(max(rejected, 0))))]
			out.append(_entry(c, f"vx-{v.name}", v.reviewed_on, "AI", "Voice symptom suggestions reviewed", v.reviewed_by,
				f"{v.case_report} · kept {cint(v.accepted)} of {cint(v.offered)}", f"/reports/{v.case_report}", record=record))

	# knowledge base assistant answers
	if exists("Chatbot Query Log"):
		for q in frappe.get_all("Chatbot Query Log", filters=sf("creation"), fields=["name", "creation", "user", "user_ref",
				"channel", "outcome", "answer_mode", "match_confidence", "confidence_band", "matched_document", "query_text",
				"escalated_to_human", "escalation_status", "handled_by", "response_note", "retrieval_config"],
				order_by="creation desc", limit_page_length=limit):
			record = [{"label": k, "value": v} for k, v in (("AI component", "Knowledge base assistant"), ("Time", _dt(q.creation)),
				("Model / settings", _short(q.retrieval_config, 200) or "—"), ("Data inputs", _short(q.query_text, 300) or "—"),
				("Outcome", q.outcome or "—"), ("Confidence", f"{_pct(q.match_confidence)} ({q.confidence_band or '—'})"),
				("Source document", q.matched_document or "—"),
				("Sent to a person", f"Yes · {q.escalation_status or ''}" if cint(q.escalated_to_human) else "No"),
				("Reviewer", c.name(q.handled_by) if q.handled_by else "—"), ("Reviewer note", q.response_note or "—"))]
			out.append(_entry(c, f"kb-{q.name}", q.creation, "AI", f"Knowledge base answer ({q.outcome or 'answered'})",
				q.user or "Guest", f"{q.channel or ''} · {q.confidence_band or ''} · {_short(q.query_text, 80)}",
				"/chatbot-query-log", record=record))
