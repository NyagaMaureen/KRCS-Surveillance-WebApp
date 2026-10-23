"""The conversation end to end, against in-memory data (no database needed).

Every message sent in these tests is also checked against WhatsApp's size limits.
"""

import re
import unicodedata
from datetime import datetime, timezone
from types import SimpleNamespace

from frappe.tests.utils import FrappeTestCase

from surveillance.whatsapp.conversation import (
	AttrDict,
	handle,
	nairobi_date,
	new_session,
	normalize_phone,
	parse_date,
	split_text,
)
from surveillance.whatsapp.messages import validate

STAFF = "254712345678"  # Ahmed Abdi in FakeData
PUBLIC = "254799000000"
START = datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc).timestamp()

REGIONS = [{"name": "reg-dadaab", "label": "Dadaab"}, {"name": "reg-kalobeyei", "label": "Kalobeyei"}]
SUB_COUNTIES = {
	"reg-dadaab": [
		{"name": "Garissa-Dadaab", "label": "Dadaab", "county": "Garissa"},
		{"name": "Garissa-Fafi", "label": "Fafi", "county": "Garissa"},
		{"name": "Garissa-Liboi", "label": "Liboi", "county": "Garissa"},
	],
	"reg-kalobeyei": [
		{"name": "Turkana-Lokichogio", "label": "Lokichogio", "county": "Turkana"},
		{"name": "Turkana-Turkana West", "label": "Turkana West", "county": "Turkana"},
	],
}
SYMPTOMS = [
	{"name": f"sym-{i}", "label": label, "category": cat}
	for i, (label, cat) in enumerate(
		[
			("Abdominal Pain", "Gastrointestinal"),
			("Bloody Stool", "Gastrointestinal"),
			("Dehydration", "Gastrointestinal"),
			("Diarrhea", "Gastrointestinal"),
			("Vomiting", "Gastrointestinal"),
			("Chest Pain", "Respiratory"),
			("Cough", "Respiratory"),
			("Difficulty Breathing", "Respiratory"),
			("Runny Nose", "Respiratory"),
			("Chills", "Febrile/Systemic"),
			("Fatigue", "Febrile/Systemic"),
			("Fever (hot body)", "Febrile/Systemic"),
			("Headache", "Febrile/Systemic"),
			("Joint Pain", "Febrile/Systemic"),
			("Red Eyes", "Febrile/Systemic"),
			("Severe Body or Muscle Pain", "Febrile/Systemic"),
			("Swollen Lymph Nodes", "Febrile/Systemic"),
			("Yellow Eyes or Skin", "Febrile/Systemic"),
			("Black Skin Sore", "Dermatological"),
			("Itching", "Dermatological"),
			("Rash", "Dermatological"),
			("Skin Lesions", "Dermatological"),
			("Swelling", "Dermatological"),
			("Bulging Soft Spot (infant)", "Neurological"),
			("Confusion or Unconsciousness", "Neurological"),
			("Stiff Neck", "Neurological"),
			("Sudden Weakness of Arm or Leg", "Neurological"),
			("Unexplained Bleeding", "Haemorrhagic"),
		],
		1,
	)
]
OPTIONS = {
	"signal_type": ["Suspected Outbreak", "Community Signal", "Facility Signal"],
	"category": ["Human Disease", "Animal Disease", "All Disease"],
	"sex": ["Male", "Female", "Mixed"],
	"age_group": ["Under 1", "1-4 years", "5-14 years", "15+ years"],
	"animal_exposure": ["None", "Bite or scratch", "Handled sick or dead animal"],
	"status": ["Submitted", "Reviewed", "Linked", "Investigating", "Closed"],
	"severity": ["Low", "Moderate", "Critical"],
	"channel": ["Mobile", "SMS", "USSD", "WhatsApp", "Web"],
}
DEMO_STAFF = {
	"254712345678": {
		"user": "ahmed.abdi@krcs.test",
		"full_name": "Ahmed Abdi",
		"role": "CHP",
		"region": "reg-dadaab",
	}
}
# The live Case Report since 16/10/2026: no `sex` field; GPS and place name required.
LIVE_SCHEMA = {
	"options": {k: v for k, v in OPTIONS.items() if k != "sex"},
	"required": ["latitude", "longitude", "location_name", "sub_county"],
}


class FakeData:
	"""In-memory stand-in for surveillance.whatsapp.data; mirrors the app's fixtures."""

	def __init__(self, now=lambda: START, schema=None, regions=REGIONS, sub_counties=None):
		self.now = now
		self.schema = schema or {"options": OPTIONS, "required": []}
		self.regions = regions
		self.sub_county_map = SUB_COUNTIES if sub_counties is None else sub_counties
		self.reports = []
		self.disease = None  # suspected_disease the rules give a new report
		self.advice = None  # reporter_advice() result, or an exception to raise
		self.advice_asked = []

	def catalog(self):
		return {**self.schema, "regions": self.regions, "symptoms": SYMPTOMS}

	def sub_counties(self, region):
		return self.sub_county_map.get(region, [])

	def find_staff(self, phone):
		st = DEMO_STAFF.get(normalize_phone(phone))
		return dict(st) if st else None

	def roles_of(self, user):
		return [s["role"] for s in DEMO_STAFF.values() if s["user"] == user]

	def community_user(self):
		return "whatsapp-community@krcs.test"

	def create_report(self, doc):
		labels = {x["name"]: x["label"] for x in SYMPTOMS}
		report = {
			**doc,
			"name": f"RPT-{len(self.reports) + 1:03d}",
			"report_date": nairobi_date(self.now()),
			"symptom_tags": doc.get("symptom_tags")
			or ", ".join(labels.get(r["symptom"], r["symptom"]) for r in doc["symptoms"]),
			"suspected_disease": self.disease,
		}
		self.reports.append(report)
		return report

	def find_duplicate(self, region, symptoms):
		return next(
			(
				r
				for r in reversed(self.reports)
				if r["region"] == region
				and r["status"] != "Closed"
				and any(x["symptom"] in symptoms for x in r["symptoms"])
			),
			None,
		)

	def my_reports(self, user=None, phone=None, limit=9):
		rows = [
			r
			for r in self.reports
			if (r["reported_by"] == user if user else r["phone_number"] == f"+{normalize_phone(phone)}")
		]
		return list(reversed(rows[-limit:]))

	def get_report(self, name):
		return next((r for r in self.reports if r["name"] == name), None)

	def reporter_advice(self, disease, user):
		self.advice_asked.append((disease, user))
		if isinstance(self.advice, Exception):
			raise self.advice
		return self.advice


class FakeChatbot:
	"""Stand-in for the Response Support Chatbot."""

	def __init__(self):
		self.calls = []

	def reply(self, outcome, message, **extra):
		return {
			"outcome": outcome,
			"route": "protocol_query",
			"reason": outcome,
			"message": message,
			"options": [],
			"escalate": outcome == "escalate",
			**extra,
		}

	def ask(self, req):
		self.calls.append(req)
		q = req["message"].lower()
		if req.get("selected_protocol_id"):
			return self.reply(
				"answer", f"Matched protocol: {req['selected_protocol_id']}\n\n[sample approved content]"
			)
		if "down" in q:
			raise ConnectionError("POST /chat -> 503")
		if re.search(r"how many|ngapi", q):
			return self.reply(
				"info",
				"You do not have access to report counts.",
				route="report_count",
				reason="missing_capability",
			)
		if re.search(r"\d+ (people|watu)", q):
			return self.reply("routed", None, route="signal_report", reason="signal_report")
		if q in ("cholera", "kipindupindu"):
			return self.reply(
				"clarify",
				"I found more than one protocol that may match.",
				options=[
					{
						"number": 1,
						"protocol_id": "cholera_case_definition",
						"title": "Cholera — Case Definition",
					},
					{
						"number": 2,
						"protocol_id": "cholera_immediate_action",
						"title": "Cholera — Immediate Action",
					},
				],
			)
		if "cholera" in q and "Guest" not in req["roles"]:
			return self.reply(
				"answer", "Matched protocol: Cholera — Immediate Action\n\n[sample approved content]"
			)
		return self.reply(
			"escalate",
			"I could not find approved guidance that matches your question, so I have not guessed.",
		)


def _reraise(title):
	raise  # tests should see the real error, not the friendly reply


class Harness:
	def __init__(self, test, phone, data=None, chatbot=None, extractor=None):
		self.test = test
		self.clock = START
		self.data = data or FakeData(now=lambda: self.clock)
		self.submitted, self.escalated = [], []
		self.ctx = SimpleNamespace(
			data=self.data,
			settings=AttrDict(idle_minutes=15, welcome_image_url=None),
			now=lambda: self.clock,
			chatbot=chatbot,
			extractor=extractor,
			on_submit=lambda report, session, media, extraction=None: self.submitted.append((report, media)),
			on_escalate=lambda **e: self.escalated.append(e),
			log_error=_reraise,
		)
		self.s = new_session(phone)
		self.s.profile_name = "Amina"
		self.last = []

	def send(self, inp):
		self.clock += 10
		self.last = handle(self.s, inp, self.ctx)
		for m in self.last:
			self.test.assertEqual(
				validate(m),
				[],
				f"limits broken in state {self.s.state}: {(m.get('body') or m.get('link'))[:60]}",
			)
		return self.last

	def say(self, value):
		return self.send({"type": "text", "text": value})

	def options(self):
		return [
			o
			for m in self.last
			for o in (m.get("buttons") or [r for sec in m.get("sections") or [] for r in sec["rows"]])
		]

	def tap(self, label):
		"""Tap the option whose title contains `label` in the last interactive message."""
		opts = self.options()
		o = next((x for x in opts if label.lower() in x["title"].lower()), None)
		self.test.assertIsNotNone(
			o, f"no option {label!r} in state {self.s.state}; have: {' | '.join(x['title'] for x in opts)}"
		)
		return self.send({"type": "reply", "id": o["id"], "title": o["title"]})

	def bodies(self):
		"""Header, body and footer as one text, the way the user reads them."""
		return "\n---\n".join(
			"\n".join(
				x
				for x in (
					m.get("header") and f"*{m['header']}*",
					m.get("body") or m.get("link"),
					m.get("footer"),
				)
				if x
			)
			for m in self.last
		)

	def advance(self, seconds):
		self.clock += seconds


def submit_staff_report(h):
	"""Staff portal -> a short animal report -> Confirm & submit."""
	start(h, "staff")
	h.tap("Submit health report")
	h.tap("Kalobeyei")
	h.tap("Lokichogio")
	h.tap("Skip")
	h.tap("Animal disease")
	h.tap("Suspected Outbreak")
	h.tap("Unexplained Bleeding")
	h.tap("Continue")
	h.say("30")
	h.tap("Mixed")
	h.say("4")
	h.tap("Specific date")
	h.say("10/10/2026")
	h.tap("Skip & review")
	h.tap("Confirm & submit")


def start(h, lang="English", guided=True):
	"""Welcome -> Community member -> language -> describe it, or tap "Step by step" (guided) for the questions
	one at a time; or Welcome -> KRCS Staff / CHP."""
	h.say("hi")
	h.test.assertIn("Welcome to Kenya Red Cross Society", h.bodies())
	if lang == "staff":
		return h.tap("KRCS Staff")
	h.tap("Community member")
	h.test.assertIn("choose your preferred language", h.bodies())
	h.tap(lang)
	h.test.assertEqual(h.s.state, "r_describe")
	if guided:
		h.tap("Hatua kwa hatua" if lang == "Kiswahili" else "Step by step")


def fill_location(h, place="skip"):
	"""The report starts with location: Dadaab / Fafi, then the place step. `place` is a message to send
	there, "skip" (typed, so it works in either language), or None to stop on the place step."""
	h.tap("Dadaab")
	h.tap("Fafi")
	if place == "skip":
		h.say("skip")
	elif place:
		h.send(place)


def fill_common_steps(h):
	"""Human disease -> Diarrhea + Vomiting -> 12 -> Mixed -> skip age/exposure -> no deaths."""
	h.tap("Human disease")
	h.tap("Diarrhea")  # a common symptom, no group needed
	h.say("vomiting")  # typed symptom name is added directly
	h.test.assertIn("Diarrhea\n• Vomiting", h.bodies())
	h.tap("Continue")
	h.say("12")
	h.tap("Mixed")
	h.tap("Skip")
	h.tap("Skip")
	h.tap("None")


def finish_without_extras(h):
	h.tap("Today")
	h.tap("Skip & review")


class TestConversation(FrappeTestCase):
	def test_community_report_end_to_end(self):
		h = Harness(self, PUBLIC)
		start(h)
		self.assertIn("Step 1 of 13: Where is it happening?", h.bodies())
		fill_location(h, {"type": "location", "lat": 0.05, "lng": 40.31, "name": "Ifo Camp"})
		self.assertIn("Step 4 of 13: Your name", h.bodies())
		h.tap("Amina")
		fill_common_steps(h)
		self.assertIn("When did it start", h.bodies())
		h.tap("Today")
		h.send(
			{
				"type": "media",
				"kind": "image",
				"media_id": "m1",
				"mime_type": "image/jpeg",
				"caption": "children at the water point",
			}
		)
		h.tap("Proceed to review")
		self.assertIn("*Symptoms:* Diarrhea, Vomiting", h.bodies())
		h.tap("Confirm & submit")
		self.assertRegex(h.bodies(), r"Report received[\s\S]*RPT-001")

		r = h.data.reports[0]
		expected = {
			"doctype": "Case Report",
			"channel": "WhatsApp",
			"status": "Submitted",
			"signal_type": "Community Signal",
			"reported_by": "whatsapp-community@krcs.test",
			"reporter_name": "Amina",
			"phone_number": "+254799000000",
			"category": "Human Disease",
			"region": "reg-dadaab",
			"sub_county": "Garissa-Fafi",
			"affected_count": 12,
			"sex": "Mixed",
			"deaths_count": 0,
			"onset_date": "2026-10-13",
			"location_name": "Ifo Camp",
			"latitude": 0.05,
			"additional_notes": "children at the water point",
		}
		self.assertEqual({k: r.get(k) for k in expected}, expected)
		self.assertEqual(len(r["symptoms"]), 2)
		[(report, media)] = h.submitted
		self.assertEqual(report["name"], "RPT-001")
		self.assertEqual(
			[(m["kind"], m["media_id"], m["caption"]) for m in media],
			[("image", "m1", "children at the water point")],
		)

		h.tap("Main menu")
		self.assertEqual(h.s.state, "welcome")

	def test_staff_recognised_by_phone(self):
		h = Harness(self, STAFF)
		start(h, "staff")
		self.assertRegex(
			h.bodies(),
			r"Identity verified[\s\S]*Welcome back, \*Ahmed Abdi\*!\nRole: \*CHP\*\nRegion: \*Dadaab\*",
		)
		h.tap("Submit health report")
		self.assertIn("Step 1 of 13: Where is it happening?", h.bodies())
		self.assertEqual(h.s.shown[0], "r:reg-dadaab")
		h.tap("Kalobeyei")
		h.tap("Lokichogio")
		h.tap("Skip")
		self.assertIn("Step 4 of 13: Signal category", h.bodies())
		h.tap("Animal disease")
		self.assertIn("Signal type", h.bodies())
		h.tap("Suspected Outbreak")
		h.tap("Unexplained Bleeding")
		h.tap("Continue")
		self.assertIn("Number of animals affected", h.bodies())
		h.say("30")
		h.tap("Mixed")
		self.assertIn("Deaths", h.bodies())  # animals: no age group / animal-contact questions
		h.say("4")
		h.tap("Specific date")
		h.say("10/10/2026")
		h.tap("Skip & review")
		h.tap("Confirm & submit")
		r = h.data.reports[0]
		self.assertEqual(r["reported_by"], "ahmed.abdi@krcs.test")
		self.assertEqual(r["reporter_name"], "Ahmed Abdi")
		self.assertEqual(r["signal_type"], "Suspected Outbreak")
		self.assertEqual(r["category"], "Animal Disease")
		self.assertIsNone(r["age_group"])
		self.assertEqual(r["deaths_count"], 4)
		self.assertEqual(r["onset_date"], "2026-10-10")
		h.tap("Done")
		self.assertEqual(h.s.state, "menu")
		self.assertIn("KRCS Health Surveillance Portal", h.bodies())

	def test_staff_get_the_mobile_next_steps(self):
		"""After a staff report: the protocol's steps for reporters and the mobile app's general lines."""
		h = Harness(self, STAFF)
		h.data.disease = "awd-cholera"
		h.data.advice = {
			"disease": "Acute Watery Diarrhoea / Cholera",
			"steps": [
				{"step": "Give ORS to every case and refer severe cases", "timeframe": "Immediately"},
				{"step": "Tell households to treat drinking water", "timeframe": ""},
			],
		}
		submit_staff_report(h)
		self.assertEqual(h.data.advice_asked, [("awd-cholera", "ahmed.abdi@krcs.test")])
		self.assertIn(
			"*Next steps*\n\nSuspected disease: *Acute Watery Diarrhoea / Cholera*\n\n"
			"*What to do for Acute Watery Diarrhoea / Cholera*\n"
			"1. Give ORS to every case and refer severe cases _(Immediately)_\n"
			"2. Tell households to treat drinking water\n\n"
			"*Also*\n• Keep your phone on.",
			h.bodies(),
		)
		self.assertNotIn("While you wait for the KRCS team", h.bodies())

	def test_staff_next_steps_without_protocol(self):
		h = Harness(self, STAFF)
		h.data.advice = {"disease": "Anthrax", "steps": []}  # no approved protocol, or no right to view it
		submit_staff_report(h)
		self.assertIn("Suspected disease: *Anthrax*\n\n*What happens next*\n• Keep your phone on.", h.bodies())
		self.assertNotIn("What to do for", h.bodies())

		h = Harness(self, STAFF)
		h.data.advice = RuntimeError("Frappe unreachable")
		logged = []
		h.ctx.log_error = logged.append
		submit_staff_report(h)
		self.assertEqual(logged, ["WhatsApp next steps could not be loaded"])
		self.assertRegex(h.bodies(), r"Report received[\s\S]*\*Next steps\*\n\n\*What happens next\*")

	def test_unknown_number_cannot_use_staff_portal(self):
		h = Harness(self, PUBLIC)
		start(h, "staff")
		self.assertRegex(h.bodies(), r"\+254 799 000 000[\s\S]*not linked to an active KRCS staff account")
		h.tap("Community member")
		h.tap("English")
		self.assertEqual(h.s.state, "r_describe")
		self.assertIsNone(h.s.staff)

	def test_kiswahili_and_typed_numbers(self):
		h = Harness(self, PUBLIC)
		start(h, "Kiswahili")
		self.assertIn("Hatua 1 kati ya 13: Linatokea wapi?", h.bodies())
		fill_location(h)
		self.assertIn("Hatua 4 kati ya 13: Jina lako", h.bodies())
		h.say("Juma Hassan")
		self.assertEqual(h.s.draft.reporter_name, "Juma Hassan")
		h.say("1")  # Ugonjwa wa binadamu
		self.assertEqual(h.s.draft.category, "Human Disease")

	def test_duplicate_warning(self):
		h = Harness(self, PUBLIC)
		start(h)
		for i in range(2):
			if i:
				h.tap("Report another")
				h.tap("Step by step")
			fill_location(h)
			h.tap("Amina")
			fill_common_steps(h)
			finish_without_extras(h)
			h.tap("Confirm & submit")
		self.assertRegex(h.bodies(), r"Potential duplicate report[\s\S]*RPT-001")
		h.tap("New incident")
		self.assertEqual(len(h.data.reports), 2)

	def test_staff_see_only_their_own_reports(self):
		data = FakeData()
		data.create_report(
			{
				"symptoms": [],
				"reported_by": "x",
				"phone_number": "+254700000001",
				"region": "reg-dadaab",
				"status": "Submitted",
			}
		)
		h = Harness(self, STAFF, data=data)
		start(h, "staff")
		h.tap("Check report status")
		self.assertIn("not sent any reports", h.bodies())
		h.say("RPT-001")
		self.assertIn("No report *RPT-001*", h.bodies())
		h.say("menu")
		h.tap("My recent reports")
		self.assertIn("not sent any reports", h.bodies())

	def test_community_reference_lookup(self):
		data = FakeData()
		data.create_report(
			{
				"symptoms": [],
				"reported_by": "x",
				"phone_number": "+254700000001",
				"region": "reg-dadaab",
				"status": "Submitted",
			}
		)
		data.create_report(
			{
				"symptoms": [],
				"reported_by": "x",
				"phone_number": "+254799000000",
				"region": "reg-dadaab",
				"status": "Investigating",
				"symptom_tags": "Cough",
			}
		)
		h = Harness(self, PUBLIC, data=data)
		h.say("hi")
		h.say("RPT-001")
		self.assertIn("No report *RPT-001*", h.bodies())
		h.say("rpt 2")
		self.assertRegex(
			h.bodies(), r"\*RPT-002\*\n• Condition: Cough[\s\S]*• Status: \*Under investigation\*"
		)

	def test_cancel_idle_timeout_and_resume(self):
		h = Harness(self, PUBLIC)
		start(h)
		fill_location(h)
		h.tap("Amina")
		h.tap("Human disease")
		h.advance(20 * 60)
		h.say("anything")
		self.assertRegex(
			h.bodies(), r"Session paused[\s\S]*after 15 minutes of inactivity[\s\S]*kept as a draft"
		)
		h.tap("Continue")
		self.assertEqual(h.s.state, "r_symptoms")
		h.say("menu")  # not idle: the plain reminder, not "Session paused"
		self.assertIn("unfinished report", h.bodies())
		self.assertNotIn("Session paused", h.bodies())
		h.tap("Continue")
		h.advance(20 * 60)
		h.say("hi")  # idle, even though "hi" is a keyword
		self.assertIn("Session paused", h.bodies())
		h.tap("Continue")
		self.assertEqual(h.s.state, "r_symptoms")
		h.say("cancel")
		self.assertIn("Report discarded", h.bodies())
		self.assertIsNone(h.s.draft)
		self.assertEqual(h.s.state, "welcome")

	def test_gps_pin_acknowledged_and_skip(self):
		h = Harness(self, PUBLIC)
		start(h)
		fill_location(h, None)
		h.tap("Use my location")
		h.say("skip")
		self.assertEqual(h.s.state, "r_name")
		self.assertIsNone(h.s.draft.location_name)

		g = Harness(self, PUBLIC)
		start(g)
		fill_location(g, None)
		g.tap("Use my location")
		g.send({"type": "location", "lat": 0.0573, "lng": 40.2974, "name": "Block B4"})
		self.assertEqual(g.s.state, "r_name")
		self.assertRegex(
			g.bodies(), r"Location received[\s\S]*`0\.05730, 40\.29740`[\s\S]*Area: \*Block B4\*"
		)

	def test_supporting_items_counted(self):
		h = Harness(self, PUBLIC)
		start(h)
		fill_location(h)
		h.tap("Amina")
		fill_common_steps(h)
		h.tap("Today")
		h.send({"type": "media", "kind": "image", "media_id": "m1", "mime_type": "image/jpeg"})
		self.assertRegex(h.bodies(), r"\*Photo attached\*[\s\S]*Supporting items attached: \*1\*")
		h.say("Water point near the borehole")
		self.assertRegex(
			h.bodies(), r'Text note added:\*\n_"Water point near the borehole"_[\s\S]*attached: \*2\*'
		)
		h.send({"type": "media", "kind": "audio", "media_id": "m2", "mime_type": "audio/ogg", "voice": True})
		self.assertRegex(h.bodies(), r"\*Voice note attached\*[\s\S]*attached: \*3\*")
		h.tap("Proceed to review")
		self.assertIn("Supporting info:* 2 file(s), 1 note(s)", h.bodies())

	def test_edit_region_asks_new_sub_county(self):
		h = Harness(self, PUBLIC)
		start(h)
		fill_location(h)
		h.tap("Amina")
		fill_common_steps(h)
		finish_without_extras(h)
		h.tap("Back / edit")
		h.tap("Region")  # location comes first, so it is on the first page of the edit list
		h.tap("Kalobeyei")
		self.assertEqual(h.s.state, "r_subcounty")
		h.tap("Turkana West")
		self.assertEqual(h.s.state, "r_review")
		self.assertRegex(h.bodies(), r"Kalobeyei[\s\S]*Turkana West")

	def test_long_lists_paged_and_shortened(self):
		regions = [
			{"name": f"r{i}", "label": f"Region number {i + 1} with a very long name"} for i in range(15)
		]
		h = Harness(self, PUBLIC, data=FakeData(regions=regions, sub_counties={}))
		start(h)  # the region list is the first step
		self.assertEqual(h.s.state, "r_region")
		h.tap("More")
		self.assertIn("prev", h.s.shown)
		h.say("Region number 15 with a very long name")  # full typed name works
		self.assertEqual(h.s.draft.region, "r14")
		self.assertEqual(h.s.state, "r_place")  # no sub-counties: question skipped

	def test_step_header_and_footer(self):
		h = Harness(self, PUBLIC)
		h.say("hi")
		self.assertEqual(h.last[0]["header"], "Welcome to Kenya Red Cross Society")
		self.assertIsNone(h.last[0].get("footer"))
		h.tap("Community member")
		h.tap("English")
		h.tap("Step by step")
		[m] = h.last
		self.assertEqual(m["header"], "Step 1 of 13: Where is it happening?")
		self.assertNotIn("Step 1", m["body"])
		self.assertEqual(m["footer"], "Type back for the previous step, cancel to stop")

	def test_back(self):
		h = Harness(self, PUBLIC)
		start(h)
		fill_location(h)
		h.tap("Amina")
		h.tap("Human disease")
		h.tap("Other symptoms")
		h.tap("Stomach")
		h.say("back")  # inside a symptom group: back to the groups
		self.assertEqual(h.s.state, "r_symptoms")
		self.assertIn("What kind of problem is it", h.bodies())
		h.say("back")  # groups: back to the common symptoms
		self.assertIsNone(h.s.symptom_group)
		self.assertIn("Not in the list", h.bodies())
		h.say("back")  # common symptoms: previous step, answer kept
		self.assertEqual(h.s.state, "r_category")
		self.assertEqual(h.s.draft.category, "Human Disease")
		h.tap("Human disease")
		h.tap("Diarrhea")
		h.say("rudi")  # Kiswahili keyword works too
		self.assertEqual(h.s.state, "r_symptoms")
		self.assertEqual(len(h.s.draft.symptoms), 1)

		g = Harness(self, PUBLIC)
		start(g)
		g.say("back")  # first step: stays put
		self.assertEqual(g.s.state, "r_region")
		fill_location(g, None)
		g.tap("Use my location")
		g.say("back")
		self.assertEqual(g.s.state, "r_place")
		g.tap("Skip")
		self.assertEqual(g.s.state, "r_name")
		g.tap("Amina")
		fill_common_steps(g)
		g.tap("Specific date")
		g.say("back")
		self.assertEqual(g.s.state, "r_onset")
		g.tap("Today")
		g.tap("Skip & review")
		g.say("back")  # on review, "back" still opens the edit menu
		self.assertEqual(g.s.state, "r_edit")
		g.tap("More")  # location fills the first page of the edit list
		g.tap("Sex")
		g.say("back")  # editing: back to review, not to the previous step
		self.assertEqual(g.s.state, "r_review")
		self.assertEqual(g.s.draft.sex, "Mixed")

	def test_last_step_button(self):
		h = Harness(self, PUBLIC)
		start(h)
		fill_location(h)
		h.tap("Amina")
		fill_common_steps(h)
		h.tap("Today")
		self.assertIn("Nothing to add? Tap *Skip & review*", h.bodies())
		self.assertEqual([b["title"] for b in h.last[0]["buttons"]], ["Skip & review"])
		h.say("borehole is dirty")
		self.assertEqual([b["title"] for b in h.last[0]["buttons"]], ["Proceed to review"])
		h.say("proceed to review")  # typed label works too
		self.assertEqual(h.s.state, "r_review")

	def test_welcome_image_once(self):
		h = Harness(self, PUBLIC)
		h.ctx.settings.welcome_image_url = "https://example.org/krcs-logo.png"
		h.say("hi")
		self.assertEqual([m["kind"] for m in h.last], ["image", "buttons"])
		self.assertEqual(h.last[0]["link"], "https://example.org/krcs-logo.png")
		h.say("hi")
		self.assertEqual([m["kind"] for m in h.last], ["buttons"])

	def test_no_emoji(self):
		h = Harness(self, STAFF, chatbot=FakeChatbot())
		seen = []
		for step in (
			lambda: h.say("hi"),
			lambda: h.tap("KRCS Staff"),
			lambda: h.tap("Submit health report"),
			lambda: h.tap("Dadaab"),
			lambda: h.say("help"),
			lambda: h.tap("Health advice"),
		):
			step()
			seen.append(repr(h.last))
		emoji = [ch for ch in "".join(seen) if unicodedata.category(ch) == "So" and ord(ch) > 0x2000]
		self.assertEqual(emoji, [])

	def test_backend_error_gives_friendly_message(self):
		data = FakeData()
		data.find_staff = lambda phone: 1 / 0
		h = Harness(self, PUBLIC, data=data)
		logged = []
		h.ctx.log_error = logged.append
		start(h, "staff")
		self.assertIn("something went wrong", h.bodies())
		self.assertEqual(logged, ["WhatsApp conversation failed"])

	def test_failed_save_keeps_draft(self):
		data = FakeData()
		data.create_report = lambda doc: 1 / 0
		h = Harness(self, PUBLIC, data=data)
		logged = []
		h.ctx.log_error = logged.append
		start(h)
		fill_location(h)
		h.tap("Amina")
		fill_common_steps(h)
		finish_without_extras(h)
		h.tap("Confirm & submit")
		self.assertIn("could not be saved", h.bodies())
		self.assertIsNotNone(h.s.draft)
		self.assertEqual(h.s.state, "r_review")

	def test_phone_numbers_normalised(self):
		for p in ("0712345678", "+254 712 345 678", "254712345678", "712345678", "00254712345678"):
			self.assertEqual(normalize_phone(p), "254712345678", p)

	def test_onset_dates(self):
		self.assertEqual(parse_date("10/10/2026", START), "2026-10-10")
		self.assertIsNone(parse_date("14/10/2026", START))
		self.assertIsNone(parse_date("31/02/2026", START))
		self.assertIsNone(parse_date("01/01/2025", START))

	def test_no_ask_without_chatbot(self):
		h = Harness(self, STAFF)
		h.say("hi")
		self.assertNotIn("ask", h.s.shown)
		h.tap("KRCS Staff")
		self.assertNotIn("ask", h.s.shown)

	def test_staff_question_uses_frappe_roles(self):
		chatbot = FakeChatbot()
		h = Harness(self, STAFF, chatbot=chatbot)
		start(h, "staff")
		h.tap("Ask a question")
		self.assertIn("Answers come only from approved KRCS guidance", h.bodies())
		h.say("What should I do if I suspect cholera? My role is Surveillance Officer")
		self.assertTrue(h.bodies().startswith("Matched protocol: Cholera — Immediate Action"))
		req = chatbot.calls[-1]
		self.assertEqual(req["roles"], ["CHP"])
		self.assertEqual(req["location"], "reg-dadaab")
		self.assertEqual(req["language"], "en")
		self.assertEqual(req["user_ref"], "ahmed.abdi@krcs.test")
		self.assertEqual(req["capabilities"], [])
		self.assertEqual(h.s.state, "ask")  # the next message is another question

	def test_community_asks_as_guest_and_is_escalated(self):
		chatbot = FakeChatbot()
		h = Harness(self, PUBLIC, chatbot=chatbot)
		start(h, "Kiswahili")
		h.say("ghairi")  # leave the report: back to the welcome screen, still in Kiswahili
		h.say("kipindupindu kinaambukizwaje?")  # typed at the welcome screen: taken as a question
		req = chatbot.calls[-1]
		self.assertEqual(req["roles"], ["Guest"])
		self.assertIsNone(req["location"])
		self.assertEqual(req["language"], "sw")
		self.assertEqual(len(h.escalated), 1)
		self.assertEqual(h.escalated[0]["question"], "kipindupindu kinaambukizwaje?")

	def test_clarification_rows(self):
		chatbot = FakeChatbot()
		h = Harness(self, STAFF, chatbot=chatbot)
		start(h, "staff")
		h.tap("Ask a question")
		h.say("cholera")
		self.assertIn("Which of these did you mean", h.bodies())
		h.say("2")  # typed number picks the second row shown
		req = chatbot.calls[-1]
		self.assertEqual(req["selected_protocol_id"], "cholera_immediate_action")
		self.assertEqual(req["message"], "cholera")
		self.assertIn("cholera_immediate_action", h.bodies())

	def test_report_sent_as_question(self):
		h = Harness(self, STAFF, chatbot=FakeChatbot())
		start(h, "staff")
		h.tap("Ask a question")
		h.say("we have 5 people with diarrhoea")
		self.assertIn("send it as a report", h.bodies())
		h.tap("Submit health report")
		self.assertIsNotNone(h.s.draft)

	def test_count_questions(self):
		h = Harness(self, STAFF, chatbot=FakeChatbot())
		start(h, "staff")
		h.tap("Ask a question")
		h.say("how many cholera reports this week?")
		self.assertIn("not available on WhatsApp", h.bodies())

	def test_chatbot_down(self):
		h = Harness(self, STAFF, chatbot=FakeChatbot())
		start(h, "staff")
		h.tap("Ask a question")
		h.say("service down?")
		self.assertIn("guidance service is not available right now, so I have not answered", h.bodies())
		self.assertEqual(h.escalated[0]["reason"], "service_unavailable")

	def test_split_long_replies(self):
		body = "\n".join(f"Line {i} {'x' * 30}" for i in range(300))
		parts = split_text(body)
		self.assertTrue(len(parts) > 1 and all(len(p) <= 4096 for p in parts))
		self.assertEqual(re.sub(r"\s+", "", "".join(parts)), re.sub(r"\s+", "", body))

	def test_symptom_groups(self):
		h = Harness(self, PUBLIC)
		start(h)
		fill_location(h)
		h.tap("Amina")
		h.tap("Human disease")

		def rows():
			return h.last[-1]["sections"][0]["rows"]

		self.assertEqual(
			[r["title"] for r in rows()],
			[
				"Fever (hot body)",
				"Diarrhea",
				"Vomiting",
				"Cough",
				"Difficulty Breathing",
				"Rash",
				"Unexplained Bleeding",
				"Headache",
				"Other symptoms",
			],
		)
		h.tap("Other symptoms")
		groups = rows()
		self.assertFalse(
			any(
				re.search(r"Gastrointestinal|Febrile|Dermatological|Neurological|Haemorrhagic", r["title"])
				for r in groups
			)
		)
		stomach = next(r for r in groups if r["title"] == "Stomach & diarrhoea")
		self.assertEqual(
			stomach["description"], "Abdominal Pain, Bloody Stool, Dehydration, Diarrhea, Vomiting"
		)
		self.assertTrue(any(r["title"] == "Common symptoms" for r in groups))
		h.tap("Stiff neck")
		h.tap("Stiff Neck")
		self.assertIn("• Stiff Neck", h.bodies())
		h.tap("Add another")
		self.assertNotIn(
			"Stiff Neck", "|".join(r["title"] for r in rows())
		)  # chosen ones are not offered again

		sw = Harness(self, PUBLIC)
		start(sw, "Kiswahili")
		fill_location(sw)
		sw.tap("Amina")
		sw.tap("binadamu")
		sw.tap("Dalili nyingine")
		self.assertTrue(any(r["title"] == "Tumbo na kuhara" for r in sw.last[-1]["sections"][0]["rows"]))

	def test_symptoms_typed_in_everyday_words(self):
		h = Harness(self, PUBLIC)
		start(h)
		fill_location(h)
		h.tap("Amina")
		h.tap("Human disease")
		h.say("My child has a running stomach and is throwing up, no fever")
		self.assertEqual(h.s.state, "r_symptoms_more")
		self.assertIn("• Diarrhea\n• Vomiting\n\n", h.bodies())
		h.say("homa, kikohozi na maumivu ya tumbo")
		self.assertIn("• Vomiting\n• Fever (hot body)\n• Cough\n• Abdominal Pain", h.bodies())
		h.say("something else entirely")
		self.assertIn("couldn't match that to a symptom", h.bodies())
		self.assertEqual(len(h.s.draft.symptoms), 5)
		h.say("clear")
		h.say("xyz")
		self.assertEqual(h.s.state, "r_symptoms")
		self.assertIn("couldn't match", h.bodies())

	def test_live_schema_requires_pin_and_place_name(self):
		h = Harness(self, PUBLIC, data=FakeData(schema=LIVE_SCHEMA))
		start(h)
		fill_location(h, None)
		self.assertEqual(h.s.state, "r_place")
		self.assertEqual(h.last[0]["kind"], "location_request")
		h.say("skip")  # not allowed any more
		self.assertEqual(h.s.state, "r_place")
		self.assertIn("location is needed", h.bodies())
		self.assertIsNone(h.s.draft.location_name)
		h.say("Ifo Camp")
		self.assertEqual(h.s.state, "r_place_gps")
		self.assertRegex(
			h.bodies(), r"Noted: \*Ifo Camp\*[\s\S]*map location is also needed[\s\S]*Send location"
		)
		h.send({"type": "location", "lat": 0.05, "lng": 40.31})  # a pin without a name keeps the typed one
		self.assertEqual(h.s.state, "r_name")
		self.assertEqual(h.s.draft.location_name, "Ifo Camp")
		h.tap("Amina")
		h.tap("Human disease")
		h.tap("Diarrhea")
		h.tap("Continue")
		h.say("12")  # no sex step on the live schema
		self.assertRegex(h.bodies(), r"(?i)age group")
		self.assertEqual(len(h.last), 1)

		g = Harness(self, PUBLIC, data=FakeData(schema=LIVE_SCHEMA))
		g.s.update(
			lang="en",
			mode="community",
			state="r_place",
			last_active=START,  # mid-conversation, not a first message
			draft=AttrDict({**h.s.draft, "location_name": None, "latitude": None, "longitude": None}),
		)
		g.send({"type": "location", "lat": 0.05, "lng": 40.31})  # a pin alone asks for the name
		self.assertEqual(g.s.state, "r_place_name")
		self.assertRegex(g.bodies(), r"Location received[\s\S]*type the name of the place")
		g.say("Block B4")
		self.assertEqual(g.s.state, "r_name")


class FakeExtractor:
	"""A stand-in for POST /extract: returns `fields` as the service would, with evidence and confidence."""

	def __init__(self, fields, **extra):
		self.fields, self.extra, self.calls = fields, extra, []

	def extract(self, body):
		self.calls.append(body)
		out = {
			k: {"value": v, "confidence": c, "autofill": c >= 0.7, "evidence": [{"text": str(v)}]}
			for k, (v, c) in self.fields.items()
		}
		return {
			"extractor": "rules-1.0", "language": "en", "is_report": True, "fields": out, "danger_signs": [],
			"threat": "routine", "mentioned_diseases": [], "notes": [], **self.extra,
		}  # fmt: skip


class TestFreeText(FrappeTestCase):
	"""Free-text community reports (AI/ML §1.4, SRS H.12): mirrors the free-text tests of node/test/flow.test.js."""

	def test_message_fills_what_it_states_only_missing_questions_asked_advice_follows(self):
		h = Harness(self, PUBLIC)
		start(h, guided=False)
		self.assertRegex(h.bodies(), r"Tell us what is happening[\s\S]*Step by step")
		h.say("5 children have diarrhoea and vomiting since yesterday in Fafi")
		self.assertRegex(
			h.bodies(),
			r"From your message I noted:[\s\S]*Sub-county: Fafi[\s\S]*Symptoms: Diarrhea, Vomiting[\s\S]*Number affected: 5[\s\S]*2 more questions",
		)
		self.assertEqual(h.s.state, "r_sex")
		self.assertIn("Step 1 of 2: Sex", h.bodies())
		h.tap("Mixed")
		self.assertIn("Step 2 of 2: Deaths", h.bodies())
		h.tap("None")
		self.assertEqual(h.s.state, "r_review")
		self.assertIn("*Your message:* _5 children have diarrhoea", h.bodies())
		self.assertIn("*Name:* Amina", h.bodies())  # WhatsApp profile name (AI/ML §6.6)
		self.assertIn("Some answers were taken from your message", h.bodies())
		h.tap("Confirm & submit")
		self.assertRegex(h.bodies(), r"Report received[\s\S]*While you wait for the KRCS team[\s\S]*Diarrhoea or vomiting")
		r = h.data.reports[0]
		self.assertEqual(
			(r["region"], r["sub_county"], r["affected_count"], r["onset_date"], r["category"], r["reporter_name"]),
			("reg-dadaab", "Garissa-Fafi", 5, "2026-10-12", "Human Disease", "Amina"),
		)
		self.assertRegex(
			r["additional_notes"],
			r'Message: "5 children have diarrhoea[\s\S]*affected_count = 5 \(0\.90\)[\s\S]*Asked as follow-up questions: Sex, Deaths',
		)

	def test_service_values_below_threshold_or_unknown_are_asked_and_danger_comes_first(self):
		extractor = FakeExtractor(
			{
				"symptoms": (["sym-28", "not-a-symptom"], 0.95),
				"affected_count": (12, 0.6),
				"region": ("reg-kalobeyei", 0.95),
				"sub_county": ("Turkana-Lokichogio", 0.95),
				"deaths_count": (2, 0.95),
				"onset_date": ("2026-10-12", 0.9),
				"category": ("Human Disease", 0.85),
				"sex": ("Mixed", 0.8),
				"location_name": ("block 4", 0.8),
			},
			danger_signs=["deaths", "bleeding"],
			threat="high",
		)
		h = Harness(self, PUBLIC, extractor=extractor)
		start(h, guided=False)
		h.say("12 people bleeding in block 4 Lokichogio since yesterday, 2 died")
		self.assertEqual(extractor.calls[0]["today"], "2026-10-13")
		urgent, noted = h.last[:2]
		self.assertIn("This may be serious", urgent["body"])
		self.assertRegex(noted["body"], r"Exact location: block 4[\s\S]*Deaths: 2")
		self.assertEqual(h.s.state, "r_symptoms")
		h.tap("Unexplained Bleeding")
		h.tap("Continue")
		self.assertEqual(h.s.state, "r_count")
		h.say("12")
		self.assertEqual(h.s.state, "r_review")
		h.tap("Confirm & submit")
		self.assertIn("Bleeding:* take the person to a health facility now", h.bodies())
		self.assertIn("Danger signs mentioned: deaths, bleeding (threat: high)", h.data.reports[0]["additional_notes"])

	def test_service_down_falls_back_to_keywords(self):
		class Down:
			def extract(self, body):
				raise RuntimeError("POST /extract -> 503")

		h = Harness(self, PUBLIC, extractor=Down())
		h.ctx.log_error = lambda title: None
		start(h, guided=False)
		h.say("my child has fever")
		self.assertEqual(h.s.draft.symptoms, ["sym-12"])
		self.assertEqual(h.s.draft.extraction.extractor, "keywords-fallback")

	def test_no_sign_of_illness_is_not_dropped(self):
		h = Harness(self, PUBLIC)
		start(h, guided=False)
		h.say("the water at the borehole is dirty")
		self.assertIn("could not find signs of illness", h.bodies())
		h.tap("Something else")
		self.assertEqual([(e["reason"], e["question"]) for e in h.escalated], [("not_a_report", "the water at the borehole is dirty")])
		self.assertIn("passed to the KRCS team", h.bodies())
		g = Harness(self, PUBLIC)
		start(g, guided=False)
		g.say("please come and see us")
		g.tap("Someone is sick")
		self.assertEqual(g.s.state, "r_region")

	def test_report_typed_on_welcome_screen_starts_free_text_report_in_its_language(self):
		h = Harness(self, PUBLIC)
		h.say("hi")
		h.say("watoto watatu wana homa na kuhara jana Liboi")
		self.assertEqual((h.s.mode, h.s.lang), ("community", "sw"))
		self.assertIn("Kutoka kwa ujumbe wako nimeandika", h.bodies())
		self.assertEqual(h.s.draft.symptoms, ["sym-12", "sym-4"])
		self.assertEqual(h.s.draft.sub_county, "Garissa-Liboi")
		g = Harness(self, STAFF, chatbot=FakeChatbot())
		g.say("hi")
		g.say("we have 5 people with diarrhoea")
		self.assertIsNone(g.s.draft)

	def test_photo_caption_is_the_description_and_voice_note_asks_for_text(self):
		h = Harness(self, PUBLIC)
		start(h, guided=False)
		h.send({"type": "media", "kind": "audio", "media_id": "v1", "mime_type": "audio/ogg", "voice": True})
		self.assertRegex(h.bodies(), r"Voice note saved[\s\S]*type a short description")
		h.send({"type": "media", "kind": "image", "media_id": "p1", "mime_type": "image/jpeg", "caption": "rash on 2 children"})
		self.assertEqual(h.s.draft.symptoms, ["sym-21"])
		self.assertEqual(len(h.s.draft.media), 2)
