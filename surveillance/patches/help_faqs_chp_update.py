"""CHP FAQ changes (KRCS 27 Nov 2026). Safe to run again.

    KRCS Data Assistant   the example question is now: What do I do in case of a cholera outbreak?
    Who do I ask for help?  points to Contact Us instead of the CHA, and moves to Getting started.
Only FAQs still worded as first added are changed, so anything an admin has edited is left alone.
"""
import frappe

CHANGES = [
	{"question": "How can the KRCS Data Assistant help me?",
	 "was": "Ask it questions such as: What is the lay case definition for cholera? Answers come from approved KRCS guidance. "
		"In an emergency, follow your supervisor's instructions.",
	 "set": {
		"answer": "Ask it questions such as: What do I do in case of a cholera outbreak? Answers come from approved KRCS "
			"guidance. In an emergency, follow your supervisor's instructions.",
		"answer_sw": "Iulize maswali kama: Nifanye nini kukiwa na mlipuko wa kipindupindu? Majibu yanatoka kwenye mwongozo "
			"ulioidhinishwa wa KRCS. Katika dharura, fuata maagizo ya msimamizi wako."}},
	{"question": "Who do I ask for help?",
	 "was": "Ask your CHA first. You can also send a message from Feedback.",
	 "set": {
		"topic": "Getting started",
		"answer": "Open Contact Us. You can call or email the support team, or send a support ticket.",
		"answer_sw": "Fungua Contact Us. Unaweza kupiga simu au kutuma barua pepe kwa timu ya msaada, au kutuma tiketi ya msaada."}},
]


def execute():
	if not frappe.db.exists("DocType", "Help FAQ"):
		return
	for c in CHANGES:
		for name in frappe.get_all("Help FAQ", filters={"question": c["question"], "answer": c["was"]}, pluck="name"):
			frappe.db.set_value("Help FAQ", name, c["set"])
	frappe.db.commit()
