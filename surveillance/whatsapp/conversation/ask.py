"""Questions, answered from the Knowledge Base, and messages that were not a report.

A question goes through, in order:
	safety.check       a request for a dose or a diagnosis gets a referral; orders to the bot get a refusal
	ctx.chatbot        /classify-intent (optional): a report sent as a question is offered the report flow,
	                   a count question is pointed to the app, a greeting gets the prompt again
	ctx.knowledge      the approved answer, quoted as it is (knowledge.py); no approved answer is passed to the desk
"""

import re
import uuid

from surveillance.whatsapp.conversation import safety
from surveillance.whatsapp.conversation.core import (
	AttrDict,
	State,
	_call,
	go,
	home,
	normalize,
	normalize_phone,
	quiet,
	split_text,
	t,
)
from surveillance.whatsapp.conversation.free_text import describe
from surveillance.whatsapp.conversation.report import begin_report, report_from_question, seed_report
from surveillance.whatsapp.conversation.steps import choose, first_missing, missing_steps
from surveillance.whatsapp.messages import menu, text
from surveillance.whatsapp.redact import pseudonym, redact

# Anything else is not shown and is passed to the desk: no approved answer (not_found), approved documents that
# disagree (conflict), and the trusted-website fallback (trusted_source), which stays off here until KRCS approves it.
ANSWERED = ("verbatim", "public", "summary")


def _ask_options(s, ctx):
	return (
		[{"id": "ask", "title": t(s)["menuAsk"], "aliases": ["ask", "question", "uliza", "swali"]}]
		if ctx.knowledge
		else []
	)


def _asker(s, ctx):
	"""The staff record behind this number, whether or not they went through the staff portal: a CHP who taps
	"Ask a question" on the welcome screen still gets CHP guidance. None for a community member."""
	return s.staff or AttrDict.wrap(ctx.data.find_staff(s.phone))


def _user_ref(staff, s, ctx):
	"""Staff by login. A community member's number stays in Frappe: they are a pseudonym."""
	if staff:
		return staff.user
	return pseudonym(normalize_phone(s.phone), getattr(ctx, "pseudonym_key", None))


def _is_question(inp, ctx):
	return bool(ctx.knowledge) and inp["type"] == "text" and len(normalize(inp.get("text"))) >= 3


def _names_disease(question, ctx):
	try:
		diseases = (ctx.data.catalog().get("options") or {}).get("suspected_disease") or []
	except Exception:
		return False
	q = question.lower()
	return any(d.lower() in q for d in diseases if len(d) > 3)


class Ask(State):
	def options(self, s, ctx):
		return [
			{"id": "report", "title": t(s)["menuReport"], "aliases": ["report", "ripoti", "taarifa"]},
			{"id": "menu", "title": t(s)["backToMenu"]},
		]

	def prompt(self, s, ctx):
		s.question = None
		s.shown = ["menu"]
		return [
			menu(
				t(s)["askPrompt"] if s.staff else t(s)["askPromptCommunity"],
				[{"id": "menu", "title": t(s)["backToMenu"]}],
			)
		]

	def on(self, s, inp, choice, ctx):
		if choice == "menu":
			return go(home(s))
		if choice == "report":
			q = s.question
			return report_from_question(s, q.text, ctx) if q and q.get("report") else begin_report(s, ctx)
		if inp["type"] == "text" and normalize(inp.get("text")):
			return ask_question(s, inp["text"], ctx)
		return None


class RNotReport(State):
	"""A description with no sign of illness is never dropped (SRS H.12): a report after all, or passed on."""

	def options(self, s, ctx):
		return [
			{"id": "sick", "title": t(s)["notReportSick"], "aliases": ["yes", "ndiyo"]},
			{"id": "other", "title": t(s)["notReportOther"], "aliases": ["no", "hapana"]},
			{"id": "menu", "title": t(s)["backToMenu"]},
		]

	def prompt(self, s, ctx):
		return [choose(s, t(s)["notReport"], self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "sick":
			s.draft.followups = missing_steps(s, ctx)
			return go(first_missing(s, ctx))
		if choice == "menu":
			s.draft = None
			return go(home(s))
		if choice == "other":
			question = s.draft.description
			s.draft = None
			if ctx.knowledge:
				return ask_question(s, question, ctx)
			req = {"request_id": str(uuid.uuid4()), "user_ref": _user_ref(_asker(s, ctx), s, ctx)}
			_call(ctx, "on_escalate", question=question, session=s, request=req, reason="not_a_report")
			return go("r_done", text(t(s)["notReportPassed"]))
		if inp["type"] == "text" and len(normalize(inp.get("text"))) >= 3:
			return describe(s, inp["text"], ctx)
		return None


def classify(question, ctx):
	"""The chatbot service's /classify-intent reply ({intent, confidence, signals}), or {} when it is not set up or
	does not answer."""
	if not ctx.chatbot:
		return {}
	try:
		return ctx.chatbot.classify(question) or {}
	except Exception:
		return {}


def _intent(question, ctx):
	return classify(question, ctx).get("intent")


def whatsapp_text(answer):
	"""Markdown bold (**x**) as WhatsApp bold (*x*)."""
	return re.sub(r"\*\*(.+?)\*\*", r"*\1*", answer or "")


def source_lines(r, s):
	used = set(r.get("used_sources") or [])
	lines = []
	for src in r.get("sources") or []:
		if used and src.get("n") not in used:
			continue
		where = ", ".join(str(x) for x in (src.get("title"), src.get("version"), src.get("section")) if x)
		if where:
			lines.append(f"[{src.get('n')}] {where}")
	return f"_{t(s)['askSources']}: " + "; ".join(lines) + "_" if lines else None


def ask_question(s, question, ctx, intent=None, stay=False):
	"""Roles and scope come from Frappe, never from the message. The reply is approved text quoted as it is, or a
	fixed reply; the conversation then stays in `ask` for the next question.
	`stay`: a question typed in the middle of something else (router.py). It is answered and the person stays where
	they were, so nothing here offers buttons. `intent`: already classified by the caller."""
	if not stay:
		s.state = "ask"
		s.page = 0
		s.question = None
	staff = _asker(s, ctx)
	roles = ctx.data.roles_of(staff.user) if staff else []
	req = {
		"message": redact(question),
		"roles": roles or ["Guest"],
		"language": s.lang,
		"location": staff.region if staff else None,
		"user_ref": _user_ref(staff, s, ctx),
		"request_id": str(uuid.uuid4()),
	}

	def handled(outcome, reason, reply):
		"""Answered here without the Knowledge Base: still one Chatbot Query Log record."""
		_call(
			ctx,
			"on_chatbot",
			request=req,
			response={"outcome": outcome, "reason": reason, "message": reply},
			session=s,
		)

	def offer_report(key):
		if stay:
			return text(t(s)[key])
		s.question = AttrDict(text=question, report=True)
		return choose(
			s,
			t(s)[key],
			[{"id": "report", "title": t(s)["menuReport"]}, {"id": "menu", "title": t(s)["backToMenu"]}],
		)

	refused = safety.check(question, roles, _names_disease(question, ctx))
	if refused == safety.BLOCKED_INSTRUCTION:
		handled("info", refused, t(s)["askBlocked"])
		return quiet(text(t(s)["askBlocked"]))
	if refused:
		handled("info", refused, t(s)["askClinical"])
		return quiet(text(t(s)["askClinical"]), offer_report("askMixed"))

	intent = intent or _intent(question, ctx)
	if intent == "signal_report":
		handled("routed", "signal_report", None)
		return (not s.staff and seed_report(s, question, ctx)) or quiet(offer_report("askRouted"))
	if intent == "report_count":
		handled("count", "report_count", t(s)["askCount"])
		return quiet(text(t(s)["askCount"]))
	if intent == "greeting":
		handled("greeting", "greeting", t(s)["askGreeting"])
		return quiet(text(t(s)["askGreeting"]))

	try:
		r = ctx.knowledge.ask(
			req["message"],
			s.lang,
			user=staff.user if staff else None,
			public_ref=None if staff else req["user_ref"],
			# Follow-up questions ("and for children?") are read with the previous ones (knowledge_base.ask).
			conversation_id=pseudonym(normalize_phone(s.phone), getattr(ctx, "pseudonym_key", None)),
			request_id=req["request_id"],
		)
	except Exception as e:
		_call(
			ctx,
			"on_escalate",
			question=question,
			session=s,
			request=req,
			reason="service_unavailable",
			error=str(e),
		)
		return quiet(text(t(s)["askUnavailable"](t(s)["askTeam"])))

	mode = r.get("mode")
	if mode not in ANSWERED or not (r.get("answer") or "").strip():
		_call(
			ctx,
			"on_escalate",
			question=question,
			session=s,
			request=req,
			reason=r.get("reason") or mode or "no_answer",
			response=r,
		)
		return quiet(text(t(s)["askNotFound"](t(s)["askTeam"])))
	if r.get("escalated"):
		_call(
			ctx, "on_escalate", question=question, session=s, request=req, reason=r.get("reason"), response=r
		)
	body = whatsapp_text(r["answer"])
	sources = source_lines(r, s)
	reply = [text(part) for part in split_text(body + (f"\n\n{sources}" if sources else ""))]
	if intent == "mixed":
		return quiet(*reply, offer_report("askMixed"))
	return quiet(*reply)
