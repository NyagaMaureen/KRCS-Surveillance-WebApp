"""Signing in and passwords for the KRCS app (KRCS 18 Nov 2026).

- Forgot password: the login page asks for the email; a KRCS email with a link to the app's own "Choose a new
  password" page is sent (never says whether the email has an account).
- An admin (Manage users) can send the same email to a user from User Management.
- The new password is saved with Frappe's update_password, so the Security Settings apply: password rules and
  minimum strength, sign out other sessions after a reset, and the link lasting as long as System Settings says.
"""
from urllib.parse import parse_qs, urlparse

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, escape_html

STRENGTH = {2: "Medium", 3: "Strong", 4: "Very strong"}


def _app_url():
	return (frappe.conf.get("frontend_url") or (frappe.utils.get_url() + "/surveillance")).rstrip("/")


def _link_valid_for():
	secs = cint(frappe.db.get_single_value("System Settings", "reset_password_link_expiry_duration"))
	if not secs:
		return "It can be used once."
	if secs % 86400 == 0:
		n = secs // 86400
		return f"It works for {n} day{'s' if n != 1 else ''} and can be used once."
	if secs % 3600 == 0:
		n = secs // 3600
		return f"It works for {n} hour{'s' if n != 1 else ''} and can be used once."
	n = max(1, secs // 60)
	return f"It works for {n} minute{'s' if n != 1 else ''} and can be used once."


def _send_reset(user, asked_by=None):
	"""Make a reset key and email the link to the app's own page. Raises on mail errors."""
	doc = frappe.get_doc("User", user)
	doc.validate_reset_password()
	frappe_link = doc._reset_password(send_email=False)   # saves a new one-time key on the user
	key = (parse_qs(urlparse(frappe_link).query).get("key") or [""])[0]
	link = f"{_app_url()}/reset-password?key={key}"
	who = escape_html(doc.first_name or doc.full_name or "")
	intro = (f"{escape_html(asked_by)} has asked for a new password to be set on your KRCS surveillance account "
		f"({escape_html(doc.email)})." if asked_by else
		f"We received a request to reset the password for your KRCS surveillance account ({escape_html(doc.email)}).")
	html = (
		f'<p style="font-size:15px">Hello{" " + who if who else ""},</p>'
		f'<p style="font-size:14px">{intro}</p>'
		f'<p style="margin:20px 0"><a href="{link}" style="background:#dc2626;color:#fff;padding:10px 16px;'
		f'border-radius:8px;text-decoration:none;font-weight:600">Reset password</a></p>'
		f'<p style="font-size:14px">{_link_valid_for()} If you did not ask for this, ignore this email: your password '
		f'stays the same.</p>'
		f'<p style="font-size:12px;color:#6b7280;margin-top:16px">Sent by the KRCS AI-enabled surveillance system.</p>'
	)
	frappe.sendmail(recipients=[doc.email], subject="Reset your KRCS surveillance password", message=html,
		delayed=False, retry=3)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=60 * 60)
def request_password_reset(email):
	"""Login page: always the same answer, so nobody can find out which emails have an account."""
	email = (email or "").strip()
	try:
		user = frappe.db.get_value("User", {"name": email}) or frappe.db.get_value("User", {"email": email})
		if user and user not in ("Administrator", "Guest") and frappe.db.get_value("User", user, "enabled"):
			_send_reset(user)
	except Exception:
		frappe.clear_messages()
		frappe.log_error(title="Password reset email failed", message=frappe.get_traceback())
	return {"message": "If this email is linked to an account, a password reset link is on its way. It can take a few "
		"minutes to arrive, so check your spam folder too."}


@frappe.whitelist(methods=["POST"])
def send_password_reset(user):
	"""User Management: an admin sends a user the reset email."""
	from surveillance.capabilities import require_capability
	require_capability("manage_users")
	if user in ("Administrator", "Guest") or not frappe.db.exists("User", user):
		frappe.throw(_("This user cannot reset their password here."))
	if not frappe.db.get_value("User", user, "enabled"):
		frappe.throw(_("This account is deactivated. Set its status to Active first."))
	try:
		_send_reset(user, asked_by=frappe.utils.get_fullname(frappe.session.user))
	except frappe.OutgoingEmailError:
		frappe.throw(_("The email could not be sent. Check the outgoing email account in Desk."))
	return {"message": f"Password reset email sent to {frappe.db.get_value('User', user, 'email')}"}


@frappe.whitelist(allow_guest=True)
def password_rules():
	"""What the Security Settings ask of a new password, for the hints on the password forms."""
	s = frappe.get_cached_doc("System Settings")
	on = cint(s.enable_password_policy)
	score = cint(s.minimum_password_score) or 2
	if not on:
		hint = "Use 8 or more characters. Mixing letters, numbers and symbols makes it safer."
	else:
		hint = "Use 8 or more characters, mixing letters, numbers and symbols. Avoid names, dates and common words."
		if score >= 3:
			hint += " Longer is stronger: aim for 12 or more characters."
	return {"policy": bool(on), "strength": STRENGTH.get(score, "Medium") if on else None, "hint": hint}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=60 * 60)
def reset_password(key, new_password):
	"""The "Choose a new password" page (reset email link, or an expired password at login). Frappe saves the
	password (rules and strength checked, other sessions signed out when the Security Settings say so) and signs the
	person in; they are signed out again here so they log in with the new password (KRCS 18 Nov 2026)."""
	from frappe.core.doctype.user.user import update_password
	result = update_password(new_password, key=key)
	if frappe.local.response.get("http_status_code") == 410:
		return result   # the link has expired or was already used
	if frappe.session.user != "Guest":
		frappe.local.login_manager.logout()
	return {"message": "Password changed"}


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=10, seconds=60 * 60)
def change_password(old_password, new_password):
	"""Profile > Change password. The current password is checked here first: Frappe treats a wrong one as a failed
	login and clears the browser's sign-in, which left the page running as "Guest" (KRCS 18 Nov 2026). The new
	password is then saved by Frappe, so the password rules and "sign out other sessions" apply."""
	from frappe.core.doctype.user.user import update_password
	from frappe.utils.password import check_password
	user = frappe.session.user
	if user == "Guest":
		raise frappe.PermissionError
	try:
		check_password(user, old_password, delete_tracker_cache=False)
	except frappe.AuthenticationError:
		frappe.clear_messages()
		frappe.throw(_("Your current password is not correct."), title=_("Password not changed"))
	return update_password(new_password, logout_all_sessions=0, old_password=old_password)


@frappe.whitelist(methods=["POST"])
def deactivate_user(user):
	"""User Management: users are never deleted, only deactivated (KRCS 18 Nov 2026), so every report, referral and
	task keeps who did it. A deactivated user cannot log in and is signed out everywhere. Reactivate them by setting
	their status back to Active in Edit user."""
	from surveillance.capabilities import require_capability
	require_capability("manage_users")
	me = frappe.session.user
	if user in ("Administrator", "Guest") or not frappe.db.exists("User", user):
		frappe.throw(_("This account cannot be deactivated."))
	if user == me:
		frappe.throw(_("You cannot deactivate your own account."))
	if "System Manager" in frappe.get_roles(user) and "System Manager" not in frappe.get_roles(me):
		frappe.throw(_("Only a System Manager can deactivate this account."))
	doc = frappe.get_doc("User", user)
	doc.enabled = 0
	if doc.meta.has_field("account_status"):
		doc.account_status = "Inactive"
	doc.save(ignore_permissions=True)
	return {"message": f"{frappe.utils.get_fullname(user)} was deactivated and can no longer log in"}


def user_status_rules(doc, method=None):
	"""User validate hook: an Inactive or Suspended account is disabled, so it cannot log in, however the status was
	set (User Management, Desk or an import)."""
	if doc.get("account_status") in ("Inactive", "Suspended"):
		doc.enabled = 0


def end_sessions_when_disabled(doc, method=None):
	"""User on_update hook: a disabled account is signed out everywhere straight away."""
	if not doc.enabled and doc.has_value_changed("enabled"):
		from frappe.sessions import clear_sessions
		clear_sessions(user=doc.name, force=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=60, seconds=60 * 60)
def login_problem(usr, pwd):
	"""After a failed login, what to tell the person (KRCS 18 and 20 Nov 2026):
	- deactivated: only when the password was right, so it tells nothing to someone who does not know the password
	- attemptsLeft: wrong passwords left before the account is locked (Security Settings: Wrong password limit)
	- locked / lockedFor: the account is now locked, and for how many seconds
	Frappe locks only after one more wrong password than the limit; here the account is locked as soon as the limit
	is reached, so the number of tries matches the setting."""
	from frappe.auth import get_login_attempt_tracker
	from frappe.utils.password import check_password
	usr = (usr or "").strip()
	user = (frappe.db.get_value("User", {"name": usr}) or frappe.db.get_value("User", {"email": usr})
		or frappe.db.get_value("User", {"username": usr}))
	if not user or user in ("Administrator", "Guest"):
		return {"deactivated": False}
	if not frappe.db.get_value("User", user, "enabled"):
		try:
			check_password(user, pwd, delete_tracker_cache=False)
		except Exception:
			frappe.clear_messages()
			return {"deactivated": False}
		return {"deactivated": True}
	limit = cint(frappe.db.get_single_value("System Settings", "allow_consecutive_login_attempts"))
	if limit <= 0:
		return {"deactivated": False}
	lock_for = cint(frappe.db.get_single_value("System Settings", "allow_login_after_fail")) or 60
	tracker = get_login_attempt_tracker(user, raise_locked_exception=False)
	failed = cint(tracker.login_failed_count)
	if not failed:
		return {"deactivated": False}
	if failed >= limit:
		if failed == limit:
			tracker.login_failed_count = limit + 1   # locked now (Frappe would allow one more try)
		return {"deactivated": False, "locked": True, "lockedFor": lock_for, "attemptsLeft": 0}
	return {"deactivated": False, "attemptsLeft": limit - failed}
