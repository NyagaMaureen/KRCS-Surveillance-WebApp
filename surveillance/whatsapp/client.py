"""WhatsApp Cloud API: webhook parsing and signature check, outgoing payloads, sending, media download.

Graph API reference: https://developers.facebook.com/docs/whatsapp/cloud-api
"""

import hashlib
import hmac

import requests

GRAPH = "https://graph.facebook.com"
TIMEOUT = 30


class WhatsAppError(Exception):
	pass


class WhatsAppClient:
	def __init__(self, access_token, phone_number_id, graph_version="v23.0"):
		self.base = f"{GRAPH}/{graph_version}"
		self.phone_number_id = phone_number_id
		self.s = requests.Session()
		self.s.headers["Authorization"] = f"Bearer {access_token}"

	def post(self, body):
		r = self.s.post(f"{self.base}/{self.phone_number_id}/messages", json=body, timeout=TIMEOUT)
		if not r.ok:
			try:
				e = r.json().get("error") or {}
			except ValueError:
				e = {}
			raise WhatsAppError(
				f"WhatsApp API {r.status_code} (code {e.get('code', '?')}): {e.get('message') or r.reason}"
			)
		return r.json()

	def send(self, to, msg):
		return self.post(to_payload(to, msg))

	def mark_read(self, message_id):
		"""Blue ticks plus a typing indicator until the reply arrives."""
		return self.post(
			{
				"messaging_product": "whatsapp",
				"status": "read",
				"message_id": message_id,
				"typing_indicator": {"type": "text"},
			}
		)

	def download_media(self, media_id):
		"""Media IDs from webhooks are valid for 30 days; the download URL itself only for about 5 minutes."""
		meta = self.s.get(f"{self.base}/{media_id}", timeout=TIMEOUT)
		meta.raise_for_status()
		meta = meta.json()
		f = self.s.get(meta["url"], timeout=120)
		f.raise_for_status()
		return f.content, meta.get("mime_type")


def to_payload(to, msg):
	base = {"messaging_product": "whatsapp", "recipient_type": "individual", "to": to}
	frame = {
		**({"header": {"type": "text", "text": msg["header"]}} if msg.get("header") else {}),
		"body": {"text": msg.get("body")},
		**({"footer": {"text": msg["footer"]}} if msg.get("footer") else {}),
	}
	kind = msg["kind"]
	if kind == "text":
		return {**base, "type": "text", "text": {"body": msg["body"], "preview_url": False}}
	if kind == "image":
		return {**base, "type": "image", "image": {"link": msg["link"]}}
	if kind == "buttons":
		buttons = [{"type": "reply", "reply": {"id": b["id"], "title": b["title"]}} for b in msg["buttons"]]
		return {
			**base,
			"type": "interactive",
			"interactive": {"type": "button", **frame, "action": {"buttons": buttons}},
		}
	if kind == "list":
		return {
			**base,
			"type": "interactive",
			"interactive": {
				"type": "list",
				**frame,
				"action": {"button": msg["button"], "sections": msg["sections"]},
			},
		}
	if kind == "location_request":
		return {
			**base,
			"type": "interactive",
			"interactive": {
				"type": "location_request_message",
				"body": {"text": msg["body"]},
				"action": {"name": "send_location"},
			},
		}
	if kind == "template":
		params = [{"type": "text", "text": str(p)[:1000]} for p in msg.get("params") or []]
		return {
			**base,
			"type": "template",
			"template": {
				"name": msg["name"],
				"language": {"code": msg["lang"]},
				"components": [{"type": "body", "parameters": params}] if params else [],
			},
		}
	raise ValueError(f"Unknown message kind: {kind}")


def verify_signature(raw_body, header, app_secret):
	"""X-Hub-Signature-256 = "sha256=" + HMAC-SHA256 of the raw request body with the App Secret."""
	if not app_secret or not header or not header.startswith("sha256="):
		return False
	expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
	return hmac.compare_digest(header[7:], expected)


def parse_webhook(body):
	"""Incoming messages as {id, from, name, timestamp, input}. Status updates (sent/delivered/read) are ignored."""
	events = []
	for entry in (body or {}).get("entry") or []:
		for change in entry.get("changes") or []:
			v = change.get("value") or {}
			if not v.get("messages"):
				continue
			names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in v.get("contacts") or []}
			for m in v["messages"]:
				events.append(
					{
						"id": m["id"],
						"from": m["from"],
						"name": names.get(m["from"]),
						"timestamp": int(m.get("timestamp") or 0),
						"input": to_input(m),
					}
				)
	return events


def to_input(m):
	kind = m.get("type")
	if kind == "text":
		return {"type": "text", "text": (m.get("text") or {}).get("body", "")}
	if kind == "interactive":
		i = m.get("interactive") or {}
		r = i.get("button_reply") or i.get("list_reply")
		return (
			{"type": "reply", "id": r["id"], "title": r.get("title")}
			if r
			else {"type": "unsupported", "raw": i.get("type")}
		)
	if kind == "button":  # quick-reply button on a template message
		b = m.get("button") or {}
		return {"type": "reply", "id": b.get("payload"), "title": b.get("text")}
	if kind == "location":
		loc = m["location"]
		return {
			"type": "location",
			"lat": loc["latitude"],
			"lng": loc["longitude"],
			"name": loc.get("name"),
			"address": loc.get("address"),
		}
	if kind in ("image", "document", "audio", "video"):
		x = m.get(kind) or {}
		return {
			"type": "media",
			"kind": kind,
			"media_id": x.get("id"),
			"mime_type": x.get("mime_type"),
			"filename": x.get("filename"),
			"caption": x.get("caption"),
			"voice": x.get("voice"),
		}
	return {"type": "unsupported", "raw": kind}
