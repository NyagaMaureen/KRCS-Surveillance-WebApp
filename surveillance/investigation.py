"""Investigation workflow for one Surveillance Event (Alerts & Signals).

Steps shown to the officer:
  1 Signal captured      reports grouped into the event (events.py)
  2 AI triage            suspected disease and reason (case definitions)
  3 Verification         Yes / No / Not sure questions from the disease's approved protocol
  4 Field investigation  protocol steps with phase "Investigation": Done / Not done / Not applicable,
                         field findings, photos, voice notes, files
  5 Decision             confirm, discard or escalate, with a reason (human sign-off)
  6 Response and close   protocol steps with phase "Response", closing summary, feedback to field reporters

Statuses: New -> Verifying -> Investigating -> Verified / Escalated -> Closed   (Discarded at any open step)

The verification suggestion is rule-based and shows its reasons; it never decides. The officer decides.
Every answer, step outcome, upload and decision is written to the event timeline.
"""
import frappe
from frappe import _
from frappe.utils import cint, get_fullname, now_datetime

from surveillance.capabilities import require_capability

ANSWERS = ("Yes", "No", "Not sure")
OUTCOMES = ("Done", "Not done", "Not applicable")
KINDS = ("Case definition", "Supports", "Red flag")
EVIDENCE_TYPES = ("Photo", "Voice Note", "Text Note", "Attachment")

# Asked for every disease unless the protocol has its own list.
# "Was the reporter reached?" and "Does it meet the case definition?" are checked on EACH report (check_report);
# the event's case-definition question is then answered from those checks.
COMMON_QUESTIONS = [
	("Are there 2 or more cases linked by place or time (same block, household, water point or gathering)?",
		"Clustering makes an outbreak more likely", "Supports"),
	("Are there any deaths, or severe cases needing referral?",
		"Deaths and severe cases need immediate escalation", "Red flag"),
	("Has the nearest health facility seen similar cases in the last 7 days?",
		"Community and facility signals together are stronger", "Supports"),
]


def case_definition_question(summary, disease_name):
	if summary:
		return (f"After speaking to the reporter or seeing the case, does it meet the case definition? {summary.strip()}",
			"Confirms the AI triage against the real case, not just what was written in the report", "Case definition")
	return (f"After speaking to the reporter or seeing the case, does it match the signs of {disease_name or 'the reported disease'}?",
		"Confirms the AI triage against the real case, not just what was written in the report", "Case definition")


def default_questions(proto, disease_name=None):
	"""Questions for a protocol with none of its own: case definition first, then the common set."""
	return [case_definition_question(proto.summary if proto else None, disease_name)] + COMMON_QUESTIONS


# ---------- setting up an event ----------

def _protocol(doc):
	from surveillance.protocols import approved_for
	if doc.protocol and frappe.db.exists("Response Protocol", doc.protocol):
		return frappe.get_doc("Response Protocol", doc.protocol)
	return approved_for(doc.disease)


def ensure_investigation(doc):
	"""Copy questions and steps from the approved protocol onto the event once, and answer the case-definition
	question from the report checks. Returns True if changed."""
	from surveillance.protocols import _ensure_checklist
	changed = _ensure_checklist(doc)
	if not doc.get("verification"):
		proto = _protocol(doc)
		rows = ([(q.question, q.why, q.kind) for q in proto.verification_questions]
			if proto and proto.get("verification_questions") else default_questions(proto, doc.disease_name))
		for i, (q, why, kind) in enumerate(rows, 1):
			doc.append("verification", {"question_no": i, "question": q, "why": why, "kind": kind or "Supports"})
		changed = True
	return sync_case_definition(doc) or changed


# ---------- per-report checks ----------

REPORT_FIELDS = ["name", "source", "ref", "check_reached", "check_case_definition", "check_status", "checked_by", "checked_on"]


def report_status(reached, meets):
	if meets == "No":
		return "Not a case"
	if reached == "Yes" and meets == "Yes":
		return "Verified"
	if reached or meets:
		return "Unconfirmed"
	return "Not checked"


def sync_case_definition(doc):
	"""Answer the event's case-definition question from its reports:
	Yes if any report is Verified, No if every checked report is Not a case, Not sure otherwise."""
	row = next((a for a in (doc.get("verification") or []) if a.kind == "Case definition"), None)
	if not row:
		return False
	checks = frappe.get_all("Surveillance Signal", filters={"event": doc.name}, fields=["check_status", "checked_by", "checked_on"],
		order_by="checked_on desc")
	done = [c for c in checks if c.check_status and c.check_status != "Not checked"]
	if any(c.check_status == "Verified" for c in done):
		answer = "Yes"
	elif done and all(c.check_status == "Not a case" for c in done):
		answer = "No"
	elif done:
		answer = "Not sure"
	else:
		answer = None
	if row.answer == answer:
		return False
	row.answer = answer
	row.answered_by = done[0].checked_by if done else None
	row.answered_on = done[0].checked_on if done else None
	return True


def _log(doc, action, note=""):
	doc.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": action, "note": note})


# ---------- rule-based suggestion ----------

def suggestion(answers, notify_immediately=False, disease_name=""):
	"""answers: list of dicts {question, kind, answer}. Returns {action, level, text, reasons}.

	action: escalate | discard | investigate | gather | monitor | none
	"""
	answered = [a for a in answers if a.get("answer")]
	if not answered:
		return {"action": "none", "level": "info", "text": "Answer the questions to get a suggestion.", "reasons": []}

	def short(a):
		return (a["question"].split("?")[0] + "?") if "?" in a["question"] else a["question"]

	reasons = [f"{short(a)} {a['answer']}" for a in answered]
	case_def = [a for a in answers if a.get("kind") == "Case definition"]
	cd = case_def[0].get("answer") if case_def else None
	red = [a for a in answers if a.get("kind") == "Red flag" and a.get("answer") == "Yes"]
	supports = [a for a in answers if a.get("kind") == "Supports"]
	yes = sum(1 for a in supports if a.get("answer") == "Yes")
	unsure = sum(1 for a in answers if a.get("answer") in (None, "", "Not sure"))

	if red:
		return {"action": "escalate", "level": "critical",
			"text": f"Red flag answered Yes ({short(red[0])}). Escalate to the county now, then continue the investigation.",
			"reasons": reasons}
	if cd == "Yes" and notify_immediately:
		return {"action": "escalate", "level": "critical",
			"text": f"One case of {disease_name or 'this disease'} meeting the case definition is an emergency. Escalate now.",
			"reasons": reasons}
	if cd == "No":
		return {"action": "discard", "level": "low",
			"text": "The cases do not meet the case definition. Discard, or change the suspected disease on the reports if another disease fits.",
			"reasons": reasons}
	if unsure * 2 > len(answers):
		return {"action": "gather", "level": "medium",
			"text": "Not enough information yet. Call the reporter or the facility before deciding.",
			"reasons": reasons}
	if cd == "Yes":
		return {"action": "investigate", "level": "high",
			"text": f"At least one report is a verified case of a priority disease ({yes} of {len(supports)} other checks support it). "
				"Start the field investigation.", "reasons": reasons}
	if supports and yes * 2 >= len(supports):
		return {"action": "investigate", "level": "high",
			"text": f"{yes} of {len(supports)} supporting checks point to a real event. Start the field investigation.",
			"reasons": reasons}
	return {"action": "monitor", "level": "medium",
		"text": "Weak signal. Investigate if the team has capacity, otherwise monitor for more reports.",
		"reasons": reasons}


# ---------- gates (enforced in events.set_status) ----------

def _steps(doc, phase):
	return [s for s in (doc.get("checklist") or []) if (s.phase or "Investigation") == phase]


def _outcome(s):
	return s.outcome or ("Done" if s.done else "")


def gates(doc):
	unanswered = [a.question_no for a in (doc.get("verification") or []) if not a.answer]
	inv_open = [s.step_no for s in _steps(doc, "Investigation") if not _outcome(s)]
	resp_open = [s.step_no for s in _steps(doc, "Response") if not _outcome(s)]
	return {
		"unansweredQuestions": unanswered,
		"openInvestigationSteps": inv_open,
		"openResponseSteps": resp_open,
		"canStartInvestigation": doc.status == "Verifying" and not unanswered,
		"canConfirm": doc.status == "Investigating" and not inv_open,
		"canClose": doc.status in ("Verified", "Escalated") and not resp_open,
	}


def check_gate(doc, action):
	"""Throw a clear message if an action is not allowed yet."""
	ensure_investigation(doc)
	g = gates(doc)
	if action == "investigate" and g["unansweredQuestions"]:
		frappe.throw(_("Check at least one report and answer all verification questions first (Not sure is an answer). Missing: {0}").format(
			", ".join(str(n) for n in g["unansweredQuestions"])))
	if action == "confirm" and g["openInvestigationSteps"]:
		frappe.throw(_("Record an outcome for every investigation step first. Missing steps: {0}").format(
			", ".join(str(n) for n in g["openInvestigationSteps"])))
	if action == "close" and g["openResponseSteps"]:
		frappe.throw(_("Record an outcome for every response step first. Missing steps: {0}").format(
			", ".join(str(n) for n in g["openResponseSteps"])))


def after_status(doc, action, note):
	"""Record the decision or closure on the event, sync the field reports, tell their reporters."""
	now, user = now_datetime(), frappe.session.user
	if action in ("confirm", "discard", "escalate"):
		doc.decision = {"confirm": "Confirmed", "discard": "Discarded", "escalate": "Escalated"}[action]
		doc.decision_reason, doc.decided_by, doc.decided_on = note, user, now
	if action == "close":
		doc.closing_summary, doc.closed_by, doc.closed_on = note, user, now
	if action == "reopen":
		doc.decision = doc.decision_reason = doc.decided_by = doc.decided_on = None
		doc.closing_summary = doc.closed_by = doc.closed_on = None


REPORT_STATUS = {"Verifying": "Investigating", "Investigating": "Investigating", "Verified": "Investigating",
	"Escalated": "Investigating", "Closed": "Closed", "Discarded": "Closed", "New": "Submitted"}


def sync_reports(doc, action, note):
	"""Keep the field Case Reports in step with the event and send in-app feedback to their reporters.
	CBS reporters cannot be contacted: we do not store their phone numbers."""
	refs = frappe.get_all("Surveillance Signal", filters={"event": doc.name, "source": "Field"}, pluck="ref")
	status = REPORT_STATUS.get(doc.status)
	for ref in refs:
		if not frappe.db.exists("Case Report", ref):
			continue
		if status:
			frappe.db.set_value("Case Report", ref, "status", status, update_modified=False)
		if action in ("close", "discard"):
			_feedback(ref, doc, action, note)


def _feedback(ref, doc, action, note):
	reporter = frappe.db.get_value("Case Report", ref, "reported_by") or frappe.db.get_value("Case Report", ref, "owner")
	if not reporter or reporter in ("Administrator", "Guest") or not frappe.db.exists("User", reporter):
		return
	outcome = ("was checked and closed: no further action needed" if action == "discard"
		else "was investigated and the response is complete")
	subject = f"Your report {ref} ({doc.disease_name or doc.disease}) {outcome}. Thank you for reporting."
	frappe.get_doc({"doctype": "Notification Log", "for_user": reporter, "type": "Alert",
		"document_type": "Case Report", "document_name": ref, "subject": subject}).insert(ignore_permissions=True)
	# officer notes are not sent: they may hold details the reporter should not receive by email


# ---------- API ----------

def _load(event, act=False):
	from surveillance.events import _check_access, ACT, VIEW
	require_capability(ACT if act else VIEW)
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	return doc


def _shape(doc):
	from surveillance.capabilities import has_capability
	from surveillance.events import ACT
	from surveillance.protocols import _shape as protocol_shape
	proto = frappe.get_doc("Response Protocol", doc.protocol) if doc.protocol and frappe.db.exists("Response Protocol", doc.protocol) else None
	questions = [{"n": a.question_no, "question": a.question, "why": a.why, "kind": a.kind, "answer": a.answer or None,
		"answeredBy": get_fullname(a.answered_by) if a.answered_by else None, "answeredOn": str(a.answered_on or "") or None}
		for a in sorted(doc.get("verification") or [], key=lambda a: cint(a.question_no))]

	def step(s):
		return {"n": s.step_no, "step": s.step, "timeframe": s.timeframe, "phase": s.phase or "Investigation",
			"outcome": _outcome(s) or None, "reason": s.reason or None,
			"by": get_fullname(s.done_by) if s.done_by else None, "on": str(s.done_on or "") or None}

	steps = [step(s) for s in sorted(doc.get("checklist") or [], key=lambda s: cint(s.step_no))]
	return {
		"event": doc.name, "status": doc.status,
		"protocol": protocol_shape(proto, steps=False) if proto else None,
		"notifyImmediately": bool(proto and proto.get("notify_immediately")),
		"questions": questions,
		"suggestion": suggestion(questions, bool(proto and proto.get("notify_immediately")), doc.disease_name),
		"investigationSteps": [s for s in steps if s["phase"] == "Investigation"],
		"responseSteps": [s for s in steps if s["phase"] == "Response"],
		"findings": doc.findings or "",
		"evidence": [{"id": e.name, "type": e.attachment_type, "file": e.file, "text": e.text_content,
			"by": get_fullname(e.added_by) if e.added_by else None, "on": str(e.added_on or "")}
			for e in (doc.get("evidence") or [])],
		"decision": ({"decision": doc.decision, "reason": doc.decision_reason, "by": get_fullname(doc.decided_by),
			"on": str(doc.decided_on or "")} if doc.decision else None),
		"closure": ({"summary": doc.closing_summary, "by": get_fullname(doc.closed_by), "on": str(doc.closed_on or "")}
			if doc.closed_on else None),
		"gates": gates(doc),
		"canAct": has_capability(ACT),
	}


@frappe.whitelist()
def get_investigation(event):
	"""Everything the investigation steps need (copies questions and steps from the protocol on first view)."""
	doc = _load(event)
	if ensure_investigation(doc):
		doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def answer_question(event, question_no, answer):
	doc = _load(event, act=True)
	if doc.status not in ("New", "Verifying", "Investigating"):
		frappe.throw(_("Verification answers can only change while the event is open for verification."))
	if answer not in ANSWERS:
		frappe.throw(_("Answer must be Yes, No or Not sure."))
	ensure_investigation(doc)
	row = next((a for a in doc.verification if cint(a.question_no) == cint(question_no)), None)
	if not row:
		frappe.throw(_("Question not found."))
	if row.kind == "Case definition":
		frappe.throw(_("This question is answered from the report checks. Check each report instead."))
	if row.answer == answer:
		return _shape(doc)
	row.answer, row.answered_by, row.answered_on = answer, frappe.session.user, now_datetime()
	if doc.status == "New":
		doc.status = "Verifying"
		_log(doc, "Verification started")
	_log(doc, "Verification answer", f"{row.question.split('?')[0]}? {answer}")
	doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def set_step_outcome(event, step_no, outcome=None, reason=None):
	"""Record Done / Not done / Not applicable on one protocol step. Not done needs a reason. Empty outcome clears it."""
	doc = _load(event, act=True)
	if doc.status in ("Discarded", "Closed"):
		frappe.throw(_("Reopen the event to change its steps."))
	ensure_investigation(doc)
	row = next((s for s in doc.checklist if cint(s.step_no) == cint(step_no)), None)
	if not row:
		frappe.throw(_("Step not found."))
	outcome = outcome or None
	reason = (reason or "").strip()
	if outcome and outcome not in OUTCOMES:
		frappe.throw(_("Outcome must be Done, Not done or Not applicable."))
	if outcome == "Not done" and not reason:
		frappe.throw(_("Say why this step was not done."))
	if (row.phase or "Investigation") == "Investigation" and doc.status not in ("Investigating", "Verified", "Escalated"):
		frappe.throw(_("Start the field investigation first."))
	if (row.phase or "Investigation") == "Response" and doc.status not in ("Verified", "Escalated"):
		frappe.throw(_("Response steps open after the decision (confirm or escalate)."))
	row.outcome, row.reason = outcome, (reason if outcome in ("Not done", "Not applicable") else None)
	row.done = 1 if outcome == "Done" else 0
	row.done_by = frappe.session.user if outcome else None
	row.done_on = now_datetime() if outcome else None
	_log(doc, f"Step {outcome.lower()}" if outcome else "Step reopened",
		f"{row.step_no}. {row.step}" + (f" ({reason})" if reason and outcome != "Done" else ""))
	doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def save_findings(event, findings):
	doc = _load(event, act=True)
	findings = (findings or "").strip()
	if findings == (doc.findings or ""):
		return _shape(doc)
	doc.findings = findings
	_log(doc, "Findings updated", findings[:300])
	doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def add_evidence(event, attachment_type, file_url=None, text=None):
	"""Attach a photo, voice note, file (already uploaded as a private file) or a text note."""
	doc = _load(event, act=True)
	if attachment_type not in EVIDENCE_TYPES:
		frappe.throw(_("Unknown attachment type."))
	if attachment_type == "Text Note" and not (text or "").strip():
		frappe.throw(_("The note is empty."))
	if attachment_type != "Text Note" and not file_url:
		frappe.throw(_("Upload a file first."))
	doc.append("evidence", {"attachment_type": attachment_type, "file": file_url, "text_content": (text or "").strip() or None,
		"added_by": frappe.session.user, "added_on": now_datetime()})
	_log(doc, f"{attachment_type} added", (text or "")[:200] or (file_url or "").split("/")[-1])
	doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def remove_evidence(event, evidence_id):
	doc = _load(event, act=True)
	row = next((e for e in (doc.get("evidence") or []) if e.name == evidence_id), None)
	if not row:
		frappe.throw(_("Attachment not found."))
	if row.added_by != frappe.session.user and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only the person who added it can remove it."))
	doc.remove(row)
	_log(doc, f"{row.attachment_type} removed")
	doc.save(ignore_permissions=True)
	return _shape(doc)


def refresh_case_definition_questions():
	"""One-off: apply the current case-definition wording to every protocol, and to open events where that
	question is not answered yet. Other questions, phases and answers are left alone.
	bench --site <site> execute surveillance.investigation.refresh_case_definition_questions"""
	protos = 0
	for name in frappe.get_all("Response Protocol", pluck="name"):
		doc = frappe.get_doc("Response Protocol", name)
		meta = frappe.db.get_value("Alert Threshold Config", doc.disease, "disease_name")
		q, why, _kind = case_definition_question(doc.summary, meta)
		changed = False
		for row in doc.get("verification_questions") or []:
			if row.kind == "Case definition" and (row.question != q or row.why != why):
				row.question, row.why, changed = q, why, True
		if changed:
			doc.save(ignore_permissions=True)
			protos += 1
	events = 0
	for name in frappe.get_all("Surveillance Event", filters={"status": ["not in", ["Closed", "Discarded"]]}, pluck="name"):
		doc = frappe.get_doc("Surveillance Event", name)
		proto = frappe.get_doc("Response Protocol", doc.protocol) if doc.protocol and frappe.db.exists("Response Protocol", doc.protocol) else None
		q, why, _kind = case_definition_question(proto.summary if proto else None, doc.disease_name)
		changed = False
		for row in doc.get("verification") or []:
			if row.kind == "Case definition" and not row.answer and row.question != q:
				row.question, row.why, changed = q, why, True
		if changed:
			doc.save(ignore_permissions=True)
			events += 1
	frappe.db.commit()
	print(f"Protocols updated: {protos} | open events updated: {events}")


@frappe.whitelist(methods=["POST"])
def check_report(event, signal, reached=None, meets_case_definition=None, note=None):
	"""Verify ONE report: was its reporter reached, and does the case meet the case definition?
	reached: Yes | No.  meets_case_definition: Yes | No | Not sure.  The note goes to the event timeline."""
	doc = _load(event, act=True)
	if doc.status not in ("New", "Verifying", "Investigating"):
		frappe.throw(_("Reports can only be checked while the event is being verified or investigated."))
	sig = frappe.db.get_value("Surveillance Signal", signal, ["name", "event", "source", "ref"], as_dict=True)
	if not sig or sig.event != doc.name:
		frappe.throw(_("This report is not part of this event."))
	if reached not in (None, "", "Yes", "No") or meets_case_definition not in (None, "", "Yes", "No", "Not sure"):
		frappe.throw(_("Use Yes / No (reached) and Yes / No / Not sure (case definition)."))
	reached, meets = reached or None, meets_case_definition or None
	status = report_status(reached, meets)
	frappe.db.set_value("Surveillance Signal", sig.name, {"check_reached": reached, "check_case_definition": meets,
		"check_status": status, "checked_by": frappe.session.user, "checked_on": now_datetime()}, update_modified=False)
	ensure_investigation(doc)
	if doc.status == "New":
		doc.status = "Verifying"
		_log(doc, "Verification started")
	_log(doc, f"Report checked: {status}", f"{sig.source} {sig.ref}. Reporter reached: {reached or '-'}; "
		f"meets case definition: {meets or '-'}" + (f". {note.strip()}" if (note or "").strip() else ""))
	sync_case_definition(doc)
	doc.save(ignore_permissions=True)
	from surveillance.events import recompute_event
	recompute_event(doc.name)   # "Not a case" reports no longer count in the event totals
	return _shape(frappe.get_doc("Surveillance Event", doc.name))


@frappe.whitelist(methods=["POST"])
def split_report(event, signal, reason):
	"""Move one report out of an event into its own new event (e.g. it is in a different, distant area).
	The officer's reason is kept on both timelines."""
	from surveillance.events import OPEN, recompute_event
	doc = _load(event, act=True)
	reason = (reason or "").strip()
	if not reason:
		frappe.throw(_("Say why this report is being split off."))
	if doc.status not in OPEN:
		frappe.throw(_("Reopen the event first."))
	sig = frappe.get_doc("Surveillance Signal", signal)
	if sig.event != doc.name:
		frappe.throw(_("This report is not part of this event."))
	if frappe.db.count("Surveillance Signal", {"event": doc.name}) < 2:
		frappe.throw(_("This is the only report in the event."))
	new = frappe.get_doc({
		"doctype": "Surveillance Event", "status": "New", "disease": doc.disease, "disease_name": doc.disease_name,
		"priority": doc.priority, "county": sig.county, "sub_county": sig.sub_county or "", "area": sig.area or "",
		"group_key": f"{doc.group_key}|split|{sig.name}", "region": sig.region,
		"first_reported": sig.signal_date, "last_reported": sig.signal_date, "severity": doc.severity or "standard",
	})
	new.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": "Split from another event",
		"note": f"{sig.source} {sig.ref} split from {doc.name}: {reason}"})
	new.insert(ignore_permissions=True)
	frappe.db.set_value("Surveillance Signal", sig.name, "event", new.name, update_modified=False)
	_log(doc, "Report split off", f"{sig.source} {sig.ref} moved to {new.name}: {reason}")
	sync_case_definition(doc)
	doc.save(ignore_permissions=True)
	recompute_event(doc.name)
	recompute_event(new.name)
	return {"event": doc.name, "newEvent": new.name}


def move_checks_to_reports():
	"""One-off: remove the old event-level "Has the reporter been reached" question (it is now checked per report)
	from protocols, and from open events where it is not answered yet.
	bench --site <site> execute surveillance.investigation.move_checks_to_reports"""
	prefix = "Has the reporter"
	protos = events = 0
	for name in frappe.get_all("Response Protocol", pluck="name"):
		doc = frappe.get_doc("Response Protocol", name)
		keep = [q for q in (doc.get("verification_questions") or []) if not (q.question or "").startswith(prefix)]
		if len(keep) != len(doc.get("verification_questions") or []):
			doc.set("verification_questions", keep)
			doc.save(ignore_permissions=True)
			protos += 1
	for name in frappe.get_all("Surveillance Event", filters={"status": ["not in", ["Closed", "Discarded"]]}, pluck="name"):
		doc = frappe.get_doc("Surveillance Event", name)
		rows = doc.get("verification") or []
		keep = [a for a in rows if not ((a.question or "").startswith(prefix) and not a.answer)]
		if len(keep) != len(rows):
			doc.set("verification", keep)
			events += 1
		if sync_case_definition(doc) or len(keep) != len(rows):
			doc.save(ignore_permissions=True)
	frappe.db.commit()
	print(f"Protocols updated: {protos} | open events updated: {events}")
