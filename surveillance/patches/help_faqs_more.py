"""More Help Center FAQs for CHA, Facility Health Worker, Surveillance Officer, County / National and Data & AI Admin
(KRCS 27 Nov 2026). English; Kiswahili can be added on Help Center Content. Safe to run again: an FAQ is added only
when no FAQ with the same question exists, so nothing an admin has written, changed or removed before is touched.
"""
import frappe

CHA, FHW, OFF, DAI, FULL = "cha", "fhw", "officer", "dataai", "full"
FIELD = {CHA: "for_cha", FHW: "for_fhw", OFF: "for_officer", DAI: "for_dataai", FULL: "for_full"}

# (topic, who, question, answer)
FAQS = [
	# ---- CHA ----
	("Reporting", [CHA], "How do I verify a new signal?",
	 "Open it from the Review Queue. On Verification, work through 1. Check with the reporter and 2. Questions about this "
	 "signal, then verify it. It is sent to the surveillance officer."),
	("Reporting", [CHA], "What if a signal is a false alarm?",
	 "On Verification, choose Discard, write the reason and tap Discard signal. The reporters get a thank-you note and "
	 "the event stays in the history as Discarded."),
	("Reporting", [CHA], "What happens after I verify a signal?",
	 "The surveillance officer takes it on: AI triage, field investigation and a decision. The steps at the top of the "
	 "event page show where it is."),
	("Reporting", [CHA], "Can I report a case myself?",
	 "Yes, if your role allows it. Go to Signals Captured and tap Create Report."),
	("Getting started", [CHA], "How do I see how my CHPs are doing?",
	 "Open CHPs in my CHU. Each CHP has their reports and referrals this month, open tasks and last sign-in. Contact any "
	 "CHP who has not reported or signed in for a while."),
	("Referrals and follow-ups", [CHA], "A CHP's referral says Did not reach. What should I do?",
	 "Ask the CHP to visit the person again and find out why they did not reach the facility. Help them get there if "
	 "they still need care."),

	# ---- Facility Health Worker ----
	("Getting started", [FHW], "What can I see as a facility health worker?",
	 "Your Dashboard shows referrals coming to your facility, open alerts near your facility and your facility's case "
	 "trend. Referrals lists everyone CHPs sent to your facility."),
	("Referrals and follow-ups", [FHW], "What if someone arrives without a referral?",
	 "Treat them as usual. If their illness is one you are asked to report and the EMR is down, tap Create Report and "
	 "record it."),
	("Referrals and follow-ups", [FHW], "Why should I mark Arrived or Did not arrive?",
	 "It tells the CHP and the CHA whether the person got care. Did not arrive asks them to follow the person up."),
	("Data and figures", [FHW], "Where do I see cases near my facility?",
	 "Open alerts near your facility are on your Dashboard. Epi Trends shows how cases change week by week."),
	("Reporting", [FHW], "Can I see the reports I sent?",
	 "Yes. Open Signals Captured to see your reports and what happened to them."),

	# ---- Surveillance Officer ----
	("Getting started", [OFF], "What are the steps of an event?",
	 "Signal captured, Verification (by the CHA), AI triage, Field investigation, Decision, then Response and close. The "
	 "steps at the top of the event page show where each event is."),
	("Reporting", [OFF], "What can I decide after the field investigation?",
	 "Confirm event when it is real (the response steps open next), Escalate to County/MoH when they need to lead, or "
	 "Close: no event found. When an event is closed, the reporters are thanked."),
	("Reporting", [OFF], "What does the AI triage do?",
	 "It suggests the likely disease and a risk level from the signs reported. It is a suggestion: you check it and "
	 "make the decision."),
	("Tasks", [OFF], "How do I give someone a task?",
	 "On the event page, in Field investigation or Response and close, add a task and choose who it is assigned to. They "
	 "get a notification and see it in My Tasks. CHPs see theirs under Follow-ups or Referrals."),
	("Referrals and follow-ups", [OFF], "How do I close a referral case?",
	 "Open Referrals. When a case is ready, use Close case and write a short closing summary. Cases of a priority disease "
	 "are closed from their event page when the response is done."),
	("Data and figures", [OFF], "How do I check the quality of the data?",
	 "Open Data Quality Monitoring for missing places, late or duplicate reports and facility completeness. Fix what you "
	 "can, then use Mark checked. Checked issues move to the Checked tab."),
	("Data and figures", [OFF, FULL], "Where do I see trends?",
	 "Open Epi Trends from your Dashboard. It shows cases week by week by disease and sub-county, and raises an alert "
	 "when cases in an area are higher than usual, so an outbreak is noticed early."),
	("Reporting", [OFF, FULL], "Where do I find the response protocol for a disease?",
	 "Open Response Protocols and choose the disease. The steps for each level are listed there, and the event page uses "
	 "the same steps."),

	# ---- County / National ----
	("Reporting", [FULL], "What happens when an event is escalated to us?",
	 "The event shows as escalated in the Review Queue. Field investigation, the decision and the response are then "
	 "with the County MOH / PHEOC."),
	("Reporting", [FULL, OFF], "How do I follow the response to an event?",
	 "Open the event from the Review Queue and go to Response and close. It shows the response tasks, who they are "
	 "assigned to and how far each has got."),
	("Data and figures", [FULL, OFF], "What is in Monitoring Reports?",
	 "Standard reports on signals received, how fast events were handled, decisions and tasks, data quality, AI "
	 "performance, CHA activity and system health. Choose a report, set the filters and export it."),
	("Data and figures", [FULL], "Can I see every county?",
	 "National users see every county. County users see their own region. Everything you open, download or ask the "
	 "KRCS Data Assistant about is limited to the area you can see."),
	("KRCS Data Assistant", [FULL, OFF, CHA], "What is the difference between Knowledge base and Query Surveillance Data?",
	 "Knowledge base answers from approved guidelines, protocols and case definitions. Query Surveillance Data answers "
	 "with figures (cases, people affected and deaths) as a table and a chart."),

	# ---- Data & AI Admin ----
	("Account and access", [DAI], "How do I add a user?",
	 "Open Users and tap Add user. Fill in the name, email, role and area, then set a temporary password (Generate makes "
	 "one). Give the password to the user and ask them to change it after signing in."),
	("Account and access", [DAI], "A user is locked out. What do I do?",
	 "After too many wrong passwords an account is locked for a while, then opens again. To help sooner, open Users, "
	 "edit the user and use Send password reset email. Security Settings sets the wrong password limit."),
	("Account and access", [DAI], "How do I see who changed something?",
	 "Open the Audit Log and filter by user, category or date. Open an entry to see what changed."),
	("Getting started", [DAI], "How do I add a document to the Knowledge Base?",
	 "Open AI Knowledge Base and upload the document with its audience, diseases and dates. It is used for answers once "
	 "it is approved."),
	("Getting started", [DAI], "Where do I see what people ask the KRCS Data Assistant?",
	 "Open AI Assistant Query Log for each question, how it was answered and any that found no answer."),
	("Data and figures", [DAI], "How do I check reports are coming in from every channel?",
	 "Open Reporting Channels for reports by channel and the other data sources, such as MOH 505 uploads."),
	("Other", [DAI], "Where do support tickets and feedback go?",
	 "To Feedback Received. Reply there; the user sees your reply on Contact Us or on Feedback."),
	("Other", [DAI], "How do I change the Help Center?",
	 "Open Help Center Content to change FAQs, the Contact Us details, guides and video tutorials, and who sees each."),
]


def execute():
	if not frappe.db.exists("DocType", "Help FAQ"):
		return
	have = set(frappe.get_all("Help FAQ", pluck="question"))
	last = frappe.db.sql("select coalesce(max(sort_order), 0) from `tabHelp FAQ`")[0][0] or 0
	added = 0
	for topic, who, q, a in FAQS:
		if q in have:
			continue
		last += 10
		doc = frappe.new_doc("Help FAQ")
		doc.update({"topic": topic, "question": q, "answer": a, "sort_order": last, "published": 1, **{FIELD[w]: 1 for w in who}})
		doc.insert(ignore_permissions=True)
		added += 1
	frappe.db.commit()
	print(f"Help Center FAQs: {added} more added")
