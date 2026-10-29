"""Tasks on Review Queue events: field visits, referrals, sample collection and follow-ups.

An officer (act_on_events) assigns a task to a person (usually the CHP who reported the signal).
The person gets an in-app notification and an email, and sees the task under My Tasks and on the dashboard.
They mark it In progress, Done or Could not complete, with an outcome note.

Who sees what:
  - everyone sees the tasks assigned to them
  - users with view_all_tasks (e.g. SCDSC) see every task in their region (all regions if none assigned)
  - officers who can act on an event see and manage its tasks on the event page

Agreed with KRCS (Allan, 28 Oct 2026):
  - CHPs do not collect samples. They refer patients to a facility; samples are collected there by a
    trained surveillance officer or health worker. So "Sample collection" is assigned to those people.
  - After an event closes, follow-up by CHV / CHP / CHA / SCDSC runs for 7 to 21 days.

Privacy: tasks never store patient names or phone numbers (same rule as signals).
"""
import frappe
from frappe import _
from frappe.utils import add_days, cint, escape_html, get_fullname, get_url, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability, require_capability

DOCTYPE = "Event Task"
ACT = "act_on_events"
VIEW_ALL = "view_all_tasks"
TYPES = ["Field visit", "Referral", "Sample collection", "Follow-up", "Other"]
OPEN_STATUSES = ["Assigned", "In progress"]
STATUSES = ["Assigned", "In progress", "Done", "Could not complete"]
FOLLOWUP_DAYS = [7, 14, 21]
SYSTEM_ROLES = {"All", "Guest", "Administrator", "System Manager", "Desk User", "Website Manager",
	"Report Manager", "Dashboard Manager", "Workspace Manager", "Prepared Report User", "Inbox User"}

FIELDS = ["name", "event", "task_type", "title", "instructions", "assigned_to", "assigned_by", "due_date", "status",
	"facility", "urgency", "disease_name", "sub_county", "area", "region", "step_phase", "step_no", "outcome",
	"completed_on", "creation", "modified", "severity", "case_report", "patient_age_group", "patient_sex", "reason"]

# How a referral's status reads to people (stored statuses are the same as other tasks)
REFERRAL_LABELS = {"Assigned": "Pending", "In progress": "On the way", "Done": "Reached facility",
	"Could not complete": "Not reached"}
RECEIVE = "receive_tasks"


# ---------- helpers ----------

def _event(event, act=True):
	from surveillance.events import _check_access
	require_capability(ACT if act else "view_review_queue")
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	return doc


def _role_label(user):
	roles = [r for r in frappe.get_roles(user) if r not in SYSTEM_ROLES]
	return ", ".join(sorted(roles)[:2]) or None


def _overdue(t):
	return t.status in OPEN_STATUSES and t.due_date and getdate(t.due_date) < getdate(nowdate())


def _shape(t, me=None):
	me = me or frappe.session.user
	return {
		"id": t.name, "event": t.event, "type": t.task_type, "title": t.title, "instructions": t.instructions or "",
		"assignedTo": t.assigned_to, "assignedToName": get_fullname(t.assigned_to) if t.assigned_to else None,
		"assignedBy": get_fullname(t.assigned_by) if t.assigned_by else None,
		"dueDate": str(t.due_date) if t.due_date else None, "status": t.status,
		"overdue": bool(_overdue(t)), "facility": t.facility or None, "urgency": t.urgency or None,
		"disease": t.disease_name, "subCounty": t.sub_county, "area": t.area,
		"stepPhase": t.step_phase or None, "stepNo": t.step_no or None,
		"outcome": t.outcome or "", "completedOn": str(t.completed_on) if t.completed_on else None,
		"createdOn": str(t.creation), "mine": t.assigned_to == me,
		"priority": t.get("severity") or None,
		"statusLabel": REFERRAL_LABELS.get(t.status, t.status) if t.task_type == "Referral" else t.status,
		"caseReport": t.get("case_report") or None,
		"patient": {"ageGroup": t.get("patient_age_group") or None, "sex": t.get("patient_sex") or None},
		"reason": t.get("reason") or "",
		"selfMade": t.assigned_by == t.assigned_to,
	}


def _log(event_doc, action, note):
	event_doc.append("actions", {"at": now_datetime(), "user": frappe.session.user, "action": action, "note": note})
	event_doc.save(ignore_permissions=True)


def _reporters(event):
	"""Users who submitted field reports in this event (the CHPs who reported the signal)."""
	refs = frappe.get_all("Surveillance Signal", filters={"event": event, "source": "Field"}, pluck="ref")
	users = []
	for ref in refs:
		if frappe.db.exists("Case Report", ref):
			u = frappe.db.get_value("Case Report", ref, "reported_by")
			if u and u not in users and frappe.db.get_value("User", u, "enabled"):
				users.append(u)
	return users


# ---------- event page ----------

@frappe.whitelist()
def get_assignees(event):
	"""People an officer can assign to: the reporting CHP(s) first, then users in the event's sub-county,
	then users in the event's region."""
	from surveillance.notifications import sub_county_users
	doc = _event(event)
	out, seen = [], set()

	def add(user, group):
		if not user or user in seen or user in ("Administrator", "Guest"):
			return
		seen.add(user)
		out.append({"user": user, "name": get_fullname(user), "role": _role_label(user), "group": group})

	for u in _reporters(doc.name):
		add(u, "Reported this signal")
	for u in sub_county_users(doc.sub_county):
		add(u.name, f"In {doc.sub_county}")
	if doc.region and frappe.get_meta("User").has_field("assigned_region"):
		for u in frappe.get_all("User", filters={"assigned_region": doc.region, "enabled": 1},
				pluck="name", limit_page_length=200):
			add(u, "In this region")
	return out


@frappe.whitelist()
def get_event_tasks(event):
	doc = _event(event, act=False)
	rows = frappe.get_all(DOCTYPE, filters={"event": doc.name}, fields=FIELDS, order_by="due_date asc, creation asc")
	return {"tasks": [_shape(t) for t in rows], "canAssign": has_capability(ACT),
		"followupDays": FOLLOWUP_DAYS, "eventStatus": doc.status}


def _insert(doc, task_type, title, assigned_to, due_date, instructions=None, facility=None, urgency=None,
		step_phase=None, step_no=None):
	if task_type not in TYPES:
		frappe.throw(_("Unknown task type."))
	if not (title or "").strip():
		frappe.throw(_("Please say what needs to be done."))
	if not assigned_to or not frappe.db.get_value("User", assigned_to, "enabled"):
		frappe.throw(_("Choose who will do this task."))
	if not due_date:
		frappe.throw(_("Choose a due date."))
	if task_type == "Referral" and not (facility or "").strip():
		frappe.throw(_("Enter the facility the patient is referred to."))
	return frappe.get_doc({
		"doctype": DOCTYPE, "event": doc.name, "task_type": task_type, "title": title.strip()[:140],
		"instructions": (instructions or "").strip(), "assigned_to": assigned_to, "assigned_by": frappe.session.user,
		"due_date": getdate(due_date), "status": "Assigned", "facility": (facility or "").strip() or None,
		"urgency": urgency or None, "disease_name": doc.disease_name, "sub_county": doc.sub_county,
		"area": doc.area, "region": doc.region, "step_phase": step_phase or None, "step_no": cint(step_no) or None,
		"severity": doc.get("severity") or None,
	}).insert(ignore_permissions=True)


@frappe.whitelist(methods=["POST"])
def create_task(event, task_type, title, assigned_to, due_date, instructions=None, facility=None, urgency=None,
		step_phase=None, step_no=None):
	doc = _event(event)
	t = _insert(doc, task_type, title, assigned_to, due_date, instructions, facility, urgency, step_phase, step_no)
	_log(doc, "Task assigned", f"{t.task_type}: {t.title} → {get_fullname(t.assigned_to)}, due {t.due_date}")
	notify_assigned(t.name)
	return get_event_tasks(doc.name)


@frappe.whitelist(methods=["POST"])
def create_followups(event, assigned_to, days=None, instructions=None):
	"""Follow-up check-ins after an event closes (default days 7, 14 and 21 from today)."""
	doc = _event(event)
	day_list = [cint(d) for d in str(days or ",".join(map(str, FOLLOWUP_DAYS))).split(",") if cint(d) > 0]
	if not day_list:
		frappe.throw(_("Choose at least one follow-up day."))
	names = []
	for d in sorted(set(day_list)):
		t = _insert(doc, "Follow-up", f"Day {d} follow-up: check the patient and look for new cases", assigned_to,
			add_days(nowdate(), d), instructions)
		names.append(t.name)
	_log(doc, "Follow-ups scheduled", f"Days {', '.join(map(str, sorted(set(day_list))))} → {get_fullname(assigned_to)}")
	notify_assigned(names[0], count=len(names))
	return get_event_tasks(doc.name)


@frappe.whitelist(methods=["POST"])
def update_task(task, status=None, outcome=None, due_date=None, assigned_to=None):
	"""The assignee updates status and outcome. Officers who can act on the event can also
	change the due date, reassign, or update on someone's behalf."""
	t = frappe.get_doc(DOCTYPE, task)
	is_assignee = t.assigned_to == frappe.session.user
	is_officer = has_capability(ACT)
	if is_officer and t.event:
		from surveillance.events import _check_access
		_check_access(frappe.get_doc("Surveillance Event", t.event))
	if not (is_assignee or is_officer):
		frappe.throw(_("This task is not assigned to you."), frappe.PermissionError)

	changes = []
	if status:
		if status not in STATUSES:
			frappe.throw(_("Unknown status."))
		if status == "Could not complete" and not (outcome or t.outcome or "").strip():
			frappe.throw(_("Please say why it could not be completed."))
		if status != t.status:
			changes.append(status)
		t.status = status
		t.completed_on = now_datetime() if status in ("Done", "Could not complete") else None
	if outcome is not None:
		t.outcome = outcome.strip()
	if is_officer and due_date:
		t.due_date = getdate(due_date)
	reassigned = False
	if is_officer and assigned_to and assigned_to != t.assigned_to:
		if not frappe.db.get_value("User", assigned_to, "enabled"):
			frappe.throw(_("That user is not active."))
		t.assigned_to = assigned_to
		t.status = "Assigned"
		t.completed_on = None
		reassigned = True
	t.save(ignore_permissions=True)

	if not t.event:
		return _shape(t)
	ev = frappe.get_doc("Surveillance Event", t.event)
	if changes and t.step_no and t.status in ("Done", "Could not complete"):
		_finish_step(ev, t)
	if reassigned:
		_log(ev, "Task reassigned", f"{t.title} → {get_fullname(t.assigned_to)}")
		notify_assigned(t.name)
	elif changes:
		note = f"{t.title}: {t.status}" + (f" — {t.outcome}" if t.outcome else "")
		_log(ev, "Task updated", note)
		if t.status in ("Done", "Could not complete") and t.assigned_by and t.assigned_by != frappe.session.user:
			notify_officer(t.name)
	return _shape(t)


def _finish_step(ev, t):
	"""When a task linked to a protocol step is finished, record the step outcome for the officer
	(only if the officer has not recorded one already)."""
	row = next((s for s in (ev.get("checklist") or []) if cint(s.step_no) == cint(t.step_no)
		and (s.phase or "Investigation") == (t.step_phase or "Investigation")), None)
	if not row or row.outcome or row.done:
		return
	done = t.status == "Done"
	row.outcome = "Done" if done else "Not done"
	row.reason = None if done else (t.outcome or "Could not complete")
	row.done = 1 if done else 0
	row.done_by = t.assigned_to
	row.done_on = now_datetime()
	ev.append("actions", {"at": now_datetime(), "user": frappe.session.user,
		"action": "Step done" if done else "Step not done",
		"note": f"{row.step_no}. {row.step} (via task, {get_fullname(t.assigned_to)})"})


def open_tasks_note(event):
	"""Text for the timeline when an event is closed with tasks still open (they carry on)."""
	rows = frappe.get_all(DOCTYPE, filters={"event": event, "status": ["in", OPEN_STATUSES]},
		fields=["title", "assigned_to", "due_date"], order_by="due_date asc")
	if not rows:
		return None
	return "Still open, continuing after closing: " + "; ".join(
		f"{r.title} ({get_fullname(r.assigned_to)}, due {r.due_date})" for r in rows)


@frappe.whitelist(methods=["POST"])
def delete_task(task):
	t = frappe.get_doc(DOCTYPE, task)
	ev = _event(t.event)
	if t.status not in OPEN_STATUSES:
		frappe.throw(_("Finished tasks are kept for the record."))
	title = t.title
	frappe.delete_doc(DOCTYPE, t.name, ignore_permissions=True, force=True)
	_log(ev, "Task removed", title)
	return get_event_tasks(ev.name)


# ---------- My Tasks ----------

@frappe.whitelist()
def get_my_tasks(scope="mine", status="open", limit=300, kind=None):
	"""scope: "mine" = assigned to me, "all" = every task in my region (needs view_all_tasks).
	status: "open" | "done" | "all"."""
	from surveillance.events import _user_region
	filters = {}
	can_all = has_capability(VIEW_ALL)
	if scope == "all" and can_all:
		region = _user_region()
		if region:
			filters["region"] = region
	else:
		scope = "mine"
		filters["assigned_to"] = frappe.session.user
	if status == "open":
		filters["status"] = ["in", OPEN_STATUSES]
	elif status == "done":
		filters["status"] = ["not in", OPEN_STATUSES]
	if kind == "referrals":
		filters["task_type"] = "Referral"
	elif kind == "followups":
		filters["task_type"] = ["!=", "Referral"]
	rows = frappe.get_all(DOCTYPE, filters=filters, fields=FIELDS, order_by="due_date asc",
		limit_page_length=min(cint(limit) or 300, 1000))
	tasks = [_shape(t) for t in rows]
	if status != "open":
		tasks.sort(key=lambda x: x["completedOn"] or x["dueDate"] or "", reverse=True)

	mine_filters = {"assigned_to": frappe.session.user, "status": ["in", OPEN_STATUSES]}
	if kind == "referrals":
		mine_filters["task_type"] = "Referral"
	elif kind == "followups":
		mine_filters["task_type"] = ["!=", "Referral"]
	mine_open = frappe.get_all(DOCTYPE, filters=mine_filters, fields=["due_date", "status"])
	today = getdate(nowdate())
	summary = {
		"overdue": sum(1 for t in mine_open if t.due_date and getdate(t.due_date) < today),
		"today": sum(1 for t in mine_open if t.due_date and getdate(t.due_date) == today),
		"upcoming": sum(1 for t in mine_open if t.due_date and getdate(t.due_date) > today),
	}
	return {"tasks": tasks, "scope": scope, "canViewAll": can_all,
		"canOpenEvents": has_capability("view_review_queue"), "summary": summary}


# ---------- referrals a CHP records themselves ----------

AGE_GROUPS = ("Under 1", "1-4 years", "5-14 years", "15+ years")


@frappe.whitelist()
def get_my_referable_reports():
	"""The user's own recent reports, to link a referral to."""
	require_capability(RECEIVE)
	user = frappe.session.user
	rows = frappe.get_all("Case Report", filters={"creation": [">=", add_days(nowdate(), -60)]},
		or_filters={"reported_by": user, "owner": user},
		fields=["name", "location_name", "symptom_tags", "suspected_disease", "creation"],
		order_by="creation desc", limit_page_length=50)
	return [{"id": r.name, "label": f"{r.name} · {r.location_name or 'no place'} · {(r.symptom_tags or '')[:40]}",
		"date": str(r.creation)[:10]} for r in rows]


@frappe.whitelist(methods=["POST"])
def create_referral(facility, reason, case_report=None, age_group=None, sex=None, urgency=None):
	"""A CHP records a patient they referred to a health facility. No names are stored."""
	require_capability(RECEIVE)
	user = frappe.session.user
	facility, reason = (facility or "").strip(), (reason or "").strip()
	if not facility:
		frappe.throw(_("Enter the health facility."))
	if not reason:
		frappe.throw(_("Say briefly why the patient was referred."))
	if age_group and age_group not in AGE_GROUPS:
		frappe.throw(_("Unknown age group."))
	if sex and sex not in ("Female", "Male"):
		frappe.throw(_("Unknown sex."))
	ctx = {}
	event = None
	if case_report:
		cr = frappe.db.get_value("Case Report", case_report,
			["name", "reported_by", "owner", "sub_county", "location_name", "region", "suspected_disease"], as_dict=True)
		if not cr or user not in (cr.reported_by, cr.owner):
			frappe.throw(_("You can only link referrals to your own reports."), frappe.PermissionError)
		event = frappe.db.get_value("Surveillance Signal", f"Field-{cr.name}", "event")
		disease = frappe.db.get_value("Alert Threshold Config", cr.suspected_disease, "disease_name") if cr.suspected_disease else None
		ctx = {"sub_county": cr.sub_county, "area": cr.location_name, "region": cr.region, "disease_name": disease}
	if event:
		ev = frappe.db.get_value("Surveillance Event", event, ["disease_name", "sub_county", "area", "region", "severity"], as_dict=True)
		ctx = {"sub_county": ev.sub_county, "area": ev.area, "region": ev.region, "disease_name": ev.disease_name,
			"severity": ev.severity}
	t = frappe.get_doc({
		"doctype": DOCTYPE, "event": event, "task_type": "Referral", "title": f"Referral to {facility}"[:140],
		"assigned_to": user, "assigned_by": user, "due_date": nowdate(), "status": "Assigned",
		"facility": facility, "urgency": urgency or "Routine", "reason": reason, "case_report": case_report or None,
		"patient_age_group": age_group or None, "patient_sex": sex or None, **ctx,
	}).insert(ignore_permissions=True)
	if event:
		_log(frappe.get_doc("Surveillance Event", event), "Referral recorded",
			f"{get_fullname(user)} referred a patient to {facility}: {reason}")
	return _shape(t)


def counts_for_events(names):
	"""{event: {"open": n, "overdue": n}} for the Review Queue list."""
	if not names:
		return {}
	out = {}
	for t in frappe.get_all(DOCTYPE, filters={"event": ["in", names], "status": ["in", OPEN_STATUSES]},
			fields=["event", "due_date", "status"]):
		c = out.setdefault(t.event, {"open": 0, "overdue": 0})
		c["open"] += 1
		if _overdue(t):
			c["overdue"] += 1
	return out


# ---------- notifications ----------

def _app_link(task):
	base = (frappe.conf.get("frontend_url") or get_url()).rstrip("/")
	return f"{base}/my-tasks?task={task}"


def notify_assigned(task, count=1):
	frappe.enqueue("surveillance.event_tasks.send_assigned", task=task, count=count, queue="short",
		enqueue_after_commit=True)


def notify_officer(task):
	frappe.enqueue("surveillance.event_tasks.send_finished", task=task, queue="short", enqueue_after_commit=True)


def _email(user, subject, pairs, task):
	from surveillance.notifications import _rows, _button
	email = frappe.db.get_value("User", user, "email")
	if not email:
		return
	html = (f"<p>{escape_html(subject)}</p>" + _rows(pairs) + _button(_app_link(task), "Open My Tasks"))
	frappe.sendmail(recipients=[email], subject=subject, message=html,
		reference_doctype=DOCTYPE, reference_name=task, delayed=False)


def _in_app(user, subject, task):
	frappe.get_doc({"doctype": "Notification Log", "for_user": user, "type": "Alert",
		"document_type": DOCTYPE, "document_name": task, "subject": subject}).insert(ignore_permissions=True)


def send_assigned(task, count=1):
	t = frappe.get_doc(DOCTYPE, task)
	what = f"{cint(count)} follow-up check-ins" if cint(count) > 1 else f"{t.task_type}: {t.title}"
	subject = f"New task: {what} ({t.disease_name or 'event'}, {t.sub_county or 'location not set'})"
	_in_app(t.assigned_to, subject, t.name)
	_email(t.assigned_to, subject, [
		("Task", escape_html(t.title)), ("Type", t.task_type), ("Due", str(t.due_date)),
		("Disease", escape_html(t.disease_name or "")), ("Place", escape_html(", ".join(x for x in [t.area, t.sub_county] if x))),
		("Refer to", escape_html(t.facility or "")), ("Urgency", t.urgency or ""),
		("Instructions", escape_html(t.instructions or "")), ("Assigned by", escape_html(get_fullname(t.assigned_by) or "")),
	], t.name)


def send_finished(task):
	t = frappe.get_doc(DOCTYPE, task)
	if not t.event:
		return
	subject = f"Task {t.status.lower()}: {t.title} ({t.event})"
	base = (frappe.conf.get("frontend_url") or get_url()).rstrip("/")
	frappe.get_doc({"doctype": "Notification Log", "for_user": t.assigned_by, "type": "Alert",
		"document_type": "Surveillance Event", "document_name": t.event, "subject": subject}).insert(ignore_permissions=True)
	from surveillance.notifications import _rows, _button
	email = frappe.db.get_value("User", t.assigned_by, "email")
	if email:
		html = (f"<p>{escape_html(subject)}</p>" + _rows([("By", escape_html(get_fullname(t.assigned_to) or "")),
			("Outcome", escape_html(t.outcome or "—"))]) + _button(f"{base}/alerts-signals/{t.event}", "Open event"))
		frappe.sendmail(recipients=[email], subject=subject, message=html,
			reference_doctype="Surveillance Event", reference_name=t.event, delayed=False)


def daily_reminders():
	"""Once a day: remind people of tasks due today or overdue (in-app; email only on the due day)."""
	today = getdate(nowdate())
	rows = frappe.get_all(DOCTYPE, filters={"status": ["in", OPEN_STATUSES], "due_date": ["<=", today]},
		fields=["name", "title", "assigned_to", "assigned_by", "due_date", "reminded_on", "disease_name", "sub_county"])
	for t in rows:
		if t.assigned_by == t.assigned_to:
			continue   # a CHP's own referral record: no reminders
		if t.reminded_on and getdate(t.reminded_on) == today:
			continue
		due_today = getdate(t.due_date) == today
		subject = f"{'Due today' if due_today else 'Overdue'}: {t.title} ({t.disease_name or ''}, {t.sub_county or ''})"
		try:
			_in_app(t.assigned_to, subject, t.name)
			if due_today:
				_email(t.assigned_to, subject, [("Task", escape_html(t.title)), ("Due", str(t.due_date))], t.name)
			frappe.db.set_value(DOCTYPE, t.name, "reminded_on", today, update_modified=False)
		except Exception:
			frappe.log_error(title="Task reminder failed", message=frappe.get_traceback())
	frappe.db.commit()
