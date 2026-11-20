"""Questions answered from the Knowledge Base (surveillance.knowledge_base.ask), as the web assistant and the mobile
app answer them. Called in the same process, so no URL or token.

Staff ask as themselves: their roles, scope and level decide what they see, exactly as when they ask in the app.
A community member is asked for by the WhatsApp service with on_behalf_of "whatsapp:<pseudonym>", which gets only
approved Public documents (site config kb_public_enabled); their number never reaches the Knowledge Base.

Answers are always verbatim approved text (mode "verbatim"): generated summaries stay off on WhatsApp until KRCS
approves them, and so does the trusted-website fallback (see ask.py).
"""

import frappe

LANGUAGES = {"en": "English", "sw": "Kiswahili"}
PUBLIC_PREFIX = "whatsapp:"
SERVICE_USER = "Administrator"  # holds kb_service; only ever used to ask for a "whatsapp:" public reference


class KnowledgeError(Exception):
	"""The Knowledge Base could not answer (not set up, unavailable, access refused or too many questions)."""


class KnowledgeBase:
	def ask(self, question, lang=None, user=None, public_ref=None, conversation_id=None, request_id=None):
		"""One answer. `user`: the staff member's login; otherwise `public_ref` (a pseudonym) for a community member.
		Returns knowledge_base.ask's reply: {answer, mode, sources, used_sources, escalated, reason, log_id, ...}."""
		from surveillance import knowledge_base

		previous = frappe.session.user
		frappe.set_user(user or SERVICE_USER)  # nosemgrep
		try:
			return knowledge_base.ask(
				query=question,
				language=LANGUAGES.get(lang, "English"),
				channel="WhatsApp",
				correlation_id=request_id,
				conversation_id=conversation_id,
				on_behalf_of=None if user else PUBLIC_PREFIX + public_ref,
				mode="verbatim",
			)
		except Exception as e:
			raise KnowledgeError(f"{type(e).__name__}: {e}"[:300]) from e
		finally:
			frappe.set_user(previous)  # nosemgrep
