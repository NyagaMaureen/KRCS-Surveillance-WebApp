"""Help Center (KRCS 27 Nov 2026). Safe to run again.

    Contact Us        placeholder details so the page looks complete, only while all of them are empty. Change them in
                      Help Center Content > Contact Us.
    FAQ wording       Report a problem points to the support ticket on Contact Us; reporting uses the buttons' real names
                      (Report an event, Create Report). Only FAQs still worded as first added are changed.
"""
import frappe

PLACEHOLDER = {"support_email": "support@krcs.org", "support_phone": "+254 700 000 000",
	"support_hours": "Monday to Friday, 9:00 to 17:00 (EAT)"}
REPORTING = [
	{"question": "How do I report someone who is sick?", "was": 'On your Dashboard, tap Record Health Signal. Choose the signs you see and when the illness started. Add a voice note or a photo if you can. Check your report, then send it.', "answer": 'On your Dashboard, tap Report an event. You can also go to Signals Captured and tap Create Report. Choose the signs you see and when the illness started. Add a voice note or a photo if you can. Check your report, then send it.', "answer_sw": 'Kwenye Dashibodi yako, gusa Report an event. Unaweza pia kwenda kwenye Signals Captured na ugusa Create Report. Chagua dalili unazoziona na lini ugonjwa ulianza. Ongeza ujumbe wa sauti au picha ukiweza. Kagua ripoti yako, kisha uitume.'},
	{"question": "When should I report here instead of the EMR?", "was": 'When the EMR is down, record the case here with Record Health Signal so it is not missed.', "answer": 'When the EMR is down, tap Create Report on your Dashboard and record the case here, so it is not missed.'},
]
PROBLEM = {
	"question": "How do I report a problem with the system?",
	"was": "Open Feedback, describe what happened and send it. The support team will follow up.",
	"answer": "Open Contact Us, describe the problem and send a support ticket. You will see the reply on the same page.",
	"answer_sw": "Fungua Contact Us, eleza tatizo na utume tiketi ya msaada. Utaona jibu kwenye ukurasa huo huo.",
}


def execute():
	if frappe.db.exists("DocType", "Help Center Settings"):
		s = frappe.get_single("Help Center Settings")
		if not any(s.get(k) for k in ("support_email", "support_phone", "support_hours", "support_note")):
			s.update(PLACEHOLDER)
			s.save(ignore_permissions=True)
	if frappe.db.exists("DocType", "Help FAQ"):
		for name in frappe.get_all("Help FAQ", filters={"question": PROBLEM["question"], "answer": PROBLEM["was"]}, pluck="name"):
			frappe.db.set_value("Help FAQ", name, {"answer": PROBLEM["answer"], "answer_sw": PROBLEM["answer_sw"]})
		for c in REPORTING:
			for name in frappe.get_all("Help FAQ", filters={"question": c["question"], "answer": c["was"]}, pluck="name"):
				frappe.db.set_value("Help FAQ", name, {k: v for k, v in c.items() if k in ("answer", "answer_sw")})
	frappe.db.commit()
