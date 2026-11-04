"""The WhatsApp channel against a real site: webhook, staff lookup, Case Reports, media and desk alerts.

The Cloud API is replaced by FakeWhatsApp; nothing is sent to Meta. Commits are patched out so the
test data is rolled back with the test.
"""

import hashlib
import hmac
import io
import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from pypdf import PdfWriter
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from surveillance.whatsapp import data, jobs, sessions, setup, webhook
from surveillance.whatsapp.client import MediaTooLarge

PHONE = "254799111222"
STAFF_PHONE = "254711000222"
STAFF_USER = "wa-staff@example.com"
DESK = "254700000009"
DISEASE = "wa-test-disease"


class FakeWhatsApp:
	def __init__(self):
		self.sent = []
		self.files = {}

	def send(self, to, msg):
		self.sent.append((to, msg))
		return {}

	def mark_read(self, message_id):
		pass

	def download_media(self, media_id):
		if media_id == "big":
			raise MediaTooLarge("11 MB")
		return self.files.get(media_id) or (b"\x89PNG\r\n\x1a\n fake image", "image/png")


def set_request(method="GET", query=None, body=b"", headers=None):
	env = EnvironBuilder(
		method=method, query_string=query, data=body, headers=headers or {}, content_type="application/json"
	).get_environ()
	frappe.local.request = Request(env)


def signed(body, secret="secret"):
	return {"X-Hub-Signature-256": "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()}


def text_message(msg_id, phone=PHONE, body="hi"):
	return {
		"entry": [
			{
				"changes": [
					{
						"value": {
							"contacts": [{"wa_id": phone, "profile": {"name": "Amina"}}],
							"messages": [
								{
									"from": phone,
									"id": msg_id,
									"timestamp": "1",
									"type": "text",
									"text": {"body": body},
								}
							],
						}
					}
				]
			}
		]
	}


class TestWhatsAppIntegration(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		setup.after_migrate()
		if not frappe.db.count("Sub County"):
			from surveillance.locations import seed_sub_counties

			seed_sub_counties()
		frappe.get_doc("WhatsApp Settings").update(
			{
				"enabled": 1,
				"phone_number_id": "123",
				"access_token": "token",
				"app_secret": "secret",
				"verify_token": "verify-me",
				"notify_numbers": DESK,
				"notify_template": "",
			}
		).save()
		cls.sub_county = frappe.get_all(
			"Sub County", fields=["name", "region", "latitude", "longitude"], limit=1
		)[0]
		cls.symptom = (
			frappe.db.get_value("Symptom", {"symptom_name": "Diarrhea"})
			or frappe.get_all("Symptom", pluck="name", limit=1)[0]
		)
		if not frappe.db.exists("User", STAFF_USER):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": STAFF_USER,
					"first_name": "Wanjiku",
					"last_name": "Test",
					"mobile_no": "0711 000 222",
					"send_welcome_email": 0,
					"roles": [{"role": "CHP"}],
				}
			).insert(ignore_permissions=True)
		# CHPs report only for their assigned region and sub-county (locations.lock_to_assigned_area)
		frappe.db.set_value(
			"User",
			STAFF_USER,
			{
				"assigned_region": cls.sub_county.region,
				"assigned_sub_county": cls.sub_county.name,
				"account_status": "Active",
				"primary_role": "CHP",
			},
		)
		data.clear_staff_cache()
		data.clear_catalog_cache()

	def setUp(self):
		for phone in (PHONE, STAFF_PHONE):
			sessions.clear(phone)
			frappe.cache.delete_value(jobs.INBOX.format(phone))
		self.wa = FakeWhatsApp()
		patches = [
			patch.object(jobs, "whatsapp_client", return_value=self.wa),
			patch("frappe.db.commit"),
			patch("frappe.enqueue"),
		]
		started = [p.start() for p in patches]
		for p in patches:
			self.addCleanup(p.stop)
		self.enqueue = started[2]

	def tearDown(self):
		frappe.local.request = None

	def test_webhook_handshake(self):
		set_request(
			query={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444"}
		)
		r = webhook.webhook()
		self.assertEqual((r.status_code, r.get_data(as_text=True)), (200, "1158201444"))
		set_request(query={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1"})
		self.assertEqual(webhook.webhook().status_code, 403)

	def test_webhook_checks_signature_and_queues_each_message_once(self):
		body = json.dumps(text_message(frappe.generate_hash())).encode()
		set_request("POST", body=body, headers={"X-Hub-Signature-256": "sha256=00"})
		self.assertEqual(webhook.webhook().status_code, 401)
		set_request("POST", body=body)
		self.assertEqual(webhook.webhook().status_code, 401)  # unsigned
		for _ in range(2):  # Meta retries: the second delivery is ignored
			set_request("POST", body=body, headers=signed(body))
			self.assertEqual(webhook.webhook().status_code, 200)
		self.assertEqual(self.enqueue.call_count, 1)
		self.assertEqual(self.enqueue.call_args.kwargs["phone"], PHONE)
		self.assertEqual(frappe.cache.llen(jobs.INBOX.format(PHONE)), 1)

	def test_inbox_answered_in_order(self):
		# One job, two messages: the second only makes sense in the session left by the first.
		for i, inp in enumerate(({"type": "text", "text": "hi"}, {"type": "reply", "id": "community"})):
			frappe.cache.rpush(
				jobs.INBOX.format(PHONE),
				json.dumps({"id": f"m{i}", "from": PHONE, "name": "Amina", "input": inp}),
			)
		jobs.process_inbox(PHONE)
		self.assertEqual(frappe.cache.llen(jobs.INBOX.format(PHONE)), 0)
		self.assertEqual(self.wa.sent[0][1]["header"], "Welcome to Kenya Red Cross Society")
		self.assertIn("choose your preferred language", self.wa.sent[-1][1]["body"])
		self.assertEqual(sessions.load(PHONE).state, "lang")

	def test_staff_matched_by_mobile_number_in_any_format(self):
		st = data.find_staff(STAFF_PHONE)
		self.assertEqual((st["user"], st["role"], st["region"]), (STAFF_USER, "CHP", self.sub_county.region))
		self.assertEqual((st["sub_county"], st["area_locked"]), (self.sub_county.name, True))
		self.assertIn("CHP", data.roles_of(STAFF_USER))
		user = frappe.get_doc("User", STAFF_USER)
		user.account_status = "Suspended"
		user.save(ignore_permissions=True)  # doc_events clear the phone index
		self.assertIsNone(data.find_staff(STAFF_PHONE))
		user.reload()
		user.account_status = "Active"
		user.save(ignore_permissions=True)
		self.assertIsNotNone(data.find_staff(STAFF_PHONE))

	def test_staff_report_is_created_by_the_staff_member(self):
		report = data.create_report(self.case_report(STAFF_USER, STAFF_PHONE))
		self.assertEqual(
			frappe.db.get_value("Case Report", report["name"], ["owner", "reported_by", "channel"]),
			(STAFF_USER, STAFF_USER, "WhatsApp"),
		)
		self.assertEqual(frappe.session.user, "Administrator")
		self.assertEqual(data.my_reports(user=STAFF_USER, limit=1)[0]["name"], report["name"])
		dup = data.find_duplicate(self.sub_county.region, [self.symptom])
		self.assertEqual(dup["name"], report["name"])
		self.assertIsNone(data.find_duplicate(self.sub_county.region, []))

	def test_delivery_updates_are_logged_and_failures_reach_the_error_log(self):
		body = json.dumps(
			{
				"entry": [
					{
						"changes": [
							{
								"value": {
									"statuses": [
										{"id": "w1", "status": "delivered", "recipient_id": DESK, "timestamp": "5"},
										{
											"id": "w2",
											"status": "failed",
											"recipient_id": DESK,
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
		).encode()
		set_request("POST", body=body, headers=signed(body))
		with patch.object(jobs.frappe, "log_error") as log_error:
			self.assertEqual(webhook.webhook().status_code, 200)
		[call] = log_error.call_args_list
		self.assertIn("131047", call.kwargs["title"])
		self.assertEqual(self.enqueue.call_count, 0)  # a delivery update is not a message to answer

	def test_escalation_uses_the_template_when_one_is_set(self):
		st = frappe._dict(
			escalation_numbers=DESK, notify_numbers="", escalation_template="", notify_template_language="sw"
		)
		with patch.object(data, "settings", return_value=st):
			jobs.send_escalation("Why?", "Amina", PHONE, None, "no_match")
			self.assertEqual(self.wa.sent[-1][1]["kind"], "text")
			st.escalation_template = "question_for_desk"
			jobs.send_escalation("Why?\nReally?", "Amina", PHONE, None, None)
		[(to, msg)] = self.wa.sent[-1:]
		self.assertEqual((to, msg["kind"], msg["name"], msg["lang"]), (DESK, "template", "question_for_desk", "sw"))
		self.assertEqual(msg["params"], [f"Amina {jobs.format_phone(PHONE)}", "—", "—", "Why?\nReally?"])

	def test_media_rows_carry_consent_and_a_failed_file_is_reported(self):
		name = data.create_report(self.case_report(STAFF_USER, STAFF_PHONE))["name"]
		answer = {"people_shown": 1, "consent": "Person agreed"}
		media = [
			{"kind": "video", "media_id": "video", "mime_type": "video/mp4", **answer},
			{"kind": "document", "media_id": "pdf", "mime_type": "application/pdf", **answer},
			{"kind": "image", "media_id": "big", "mime_type": "image/png", **answer},
			{"kind": "document", "media_id": "exe", "mime_type": "application/pdf", **answer},
		]
		pdf = io.BytesIO()  # a real one: Frappe checks PDFs when a File is saved
		writer = PdfWriter()
		writer.add_blank_page(72, 72)
		writer.write(pdf)
		self.wa.files = {
			"video": (b"\x00\x00\x00\x18ftypmp42", "video/mp4"),
			"pdf": (pdf.getvalue(), "application/pdf"),
			"exe": (b"MZ", "application/x-msdownload"),  # not what WhatsApp declared
		}
		with patch.object(frappe, "log_error"):
			jobs.after_submit(name, media, PHONE, lang="sw")
		rows = frappe.get_doc("Case Report", name).attachments
		self.assertEqual(
			[(r.attachment_type, r.people_shown, r.consent) for r in rows[:2]],
			[("Attachment", 1, "Person agreed"), ("Attachment", 1, "Person agreed")],
		)
		self.assertTrue(all(r.consent_recorded_on for r in rows[:2]))
		self.assertEqual(rows[2].attachment_type, "Text Note")
		self.assertIn("2 of 4", rows[2].text_content)
		told = [m for to, m in self.wa.sent if to == PHONE]
		self.assertEqual(len(told), 1)
		self.assertIn(name, told[0]["body"])
		self.assertIn("MB 10", told[0]["body"])

	def test_staff_next_steps_from_the_approved_protocol(self):
		from surveillance.field_api import UNUSUAL_EVENT, advice_steps
		from surveillance.protocols import approved_for

		def steps(user=STAFF_USER, disease=DISEASE):
			a = data.reporter_advice(disease, user)
			return a["disease"], [s["step"] for s in a["steps"]]

		# The site's unusual-event protocol, if it has an approved one, stands in when the disease has none.
		fallback = [s["step"] for s in advice_steps(approved_for(UNUSUAL_EVENT))]
		# A disease of its own (a fresh site has none until migrate seeds them). CHPs get the steps because they
		# create reports, as in protocols.get_reporter_advice; they need not view protocols.
		if not frappe.db.exists("Role Capability", {"role": "CHP", "capability": "create_reports"}):
			frappe.get_doc({"doctype": "Role Capability", "role": "CHP", "capability": "create_reports"}).insert(
				ignore_permissions=True
			)
		frappe.get_doc(
			{
				"doctype": "Alert Threshold Config",
				"disease_key": DISEASE,
				"disease_name": "WA test disease",
				"threshold": 1,
			}
		).insert(ignore_permissions=True)
		frappe.db.delete("Role Capability", {"role": "CHP", "capability": ["like", "%_response_protocols"]})
		protocol = frappe.get_doc(
			{
				"doctype": "Response Protocol",
				"title": "WA test protocol",
				"disease": DISEASE,
				"status": "Draft",
				"steps": [
					{
						"step": "Give ORS and refer severe cases",
						"timeframe": "Immediately",
						"responsible": "CHP",
					},
					{"step": "Collect stool samples", "responsible": "Surveillance Officer"},
					{"step": "Tell households to treat water", "responsible": "Community volunteers"},
				],
			}
		).insert(ignore_permissions=True)
		disease = "WA test disease"
		self.assertEqual(steps("Guest"), (disease, []))  # no right to report, get follow-ups or view protocols
		self.assertEqual(steps(), (disease, fallback))  # only an Approved protocol counts
		protocol.db_set("status", "Approved")
		self.assertEqual(
			steps(), (disease, ["Give ORS and refer severe cases", "Tell households to treat water"])
		)
		frappe.db.set_value("Response Protocol Step", protocol.steps[1].name, "show_to_reporters", 1)
		self.assertEqual(steps(), (disease, ["Collect stool samples"]))  # ticked steps win
		self.assertEqual(steps(disease=None), (None, fallback))  # no suspected disease

		frappe.db.set_single_value("Reporter Advice Settings", "general_advice", "Line one\n\n  Line two \n")
		self.assertEqual(data.reporter_advice(DISEASE, STAFF_USER)["general"], ["Line one", "Line two"])

	def test_community_advice_replaces_the_draft_once_approved(self):
		frappe.db.delete("Community Advice", {"key": "Gastrointestinal"})
		data.clear_catalog_cache()
		self.assertNotIn("Gastrointestinal", data.community_advice("sw"))

		def advice(language, text, status="Approved"):
			return frappe.get_doc(
				{"doctype": "Community Advice", "key": "Gastrointestinal", "language": language, "text": text, "status": status}
			).insert(ignore_permissions=True)  # doc_events clear the cache

		advice("sw", "Rasimu", status="Draft")
		self.assertNotIn("Gastrointestinal", data.community_advice("sw"))  # drafts are not used
		advice("en", "Approved English")
		self.assertEqual(data.community_advice("sw")["Gastrointestinal"], "Approved English")  # English fallback
		advice("sw", "Kiswahili kilichoidhinishwa")
		self.assertEqual(data.community_advice("sw")["Gastrointestinal"], "Kiswahili kilichoidhinishwa")
		self.assertEqual(data.community_advice("en")["Gastrointestinal"], "Approved English")

	def test_community_report_end_to_end(self):
		sent_media = False
		self.receive({"type": "text", "text": "hi"})
		for _ in range(40):
			state = sessions.load(PHONE).state
			if state == "r_done":
				break
			if state == "r_extra" and not sent_media:
				sent_media = True
				self.receive(
					{
						"type": "media",
						"kind": "image",
						"media_id": "m1",
						"mime_type": "image/png",
						"caption": "water point",
					}
				)
				continue
			self.receive(self.answer(state))
		self.assertEqual(state, "r_done")
		received = [m for _, m in self.wa.sent if "Report received" in (m.get("body") or "")]
		self.assertRegex(received[-1]["body"], r"Reference: \*(RPT-\d+)\*")
		self.assertTrue(
			any("While you wait for the KRCS team" in (m.get("body") or "") for _, m in self.wa.sent)
		)
		name = self.last_report()
		doc = frappe.get_doc("Case Report", name)
		community = frappe.db.get_single_value("WhatsApp Settings", "community_user")
		self.assertEqual(
			(doc.channel, doc.signal_type, doc.reported_by, doc.owner, doc.phone_number, doc.reporter_name),
			("WhatsApp", "Community Signal", community, community, f"+{PHONE}", "Amina"),
		)
		self.assertEqual(
			(doc.affected_count, doc.location_name, doc.sub_county), (12, "Ifo Camp", self.sub_county.name)
		)
		self.assertEqual(doc.additional_notes, "water point")
		self.assertTrue(doc.symptom_tags)

		[call] = [c for c in self.enqueue.call_args_list if c.args[0].endswith("after_submit")]
		self.assertEqual(call.kwargs["report"], name)
		self.wa.sent.clear()
		jobs.after_submit(**{k: v for k, v in call.kwargs.items() if k != "queue"})
		doc.reload()
		[row] = doc.attachments
		self.assertEqual(row.attachment_type, "Photo")
		self.assertEqual((row.people_shown, row.consent), (1, "Parent or guardian agreed"))
		self.assertTrue(row.consent_recorded_on)
		self.assertTrue(row.file.startswith("/private/files/"))
		self.assertEqual(frappe.db.get_value("File", {"file_url": row.file}, "attached_to_name"), name)
		[(to, alert)] = self.wa.sent
		self.assertEqual(to, DESK)
		self.assertIn(f"New surveillance report {name}", alert["body"])

		self.assertEqual(data.my_reports(phone=PHONE, limit=1)[0]["name"], name)
		self.assertEqual(data.get_report(name)["phone_number"], f"+{PHONE}")

	def receive(self, inp):
		jobs.process_event({"id": frappe.generate_hash(), "from": PHONE, "name": "Amina", "input": inp})

	def answer(self, state):
		reply = lambda i: {"type": "reply", "id": i}  # noqa: E731
		# At the sub-county's centre, so the pin gives that region and sub-county (or they are asked, if it has none).
		sc = self.sub_county
		location = {
			"type": "location",
			"lat": sc.latitude or 0.05,
			"lng": sc.longitude or 40.31,
			"name": "Ifo Camp",
		}
		return {
			"welcome": reply("community"),
			"lang": reply("en"),
			"r_describe": reply("guided"),
			"r_name": reply("profile"),
			"r_category": reply("v:Human Disease"),
			"r_symptoms": {"type": "text", "text": "diarrhoea"},
			"r_symptoms_more": reply("done"),
			"r_count": {"type": "text", "text": "12"},
			"r_age": reply("skip"),
			"r_exposure": reply("skip"),
			"r_deaths": reply("none"),
			"r_region": reply(f"r:{self.sub_county.region}"),
			"r_subcounty": reply(f"c:{self.sub_county.name}"),
			"r_place": location,
			"r_place_gps": location,
			"r_place_name": {"type": "text", "text": "Ifo Camp"},
			"r_onset": reply("today"),
			"r_extra": reply("review"),
			"r_review": reply("submit"),
			"r_consent": reply("guardian"),
			"r_duplicate": reply("submit"),
		}[state]

	def last_report(self):
		return frappe.get_all(
			"Case Report",
			filters={"phone_number": f"+{PHONE}"},
			order_by="creation desc",
			pluck="name",
			limit=1,
		)[0]

	def case_report(self, user, phone):
		return {
			"doctype": "Case Report",
			"reported_by": user,
			"reporter_name": "Wanjiku Test",
			"phone_number": f"+{phone}",
			"signal_type": "Suspected Outbreak",
			"category": "Human Disease",
			"region": self.sub_county.region,
			"sub_county": self.sub_county.name,
			"location_name": "Block A",
			"latitude": 0.05,
			"longitude": 40.31,
			"affected_count": 3,
			"symptoms": [{"symptom": self.symptom}],
			"onset_date": frappe.utils.today(),
			"deaths_count": 0,
			"channel": "WhatsApp",
			"status": "Submitted",
		}
