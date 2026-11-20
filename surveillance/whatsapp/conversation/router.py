"""Reports and questions typed anywhere in the conversation, not only on the welcome screen or in "Ask a question".

	clear question in a report step   answered, then the same step is asked again (the draft is kept)
	text no state understood          the chatbot service's /classify-intent decides (the extractor when the
	                                  service is not set up): a report starts one, or asks whether it belongs to
	                                  the report being written; a question is answered and the person stays where
	                                  they were; anything else gets "I didn't understand", as before

Steps that take any text (the name, the place name, notes) keep it unless it is clearly a question, so a note
like "3 more children are sick" stays a note.
"""

from surveillance.whatsapp.conversation.ask import ask_question, classify
from surveillance.whatsapp.conversation.core import STATES, State, go, nairobi_date, normalize, run, t
from surveillance.whatsapp.conversation.report import begin_report, seed_report
from surveillance.whatsapp.conversation.steps import choose
from surveillance.whatsapp.extract import extract_report
from surveillance.whatsapp.messages import text

QUESTION_WORDS = {
	"what", "how", "why", "when", "where", "which", "who", "whom",
	"nini", "vipi", "je", "lini", "wapi", "gani", "kwanini", "nifanye", "tufanye",
}  # fmt: skip
QUESTIONS = ("protocol_query", "mixed", "app_services")
# Where text already has a meaning: the description, a report that may not be one, questions, the privacy notice.
NOT_ROUTED = {
	"r_describe",
	"r_not_report",
	"ask",
	"welcome",
	"not_staff",
	"privacy_notice",
	"privacy",
	"r_add_or_new",
}


def clear_question(value):
	"""Ends with "?" or starts with a question word ("how", "nini", "kwa nini"...), and is at least three words."""
	words = normalize(value).split()
	if len(words) < 3:
		return False
	return value.strip().endswith("?") or words[0] in QUESTION_WORDS or words[:2] == ["kwa", "nini"]


def _text(inp):
	return inp.get("text") or "" if inp["type"] == "text" else ""


def answer_and_stay(s, question, ctx, intent=None):
	out = run(s, ask_question(s, question, ctx, intent=intent, stay=True), ctx)
	return [*out, *STATES[s.state].prompt(s, ctx)]


def question_in_a_step(s, inp, ctx):
	"""Before the step reads the message: a clear question typed during a report is answered, not taken as the
	answer to the step."""
	value = _text(inp)
	if not (
		ctx.knowledge and s.state.startswith("r_") and s.state not in NOT_ROUTED and clear_question(value)
	):
		return None
	intent = classify(value, ctx).get("intent")
	if intent in ("signal_report", "report_count"):
		return None
	return answer_and_stay(s, value, ctx, intent)


def _is_report(s, value, ctx, intent):
	if intent:
		return intent == "signal_report"
	return extract_report(value, ctx, nairobi_date(ctx.now()), s.lang)["is_report"]


def unhandled(s, inp, ctx):
	"""After the step did not understand the message. None: "I didn't understand", as before."""
	value = _text(inp)
	if len(normalize(value)) < 3 or s.state in NOT_ROUTED:
		return None
	c = classify(value, ctx)
	intent = c.get("intent")
	if _is_report(s, value, ctx, intent):
		if s.draft:  # also a paused draft (resume): it is not dropped without asking
			s.pending_report = value
			s.route_back = s.state
			return run(s, go("r_add_or_new"), ctx)
		if s.mode != "staff" and (seeded := seed_report(s, value, ctx)):
			return run(s, seeded, ctx)
		return run(s, ask_question(s, value, ctx, intent="signal_report"), ctx) if ctx.knowledge else None
	if intent == "report_count":
		return [text(t(s)["askCount"]), *STATES[s.state].prompt(s, ctx)]
	# The service calls anything it doesn't recognise a question ("default"): "ok thanks" is not one.
	recognised = intent in QUESTIONS and "default" not in (c.get("signals") or [])
	if ctx.knowledge and (recognised or clear_question(value)):
		return answer_and_stay(s, value, ctx, intent)
	return None


class RAddOrNew(State):
	"""A report typed while another is being written: part of it, a new one, or neither."""

	def options(self, s, ctx):
		return [
			{"id": "add", "title": t(s)["routeAdd"], "aliases": ["add", "ongeza"]},
			{"id": "new", "title": t(s)["routeNew"], "aliases": ["new", "mpya"]},
			{"id": "back", "title": t(s)["routeBack"], "aliases": ["back", "continue", "endelea", "rudi"]},
		]

	def prompt(self, s, ctx):
		return [choose(s, t(s)["routeAsk"], self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		back = s.route_back if s.route_back in STATES else "r_review"
		value = s.pending_report
		if choice == "add":
			s.draft.notes.append(value[:1000])
			s.pending_report = s.route_back = None
			return go(back, text(t(s)["routeAdded"]))
		if choice == "new":
			s.draft = None
			s.pending_report = s.route_back = None
			return (s.mode != "staff" and seed_report(s, value, ctx)) or begin_report(s, ctx)
		if choice == "back":
			s.pending_report = s.route_back = None
			return go(back)
		return None
