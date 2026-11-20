"""Community WhatsApp reports written to CBS (cbs.py) against a real site.

CBS is replaced by FakeCBS, which answers as the CBS API documents do; nothing leaves the test. Commits are patched
out so the test data is rolled back with the test.
"""

import json
from unittest.mock import patch

import frappe
import requests
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_to_date, now_datetime

from surveillance.whatsapp import cbs, data, jobs, retention, setup
from surveillance.whatsapp.cbs import pick_event, regions_of

PHONE = "254799333444"
STAFF_USER = "Administrator"
DESK = "254700000009"
CBS_URL = "https://cbs.test"


class Response:
	def __init__(self, status, body):
		self.status_code, self.body = status, body

	def json(self):
		return self.body


class FakeCBS:
	"""The CBS API as documented: login, projects, events, levels, regions, reports. `fail` holds the answers to
	give to the next report calls instead: a status code, or "drop" for no answer."""

	def __init__(self, sub_counties):
		self.project = "p" * 24
		self.levels = [
			{"_id": "lv1", "name": "County"},
			{"_id": "lv2", "name": "Sub County"},
			{"_id": "lv3", "name": "Community Health Unit"},
		]
		self.regions, self.events = [], []
		for county in sorted({s.county for s in sub_counties}):
			self.regions.append(
				{"_id": f"c-{county}", "name": f"{county} County", "level": "lv1", "parent": None}
			)
		for s in sub_counties:
			sid = f"s-{s.sub_county_name}"
			self.regions.append(
				{
					"_id": sid,
					"name": f"{s.sub_county_name} Sub County",
					"level": "lv2",
					"parent": f"c-{s.county}",
				}
			)
			self.regions.append(
				{
					"_id": f"u-{s.sub_county_name}",
					"name": f"{s.sub_county_name} CHU",
					"level": "lv3",
					"parent": sid,
				}
			)
		for code, name in (
			("AWD", "Acute Watery Diarrhoea / Cholera"),
			("MEASLES", "Measles"),
			("UIP", "Unusual illness in people"),
			("UDP", "Unusual deaths of people"),
			("UIDA", "Unusual illnesses or deaths of animals"),
			("UE", "Unusual event"),
		):
			self.events.append({"_id": f"e-{code}", "code": code, "name": name})
		self.reports, self.calls, self.fail = {}, [], []
		self.tokens, self.logins = set(), 0

	def request(self, method, url, json=None, params=None, headers=None, timeout=None):
		path = url.removeprefix(CBS_URL)
		self.calls.append((method, path, json))
		if path == "/api/auth/login":
			if json != {"email": "writer@krcs.test", "password": "secret"}:
				return Response(
					401, {"error": {"code": "INVALID_CREDENTIALS", "message": "Invalid email or password"}}
				)
			self.logins += 1
			token = f"t{self.logins}"
			self.tokens.add(token)
			return Response(200, {"token": token, "user": {"_id": "u1"}})
		if (headers or {}).get("Authorization", "").removeprefix("Bearer ") not in self.tokens:
			return Response(401, {"error": {"code": "TOKEN_EXPIRED", "message": "Token expired"}})
		if path.startswith("/api/reports") and self.fail:
			answer = self.fail.pop(0)
			if answer == "drop":
				raise requests.ConnectionError("connection reset")
			return Response(
				answer, {"error": {"code": f"E{answer}", "message": "Simulated", "retryAfter": 120}}
			)
		if path == "/api/projects":
			return Response(200, {"projects": [{"_id": self.project, "title": "Kenya CBS"}]})
		if path == f"/api/events/{self.project}":
			return Response(200, {"events": self.events})
		if path == f"/api/geo/levels/{self.project}":
			return Response(200, {"levels": self.levels})
		if path == f"/api/geo/regions/{self.project}":
			return Response(200, {"regions": self.regions, "page": 1, "pages": 1})
		if (method, path) == ("POST", "/api/reports"):
			rid = f"r{len(self.reports) + 1:023d}"
			self.reports[rid] = {**json, "_id": rid, "caseNumber": f"C{len(self.reports) + 1:06d}"}
			return Response(201, {"report": self.reports[rid], "escalation": {"_id": "x", "currentLevel": 0}})
		if method == "PUT" and path.removeprefix("/api/reports/") in self.reports:
			self.reports[path.removeprefix("/api/reports/")].update(json)
			return Response(200, {"report": self.reports[path.removeprefix("/api/reports/")]})
		return Response(404, {"error": {"code": "NOT_FOUND", "message": path}})

	def posted(self):
		return [body for method, path, body in self.calls if (method, path) == ("POST", "/api/reports")]


class FakeWhatsApp:
	def __init__(self):
		self.sent = []

	def send(self, to, msg):
		self.sent.append((to, msg))
		return {"messages": [{"id": f"wamid.{len(self.sent)}"}]}


class TestCBSWriteback(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		setup.after_migrate()
		if not frappe.db.count("Sub County"):
			from surveillance.locations import seed_sub_counties

			seed_sub_counties()
		cls.sub_counties = frappe.get_all(
			"Sub County",
			filters={"is_active": 1},
			fields=["name", "sub_county_name", "county", "region", "latitude", "longitude"],
		)
		cls.sub_county = cls.sub_counties[0]
		cls.symptom = frappe.get_all("Symptom", pluck="name", limit=1)[0]

	def setUp(self):
		frappe.get_doc("WhatsApp Settings").update(
			{
				"enabled": 1,
				"phone_number_id": "123",
				"access_token": "token",
				"app_secret": "secret",
				"verify_token": "verify-me",
				"notify_numbers": DESK,
				"notify_template": "",
				"cbs_writeback": 1,
				"cbs_writeback_url": CBS_URL,
				"cbs_writeback_email": "writer@krcs.test",
				"cbs_writeback_password": "secret",
				"cbs_project": "",
			}
		).save()
		frappe.cache.delete_keys("cbs_writeback:")
		# Test data stays until the class ends (commits are patched out): start each test from none.
		frappe.db.delete(cbs.WRITEBACK)
		for name in frappe.get_all("Case Report", filters={"phone_number": f"+{PHONE}"}, pluck="name"):
			frappe.delete_doc("Case Report", name, force=True, ignore_permissions=True)
		self.cbs = FakeCBS(self.sub_counties)
		self.wa = FakeWhatsApp()
		for p in (
			patch.object(cbs, "session", return_value=self.cbs),
			patch.object(jobs, "whatsapp_client", return_value=self.wa),
			patch("frappe.db.commit"),
		):
			p.start()
			self.addCleanup(p.stop)

	def report(self, staff=False, **values):
		doc = {
			"doctype": "Case Report",
			"reported_by": STAFF_USER if staff else data.community_user(),
			"reporter_name": "Achieng Staff" if staff else "Amina",
			"phone_number": "+254711000333" if staff else f"+{PHONE}",
			"signal_type": "Suspected Outbreak" if staff else "Community Signal",
			"category": "Human Disease",
			"region": self.sub_county.region,
			"sub_county": self.sub_county.name,
			"location_name": "Block C",
			"latitude": 0.123456,
			"longitude": 40.654321,
			"affected_count": 4,
			"deaths_count": 0,
			"symptoms": [{"symptom": self.symptom}],
			"onset_date": frappe.utils.today(),
			"report_date": frappe.utils.today(),
			"additional_notes": "My name is Amina, call 0722 123 456",
			"channel": "WhatsApp",
			"status": "Submitted",
			**values,
		}
		disease = doc.pop("suspected_disease", None)
		name = frappe.get_doc(doc).insert(ignore_permissions=True).name
		if disease:  # the Case Report's rules classify it on save
			frappe.db.set_value("Case Report", name, {"suspected_disease": disease, "classified_by": "Rules"})
		return name

	def submit(self, name, danger_signs=None):
		phone = frappe.db.get_value("Case Report", name, "phone_number").lstrip("+")
		jobs.after_submit(name, [], phone, None, danger_signs or [])

	def row(self, name):
		return frappe.get_doc(cbs.WRITEBACK, name)

	def test_community_report_is_created_in_cbs_and_not_sent_to_the_desk(self):
		name = self.report(suspected_disease="awd-cholera")
		self.submit(name, ["cannot drink"])
		row = self.row(name)
		self.assertEqual((row.status, row.cbs_case_number, row.attempts), ("Sent", "C000001", 1))
		self.assertTrue(row.cbs_report_id)
		self.assertEqual(self.wa.sent, [])  # CBS escalates it

		[sent] = self.cbs.posted()
		centre = self.sub_county
		self.assertEqual(sent["project"], self.cbs.project)
		self.assertEqual(sent["region"], f"s-{centre.sub_county_name}")
		self.assertEqual(sent["event"], "e-AWD")
		self.assertEqual((sent["noOfCases"], sent["phoneNumber"]), (4, f"+{PHONE}"))
		if centre.latitude and centre.longitude:
			self.assertEqual(
				sent["location"]["coordinates"], [centre.longitude, centre.latitude]
			)  # not the reporter's point
		self.assertIn("Block C", sent["location"]["name"])
		self.assertIn(name, sent["description"])
		self.assertIn("cannot drink", sent["description"])
		self.assertNotIn("Amina", json.dumps(sent))  # no name, not even in the notes
		self.assertNotIn("0722", sent["description"])
		self.assertNotIn(PHONE, row.payload)  # the record keeps a shortened number
		self.assertNotIn("source", sent)  # CBS only allows web, mobile_app, ussd and legacy

	def test_staff_report_stays_in_frappe_and_alerts_the_desk(self):
		name = self.report(staff=True)
		self.submit(name)
		self.assertFalse(frappe.db.exists(cbs.WRITEBACK, name))
		self.assertEqual(self.cbs.calls, [])
		[(to, alert)] = self.wa.sent
		self.assertEqual(to, DESK)
		self.assertIn(name, alert["body"])

	def test_with_the_write_back_off_community_reports_alert_the_desk(self):
		frappe.get_doc("WhatsApp Settings").update({"cbs_writeback": 0}).save()
		name = self.report()
		self.submit(name)
		self.assertFalse(frappe.db.exists(cbs.WRITEBACK, name))
		self.assertEqual(len(self.wa.sent), 1)

	def test_cbs_down_is_retried_later_and_then_sent(self):
		name = self.report()
		self.cbs.fail = [503]
		self.submit(name)
		row = self.row(name)
		self.assertEqual((row.status, row.attempts), ("Queued", 1))
		self.assertGreater(row.next_attempt, now_datetime())
		self.assertIn("503", row.message)

		cbs.retry_due()  # not due yet
		self.assertEqual(self.row(name).attempts, 1)
		frappe.db.set_value(cbs.WRITEBACK, name, "next_attempt", add_to_date(now_datetime(), minutes=-1))
		cbs.retry_due()
		row = self.row(name)
		self.assertEqual((row.status, row.attempts, row.cbs_case_number), ("Sent", 2, "C000001"))
		self.assertEqual(self.wa.sent, [])

	def test_rate_limit_waits_as_long_as_cbs_asks(self):
		name = self.report()
		self.cbs.fail = [429]
		self.submit(name)
		wait = (self.row(name).next_attempt - now_datetime()).total_seconds()
		self.assertGreater(wait, 100)  # retryAfter 120 s, longer than the first back-off (60 s)

	def test_after_the_last_retry_the_desk_gets_the_report(self):
		name = self.report()
		self.cbs.fail = ["drop"] * (len(cbs.BACKOFF_MINUTES) + 1)
		self.submit(name)
		for _ in cbs.BACKOFF_MINUTES:
			frappe.db.set_value(cbs.WRITEBACK, name, "next_attempt", add_to_date(now_datetime(), minutes=-1))
			cbs.retry_due()
		row = self.row(name)
		self.assertEqual((row.status, row.desk_alerted), ("Failed", 1))
		self.assertIn("Gave up", row.message)
		self.assertEqual(len(self.wa.sent), 1)
		cbs.retry_due()
		self.assertEqual(len(self.wa.sent), 1)  # alerted once

	def test_refused_report_fails_at_once_and_alerts_the_desk(self):
		name = self.report()
		self.cbs.fail = [403]
		self.submit(name)
		row = self.row(name)
		self.assertEqual((row.status, row.attempts, row.desk_alerted), ("Failed", 1, 1))
		self.assertEqual(len(self.wa.sent), 1)

	def test_expired_token_logs_in_again(self):
		self.submit(self.report())
		self.cbs.tokens.clear()  # CBS no longer accepts the cached token
		name = self.report()
		self.submit(name)
		self.assertEqual(self.row(name).status, "Sent")
		self.assertEqual(self.cbs.logins, 2)

	def test_token_and_catalog_are_reused(self):
		self.submit(self.report())
		self.submit(self.report())
		self.assertEqual(self.cbs.logins, 1)
		self.assertEqual(sum(1 for _, path, _ in self.cbs.calls if path.startswith("/api/geo/regions")), 1)

	def test_a_url_without_its_own_account_never_gets_the_cbs_feed_account(self):
		frappe.get_doc("WhatsApp Settings").update({"cbs_writeback_email": ""}).save()
		name = self.report()
		with patch.dict(frappe.conf, {"cbs_email": "feed@krcs.test", "cbs_password": "feed"}):
			self.submit(name)
		self.assertEqual(self.row(name).status, "Failed")
		self.assertEqual(self.cbs.calls, [])

	def test_sub_county_missing_in_cbs_falls_back_to_the_county(self):
		self.cbs.regions = [r for r in self.cbs.regions if r["_id"] != f"s-{self.sub_county.sub_county_name}"]
		name = self.report()
		self.submit(name)
		self.assertEqual(self.cbs.posted()[0]["region"], f"c-{self.sub_county.county}")
		self.assertIn("county level", self.row(name).message)

	def test_no_cbs_region_at_all_fails(self):
		self.cbs.regions = []
		name = self.report()
		self.submit(name)
		self.assertEqual(self.row(name).status, "Failed")
		self.assertIn("No CBS region", self.row(name).message)

	def test_anonymising_a_community_reporter_clears_the_cbs_copy_and_leaves_staff_alone(self):
		name = self.report()
		self.submit(name)
		staff = self.report(staff=True, phone_number=f"+{PHONE}")  # same number, as staff
		self.assertEqual(retention.anonymise_reporter(PHONE), [name])
		[cbs_copy] = self.cbs.reports.values()
		self.assertEqual((cbs_copy["description"], cbs_copy["phoneNumber"]), (cbs.REMOVED_TEXT, ""))
		row = self.row(name)
		self.assertFalse(row.payload)
		self.assertIn("cleared in CBS", row.message)
		self.assertEqual(frappe.db.get_value("Case Report", staff, "reporter_name"), "Achieng Staff")

	def test_anonymising_before_it_was_sent_cancels_it(self):
		name = self.report()
		self.cbs.fail = [503]
		self.submit(name)
		retention.anonymise_reporter(PHONE)
		self.assertEqual(self.row(name).status, "Cancelled")
		frappe.db.set_value(cbs.WRITEBACK, name, "next_attempt", add_to_date(now_datetime(), minutes=-1))
		cbs.retry_due()
		self.assertEqual(len(self.cbs.posted()), 1)  # only the attempt CBS answered with 503

	def test_check_shows_how_sub_counties_and_diseases_match(self):
		result = cbs.check()
		self.assertEqual(result["project"], self.cbs.project)
		self.assertIn("(sub-county)", result["sub_counties"][self.sub_county.name])
		if "awd-cholera" in result["diseases"]:
			self.assertEqual(result["diseases"]["awd-cholera"], "Acute Watery Diarrhoea / Cholera")


class TestCBSMatching(FrappeTestCase):
	"""Matching without CBS: regions as CBS lists them, events as the CBS feed reads them."""

	def test_regions_nested_or_flat_find_their_county(self):
		nested = [
			{
				"_id": "c",
				"name": "Garissa County",
				"level": {"name": "County"},
				"children": [
					{
						"_id": "s",
						"name": "Dadaab Sub County",
						"level": {"name": "Sub-County"},
						"children": [
							{"_id": "u", "name": "Ifo CHU", "level": {"name": "Community Health Unit"}}
						],
					}
				],
			}
		]
		by_id = {r["id"]: r for r in regions_of(nested)}
		self.assertEqual((by_id["s"]["kind"], by_id["s"]["county"]), ("sub_county", "Garissa County"))
		self.assertEqual((by_id["u"]["kind"], by_id["u"]["county"]), ("other", "Garissa County"))
		region, matched = cbs.pick_region(list(by_id.values()), "Dadaab", "Garissa")
		self.assertEqual((region["id"], matched), ("s", "sub-county"))

	def test_same_sub_county_name_in_two_counties_uses_the_county(self):
		regions = regions_of(
			[
				{"_id": "c1", "name": "Garissa", "level": {"name": "County"}},
				{"_id": "c2", "name": "Wajir", "level": {"name": "County"}},
				{"_id": "s1", "name": "Central", "level": {"name": "Sub County"}, "parent": "c1"},
				{"_id": "s2", "name": "Central", "level": {"name": "Sub County"}, "parent": "c2"},
			]
		)
		self.assertEqual(cbs.pick_region(regions, "Central", "Wajir")[0]["id"], "s2")

	def test_events_for_a_disease_or_the_unusual_event_that_fits(self):
		events = [
			{"_id": "m", "name": "Measles", "code": "MEASLES"},
			{"_id": "ip", "name": "Unusual illness in people", "code": "UIP"},
			{"_id": "dp", "name": "Unusual deaths of people", "code": "UDP"},
			{"_id": "a", "name": "Unusual illnesses or deaths of animals", "code": "UIDA"},
			{"_id": "e", "name": "Unusual event", "code": "UE"},
		]
		self.assertEqual(pick_event(events, "measles", "Human Disease", 0)["_id"], "m")
		self.assertEqual(pick_event(events, None, "Human Disease", 0)["_id"], "ip")
		self.assertEqual(pick_event(events, "anthrax", "Human Disease", 2)["_id"], "dp")
		self.assertEqual(
			pick_event(events, None, "Animal Disease", 0)["_id"], "a"
		)  # CBS's combined animal event
		self.assertEqual(pick_event(events[-1:], None, "Human Disease", 0)["_id"], "e")
		self.assertIsNone(pick_event(events[:1], None, "Human Disease", 0))
