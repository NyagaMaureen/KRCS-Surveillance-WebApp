"""Welcome, language, the staff portal, help, and resuming an unfinished report."""

from surveillance.whatsapp import content as C
from surveillance.whatsapp.conversation.ask import _chatbot_options, _is_question, ask_chatbot
from surveillance.whatsapp.conversation.core import (
	STATES,
	AttrDict,
	State,
	format_phone,
	go,
	home,
	normalize,
	normalize_phone,
	quiet,
	ref_from,
	region_label,
	stay,
	t,
)
from surveillance.whatsapp.conversation.report import begin_report, seed_report, start_report, verify_staff
from surveillance.whatsapp.conversation.status import one_report, recent_reports, report_status
from surveillance.whatsapp.conversation.steps import choose
from surveillance.whatsapp.messages import LIMITS, image, text


class Welcome(State):
	def options(self, s, ctx):
		return [
			{
				"id": "community",
				"title": t(s)["roleCommunity"],
				"aliases": ["community", "public", "mwanajamii", "jamii"],
			},
			{
				"id": "staff",
				"title": t(s)["roleStaff"],
				"aliases": ["staff", "chp", "krcs staff", "mfanyakazi"],
			},
			*_chatbot_options(s, ctx),
			{"id": "help", "title": t(s)["roleHelp"], "aliases": ["hotlines", "emergency", "dharura"]},
		]

	def prompt(self, s, ctx):
		s.draft = None
		s.editing = False
		# The KRCS logo, once per session, ahead of the first welcome (a list message can't carry an image header).
		logo = []
		if ctx.settings.welcome_image_url and not s.logo_sent:
			logo = [image(ctx.settings.welcome_image_url)]
			s.logo_sent = True
		return [*logo, choose(s, t(s)["welcome"], self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "community":
			s.mode = "community"
			s.staff = None
			return go("lang")
		if choice == "staff":
			return verify_staff(s, ctx)
		if choice == "ask":
			return go("ask")
		if choice == "help":
			return go("help")
		ref = ref_from(inp)
		if ref:
			return stay(text(one_report(s, ctx, ref)))
		# Anything else typed here: a report in the sender's own words starts one; anything else is a question.
		if inp["type"] != "text" or len(normalize(inp.get("text"))) < 3:
			return None
		return seed_report(s, inp["text"], ctx) or (ask_chatbot(s, inp["text"], ctx) if ctx.chatbot else None)


class NotStaff(State):
	def options(self, s, ctx):
		return [
			{"id": "community", "title": t(s)["roleCommunity"]},
			{"id": "help", "title": t(s)["roleHelp"]},
			{"id": "back", "title": t(s)["back"]},
		]

	def prompt(self, s, ctx):
		return [choose(s, t(s)["notStaff"](format_phone(normalize_phone(s.phone))), self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "community":
			s.mode = "community"
			return go("lang")
		if choice == "help":
			return go("help")
		if choice == "back":
			return go("welcome")
		return None


class Lang(State):
	def options(self, s, ctx):
		return [
			{"id": "sw", "title": "Kiswahili", "aliases": ["swahili", "kiswahili"]},
			{"id": "en", "title": "English", "aliases": ["english", "kiingereza"]},
			{"id": "menu", "title": "Menu / Menyu"},
		]

	def prompt(self, s, ctx):
		return [choose(s, C.CHOOSE_LANGUAGE, self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "menu":
			return go(home(s))
		if choice not in ("sw", "en"):
			return None
		s.lang = choice
		if s.draft and s.resume_state:
			return go("resume")
		if s.mode == "staff":
			return go("menu")
		if s.mode == "community":
			return start_report(s, ctx)
		return go("welcome")


class Menu(State):
	"""Staff portal. The staff record is re-read from Frappe each time, so a deactivated user drops out."""

	def options(self, s, ctx):
		return [
			{
				"id": "report",
				"title": t(s)["menuReport"],
				"aliases": ["report", "submit", "ripoti", "taarifa"],
			},
			{"id": "status", "title": t(s)["menuStatus"], "aliases": ["status", "track", "hali"]},
			{"id": "recent", "title": t(s)["menuRecent"], "aliases": ["recent", "history", "my reports"]},
			*_chatbot_options(s, ctx),
			{"id": "help", "title": t(s)["menuHelp"], "aliases": ["support"]},
		]

	def prompt(self, s, ctx):
		s.draft = None
		s.editing = False
		s.staff = AttrDict.wrap(ctx.data.find_staff(s.phone))
		if not s.staff:
			s.mode = None
			s.state = "not_staff"
			return STATES["not_staff"].prompt(s, ctx)
		if s.staff.region:
			s.staff.region_label = region_label(s.staff.region, ctx)
		body = (
			t(s)["staffVerified"](s.staff, format_phone(normalize_phone(s.phone)))
			if s.greet
			else t(s)["portal"]
		)
		s.greet = False
		return [choose(s, body, self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "report":
			return start_report(s, ctx)
		if choice in ("status", "recent"):
			s.view = choice
			return go("reports")
		if choice == "ask":
			return go("ask")
		if choice == "help":
			return go("help")
		ref = ref_from(inp)
		if ref:
			return stay(text(one_report(s, ctx, ref)))
		if _is_question(inp, ctx):
			return ask_chatbot(s, inp["text"], ctx)
		return None


class Reports(State):
	def options(self, s, ctx):
		return [{"id": "report", "title": t(s)["submitNew"]}, {"id": "menu", "title": t(s)["backToMenu"]}]

	def prompt(self, s, ctx):
		body = recent_reports(s, ctx) if s.view == "recent" else report_status(s, ctx)
		opts = self.options(s, ctx)
		if len(body) <= LIMITS["body"]:
			return [choose(s, body, opts)]
		return [text(body), choose(s, t(s)["next"], opts)]

	def on(self, s, inp, choice, ctx):
		if choice == "report":
			return begin_report(s, ctx)
		if choice == "menu":
			return go(home(s))
		ref = ref_from(inp)
		if ref:
			return quiet(text(one_report(s, ctx, ref)))
		return None


class Help(State):
	def options(self, s, ctx):
		return [
			{"id": "report", "title": t(s)["submitReport"]},
			{"id": "advice", "title": t(s)["advice"]},
			{"id": "menu", "title": t(s)["backToMenu"]},
		]

	def prompt(self, s, ctx):
		return [choose(s, t(s)["help"], self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "report":
			return go("resume") if s.draft else begin_report(s, ctx)
		if choice == "advice":
			return stay(text(C.HEALTH_TIPS))
		if choice != "menu":
			return None
		return go("resume" if s.draft else home(s))


class Resume(State):
	def options(self, s, ctx):
		return [{"id": "resume", "title": t(s)["resumeBtn"]}, {"id": "restart", "title": t(s)["restartBtn"]}]

	def prompt(self, s, ctx):
		body = t(s)["paused"](ctx.settings.idle_minutes) if s.paused_idle else t(s)["resume"]
		s.paused_idle = False
		return [choose(s, body, self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "restart":
			s.draft = None
			return go(home(s))
		if choice != "resume":
			return None
		target = s.resume_state if s.resume_state in STATES and s.resume_state != "resume" else home(s)
		s.resume_state = None
		return go(target)
