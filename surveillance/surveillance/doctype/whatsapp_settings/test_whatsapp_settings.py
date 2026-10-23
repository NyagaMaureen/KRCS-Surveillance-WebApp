# Copyright (c) 2026, Good Partners and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestWhatsAppSettings(FrappeTestCase):
	def test_webhook_url_and_numbers(self):
		doc = frappe.get_doc("WhatsApp Settings")
		self.assertTrue(doc.webhook_url.endswith("/api/method/surveillance.whatsapp.webhook.webhook"))
		doc.notify_numbers = "+254 712 345 678\n0700-000-001, 254799000000\n\n"
		doc.save()
		self.assertEqual(doc.notify_numbers, "254712345678\n254700000001\n254799000000")

	def test_welcome_image_must_be_https(self):
		doc = frappe.get_doc("WhatsApp Settings")
		doc.welcome_image_url = "http://example.org/logo.png"
		self.assertRaises(frappe.ValidationError, doc.save)
