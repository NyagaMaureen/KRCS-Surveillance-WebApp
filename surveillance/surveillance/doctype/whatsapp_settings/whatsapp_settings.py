# Copyright (c) 2026, Good Partners and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_url

WEBHOOK_PATH = "/api/method/surveillance.whatsapp.webhook.webhook"


class WhatsAppSettings(Document):
	@property
	def webhook_url(self):
		return get_url(WEBHOOK_PATH)

	def validate(self):
		from surveillance.whatsapp.conversation import normalize_phone
		from surveillance.whatsapp.jobs import numbers

		# The Cloud API needs international numbers: 0712… becomes 254712….
		for field in ("notify_numbers", "escalation_numbers"):
			self.set(
				field,
				"\n".join(normalize_phone(n, self.country_code or "254") for n in numbers(self.get(field))),
			)
		if self.welcome_image_url and not self.welcome_image_url.startswith("https://"):
			frappe.throw(_("Welcome Image URL must start with https://"))

	def on_update(self):
		from surveillance.whatsapp.data import clear_staff_cache

		clear_staff_cache()  # the country code changes how mobile numbers are matched

	@frappe.whitelist()
	def send_test_message(self, to: str):
		"""Desk button: check the token and number by sending one text message."""
		frappe.only_for("System Manager")
		from surveillance.whatsapp.jobs import numbers, whatsapp_client
		from surveillance.whatsapp.messages import text

		to = (numbers(to) or [None])[0]
		if not to:
			frappe.throw(_("Enter a WhatsApp number, e.g. 254712345678"))
		whatsapp_client(self).send(to, text("KRCS surveillance: WhatsApp test message."))
		return to
