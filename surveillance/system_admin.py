"""Data & AI Admin workspace (KRCS 18 Nov 2026): one role for the Data & AI Admin and ICT Admin designs.

Dashboard tabs (only what the system really records; no case or patient data):
  Overview          sign-ins, integrations, AI, data quality, errors, database size; recent admin changes; shortcuts
  AI Performance    Monitoring Report R38 plus the models in use (AI Model Metric from MLflow, AI Prediction)
  Integrations      Monitoring Reports R40 (integrations) and R40b (system health)
  Data Quality      Monitoring Report R37
Settings, real instead of the earlier placeholders:
  Security          password policy, sign-in lockout and session length (Frappe System Settings), people signed in
                    now (an admin can end a session) and recent sign-in events (Activity Log)
  Data and Database database size, scheduler, backups (list and run one now)
"""
import hashlib
import os
from datetime import datetime, timedelta

import frappe
from frappe.utils import add_days, cint, get_datetime, getdate, now_datetime, nowdate

from surveillance.capabilities import has_capability

DASHBOARD = ("dataai_workspace", "manage_roles")
SECURITY = "settings_security"
DATA = "settings_data"


def _require(*keys):
	if frappe.session.user == "Guest" or not any(has_capability(k) for k in keys):
		frappe.throw("You do not have permission to see this.", frappe.PermissionError)


def _period(from_date=None, to_date=None, days=28):
	to_d = getdate(to_date) if to_date else getdate(nowdate())
	from_d = getdate(from_date) if from_date else add_days(to_d, -(days - 1))
	return (from_d, to_d) if from_d <= to_d else (to_d, from_d)


def _db_size_mb():
	try:
		row = frappe.db.sql("""select sum(data_length + index_length) from information_schema.tables
			where table_schema = %s""", frappe.conf.db_name)
		return round((row[0][0] or 0) / 1024 / 1024, 1)
	except Exception:
		return None


def _report(key, from_d, to_d):
	from surveillance.monitoring import _build
	_r, _f, out = _build(key, {"from_date": str(from_d), "to_date": str(to_d)})
	return out


# ---------- dashboard ----------

ADMIN_DOCTYPES = {   # changes shown under Recent admin activity
	"User": "User account", "Alert Threshold Config": "Alert threshold", "Alert Threshold Settings": "Alert threshold settings",
	"Knowledge Document": "Knowledge base document", "Response Protocol": "Response protocol",
	"Community Health Unit": "Community Health Unit", "Risk Score Settings": "AI risk engine settings",
	"Risk Red Flag Symptom": "Red-flag symptom", "System Settings": "Security settings", "Escalation Contact": "Escalation contact",
	"Reporting Facility": "Reporting facility", "WhatsApp Settings": "WhatsApp settings",
}


def _activity(limit=8):
	from surveillance.capabilities import CAPABILITY_MAP
	types = [d for d in ADMIN_DOCTYPES if frappe.db.exists("DocType", d)]
	rows = []
	for v in frappe.get_all("Version", filters={"ref_doctype": ["in", types]}, fields=["ref_doctype", "docname", "owner", "creation"],
			order_by="creation desc", limit=limit):
		rows.append({"what": f"{ADMIN_DOCTYPES[v.ref_doctype]} changed", "item": v.docname, "by": v.owner, "on": v.creation})
	for u in frappe.get_all("User", filters={"name": ["not in", ["Administrator", "Guest"]]}, fields=["name", "owner", "creation"],
			order_by="creation desc", limit=limit):
		rows.append({"what": "User created", "item": u.name, "by": u.owner, "on": u.creation})
	for c in frappe.get_all("Role Capability", fields=["role", "capability", "owner", "creation"], order_by="creation desc", limit=limit):
		name = (CAPABILITY_MAP.get(c.capability) or {}).get("name") or c.capability
		rows.append({"what": "Permission given", "item": f"{name} to {c.role}", "by": c.owner, "on": c.creation})
	rows.sort(key=lambda r: get_datetime(r["on"]), reverse=True)
	names = {}
	for r in rows[:limit]:
		names.setdefault(r["by"], frappe.utils.get_fullname(r["by"]))
		r["by"] = names[r["by"]]
		r["on"] = str(r["on"])[:19]
	return rows[:limit]


@frappe.whitelist()
def get_overview():
	_require(*DASHBOARD)
	now = now_datetime()
	week = now - timedelta(days=7)
	day = now - timedelta(hours=24)
	signed_in = len(set(frappe.get_all("Activity Log", filters={"operation": "Login", "status": "Success", "creation": [">=", week]},
		pluck="user")))
	active = frappe.db.count("User", {"enabled": 1, "user_type": "System User", "name": ["not in", ["Administrator", "Guest"]]})
	cards = [
		{"key": "users", "label": "People who signed in", "value": signed_in, "note": f"last 7 days, of {active} active accounts"},
	]
	try:
		r40 = _report("R40", add_days(getdate(nowdate()), -6), getdate(nowdate()))
		rows = r40["detail"]["rows"]
		ok = sum(1 for r in rows if r.get("status") == "OK")
		cards.append({"key": "integrations", "label": "Integrations working", "value": f"{ok} of {len(rows)}",
			"note": f"{sum(1 for r in rows if r.get('status') in ('Warning', 'Down'))} need a look"})
	except Exception:
		frappe.log_error(title="Data & AI dashboard: integration status failed")
	try:
		from surveillance.monitoring import _filters, ai_measures
		f = _filters({"from_date": str(add_days(getdate(nowdate()), -27)), "to_date": nowdate()})
		top = next((m for m in ai_measures(f) if m["key"] == "top_suggestion"), None)
		if top:
			cards.append({"key": "ai", "label": "AI first suggestion right", "value": "—" if top["value"] is None else f"{top['value']}%",
				"note": "disease suggestions, last 4 weeks"})
	except Exception:
		frappe.log_error(title="Data & AI dashboard: AI measures failed")
	cards.append({"key": "errors", "label": "Application errors", "value": frappe.db.count("Error Log", {"creation": [">=", day]}),
		"note": "last 24 hours"})
	size = _db_size_mb()
	cards.append({"key": "database", "label": "Database size", "value": "—" if size is None else f"{size} MB", "note": "all tables"})

	kb = frappe.get_all("Knowledge Document", fields=["status"], limit_page_length=0) if frappe.db.exists("DocType", "Knowledge Document") else []
	counts = {
		"users": active,
		"roles": len(set(frappe.get_all("Role Capability", pluck="role"))),
		"kb": len(kb),
		"failed_logins": frappe.db.count("Activity Log", {"operation": "Login", "status": ["!=", "Success"], "creation": [">=", week]}),
		"sessions": frappe.db.count("Sessions") if frappe.db.table_exists("Sessions") else 0,
	}
	return {"cards": cards, "activity": _activity(), "counts": counts, "now": str(now)[:19]}


@frappe.whitelist()
def get_tab(report, from_date=None, to_date=None):
	"""One Monitoring Report (R37, R38, R40, R40b) for a dashboard tab; not logged as a report view."""
	_require(*DASHBOARD)
	from surveillance.monitoring import SYSTEM_REPORTS
	if report not in SYSTEM_REPORTS:
		frappe.throw("Unknown report.")
	from_d, to_d = _period(from_date, to_date)
	out = _report(report, from_d, to_d)
	keep = {"report", "title", "description", "period", "summary"}
	res = {k: v for k, v in out.items() if k in keep}
	if report == "R40":   # the integrations table is the point of this tab
		res["table"] = out["detail"]["tables"][0]
	return res


# measures shown on the dashboard, in this order (the rest stay in MLflow)
KEY_MEASURES = [("accuracy", "Accuracy"), ("top3_accuracy", "Right disease in top 3"), ("macro_f1", "Macro F1"),
	("weighted_f1", "Weighted F1"), ("priority_recall_top3", "Priority diseases found (top 3)"), ("wer", "Word error rate"),
	("cer", "Character error rate"), ("symptoms_found", "Symptoms found")]
PERCENT = {"accuracy", "top3_accuracy", "priority_recall_top3", "wer", "cer", "symptoms_found"}


def _fmt_measure(key, value):
	return f"{round(value * 100, 1)}%" if key in PERCENT and value <= 1 else round(value, 2)


CLASSIFIER = "disease-classifier"   # the name push_model_metrics.py (AI server) sends the classifier's MLflow measures under
STT_LANG = {"en": "English", "sw": "Kiswahili", "mixed": "English and Kiswahili"}


def _model_label(model):
	if model == CLASSIFIER:
		return "Disease classifier"
	if model.startswith("speech-to-text-"):
		lang = model.rsplit("-", 1)[-1]
		return f"Speech to text ({STT_LANG.get(lang, lang)})"
	return model


@frappe.whitelist()
def get_models(from_date=None, to_date=None):
	"""Models in use: the measures the AI server sent from MLflow (AI Model Metric) and how often the disease
	classifier was used (AI Prediction), one row per model."""
	_require(*DASHBOARD)
	from_d, to_d = _period(from_date, to_date)
	start, end = get_datetime(f"{from_d} 00:00:00"), get_datetime(f"{to_d} 23:59:59")
	models = {}

	def row(key):
		return models.setdefault(key, {"model": _model_label(key), "version": "", "updated": "", "measures": {},
			"used": None, "lastUsed": None, "source": "MLflow"})

	if frappe.db.table_exists("AI Model Metric"):
		for r in frappe.get_all("AI Model Metric", fields=["model", "metric", "value", "model_version", "recorded_on"],
				order_by="recorded_on desc", limit=2000):
			m = row(r.model)
			if not m["updated"]:   # newest first: the version and date of the latest run
				m["version"], m["updated"] = r.model_version or "", str(r.recorded_on or "")[:16]
			m["measures"].setdefault(r.metric, round(r.value, 3))
	if frappe.db.table_exists("AI Prediction"):
		used = frappe.db.sql("""select model_version, count(*) n, max(predicted_on) last from `tabAI Prediction`
			where kind = 'Model' and predicted_on between %s and %s group by model_version order by last desc""", (start, end), as_dict=True)
		if used:
			m = row(CLASSIFIER)
			m["used"] = sum(cint(r.n) for r in used)
			m["lastUsed"] = str(used[0].last or "")[:16]
			serving = used[0].model_version or ""
			if serving and m["version"] and serving != m["version"]:
				m["note"] = f"Serving version {serving}; the measures are from version {m['version']}"
			m["version"] = m["version"] or serving
			if not m["measures"]:
				m["note"] = "No measures sent yet: run push_model_metrics.py on the AI server"
			m["source"] = "MLflow and the AI server"
	rows = sorted(models.values(), key=lambda m: (m["model"] != "Disease classifier", m["model"].lower()))
	for m in rows:
		all_ = m["measures"]
		# the headline measures only (MLflow sends ~100 for the classifier: per-disease recall etc.), as percentages
		m["measures"] = [{"metric": label, "value": _fmt_measure(k, all_[k])} for k, label in KEY_MEASURES if k in all_]
		m["more"] = max(0, len(all_) - len(m["measures"]))
	return {"models": rows, "period": f"{from_d.strftime('%-d %b %Y')} to {to_d.strftime('%-d %b %Y')}"}


# ---------- security ----------

PRIVILEGED_ROLES = {"System Manager", "Administrator"}


def validate_user_roles(doc, method=None):
	"""User validate hook: people who manage users without being System Managers (e.g. Data & AI Administrators)
	cannot give anyone the System Manager or Administrator role."""
	if frappe.session.user == "Administrator" or frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch:
		return
	if "System Manager" in frappe.get_roles():
		return
	before = set(frappe.get_all("Has Role", filters={"parent": doc.name, "parenttype": "User"}, pluck="role")) if not doc.is_new() else set()
	added = {r.role for r in doc.get("roles") or []} - before
	if added & PRIVILEGED_ROLES:
		frappe.throw("Only a System Manager can give the System Manager role.", frappe.PermissionError)

SESSION_OPTIONS = ["01:00", "04:00", "08:00", "12:00", "24:00", "72:00", "170:00"]


def _sid_key(sid):
	return hashlib.sha256((sid or "").encode()).hexdigest()[:16]


def _device(data):
	try:
		d = frappe.parse_json(data) if data else {}
		d = d.get("data", d) if isinstance(d, dict) else {}
		return (d.get("device") or "").title() or "Browser"
	except Exception:
		return "Browser"


@frappe.whitelist()
def get_security():
	_require(SECURITY)
	s = frappe.get_cached_doc("System Settings")
	settings = {
		"enable_password_policy": cint(s.enable_password_policy), "minimum_password_score": str(s.minimum_password_score or "2"),
		"force_user_to_reset_password": cint(s.force_user_to_reset_password),
		"allow_consecutive_login_attempts": cint(s.allow_consecutive_login_attempts),
		"allow_login_after_fail": cint(s.allow_login_after_fail), "session_expiry": s.session_expiry or "170:00",
		"logout_on_password_reset": cint(s.logout_on_password_reset),
	}
	mine = _sid_key(frappe.session.sid)
	sessions = []
	if frappe.db.table_exists("Sessions"):
		for r in frappe.db.sql("""select user, sid, ipaddress, lastupdate, sessiondata from `tabSessions`
				where user not in ('Guest') order by lastupdate desc limit 200""", as_dict=True):
			key = _sid_key(r.sid)
			sessions.append({"id": key, "user": r.user, "name": frappe.utils.get_fullname(r.user), "ip": r.ipaddress or "",
				"device": _device(r.sessiondata), "last": str(r.lastupdate or "")[:19], "current": key == mine})
	events = [{"user": e.user, "name": e.full_name or e.user, "ip": e.ip_address or "", "on": str(e.creation)[:19],
		"operation": e.operation, "status": e.status}
		for e in frappe.get_all("Activity Log", filters={"operation": ["in", ["Login", "Logout"]]},
			fields=["user", "full_name", "ip_address", "creation", "operation", "status"], order_by="creation desc", limit=30)]
	week = now_datetime() - timedelta(days=7)
	failed = frappe.db.count("Activity Log", {"operation": "Login", "status": ["!=", "Success"], "creation": [">=", week]})
	return {"settings": settings, "sessionOptions": SESSION_OPTIONS, "sessions": sessions, "events": events,
		"failedThisWeek": failed}


@frappe.whitelist(methods=["POST"])
def save_security(settings=None):
	_require(SECURITY)
	v = frappe.parse_json(settings) if isinstance(settings, str) else (settings or {})
	s = frappe.get_doc("System Settings")
	if "enable_password_policy" in v:
		s.enable_password_policy = 1 if cint(v["enable_password_policy"]) else 0
	if "minimum_password_score" in v:
		if str(v["minimum_password_score"]) not in ("2", "3", "4"):
			frappe.throw("Choose a password strength.")
		s.minimum_password_score = str(v["minimum_password_score"])
	if "force_user_to_reset_password" in v:
		s.force_user_to_reset_password = max(0, min(365, cint(v["force_user_to_reset_password"])))
	if "allow_consecutive_login_attempts" in v:
		s.allow_consecutive_login_attempts = max(0, min(20, cint(v["allow_consecutive_login_attempts"])))
	if "allow_login_after_fail" in v:
		s.allow_login_after_fail = max(10, min(86400, cint(v["allow_login_after_fail"])))
	if "session_expiry" in v:
		if v["session_expiry"] not in SESSION_OPTIONS:
			frappe.throw("Choose a session length.")
		s.session_expiry = v["session_expiry"]
	if "logout_on_password_reset" in v:
		s.logout_on_password_reset = 1 if cint(v["logout_on_password_reset"]) else 0
	s.flags.ignore_permissions = True
	s.save()   # kept in the Version history, so it shows in the Audit Log
	return get_security()


@frappe.whitelist(methods=["POST"])
def end_session(id):
	"""Sign someone out (their session ends; they sign in again). Not your own current session."""
	_require(SECURITY)
	if id == _sid_key(frappe.session.sid):
		frappe.throw("This is your own session. Use Log out instead.")
	from frappe.sessions import delete_session
	for r in frappe.db.sql("select sid, user from `tabSessions`", as_dict=True):
		if _sid_key(r.sid) == id:
			delete_session(r.sid, r.user, reason=f"Signed out by {frappe.utils.get_fullname(frappe.session.user)}")
			return {"ended": r.user}
	frappe.throw("That session has already ended.")


# ---------- data and database ----------

def _backups():
	path = frappe.get_site_path("private", "backups")
	if not os.path.isdir(path):
		return []
	out = []
	for name in os.listdir(path):
		full = os.path.join(path, name)
		if os.path.isfile(full) and (name.endswith(".sql.gz") or name.endswith(".sql")):
			st = os.stat(full)
			out.append({"file": name, "sizeMb": round(st.st_size / 1024 / 1024, 1),
				"on": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")})
	return sorted(out, key=lambda b: b["on"], reverse=True)[:10]


@frappe.whitelist()
def get_data_overview():
	_require(DATA)
	tables = []
	try:
		tables = [{"table": r[0].removeprefix("tab"), "mb": round((r[1] or 0) / 1024 / 1024, 1)} for r in frappe.db.sql(
			"""select table_name, data_length + index_length from information_schema.tables where table_schema = %s
			order by 2 desc limit 8""", frappe.conf.db_name)]
	except Exception:
		pass
	from frappe.utils.scheduler import is_scheduler_disabled
	return {"sizeMb": _db_size_mb(), "largest": tables, "backups": _backups(),
		"scheduler": "Off" if is_scheduler_disabled(verbose=False) else "On"}


@frappe.whitelist(methods=["POST"])
def run_backup():
	"""Back up the database now (in the background; takes a minute). Files stay on the server."""
	_require(DATA)
	frappe.enqueue("frappe.utils.backups.new_backup", queue="long", ignore_files=True, force=True, timeout=1800)
	return {"started": True}


# ---------- system alerts for Data & AI Administrators (in the app only, KRCS 18 Nov 2026) ----------

ALERT_PREFIX = "System Alert:"        # Notification Log document_name; the bell opens the page in ALERT_LINKS
ALERT_LINKS = {"integrations": "/dashboard?tab=integrations", "security": "/settings?tab=security", "data": "/settings?tab=data"}
FAILED_LOGINS_PER_HOUR = 10
ERRORS_PER_HOUR = 20
BACKUP_HOURS = 36


def alert_link(name):
	"""Where a system alert opens (notifications._link_for)."""
	return ALERT_LINKS.get((name or "").removeprefix(ALERT_PREFIX).split(":", 1)[0])


def _admins():
	roles = frappe.get_all("Role Capability", filters={"capability": "dataai_workspace"}, pluck="role")
	users = set(frappe.get_all("Has Role", filters={"role": ["in", roles or [""]], "parenttype": "User"}, pluck="parent"))
	return [u for u in users - {"Administrator", "Guest"} if frappe.db.get_value("User", u, "enabled")]


def _alert(users, page, key, subject):
	"""One bell notification per problem per day for each Data & AI Administrator (no email)."""
	name = f"{ALERT_PREFIX}{page}:{key}"
	today = get_datetime(f"{nowdate()} 00:00:00")
	for u in users:
		if frappe.db.exists("Notification Log", {"for_user": u, "document_name": name, "creation": [">=", today]}):
			continue
		doc = frappe.get_doc({"doctype": "Notification Log", "for_user": u, "type": "Alert", "document_type": "DocType",
			"document_name": name, "subject": subject})
		doc.flags.ignore_links = True
		doc.insert(ignore_permissions=True)


def check_system():
	"""Scheduler (hourly): integrations down or needing a look, failed background jobs, many failed sign-ins or
	errors in the last hour, and no recent database backup."""
	users = _admins()
	if not users:
		return
	now = now_datetime()
	hour = now - timedelta(hours=1)
	try:
		from surveillance.monitoring import _filters, _r40
		f = _filters({"from_date": str(add_days(getdate(nowdate()), -6)), "to_date": nowdate()})
		for r in _r40(f)["rows"]:
			if r["status"] in ("Warning", "Down"):
				state = "is down" if r["status"] == "Down" else "needs a look"
				_alert(users, "integrations", r["integration"], f"{r['integration']} {state}: {r['note'] or 'see Integrations'}")
	except Exception:
		frappe.log_error(title="System alerts: integration check failed")
	jobs = frappe.get_all("Scheduled Job Log", filters={"status": "Failed", "creation": [">=", hour]}, pluck="scheduled_job_type")
	if jobs:
		names = ", ".join(sorted({(j or "").rsplit(".", 1)[-1] for j in jobs}))
		_alert(users, "integrations", "jobs", f"{len(jobs)} background job{'' if len(jobs) == 1 else 's'} failed in the last hour: {names}")
	errors = frappe.db.count("Error Log", {"creation": [">=", hour]})
	if errors >= ERRORS_PER_HOUR:
		_alert(users, "integrations", "errors", f"{errors} application errors in the last hour")
	failed = frappe.get_all("Activity Log", filters={"operation": "Login", "status": ["!=", "Success"], "creation": [">=", hour]},
		pluck="user")
	if len(failed) >= FAILED_LOGINS_PER_HOUR:
		who = ", ".join(sorted({u for u in failed if u})[:5]) or "unknown accounts"
		_alert(users, "security", "logins", f"{len(failed)} failed sign-ins in the last hour ({who})")
	backups = _backups()
	newest = get_datetime(backups[0]["on"]) if backups else None
	if not newest or (now - newest).total_seconds() > BACKUP_HOURS * 3600:
		_alert(users, "data", "backup", "No database backup in the last 36 hours" if newest else "No database backup on the server yet")
	frappe.db.commit()
