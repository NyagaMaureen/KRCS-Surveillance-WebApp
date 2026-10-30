"""Endpoints for the mobile app and the WhatsApp bot (David, batch 1).

All are whitelisted Frappe methods: /api/method/surveillance.field_api.<name>

  submit_case_report(report)            idempotent report submit (client_ref)
  get_reporter_advice(disease)          what the reporter should do now (protocol steps ticked "Show to reporters")
  get_api_credentials(device_id)        per-phone sync key (field users; switched on in site config)
  revoke_api_credentials(device_id)     cut off one phone
  register_push_token(token)            Expo push token for this phone
  unregister_push_token(token)

Settings (site config, never in code):
  bench --site <site> set-config field_api_tokens 1     # allow field users to get API tokens
  bench --site <site> set-config expo_access_token "<token>"   # only if Expo "enhanced push security" is on
"""
import frappe
from frappe import _
from frappe.utils import cint, get_datetime, get_fullname, now_datetime

from surveillance.capabilities import has_capability, require_capability

UNUSUAL_EVENT = "unusual-event"   # protocol used when no case definition matches (same as protocols.GENERIC_EVENT)
FIELD_CAPS = ("create_reports", "receive_tasks")


def _ref(client_ref):
	ref = (client_ref or "").strip()
	if len(ref) > 64:
		frappe.throw(_("client_ref must be 64 characters or fewer."))
	return ref or None


# ---------- 1. idempotent report submit ----------

@frappe.whitelist(methods=["POST"])
def submit_case_report(report):
	"""Create a Case Report. If one with the same client_ref already exists, return it instead (safe to retry).

	report: the Case Report fields as JSON (same as frappe.client.insert), plus optional
	  client_ref (string, max 64), queued_at (when the phone queued it), sync_attempts (int).
	Returns {"name": "RPT-001", "duplicate": false}.
	"""
	require_capability("create_reports")
	data = frappe.parse_json(report) if isinstance(report, str) else dict(report or {})
	data.pop("name", None)
	data["doctype"] = "Case Report"
	ref = _ref(data.get("client_ref"))
	data["client_ref"] = ref
	if ref:
		existing = frappe.db.get_value("Case Report", {"client_ref": ref}, "name")
		if existing:
			_count_attempt(existing, data.get("sync_attempts"))
			return {"name": existing, "duplicate": True}
	if data.get("queued_at"):
		data["queued_at"] = get_datetime(data["queued_at"])
	data["sync_attempts"] = cint(data.get("sync_attempts")) or 1
	try:
		doc = frappe.get_doc(data).insert()
	except (frappe.UniqueValidationError, frappe.DuplicateEntryError):
		# two retries arrived at the same moment: the other one won
		frappe.db.rollback()
		existing = frappe.db.get_value("Case Report", {"client_ref": ref}, "name") if ref else None
		if not existing:
			raise
		return {"name": existing, "duplicate": True}
	return {"name": doc.name, "duplicate": False}


def _count_attempt(name, attempts):
	if attempts:
		current = cint(frappe.db.get_value("Case Report", name, "sync_attempts"))
		if cint(attempts) > current:
			frappe.db.set_value("Case Report", name, "sync_attempts", cint(attempts), update_modified=False)


# 4. Append-only report updates and sync stats: see surveillance/reports.py


# ---------- 5. advice for the reporter ----------

def advice_steps(protocol_doc):
	"""Steps a reporter should see. Steps ticked 'Show to reporters' win; a protocol with no ticks yet falls back to
	steps whose 'Responsible' mentions CHPs, the community or volunteers (what the app and bot did before)."""
	if not protocol_doc:
		return []
	steps = protocol_doc.get("steps") or []
	ticked = [s for s in steps if s.get("show_to_reporters")]
	if not ticked:
		import re
		ticked = [s for s in steps if re.search(r"\b(chps?|community|volunteers?)\b", s.responsible or "", re.I)]
	return [{"step": s.step, "timeframe": s.timeframe or None} for s in ticked]


def _protocol(disease):
	if not disease:
		return None
	from surveillance.protocols import approved_for
	return approved_for(disease)


@frappe.whitelist()
def get_reporter_advice(disease=None, case_report=None):
	"""What the reporter should do now. Steps come from the disease's protocol (ticked 'Show to reporters').
	If the disease is unknown, has no protocol or no ticked steps, the unusual-event protocol is used."""
	if not (has_capability("create_reports") or has_capability("receive_tasks")):
		frappe.throw(_("You do not have permission to perform this action."), frappe.PermissionError)
	if case_report and not disease:
		disease = frappe.db.get_value("Case Report", case_report, "suspected_disease")
	proto = _protocol(disease)
	steps = advice_steps(proto)
	fallback = False
	if not steps:
		fallback = True
		proto = _protocol(UNUSUAL_EVENT)
		steps = advice_steps(proto)
	name = frappe.db.get_value("Alert Threshold Config", disease, "disease_name") if disease else None
	return {"disease": disease or None, "diseaseName": name, "protocol": proto.title if proto else None,
		"fallback": fallback, "advice": steps}


# ---------- 8. per-device sync keys ----------
# One key per phone (Device Key), not per user, so signing in on a second phone never cuts off the first,
# and signing out (or an admin ticking Revoked in Desk) cuts off only that phone.
# Requests send:  Authorization: device <key>:<secret>     (checked by device_auth, hooks.auth_hooks)

def _is_field_user():
	return any(has_capability(c) for c in FIELD_CAPS)


@frappe.whitelist(methods=["POST"])
def get_api_credentials(device_id, device_name=None):
	"""Call once after login. Returns this phone's key and secret; calling again from the same phone returns the
	same pair (nothing is regenerated). device_id: a stable ID the app keeps for this install.
	Switched off unless site config field_api_tokens = 1."""
	if not cint(frappe.conf.get("field_api_tokens")):
		frappe.throw(_("Sync keys for field users are not switched on."), frappe.PermissionError)
	if frappe.session.user in ("Guest", "Administrator") or not _is_field_user():
		frappe.throw(_("Only field users can get sync keys."), frappe.PermissionError)
	device_id = (device_id or "").strip()[:100]
	if not device_id:
		frappe.throw(_("device_id is required."))
	from frappe.utils.password import get_decrypted_password
	name = frappe.db.get_value("Device Key", {"user": frappe.session.user, "device_id": device_id, "revoked": 0}, "name")
	if name:
		key = frappe.db.get_value("Device Key", name, "key")
		secret = get_decrypted_password("Device Key", name, "secret")
		if device_name:
			frappe.db.set_value("Device Key", name, "device_name", device_name[:140])
	else:
		key, secret = frappe.generate_hash(length=20), frappe.generate_hash(length=32)
		frappe.get_doc({"doctype": "Device Key", "user": frappe.session.user, "device_id": device_id,
			"device_name": (device_name or "")[:140] or None, "key": key, "secret": secret}).insert(ignore_permissions=True)
	return {"key": key, "secret": secret, "authorization": f"device {key}:{secret}"}


@frappe.whitelist(methods=["POST"])
def revoke_api_credentials(device_id=None):
	"""Call on sign-out: cuts off this phone only. Without device_id, the key used for this request is revoked.
	Admins revoke a lost phone in Desk (Device Key -> Revoked)."""
	filters = {"user": frappe.session.user, "revoked": 0}
	if device_id:
		filters["device_id"] = device_id.strip()[:100]
	elif getattr(frappe.local, "device_key", None):
		filters["name"] = frappe.local.device_key
	else:
		return {"ok": True, "revoked": 0}
	names = frappe.get_all("Device Key", filters=filters, pluck="name")
	for n in names:
		frappe.db.set_value("Device Key", n, "revoked", 1)
	return {"ok": True, "revoked": len(names)}


def device_auth():
	"""hooks.auth_hooks: log the request in as the phone's user when it sends  Authorization: device <key>:<secret>."""
	header = frappe.get_request_header("Authorization") or ""
	if not header.lower().startswith("device "):
		return
	try:
		key, secret = header[7:].strip().split(":", 1)
	except ValueError:
		return
	row = frappe.db.get_value("Device Key", {"key": key, "revoked": 0}, ["name", "user"], as_dict=True)
	if not row:
		return
	from frappe.utils.password import get_decrypted_password
	import hmac
	stored = get_decrypted_password("Device Key", row.name, "secret", raise_exception=False) or ""
	if not hmac.compare_digest(stored, secret):
		return
	if not frappe.db.get_value("User", row.user, "enabled"):
		return
	frappe.set_user(row.user)
	frappe.local.device_key = row.name
	frappe.db.set_value("Device Key", row.name, "last_used", now_datetime(), update_modified=False)


# ---------- push notifications (Expo) ----------

def _valid_token(token):
	return isinstance(token, str) and token.startswith(("ExponentPushToken[", "ExpoPushToken[")) and token.endswith("]")


@frappe.whitelist(methods=["POST"])
def register_push_token(token, platform=None, device_name=None):
	"""Save this phone's Expo push token for the logged-in user (call after login and when the token changes)."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Log in first."), frappe.PermissionError)
	token = (token or "").strip()
	if not _valid_token(token):
		frappe.throw(_("Not an Expo push token."))
	platform = platform if platform in ("android", "ios") else None
	name = frappe.db.get_value("Push Device", {"token": token}, "name")
	values = {"user": frappe.session.user, "platform": platform, "device_name": (device_name or "")[:140] or None,
		"last_seen": now_datetime()}
	if name:
		frappe.db.set_value("Push Device", name, values)   # same phone, maybe a different user now
	else:
		frappe.get_doc({"doctype": "Push Device", "token": token, **values}).insert(ignore_permissions=True)
	return {"ok": True}


@frappe.whitelist(methods=["POST"])
def unregister_push_token(token):
	"""Call on logout so this phone stops getting this user's notifications."""
	name = frappe.db.get_value("Push Device", {"token": (token or "").strip(), "user": frappe.session.user}, "name")
	if name:
		frappe.delete_doc("Push Device", name, ignore_permissions=True)
	return {"ok": True}


# ---------- optimistic locking (offline edits) ----------

class ConflictError(frappe.ValidationError):
	http_status_code = 409


def check_expected(expected, current, by=None, at=None):
	"""If the app sends `expected` (the value it last saw) and the server now holds something else, refuse with 409
	"Changed by <user> at <time>" so the app can ask the user what to keep. No `expected` = no check."""
	if expected is None:
		return
	if str(expected or "").strip() == str(current or "").strip():
		return
	who = get_fullname(by) if by else "someone"
	when = frappe.utils.format_datetime(at, "d MMM yyyy, HH:mm") if at else "an unknown time"
	frappe.throw(_("Changed by {0} at {1}.").format(who, when), ConflictError, title=_("Changed by someone else"))
