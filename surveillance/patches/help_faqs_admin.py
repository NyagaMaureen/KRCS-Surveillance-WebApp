"""Help Center FAQs for System Administrators and Data & AI Admins (KRCS 27 Nov 2026). Safe to run again.

    Epi Trends          the answer now says it raises an alert when cases are higher than usual (only if not edited).
    System Administrator  gets the Data & AI Admin FAQs too, and the new ones on configuring the system.
    New FAQs            added only when no FAQ with the same question exists.
"""
import frappe

DAI, SYS = "for_dataai", "for_sysadmin"

EPI = {
	"question": "Where do I see trends?",
	"was": "Open Epi Trends from your Dashboard. It shows cases week by week by disease and sub-county.",
	"answer": "Open Epi Trends from your Dashboard. It shows cases week by week by disease and sub-county, and raises an "
		"alert when cases in an area are higher than usual, so an outbreak is noticed early.",
}

# the Data & AI Admin FAQs added on 27 Nov that System Administrators should see too
SHARE = [
	"Where do I check the AI parts are working?", "How do I change what a role can see?", "How do I add a user?",
	"A user is locked out. What do I do?", "How do I see who changed something?",
	"How do I add a document to the Knowledge Base?", "Where do I see what people ask the KRCS Data Assistant?",
	"How do I check reports are coming in from every channel?", "Where do support tickets and feedback go?",
	"How do I change the Help Center?",
]

# (topic, who, question, answer)
FAQS = [
	("Getting started", [SYS], "What do I look after as System Administrator?",
	 "You see the full menu. You set up users and roles, the settings that decide how signals are scored and when "
	 "alerts are raised, response protocols, data sources and the Help Center. The other FAQs here say where each is."),
	("Getting started", [DAI, SYS], "Where do I change the risk score settings?",
	 "Open AI Risk Engine under System settings. Risk score weights sets how much each factor counts towards a report's "
	 "risk score, Red-flag symptoms sets which symptoms raise the risk, and AI review deadlines sets how soon AI "
	 "suggestions must be checked."),
	("Getting started", [DAI, SYS], "Where do I change when an alert is raised?",
	 "Open Alert Thresholds under System settings. Set the case counts that raise an alert for each disease, and the "
	 "regions under surveillance."),
	("Getting started", [SYS], "How do I add or change a response protocol?",
	 "Open Response Protocols and choose the disease. Edit its case definition, verification questions and steps. A "
	 "protocol is used once it is approved; Retire takes it out of use."),
	("Data and figures", [DAI, SYS], "How do I upload MOH 505 reports?",
	 "Open MOH 505 Facility Reports and drop the KHIS export files on the page. Facilities are matched by their name in "
	 "KHIS files, so add any facility that is missing first."),
	("Data and figures", [DAI, SYS], "How do I update context data such as weather and population?",
	 "Open Context Data. Weather comes in by itself every day. Population figures and camp WASH assessments are entered "
	 "or imported there."),
	("Getting started", [DAI, SYS], "How do I approve a Knowledge Base document?",
	 "Open AI Knowledge Base, open the document and approve it. Only approved documents are used for answers."),
	("Account and access", [DAI, SYS], "Where do I change security settings?",
	 "Open Security Settings. It sets the wrong password limit and how long people stay signed in, and shows who is "
	 "signed in now."),
	("Account and access", [DAI, SYS], "How do I set up a Community Health Unit?",
	 "When you add or edit a CHP or CHA in Users, choose their Community Health Unit. Use + New unit to add one that "
	 "is missing."),
	("Account and access", [DAI, SYS], "How do I give an officer more than one sub-county?",
	 "Open Users, edit the officer and add the extra ones under Other sub-counties."),
	("Data and figures", [DAI, SYS], "Where do I check the database and backups?",
	 "Open Data and Database for the database size, largest tables, background jobs and backups."),
	("Data and figures", [DAI, SYS], "Where do I see if the system is healthy?",
	 "Monitoring Reports has system health and integrations: errors, background jobs, failed sign-ins and whether each "
	 "data source is sending data."),
]


def execute():
	if not frappe.db.exists("DocType", "Help FAQ"):
		return
	frappe.reload_doc("surveillance", "doctype", "help_faq")
	frappe.reload_doc("surveillance", "doctype", "help_resource")
	for name in frappe.get_all("Help FAQ", filters={"question": EPI["question"], "answer": EPI["was"]}, pluck="name"):
		frappe.db.set_value("Help FAQ", name, "answer", EPI["answer"])
	for name in frappe.get_all("Help FAQ", filters={"question": ["in", SHARE], DAI: 1}, pluck="name"):
		frappe.db.set_value("Help FAQ", name, SYS, 1)
	have = set(frappe.get_all("Help FAQ", pluck="question"))
	last = frappe.db.sql("select coalesce(max(sort_order), 0) from `tabHelp FAQ`")[0][0] or 0
	added = 0
	for topic, who, q, a in FAQS:
		if q in have:
			continue
		last += 10
		doc = frappe.new_doc("Help FAQ")
		doc.update({"topic": topic, "question": q, "answer": a, "sort_order": last, "published": 1, **{f: 1 for f in who}})
		doc.insert(ignore_permissions=True)
		added += 1
	frappe.db.commit()
	print(f"Help Center FAQs: {added} for admins added")
