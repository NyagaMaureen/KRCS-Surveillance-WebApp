"""Cloud API payloads, webhook parsing and signatures (no database needed)."""

import hashlib
import hmac
from types import SimpleNamespace

from frappe.tests.utils import FrappeTestCase

from surveillance.whatsapp.client import (
	MAX_MEDIA_BYTES,
	MediaTooLarge,
	WhatsAppClient,
	parse_statuses,
	parse_webhook,
	to_payload,
	verify_signature,
)
from surveillance.whatsapp.messages import menu


def wrap(message):
	return {
		"entry": [
			{
				"changes": [
					{
						"value": {
							"contacts": [{"wa_id": "254700000001", "profile": {"name": "Amina"}}],
							"messages": [message],
						}
					}
				]
			}
		]
	}


class TestClient(FrappeTestCase):
	def test_parses_replies_locations_and_voice_notes(self):
		[a] = parse_webhook(
			wrap(
				{
					"from": "254700000001",
					"id": "w1",
					"timestamp": "1",
					"type": "interactive",
					"interactive": {"type": "list_reply", "list_reply": {"id": "awd", "title": "x"}},
				}
			)
		)
		self.assertEqual(a["input"], {"type": "reply", "id": "awd", "title": "x"})
		self.assertEqual(a["name"], "Amina")
		[b] = parse_webhook(
			wrap(
				{
					"from": "1",
					"id": "w2",
					"timestamp": "1",
					"type": "location",
					"location": {"latitude": 0.05, "longitude": 40.3},
				}
			)
		)
		self.assertEqual((b["input"]["type"], b["input"]["lng"]), ("location", 40.3))
		[c] = parse_webhook(
			wrap(
				{
					"from": "1",
					"id": "w3",
					"timestamp": "1",
					"type": "audio",
					"audio": {"id": "m9", "mime_type": "audio/ogg", "voice": True},
				}
			)
		)
		self.assertEqual(
			(c["input"]["kind"], c["input"]["media_id"], c["input"]["voice"]), ("audio", "m9", True)
		)
		self.assertEqual(parse_webhook({"entry": [{"changes": [{"value": {"statuses": [{}]}}]}]}), [])

	def test_title_line_becomes_header(self):
		step = menu(
			"*Step 6 of 13: Age group* _(optional)_\nWhat is the age?",
			[{"id": "a", "title": "A"}],
			footer="Type back",
		)
		self.assertEqual(step["header"], "Step 6 of 13: Age group (optional)")
		self.assertEqual(step["body"], "What is the age?")
		p = to_payload("1", step)
		self.assertEqual(
			p["interactive"]["header"], {"type": "text", "text": "Step 6 of 13: Age group (optional)"}
		)
		self.assertEqual(p["interactive"]["footer"], {"text": "Type back"})
		# Not a title line on its own, or nothing after it: left in the body.
		self.assertNotIn("header", menu("*Number:* `+254`\nHi", [{"id": "a", "title": "A"}]))
		self.assertNotIn("header", menu("*Only a title*", [{"id": "a", "title": "A"}]))
		self.assertNotIn("header", to_payload("1", menu("Pick", [{"id": "a", "title": "A"}]))["interactive"])
		self.assertEqual(
			to_payload("1", {"kind": "image", "link": "https://x/logo.png"})["image"],
			{"link": "https://x/logo.png"},
		)

	def test_payloads(self):
		buttons = to_payload(
			"254700000001", menu("Pick", [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}])
		)
		self.assertEqual(buttons["interactive"]["type"], "button")
		self.assertEqual(
			buttons["interactive"]["action"]["buttons"][0],
			{"type": "reply", "reply": {"id": "a", "title": "A"}},
		)
		lst = to_payload("1", menu("Pick", [{"id": "a", "title": "A", "desc": "long"}], button="Open"))
		self.assertEqual(lst["interactive"]["type"], "list")
		self.assertEqual(lst["interactive"]["action"]["button"], "Open")
		self.assertEqual(lst["interactive"]["action"]["sections"][0]["rows"][0]["description"], "long")
		loc = to_payload("1", {"kind": "location_request", "body": "Where?"})
		self.assertEqual(loc["interactive"]["type"], "location_request_message")
		tpl = to_payload(
			"1", {"kind": "template", "name": "report_alert", "lang": "en", "params": ["RPT-1", 2]}
		)
		self.assertEqual(tpl["template"]["components"][0]["parameters"][1], {"type": "text", "text": "2"})

	def test_template_values_are_made_acceptable_to_meta(self):
		tpl = to_payload(
			"1", {"kind": "template", "name": "t", "lang": "en", "params": ["line one\n\nline two\tend     x"]}
		)
		self.assertEqual(tpl["template"]["components"][0]["parameters"][0]["text"], "line one line two end x")

	def test_delivery_updates(self):
		body = {
			"entry": [
				{
					"changes": [
						{
							"value": {
								"statuses": [
									{"id": "w1", "status": "delivered", "recipient_id": "254700", "timestamp": "5"},
									{
										"id": "w2",
										"status": "failed",
										"recipient_id": "254701",
										"timestamp": "6",
										"errors": [{"code": 131047, "title": "Re-engagement message"}],
									},
								]
							}
						}
					]
				}
			]
		}
		[ok, failed] = parse_statuses(body)
		self.assertEqual((ok["id"], ok["status"], ok["recipient"], ok["errors"]), ("w1", "delivered", "254700", []))
		self.assertEqual(failed["errors"], [{"code": 131047, "title": "Re-engagement message"}])
		self.assertEqual(parse_statuses(wrap({"from": "1", "id": "w", "type": "text"})), [])

	def _client_serving(self, meta, content=b"x"):
		class Reply:
			def __init__(self, json_body=None, content=b""):
				self.body, self.content = json_body, content

			def raise_for_status(self):
				pass

			def json(self):
				return self.body

		wa = WhatsAppClient("token", "1")
		wa.s = SimpleNamespace(
			calls=[],
			get=lambda url, timeout: Reply(content=content) if url == meta["url"] else Reply(meta),
		)
		return wa

	def test_media_over_the_limit_is_refused(self):
		ok = {"url": "https://m/f", "mime_type": "image/png", "file_size": 3}
		self.assertEqual(self._client_serving(ok).download_media("m"), (b"x", "image/png"))
		with self.assertRaises(MediaTooLarge):
			self._client_serving({**ok, "file_size": MAX_MEDIA_BYTES + 1}).download_media("m")
		with self.assertRaises(MediaTooLarge):  # Meta did not give a size
			self._client_serving(
				{"url": "https://m/f", "mime_type": "image/png"}, content=b"x" * (MAX_MEDIA_BYTES + 1)
			).download_media("m")

	def test_signatures(self):
		body = b'{"a":1}'
		sig = "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest()
		self.assertTrue(verify_signature(body, sig, "secret"))
		self.assertFalse(verify_signature(body, sig, "other"))
		self.assertFalse(verify_signature(body, None, "secret"))
		self.assertFalse(verify_signature(body, sig, None))  # no App Secret set: nothing is accepted
