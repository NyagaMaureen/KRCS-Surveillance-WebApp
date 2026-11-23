"""Chatbot service client (agents/chatbot): what kind of message a question is (POST /classify-intent).

Questions are answered by the Knowledge Base (knowledge.py), not by this service. Its URL and token are in
WhatsApp Settings; free-text reports use its POST /extract too (extract.py).
"""

import requests


class ChatbotError(Exception):
	pass


class ChatbotClient:
	def __init__(self, url, token=None, timeout=10):
		self.base = url.rstrip("/")
		self.headers = {
			"Accept": "application/json",
			**({"Authorization": f"Bearer {token}"} if token else {}),
		}
		# Classification is a quick lookup: a slow service shouldn't hold up the answer.
		self.timeout = min(timeout, 5)

	def classify(self, message):
		"""{"intent": protocol_query | signal_report | mixed | greeting | report_count | app_services | unknown,
		"confidence", "signals"}. No retry: the question is answered anyway."""
		try:
			r = requests.post(
				self.base + "/classify-intent",
				json={"text": str(message)[:2000]},
				headers=self.headers,
				timeout=self.timeout,
			)
		except requests.RequestException as e:
			raise ChatbotError(str(e)) from e
		if not r.ok:
			raise ChatbotError(f"POST /classify-intent -> {r.status_code}")
		return r.json()
