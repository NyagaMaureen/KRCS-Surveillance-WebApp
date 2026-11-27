"""Help Center FAQs (KRCS 27 Nov 2026). Safe to run again.

    manage_faqs   given to System Administrator and Data & AI Administrator.
    FAQs          a starting set per workspace, simple ones for CHPs (English and Kiswahili). Added only when there are no
                  FAQs yet, so nothing an admin has written or changed is ever replaced.
"""
import frappe

from surveillance.patches.roles_cleanup_2026_11_v2 import _add_capabilities

E, CHP, CHA, FHW, OFF, DAI, FULL = "everyone", "chp", "cha", "fhw", "officer", "dataai", "full"

# (topic, who, question, answer, question in Kiswahili, answer in Kiswahili)
FAQS = [
	# ---- CHP: short and simple ----
	("Getting started", [CHP], "What do I do in this system?",
	 "You report people in your community who are sick, send them to a health facility when needed, and check on them "
	 "later. Your CHA and the surveillance officer see what you report.",
	 "Ninafanya nini kwenye mfumo huu?",
	 "Unaripoti watu wagonjwa katika jamii yako, unawapeleka kwenye kituo cha afya inapohitajika, na unawafuatilia "
	 "baadaye. CHA wako na afisa wa ufuatiliaji wanaona unachoripoti."),
	("Reporting", [CHP], "How do I report someone who is sick?",
	 "On your Dashboard, tap Report an event. You can also go to Signals Captured and tap Create Report. Choose the "
	 "signs you see and when the illness started. Add a voice note or a photo if you can. Check your report, then send it.",
	 "Ninaripotije mtu aliye mgonjwa?",
	 "Kwenye Dashibodi yako, gusa Report an event. Unaweza pia kwenda kwenye Signals Captured na ugusa Create Report. "
	 "Chagua dalili unazoziona na lini ugonjwa ulianza. Ongeza ujumbe wa sauti au picha ukiweza. Kagua ripoti yako, "
	 "kisha uitume."),
	("Reporting", [CHP], "What should I report?",
	 "Report illness that is unusual, several people with the same signs, any death you cannot explain, and the signs "
	 "your training told you to report at once. If you are not sure, report it. The officer will check.",
	 "Niripoti nini?",
	 "Ripoti ugonjwa usio wa kawaida, watu kadhaa wenye dalili zilezile, kifo chochote usichoweza kueleza, na dalili "
	 "ulizofundishwa kuripoti mara moja. Ukiwa na shaka, ripoti. Afisa atakagua."),
	("Reporting", [CHP], "Should I write the person's name or phone number?",
	 "No. Never write names or phone numbers in a report or a referral. Write the age, sex and place instead.",
	 "Niandike jina au nambari ya simu ya mtu?",
	 "Hapana. Usiandike majina wala nambari za simu kwenye ripoti au rufaa. Andika umri, jinsia na mahali badala yake."),
	("Reporting", [CHP], "What happens after I send a report?",
	 "The surveillance officer reviews it and may call you. You can see your reports under Signals Captured.",
	 "Nini hutokea baada ya kutuma ripoti?",
	 "Afisa wa ufuatiliaji anaikagua na anaweza kukupigia simu. Unaweza kuona ripoti zako chini ya Signals Captured."),
	("Reporting", [CHP], "I have no network. Can I still report?",
	 "Yes, in the KRCS mobile app. Record the report as usual. It is sent by itself when you have network again. "
	 "The website needs network.",
	 "Sina mtandao. Bado naweza kuripoti?",
	 "Ndiyo, kwenye programu ya simu ya KRCS. Rekodi ripoti kama kawaida. Itatumwa yenyewe ukipata mtandao tena. "
	 "Tovuti inahitaji mtandao."),
	("Referrals and follow-ups", [CHP], "How do I record a referral?",
	 "Go to Referrals and tap New referral. Choose the report it is about, the nearest health facility and why you "
	 "referred the person. Do not write names.",
	 "Ninarekodije rufaa?",
	 "Nenda kwenye Referrals na ugusa New referral. Chagua ripoti inayohusika, kituo cha afya kilicho karibu na sababu "
	 "ya kumpa mtu rufaa. Usiandike majina."),
	("Referrals and follow-ups", [CHP], "What do the referral statuses mean?",
	 "To refer: you still need to send the person. Referred: you sent them. Reached facility: the facility says they "
	 "arrived. Did not reach: they did not arrive, so check on them.",
	 "Hali za rufaa zinamaanisha nini?",
	 "To refer: bado unahitaji kumpeleka mtu. Referred: umempeleka. Reached facility: kituo kinasema amefika. "
	 "Did not reach: hakufika, kwa hivyo mfuatilie."),
	("Referrals and follow-ups", [CHP], "What is a follow-up?",
	 "A visit or call to check on someone you reported. Open Follow-ups, do the visit, then write what you found and "
	 "save it.",
	 "Ufuatiliaji ni nini?",
	 "Ni ziara au simu ya kumjulia hali mtu uliyemripoti. Fungua Follow-ups, fanya ziara, kisha andika ulichokipata "
	 "na uhifadhi."),
	("KRCS Data Assistant", [CHP], "How can the KRCS Data Assistant help me?",
	 "Ask it questions such as: What do I do in case of a cholera outbreak? Answers come from approved KRCS guidance. "
	 "In an emergency, follow your supervisor's instructions.",
	 "KRCS Data Assistant inanisaidiaje?",
	 "Iulize maswali kama: Nifanye nini kukiwa na mlipuko wa kipindupindu? Majibu yanatoka kwenye mwongozo ulioidhinishwa "
	 "wa KRCS. Katika dharura, fuata maagizo ya msimamizi wako."),
	("Getting started", [CHP], "Who do I ask for help?",
	 "Open Contact Us. You can call or email the support team, or send a support ticket.",
	 "Nimuulize nani msaada?",
	 "Fungua Contact Us. Unaweza kupiga simu au kutuma barua pepe kwa timu ya msaada, au kutuma tiketi ya msaada."),

	# ---- CHA ----
	("Getting started", [CHA], "What can I see as a CHA?",
	 "Your Dashboard shows your sub-county. CHPs in my CHU lists the CHPs in your Community Health Unit with their "
	 "reports, open tasks and referrals this month. Referrals shows referrals made in your unit.", None, None),
	("Referrals and follow-ups", [CHA], "How do I check on my CHPs' referrals?",
	 "Open Referrals to see every referral in your unit and its status. Follow up on any marked Did not reach.", None, None),
	("Tasks", [CHA, OFF, FHW], "What is in My Tasks?",
	 "Tasks given to you, such as a follow-up or a field visit. Open a task, do it, then mark it done and write what "
	 "you found.", None, None),
	("Data and figures", [CHA, OFF, FULL], "How do I get figures for my area?",
	 "Open the KRCS Data Assistant, choose Query Surveillance Data and ask, for example: measles cases by sub-county in "
	 "the last 3 months. You get a table and a chart for the area you can see.", None, None),

	# ---- Facility Health Worker ----
	("Referrals and follow-ups", [FHW], "How do I confirm that a referred person arrived?",
	 "Open Referrals. For each person referred to your facility, mark Reached facility or Did not reach.", None, None),
	("Reporting", [FHW], "When should I report here instead of the EMR?",
	 "When the EMR is down, tap Create Report on your Dashboard and record the case here, so it is not missed.", None, None),

	# ---- Surveillance Officer ----
	("Reporting", [OFF], "How do I review a new signal?",
	 "Open the Review Queue, open the signal and work through the steps: check the report, call the reporter if "
	 "needed, then decide to verify, escalate or close it.", None, None),
	("Data and figures", [OFF, FULL], "How is the risk score worked out?",
	 "Each report gets a score from its signs, red-flag symptoms, how many similar reports are nearby and context "
	 "such as weather and population. It helps sort the queue. You make the decision.", None, None),
	("Data and figures", [OFF, FULL, CHA], "How do I download data?",
	 "Open Data Explorer, set the filters, then use Download for CSV or JSON. The download has only the area you can "
	 "see.", None, None),

	# ---- County / National ----
	("Data and figures", [FULL], "Where do I see what is happening across my region?",
	 "The Dashboard shows active events, alerts and suspected disease distribution for your area. Epi Trends and the "
	 "Surveillance Map show trends and where cases are.", None, None),

	# ---- Data & AI Admin ----
	("Getting started", [DAI], "Where do I check the AI parts are working?",
	 "AI Performance shows how often each AI part agreed with what people decided, and the models in use. The "
	 "Knowledge Base and the AI Assistant Query Log show what users asked and how it was answered.", None, None),
	("Account and access", [DAI], "How do I change what a role can see?",
	 "Open Users and Roles, choose the role and tick or untick its permissions. Changes apply the next time those "
	 "users load the page.", None, None),

	# ---- Everyone ----
	("Account and access", [E], "How do I change my password?",
	 "Open the menu with your name at the top right and choose Change password.",
	 "Ninabadilishaje nenosiri langu?",
	 "Fungua menyu yenye jina lako juu kulia na uchague Change password."),
	("Account and access", [E], "I forgot my password. What do I do?",
	 "On the sign-in page, tap Forgot password? and follow the steps in the email. If you have no email, ask your "
	 "supervisor.",
	 "Nimesahau nenosiri langu. Nifanye nini?",
	 "Kwenye ukurasa wa kuingia, gusa Forgot password? na ufuate hatua zilizo kwenye barua pepe. Kama huna barua pepe, "
	 "muulize msimamizi wako."),
	("Other", [E], "How do I report a problem with the system?",
	 "Open Contact Us, describe the problem and send a support ticket. You will see the reply on the same page.",
	 "Ninaripotije tatizo la mfumo?",
	 "Fungua Contact Us, eleza tatizo na utume tiketi ya msaada. Utaona jibu kwenye ukurasa huo huo."),
]

FIELD = {E: "for_everyone", CHP: "for_chp", CHA: "for_cha", FHW: "for_fhw", OFF: "for_officer", DAI: "for_dataai",
	FULL: "for_full"}


def execute():
	frappe.reload_doc("surveillance", "doctype", "help_faq")
	frappe.reload_doc("surveillance", "doctype", "help_resource")
	frappe.reload_doc("surveillance", "doctype", "help_center_settings")
	for role in ("System Administrator", "Data & AI Administrator"):
		if frappe.db.exists("Role", role):
			_add_capabilities(role, ["manage_faqs"])
	from surveillance.capabilities import sync_all_role_permissions
	sync_all_role_permissions()
	if not frappe.db.count("Help FAQ"):
		for i, (topic, who, q, a, q_sw, a_sw) in enumerate(FAQS):
			doc = frappe.new_doc("Help FAQ")
			doc.update({"topic": topic, "question": q, "answer": a, "question_sw": q_sw or "", "answer_sw": a_sw or "",
				"sort_order": (i + 1) * 10, "published": 1, **{FIELD[w]: 1 for w in who}})
			doc.insert(ignore_permissions=True)
		print(f"Help Center FAQs: {len(FAQS)} added")
	frappe.clear_cache()
	frappe.db.commit()
