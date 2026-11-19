"""Voice note -> text, through the speech-to-text service on the AI server (POST /transcribe, AI/ML §6.3, §7.2).

The service surveillance.transcription uses for officers' transcripts, with its site config (`stt_url`, `stt_token`)
and its request: the audio as the form field `file`, the form field `language` (`en`, `sw` or `auto`), a bearer token.
It returns {"text", "language"}.
Does not import frappe: the client is built in jobs.make_context. The conversation falls back to asking the
reporter to type when the service is off, fails, or hears nothing.
"""

import requests


class TranscriptionClient:
	def __init__(self, url, token=None, timeout=45):
		self.url = url.rstrip("/") + "/transcribe"
		self.headers = {"Accept": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})}
		self.timeout = timeout

	def transcribe(self, audio, mime_type=None, filename=None, language="auto"):
		"""{"text", "language"}, or None when nothing was heard. No retry: a voice note is slow to process and the
		reporter is waiting."""
		r = requests.post(
			self.url,
			files={"file": (filename or "voice-note", audio, mime_type or "application/octet-stream")},
			data={"language": language} if language else None,
			headers=self.headers,
			timeout=self.timeout,
		)
		r.raise_for_status()
		body = r.json()
		text = (body.get("text") or "").strip()
		if not text:
			return None
		return {"text": text, "language": body.get("language")}
