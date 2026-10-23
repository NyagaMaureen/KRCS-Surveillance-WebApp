"""KRCS Response Support Chatbot client. Contract: agents/chatbot/docs/frappe_interface.md §3.

The chatbot is a separate service (agents/chatbot); its URL and token are in WhatsApp Settings.
"""

import requests


class ChatbotError(Exception):
	pass


class ChatbotClient:
	def __init__(self, url, token=None, timeout=10):
		self.url = url.rstrip("/") + "/chat"
		self.headers = {
			"Accept": "application/json",
			**({"Authorization": f"Bearer {token}"} if token else {}),
		}
		self.timeout = timeout

	def post(self, body):
		r = requests.post(self.url, json=body, headers=self.headers, timeout=self.timeout)
		if not r.ok:
			raise ChatbotError(f"POST /chat -> {r.status_code}", r.status_code)
		return r.json()

	def ask(self, req):
		"""Retries once on a timeout, connection error or 5xx."""
		body = {
			"message": str(req["message"])[:2000],
			"roles": req.get("roles") or ["Guest"],
			"language": req.get("language"),
			"location": req.get("location"),
			"selected_protocol_id": req.get("selected_protocol_id"),
			"user_ref": req.get("user_ref"),
			"request_id": req.get("request_id"),
			"capabilities": req.get("capabilities") or [],
		}
		try:
			return self.post(body)
		except ChatbotError as e:
			if e.args[1] < 500:
				raise
		except requests.RequestException:
			pass
		try:
			return self.post(body)
		except requests.RequestException as e:
			raise ChatbotError(str(e)) from e
