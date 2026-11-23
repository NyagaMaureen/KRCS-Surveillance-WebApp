"""Investigation workflow for one Surveillance Event (Alerts & Signals).

Steps shown to the officer:
  1 Signal captured      reports grouped into the event (events.py)
  2 Verification         the CHA (or the officer) calls each reporter, checks the symptoms and answers the questions
                         every event has (COMMON_QUESTIONS), then Confirm and save tells the officer. No diseases.
  3 AI triage            the officer chooses the disease, then answers only that disease's own questions
                         (KRCS 19 Nov 2026: steps 2 and 3 swapped, Yes / No answers only)
  4 Field investigation  protocol steps with phase "Investigation": Done / Not done / Not applicable,
                         field findings, photos, voice notes, files
  5 Decision             confirm, discard or escalate, with a reason (human sign-off)
  6 Response and close   protocol steps with phase "Response", closing summary, feedback to field reporters

Statuses (KRCS 20 Nov 2026): New -> Verified (Confirm and save) -> Investigating ("In the field") -> Confirmed / Escalated -> Closed.
Why it closed is the outcome: Responded, Not confirmed, Discarded (at verification or AI triage) or Referred (non-priority disease).

The verification suggestion is rule-based and shows its reasons; it never decides. The officer decides.
Every answer, step outcome, upload and decision is written to the event timeline.
"""
import frappe
from frappe import _
from frappe.utils import cint, get_fullname, now_datetime

from surveillance.capabilities import require_capability

ANSWERS = ("Yes", "No")   # "Not sure" removed from the questions (KRCS 19 Nov 2026); old answers still show
CHA, OFFICER = "CHA", "Officer"   # who asks a question: Verification (step 2) or AI triage (step 3)
OUTCOMES = ("Done", "Not done", "Not applicable")
KINDS = ("Key question", "Case definition", "Supports", "Red flag")
# Key questions decide whether a signal goes to field investigation (agreed with KRCS, Allan, 28 Oct 2026):
# at least half of them must be answered Yes, otherwise the signal is discarded. The case-definition
# question always counts as a key question. Red flags never block: escalation is always possible.
KEY_KINDS = ("Key question", "Case definition")


def _get(a, k):
	return a.get(k) if isinstance(a, dict) else getattr(a, k, None)


def is_key(a):
	"""Ticked "Needed to start the investigation" (older records: Key question / Case definition)."""
	return bool(cint(_get(a, "needed_to_start"))) or _get(a, "kind") in KEY_KINDS


def is_red(a):
	"""Ticked "Yes means escalate now" (older records: Red flag)."""
	return bool(cint(_get(a, "escalate_if_yes"))) or _get(a, "kind") == "Red flag"


def kind_for(needed, red, current=None):
	"""Keep the old kind label in step with the ticks (the case-definition question keeps its kind)."""
	if current == "Case definition" and needed:
		return "Case definition"
	return "Key question" if needed else "Red flag" if red else "Supports"


def key_check(answers):
	"""answers: dicts or rows with ticks/kind and answer. Returns the half-Yes rule result."""
	get = _get
	keys = [a for a in answers if is_key(a)]
	total = len(keys)
	yes = sum(1 for a in keys if get(a, "answer") == "Yes")
	no = sum(1 for a in keys if get(a, "answer") == "No")
	needed = (total + 1) // 2          # at least half, rounded up
	return {"total": total, "yes": yes, "no": no, "needed": needed,
		"met": total == 0 or yes >= needed,
		"failed": total > 0 and (total - no) < needed}   # cannot reach half any more
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


def _norm(text):
	return "".join(ch for ch in (text or "").lower() if ch.isalnum())


COMMON_NORMS = {_norm(q) for q, _w, _k in COMMON_QUESTIONS}


def stage_of(row):
	"""CHA for the questions every event has (asked in Verification), Officer for the disease's own ones."""
	return row.get("stage") or (CHA if _norm(row.get("question")) in COMMON_NORMS else OFFICER)


def can_verify():
	"""Verification (step 2): whoever has the Step 2 box in Roles & Permissions (the CHA, or an officer)."""
	from surveillance.events import allowed_steps
	return 2 in allowed_steps()


def viewer_is_cha(user=None):
	"""Signal captured and Verification only: no diseases, risk score or later steps (KRCS 19 Nov 2026). Set in Roles &
	Permissions: anyone who works the Review Queue without "See AI Triage and Diseases" gets this view, whatever else
	the role has (KRCS 19 Nov 2026: a CHA role with Act on Events still saw AI triage)."""
	from surveillance.capabilities import get_user_capabilities
	from surveillance.events import ACT
	caps = get_user_capabilities(user)
	return "ai_triage" not in caps and bool(caps & {"cha_workspace", "view_review_queue", ACT, "step_signal", "step_verification"})


def officer_chose(doc):
	"""The disease is chosen: an officer set it on the field reports in AI triage, or the event has no field reports
	(CBS only, or opened from Epi Trends) so the disease comes with it."""
	refs = frappe.get_all("Surveillance Signal", filters={"event": doc.name, "source": "Field"}, pluck="ref") if doc.name else []
	if not refs:
		return True
	return bool(frappe.db.exists("Case Report", {"name": ["in", refs], "classified_by": "Officer"}))


def verification_done(doc):
	"""Step 2 is finished: Confirm and save was used, or (older events) the officer already chose the disease."""
	return bool(doc.get("verification_on")) or (officer_chose(doc) and bool(
		frappe.get_all("Surveillance Signal", filters={"event": doc.name, "source": "Field"}, limit=1)))


def _renumber(doc):
	rows = sorted(doc.get("verification") or [], key=lambda a: (0 if stage_of(a) == CHA else 1, cint(a.question_no)))
	for i, a in enumerate(rows, 1):
		a.question_no = i
		a.idx = i


def ensure_cha_questions(doc):
	"""The questions every event has, asked by the CHA in Verification (marks matching older rows as CHA)."""
	changed = False
	rows = doc.get("verification") or []
	for q, why, kind in COMMON_QUESTIONS:
		row = next((a for a in rows if _norm(a.question) == _norm(q)), None)
		if row:
			if row.get("stage") != CHA:
				row.stage = CHA
				changed = True
			continue
		doc.append("verification", {"question_no": len(doc.get("verification") or []) + 1, "question": q, "why": why,
			"kind": kind, "stage": CHA, "needed_to_start": 1 if kind in KEY_KINDS else 0,
			"escalate_if_yes": 1 if kind == "Red flag" else 0})
		changed = True
	if changed:
		_renumber(doc)
	return changed


def ensure_officer_questions(doc):
	"""The chosen disease's own questions for the officer in AI triage, once the disease is chosen. Questions the
	CHA already asked are not repeated."""
	if any(stage_of(a) == OFFICER for a in (doc.get("verification") or [])) or not officer_chose(doc):
		return False
	proto = _protocol(doc)
	rows = ([(q.question, q.why, q.kind, is_key(q), is_red(q)) for q in proto.verification_questions]
		if proto and proto.get("verification_questions")
		else [(q, w, k, k in KEY_KINDS, k == "Red flag") for q, w, k in default_questions(proto, doc.disease_name)])
	asked = {_norm(a.question) for a in (doc.get("verification") or [])}
	added = False
	for q, why, kind, needed, red in rows:
		if _norm(q) in asked or _norm(q) in COMMON_NORMS:
			continue
		doc.append("verification", {"question_no": 999, "question": q, "why": why, "kind": kind or "Supports", "stage": OFFICER,
			"needed_to_start": 1 if needed else 0, "escalate_if_yes": 1 if red else 0})
		added = True
	if added:
		_renumber(doc)
	return added


# ---------- setting up an event ----------

def _protocol(doc):
	from surveillance.protocols import approved_for
	if doc.protocol and frappe.db.exists("Response Protocol", doc.protocol):
		return frappe.get_doc("Response Protocol", doc.protocol)
	return approved_for(doc.disease)


def ensure_investigation(doc):
	"""Copy the steps from the approved protocol once; the CHA's questions from the start and the disease's own
	questions once the officer has chosen the disease; answer the case-definition question from the report checks.
	Returns True if changed."""
	from surveillance.protocols import _ensure_checklist
	changed = _ensure_checklist(doc)
	changed = ensure_cha_questions(doc) or changed
	changed = ensure_officer_questions(doc) or changed
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
	if not checks:
		return False   # event opened from an Epi Trends alert: the officer answers this question directly
	done = [c for c in checks if c.check_status and c.check_status != "Not checked"]
	if any(c.check_status == "Verified" for c in done):
		answer = "Yes"
	elif done and all(c.check_status == "Not a case" for c in done):
		answer = "No"
	else:
		# no reporter confirmed it either way (e.g. none reached): the officer answers it (KRCS 19 Nov 2026)
		return False
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
	kc = key_check(answers)
	case_def = [a for a in answers if a.get("kind") == "Case definition"]
	cd = case_def[0].get("answer") if case_def else None
	red = [a for a in answers if is_red(a) and a.get("answer") == "Yes"]
	supports = [a for a in answers if not is_key(a) and not is_red(a)]
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
	if kc["total"]:
		if kc["met"] and notify_immediately:
			return {"action": "escalate", "level": "critical",
				"text": f"{kc['yes']} of {kc['total']} key questions are Yes and one case of {disease_name or 'this disease'} is an emergency. Escalate now.",
				"reasons": reasons}
		if kc["met"]:
			return {"action": "investigate", "level": "high",
				"text": f"{kc['yes']} of {kc['total']} key questions are Yes (at least {kc['needed']} needed). Start the field investigation.",
				"reasons": reasons}
		if kc["failed"]:
			return {"action": "discard", "level": "low",
				"text": f"Only {kc['yes']} of {kc['total']} key questions are Yes (at least {kc['needed']} needed). This does not meet the criteria for an event: discard the signal.",
				"reasons": reasons}
		return {"action": "gather", "level": "medium",
			"text": f"{kc['yes']} of {kc['total']} key questions are Yes so far (at least {kc['needed']} needed). Answer the rest before deciding.",
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


def must_escalate(doc):
	"""Diseases where one case is an emergency (protocol "Single case is an emergency": VHF, BVD, polio,
	yellow fever, mpox) cannot be confirmed locally: National MOH leads, so they must be escalated."""
	proto = _protocol(doc)
	return bool(proto and proto.get("notify_immediately"))


def _handed_over(doc):
	"""(phase, step_no) of steps that have an open task: someone is doing them, so they do not block."""
	if not doc.name or not frappe.db.exists("DocType", "Event Task"):
		return set()
	rows = frappe.get_all("Event Task", filters={"event": doc.name, "status": ["in", ["Assigned", "In progress"]],
		"step_no": [">", 0]}, fields=["step_phase", "step_no"])
	return {((r.step_phase or "Investigation"), cint(r.step_no)) for r in rows}


def gates(doc):
	unanswered = [a.question_no for a in (doc.get("verification") or []) if not a.answer]
	handed = _handed_over(doc)
	inv_open = [s.step_no for s in _steps(doc, "Investigation")
		if not _outcome(s) and ("Investigation", cint(s.step_no)) not in handed]
	resp_open = [s.step_no for s in _steps(doc, "Response")
		if not _outcome(s) and ("Response", cint(s.step_no)) not in handed]
	return {
		"unansweredQuestions": unanswered,
		"openInvestigationSteps": inv_open,
		"openResponseSteps": resp_open,
		"handedOverSteps": sorted(n for _, n in handed),
		"keyCheck": key_check(doc.get("verification") or []),
		"canStartInvestigation": doc.status in ("New", "Verified") and not unanswered and key_check(doc.get("verification") or [])["met"],
		"canConfirm": doc.status == "Investigating" and not inv_open,
		"canClose": doc.status in ("Confirmed", "Escalated") and not resp_open,
	}


def check_gate(doc, action):
	"""Throw a clear message if an action is not allowed yet."""
	ensure_investigation(doc)
	g = gates(doc)
	if action == "investigate" and not doc.get("verification_on") and needs_cha(doc):
		frappe.throw(_("The CHA verifies this signal first (step 2: Confirm and save)."))
	if action == "investigate" and g["unansweredQuestions"]:
		frappe.throw(_("Answer all the verification questions first. Missing: {0}").format(
			", ".join(str(n) for n in g["unansweredQuestions"])))
	if action == "investigate":
		kc = key_check(doc.get("verification") or [])
		if not kc["met"]:
			frappe.throw(_("Only {0} of {1} key questions are Yes; at least {2} are needed to start the field investigation. Discard the signal, or escalate if there is a red flag.").format(
				kc["yes"], kc["total"], kc["needed"]))
	if action == "confirm" and must_escalate(doc):
		frappe.throw(_("{0} must be escalated to County / National MOH. Use Escalate instead of Confirm.").format(
			doc.disease_name or doc.disease))
	if action == "confirm" and g["openInvestigationSteps"]:
		frappe.throw(_("Record an outcome for every investigation step first. Missing steps: {0}").format(
			", ".join(str(n) for n in g["openInvestigationSteps"])))
	if action == "close" and g["openResponseSteps"] and doc.get("pathway") != "Referral":   # referral: no response steps
		frappe.throw(_("Record an outcome for every response step first. Missing steps: {0}").format(
			", ".join(str(n) for n in g["openResponseSteps"])))


def after_status(doc, action, note):
	"""Record the decision or closure on the event, sync the field reports, tell their reporters."""
	now, user = now_datetime(), frappe.session.user
	if action in ("confirm", "discard", "escalate", "close_unconfirmed"):
		doc.decision = {"confirm": "Confirmed", "discard": "Discarded", "escalate": "Escalated",
			"close_unconfirmed": "Not confirmed"}[action]
		doc.decision_reason, doc.decided_by, doc.decided_on = note, user, now
	if action in ("close", "close_unconfirmed"):
		doc.closing_summary, doc.closed_by, doc.closed_on = note, user, now
	if action == "reopen":
		doc.decision = doc.decision_reason = doc.decided_by = doc.decided_on = None
		doc.closing_summary = doc.closed_by = doc.closed_on = None


# a field report always shows its event's status (KRCS 20 Nov 2026); Submitted reads as New
REPORT_STATUS = {"New": "Submitted", "Verified": "Verified", "Investigating": "Investigating", "Confirmed": "Confirmed",
	"Escalated": "Escalated", "Closed": "Closed"}


def needs_cha(doc):
	"""Field and CBS signals are verified by the CHA before AI triage; facility (EMR) data is not (KRCS 23 Nov 2026)."""
	return bool(frappe.db.exists("Surveillance Signal", {"event": doc.name, "source": ["in", ["Field", "CBS"]]}))


# Feedback on every outcome (KRCS 23 Nov 2026), in-app only. Reporters (CHPs) never see the disease; the CHAs of the
# sub-county get the same news about the event. Nobody is told about their own action. Officer notes are not sent.
REPORTER_NEWS = {
	"verified": "was checked by the CHA and sent to the surveillance officer",
	"investigate": "is being followed up in the field by the surveillance team",
	"confirm": "was confirmed by the public health team, who are responding",
	"escalate": "was sent to the county health team",
	"discard": "was checked and closed",
	"close_unconfirmed": "was investigated: no outbreak was found, and it is closed",
	"close": "was investigated and the response is complete",
	"refer": "was checked: the patient is being referred to a health facility",
}
CHA_NEWS = {
	"verified": "it was verified and sent to the surveillance officer for AI triage",
	"investigate": "the officer started the field investigation",
	"confirm": "the officer confirmed the event; the response has started",
	"escalate": "the officer escalated it to the county health team",
	"discard": "it was discarded",
	"close_unconfirmed": "it was investigated and closed: no outbreak was found",
	"close": "it is closed: the response is complete",
	"refer": "the patient is being referred to a health facility by a CHP; the case is closed",
}


def sync_reports(doc, action, note):
	"""Keep the field Case Reports in step with the event and tell the reporters and CHAs what happened.
	CBS reporters cannot be contacted: we do not store their phone numbers."""
	refs = frappe.get_all("Surveillance Signal", filters={"event": doc.name, "source": "Field"}, pluck="ref")
	status = REPORT_STATUS.get(doc.status)
	told = set()
	for ref in refs:
		if not frappe.db.exists("Case Report", ref):
			continue
		if status:
			frappe.db.set_value("Case Report", ref, "status", status, update_modified=False)
		if action in REPORTER_NEWS:
			told |= _feedback(ref, doc, action)
	if action in CHA_NEWS:
		_tell_chas(doc, action, told)


def _notify(user, subject, doctype, name):
	frappe.get_doc({"doctype": "Notification Log", "for_user": user, "type": "Alert",
		"document_type": doctype, "document_name": name, "subject": subject[:140]}).insert(ignore_permissions=True)


def _feedback(ref, doc, action):
	reporter = frappe.db.get_value("Case Report", ref, "reported_by") or frappe.db.get_value("Case Report", ref, "owner")
	if not reporter or reporter in ("Administrator", "Guest", frappe.session.user) or not frappe.db.exists("User", reporter):
		return set()
	# no disease named (KRCS 19 Nov 2026)
	_notify(reporter, f"Your report {ref} {REPORTER_NEWS[action]}. Thank you for reporting.", "Case Report", ref)
	return {reporter}


def _tell_chas(doc, action, already=()):
	try:
		from surveillance.notifications import _chas, sub_county_users
		chas = [u.name for u in _chas(sub_county_users(doc.sub_county, doc.name))]
	except Exception:  # noqa: BLE001 - feedback never blocks the officer
		return
	what = doc.disease_name or "Signal"
	for u in chas:
		if u in already or u == frappe.session.user:
			continue
		_notify(u, f"{doc.name} ({what}, {doc.sub_county or 'location missing'}): {CHA_NEWS[action]}.", "Surveillance Event", doc.name)


# ---------- API ----------

def _load(event, act=False, step=None):
	"""step: the event step(s) the change belongs to; the user needs one of those boxes (Roles & Permissions)."""
	from surveillance.events import _check_access, ACT, VIEW, require_step
	if step:
		require_step(*(step if isinstance(step, (tuple, list)) else (step,)))
	else:
		require_capability(ACT if act else VIEW)
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	return doc


def _load_verify(event):
	"""An event the user may verify (step 2): the CHA, or an officer who acts on events."""
	from surveillance.events import _check_access, VIEW
	require_capability(VIEW)
	if not can_verify():
		frappe.throw(_("You cannot verify this event."), frappe.PermissionError)
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	return doc


def tasks_access():
	"""The Tasks section on an event (Roles & Permissions): see it, and assign tasks."""
	from surveillance.capabilities import has_capability
	assign = has_capability("assign_event_tasks")
	return {"see": assign or has_capability("view_event_tasks"), "assign": assign}


def _shape(doc):
	from surveillance.capabilities import has_capability
	from surveillance.events import ACT, allowed_steps
	from surveillance.protocols import _shape as protocol_shape
	proto = frappe.get_doc("Response Protocol", doc.protocol) if doc.protocol and frappe.db.exists("Response Protocol", doc.protocol) else None
	questions = [{"n": a.question_no, "question": a.question, "why": a.why, "kind": a.kind, "answer": a.answer or None,
		"stage": stage_of(a),
		"key": is_key(a), "redFlag": is_red(a), "neededToStart": is_key(a), "escalateIfYes": is_red(a),
		"answeredBy": get_fullname(a.answered_by) if a.answered_by else None, "answeredOn": str(a.answered_on or "") or None}
		for a in sorted(doc.get("verification") or [], key=lambda a: cint(a.question_no))]
	verified = ({"by": get_fullname(doc.verification_by) if doc.get("verification_by") else None,
		"on": str(doc.verification_on)} if doc.get("verification_on") else None)
	if viewer_is_cha():   # Signal captured and Verification only: nothing about diseases (KRCS 19 Nov 2026)
		return {"event": doc.name, "status": doc.status, "protocol": None, "notifyImmediately": False, "mustEscalate": False,
			"questions": [q for q in questions if q["stage"] == CHA], "suggestion": None, "investigationSteps": [],
			"responseSteps": [], "findings": "", "evidence": [], "gates": {}, "canAct": False, "isCha": True,
			"canVerify": can_verify(), "verified": verified, "verificationDone": verification_done(doc), "locked": bool(doc.get("verification_on")) or officer_chose(doc),
			"steps": allowed_steps(), "tasks": tasks_access()}

	assignable = {(p.step or "").strip().lower() for p in (proto.get("steps") or []) if p.get("assignable")} if proto else set()

	def step(s):
		return {"n": s.step_no, "step": s.step, "timeframe": s.timeframe, "phase": s.phase or "Investigation",
			"assignable": (s.step or "").strip().lower() in assignable,
			"outcome": _outcome(s) or None, "reason": s.reason or None,
			"by": get_fullname(s.done_by) if s.done_by else None, "on": str(s.done_on or "") or None}

	steps = [step(s) for s in sorted(doc.get("checklist") or [], key=lambda s: cint(s.step_no))]
	return {
		"event": doc.name, "status": doc.status,
		"protocol": protocol_shape(proto, steps=False) if proto else None,
		"notifyImmediately": bool(proto and proto.get("notify_immediately")),
		"mustEscalate": bool(proto and proto.get("notify_immediately")),
		"nearestFacility": doc.get("nearest_facility") or None,
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
		"isCha": False, "canVerify": can_verify(), "verified": verified, "verificationDone": verification_done(doc),
		"steps": allowed_steps(), "tasks": tasks_access(),
	}


@frappe.whitelist()
def get_investigation(event):
	"""Everything the investigation steps need (copies questions and steps from the protocol on first view)."""
	doc = _load(event)
	if ensure_investigation(doc):
		doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def answer_question(event, question_no, answer, expected=None):
	"""expected (optional): the answer the app last saw; a different answer on the server is refused with 409.
	The CHA answers the Verification questions; the disease's own questions are the officer's."""
	doc = _load_verify(event)
	if doc.status not in ("New", "Verified", "Investigating"):
		frappe.throw(_("Verification answers can only change while the event is open for verification."))
	if answer not in ANSWERS:
		frappe.throw(_("Answer Yes or No."))
	ensure_investigation(doc)
	row = next((a for a in doc.verification if cint(a.question_no) == cint(question_no)), None)
	if not row:
		frappe.throw(_("Question not found."))
	if stage_of(row) != CHA:
		from surveillance.events import require_step
		require_step(3)
	elif doc.get("verification_on"):
		frappe.throw(_("The verification was confirmed and saved, so it can no longer change."))
	elif viewer_is_cha() and officer_chose(doc):
		frappe.throw(_("The surveillance officer has already taken this signal on, so the verification can no longer change."))
	from surveillance.field_api import check_expected
	check_expected(expected, row.answer, row.answered_by, row.answered_on)
	if row.kind == "Case definition" and frappe.db.count("Surveillance Signal", {"event": doc.name,
			"check_status": ["in", ["Verified", "Not a case"]]}):
		frappe.throw(_("This question is answered from the report checks. Check each report instead."))
	if row.answer == answer:
		return _shape(doc)
	row.answer, row.answered_by, row.answered_on = answer, frappe.session.user, now_datetime()
	if doc.status == "New" and not any(a.action == "Verification started" for a in doc.actions):
		_log(doc, "Verification started")
	_log(doc, "Verification answer", f"{row.question.split('?')[0]}? {answer}")
	doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def set_step_outcome(event, step_no, outcome=None, reason=None, expected=None):
	"""Record Done / Not done / Not applicable on one protocol step. Not done needs a reason. Empty outcome clears it."""
	doc = _load(event, step=(4, 6))
	if doc.status == "Closed":
		frappe.throw(_("Reopen the event to change its steps."))
	ensure_investigation(doc)
	row = next((s for s in doc.checklist if cint(s.step_no) == cint(step_no)), None)
	if not row:
		frappe.throw(_("Step not found."))
	from surveillance.events import require_step
	require_step(6 if (row.phase or "Investigation") == "Response" else 4)
	from surveillance.field_api import check_expected
	check_expected(expected, row.outcome, row.done_by, row.done_on)
	outcome = outcome or None
	reason = (reason or "").strip()
	if outcome and outcome not in OUTCOMES:
		frappe.throw(_("Outcome must be Done, Not done or Not applicable."))
	if outcome == "Not done" and not reason:
		frappe.throw(_("Say why this step was not done."))
	if (row.phase or "Investigation") == "Investigation" and doc.status not in ("Investigating", "Confirmed", "Escalated"):
		frappe.throw(_("Start the field investigation first."))
	if (row.phase or "Investigation") == "Response" and doc.status not in ("Confirmed", "Escalated"):
		frappe.throw(_("RCCE steps open after the decision (confirm or escalate)."))
	row.outcome, row.reason = outcome, (reason if outcome in ("Not done", "Not applicable") else None)
	row.done = 1 if outcome == "Done" else 0
	row.done_by = frappe.session.user if outcome else None
	row.done_on = now_datetime() if outcome else None
	_log(doc, f"Step {outcome.lower()}" if outcome else "Step reopened",
		f"{row.step_no}. {row.step}" + (f" ({reason})" if reason and outcome != "Done" else ""))
	doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def save_findings(event, findings, expected=None):
	doc = _load(event, step=4)
	from surveillance.field_api import check_expected
	check_expected(expected, doc.findings, doc.modified_by, doc.modified)
	findings = (findings or "").strip()
	if findings == (doc.findings or ""):
		return _shape(doc)
	doc.findings = findings
	_log(doc, "Findings updated", findings[:300])
	doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def add_evidence(event, attachment_type, file_url=None, text=None, people_shown=None, consent=None,
		consent_recorded_on=None, client_ref=None):
	"""Attach a photo, voice note, file (already uploaded as a private file) or a text note.
	Photos and voice notes: people_shown (0/1) and, when 1, consent "Person agreed" / "Parent or guardian agreed".
	client_ref (optional, from the app): a retry with the same reference does not attach it twice."""
	doc = _load(event, step=4)
	if attachment_type not in EVIDENCE_TYPES:
		frappe.throw(_("Unknown attachment type."))
	ref = (client_ref or "").strip()[:64] or None
	if ref and any(e.get("client_ref") == ref for e in (doc.get("evidence") or [])):
		return _shape(doc)
	from surveillance.case_report_rules import check_consent
	shown, consent, recorded = check_consent(attachment_type, people_shown, consent)
	if consent_recorded_on and shown is not None and attachment_type in ("Photo", "Voice Note"):
		from frappe.utils import get_datetime
		recorded = get_datetime(consent_recorded_on)   # when the app asked the question, offline
	if attachment_type == "Text Note" and not (text or "").strip():
		frappe.throw(_("The note is empty."))
	if attachment_type != "Text Note" and not file_url:
		frappe.throw(_("Upload a file first."))
	doc.append("evidence", {"attachment_type": attachment_type, "file": file_url, "text_content": (text or "").strip() or None,
		"added_by": frappe.session.user, "added_on": now_datetime(), "people_shown": shown, "consent": consent,
		"consent_recorded_on": recorded, "client_ref": ref})
	_log(doc, f"{attachment_type} added", (text or "")[:200] or (file_url or "").split("/")[-1])
	doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def remove_evidence(event, evidence_id):
	doc = _load(event, step=4)
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
	doc = _load(event, step=2)
	if doc.status not in ("New", "Verified", "Investigating"):
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
	if doc.status == "New" and not any(a.action == "Verification started" for a in doc.actions):
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
	doc = _load(event, step=(2, 3))
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


def sync_epi_trends(doc, note):
	"""Confirming an event also confirms the linked Epi Trends alert (if it is still open)."""
	if not doc.linked_alert or not frappe.db.exists("Risk Alert", doc.linked_alert):
		return
	alert = frappe.get_doc("Risk Alert", doc.linked_alert)
	if alert.status in ("Confirmed", "Resolved", "Rejected"):
		return
	alert.status = "Confirmed"
	alert.append("notes", {"note": f"Confirmed from Alerts & Signals event {doc.name}: {note}"[:1000],
		"added_by": frappe.session.user, "created_at": now_datetime()})
	alert.save(ignore_permissions=True)
