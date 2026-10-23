"""The endpoint Meta calls: https://<site>/api/method/surveillance.whatsapp.webhook.webhook

GET   Meta's verification handshake: hub.challenge back as plain text if hub.verify_token matches.
POST  Signed with X-Hub-Signature-256 (HMAC-SHA256 of the raw body, App Secret). Answered with 200 at once;
      each new message is queued for a background job (jobs.process_inbox). Meta retries deliveries,
      so a message ID is processed only once (Redis key kept for 24 hours).
When WhatsApp Settings is not Enabled, the handshake still works but messages are ignored.
"""

import hmac
import json

import frappe
from frappe.utils import cint
from werkzeug.wrappers import Response

from surveillance.whatsapp.client import parse_webhook, verify_signature
from surveillance.whatsapp.data import settings
from surveillance.whatsapp.jobs import DAY, queue_message

SEEN = "whatsapp:seen:{}"


def _plain(body, status=200):
	return Response(body, status=status, mimetype="text/plain")


# Guest access is required: Meta calls this without a Frappe login. Every POST must carry Meta's signature;
# the endpoint only queues message IDs and returns "OK" (see the security notes in the review write-up).
@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])  # nosemgrep
def webhook(**kwargs):
	st = settings()
	if frappe.request.method == "GET":
		args = frappe.request.args
		token = st.get_password("verify_token", raise_exception=False) or ""
		ok = (
			args.get("hub.mode") == "subscribe"
			and token
			and hmac.compare_digest(args.get("hub.verify_token") or "", token)
		)
		return _plain(args.get("hub.challenge") or "", 200) if ok else _plain("Forbidden", 403)

	raw = frappe.request.get_data()
	app_secret = st.get_password("app_secret", raise_exception=False)
	if not verify_signature(raw, frappe.get_request_header("X-Hub-Signature-256"), app_secret):
		return _plain("Bad signature", 401)
	if not cint(st.enabled):
		return _plain("OK")
	for ev in parse_webhook(json.loads(raw)):
		# SET NX: true only the first time this message ID is seen. make_key adds the site prefix.
		if frappe.cache.set(frappe.cache.make_key(SEEN.format(ev["id"])), 1, nx=True, ex=DAY):  # nosemgrep
			queue_message(ev)
	return _plain("OK")
