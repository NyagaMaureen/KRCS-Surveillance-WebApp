"""The WhatsApp conversation: welcome, staff portal, the report steps, review, questions to the chatbot.

A state machine over one session per phone number. Each state has
        options(s, ctx) -> choices, prompt(s, ctx) -> messages, on(s, input, choice, ctx) -> result or None.
The report steps follow the web "Record Health Signal" form and end in an ordinary Case Report
(channel = WhatsApp).

	core.py       session, results (go / stay / quiet), choices, phone numbers, dates, labels
	steps.py      which report steps apply, their order, "back", what is still missing, shared step prompts
	fields.py     one state per report field
	free_text.py  community reports in their own words: what was understood, advice afterwards
	report.py     starting a report, review, duplicate check, edit, saving, what the reporter sees afterwards
	status.py     report status, recent reports, lookup by reference
	ask.py        questions to the Response Support Chatbot
	portal.py     welcome, language, staff portal, help, resume
	__init__.py   handle(): global keywords (menu, cancel, back...) and the state table

This package does not import frappe: everything it needs comes in through `ctx`
(see jobs.make_context), so the whole flow is tested without a site (tests/test_conversation.py).
        ctx.data      catalog(), sub_counties(region), find_staff(phone), roles_of(user), community_user(),
                      create_report(doc), find_duplicate(region, symptoms), my_reports(user, phone, limit), get_report(name),
                      reporter_advice(disease, user)
        ctx.settings  idle_minutes, welcome_image_url
        ctx.now()     epoch seconds
        ctx.chatbot   Response Support Chatbot client, or None
        ctx.extractor free-text extraction client (extract.ExtractionClient), or None for the keyword fallback
        ctx.on_submit(report, session, media, extraction), ctx.on_extract(report, session, draft),
        ctx.on_chatbot(request, response, session),
        ctx.on_escalate(question=, session=, request=, reason=, ...), ctx.log_error(title)   (all optional)
"""

from surveillance.whatsapp import content as C
from surveillance.whatsapp.conversation.ask import Ask, RNotReport
from surveillance.whatsapp.conversation.core import (
	MIN,
	STATES,
	AttrDict,
	enter,
	format_phone,
	go,
	home,
	media_ack,
	nairobi_date,
	new_session,
	normalize,
	normalize_phone,
	parse_date,
	pause,
	resolve_choice,
	run,
	split_text,
	t,
	to_media,
)
from surveillance.whatsapp.conversation.fields import (
	OptionalSelect,
	RCount,
	RDeaths,
	RExtra,
	RName,
	ROnset,
	ROnsetDate,
	RPlace,
	RPlaceGps,
	RPlaceName,
	RRegion,
	RSubCounty,
	RSymptoms,
	RSymptomsMore,
	SelectStep,
)
from surveillance.whatsapp.conversation.portal import Help, Lang, Menu, NotStaff, Reports, Resume, Welcome
from surveillance.whatsapp.conversation.report import RDescribe, RDone, RDuplicate, REdit, RReview
from surveillance.whatsapp.conversation.steps import BACK_TO, step_back
from surveillance.whatsapp.messages import text

__all__ = [
	"AttrDict",
	"format_phone",
	"handle",
	"nairobi_date",
	"new_session",
	"normalize_phone",
	"parse_date",
	"split_text",
]


def handle(s, inp, ctx):
	"""Answer one incoming message. Returns the messages to send; never raises."""
	try:
		return dispatch(s, inp, ctx)
	except Exception:
		if getattr(ctx, "log_error", None):
			ctx.log_error("WhatsApp conversation failed")
		return [text(t(s)["errorGeneric"])]


def dispatch(s, inp, ctx):
	now = ctx.now()
	first = not s.last_active
	idle = not first and now - s.last_active > ctx.settings.idle_minutes * MIN
	s.last_active = now

	kw = normalize(inp.get("text")) if inp["type"] == "text" else None
	drafting = bool(s.draft) and s.state != "resume"
	if first or (kw and kw in C.KEYWORDS["greeting"]):
		return pause(s, ctx, idle) if drafting else enter(s, "welcome", ctx)
	if kw and kw in C.KEYWORDS["language"]:
		if drafting:
			s.resume_state = s.state
		return enter(s, "lang", ctx)
	if kw and kw in C.KEYWORDS["menu"]:
		return pause(s, ctx, idle) if drafting else enter(s, home(s), ctx)
	if kw and kw in C.KEYWORDS["help"]:
		return enter(s, "help", ctx)
	if kw and kw in C.KEYWORDS["cancel"]:
		had = bool(s.draft)
		s.draft = None
		return run(s, go(home(s), *([text(t(s)["cancelled"])] if had else [])), ctx)
	if idle and drafting:
		return pause(s, ctx, True)
	if kw and kw in C.KEYWORDS["back"] and s.draft and s.state in BACK_TO:
		return run(s, step_back(s, ctx), ctx)

	st = STATES.get(s.state) or STATES["welcome"]
	choice = resolve_choice(st.options(s, ctx), inp, s.shown)
	res = st.on(s, inp, choice, ctx)
	if res:
		return run(s, res, ctx)

	if inp["type"] == "media" and s.draft:
		s.draft.media.append(to_media(inp))
		return [text(media_ack(s, inp))]
	return [text(t(s)["invalid"]), *(STATES.get(s.state) or STATES["welcome"]).prompt(s, ctx)]


STATES.update(
	{
		"welcome": Welcome(),
		"not_staff": NotStaff(),
		"lang": Lang(),
		"menu": Menu(),
		"reports": Reports(),
		"ask": Ask(),
		"help": Help(),
		"resume": Resume(),
		"r_describe": RDescribe(),
		"r_not_report": RNotReport(),
		"r_name": RName(),
		"r_category": SelectStep("r_category", "category", "category"),
		"r_signal": SelectStep("r_signal", "signal_type", "signal"),
		"r_symptoms": RSymptoms(),
		"r_symptoms_more": RSymptomsMore(),
		"r_count": RCount(),
		"r_sex": SelectStep("r_sex", "sex", "sex"),
		"r_age": OptionalSelect("r_age", "age_group", "age"),
		"r_exposure": OptionalSelect("r_exposure", "animal_exposure", "exposure"),
		"r_deaths": RDeaths(),
		"r_region": RRegion(),
		"r_subcounty": RSubCounty(),
		"r_place": RPlace(),
		"r_place_gps": RPlaceGps(),
		"r_place_name": RPlaceName(),
		"r_onset": ROnset(),
		"r_onset_date": ROnsetDate(),
		"r_extra": RExtra(),
		"r_review": RReview(),
		"r_duplicate": RDuplicate(),
		"r_edit": REdit(),
		"r_done": RDone(),
	}
)
