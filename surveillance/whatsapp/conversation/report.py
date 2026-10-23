"""Starting a report, the review, the duplicate check, editing, saving it and what the reporter sees afterwards."""

import re

from surveillance.whatsapp import content as C
from surveillance.whatsapp.conversation.core import (
	AttrDict,
	L,
	State,
	_call,
	go,
	home,
	nairobi_date,
	nav,
	normalize,
	normalize_phone,
	paging,
	quiet,
	ref_from,
	region_label,
	show_date,
	split_text,
	stay,
	sub_county_label,
	symptom_labels,
	t,
	to_media,
)
from surveillance.whatsapp.conversation.free_text import _clip, advice_for, describe, extraction_note
from surveillance.whatsapp.conversation.status import one_report
from surveillance.whatsapp.conversation.steps import (
	active_steps,
	ask,
	choose,
	first_step,
	missing_steps,
	new_draft,
	set_place,
	step_name,
)
from surveillance.whatsapp.extract import extract_report
from surveillance.whatsapp.messages import text


class RDescribe(State):
	"""Community members first describe what is happening in their own words (AI/ML §1.4, SRS H.12)."""

	def options(self, s, ctx):
		return [
			{
				"id": "guided",
				"title": t(s)["describeGuided"],
				"aliases": ["step by step", "steps", "hatua kwa hatua", "hatua"],
			}
		]

	def prompt(self, s, ctx):
		return [choose(s, t(s)["describe"], self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "guided":
			s.draft.free = False
			return go(first_step(s, ctx))
		if inp["type"] == "media":
			s.draft.media.append(to_media(inp))
			if len(normalize(inp.get("caption"))) >= 3:
				return describe(s, inp["caption"], ctx)
			body = t(s)["describeVoice"] if inp.get("kind") == "audio" else t(s)["describeMedia"]
			return quiet(choose(s, body, self.options(s, ctx)))
		if inp["type"] == "location":
			set_place(s, inp)
			return quiet(choose(s, t(s)["describeLocation"], self.options(s, ctx)))
		if inp["type"] == "text" and len(normalize(inp.get("text"))) >= 3:
			return describe(s, inp["text"], ctx)
		return None


class RReview(State):
	def options(self, s, ctx):
		return [
			{
				"id": "submit",
				"title": t(s)["submit"],
				"aliases": ["submit", "confirm", "send", "yes", "tuma", "thibitisha", "ndiyo"],
			},
			{"id": "edit", "title": t(s)["edit"], "aliases": ["edit", "back", "change", "badilisha"]},
			{"id": "cancel", "title": t(s)["cancel"], "aliases": ["discard", "futa"]},
		]

	def prompt(self, s, ctx):
		s.editing = False
		return [choose(s, t(s)["review"](summary(s, ctx)), self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "edit":
			return go("r_edit")
		if choice == "cancel":
			s.draft = None
			return go("r_done", text(t(s)["cancelled"]))
		if choice != "submit":
			return None
		missing = missing_steps(s, ctx)
		if missing:
			s.editing = True
			return go(missing[0], text(t(s)["incomplete"](", ".join(step_name(s, m) for m in missing))))
		if not s.draft.skip_duplicate_check:
			dup = ctx.data.find_duplicate(s.draft.region, s.draft.symptoms)
			if dup:
				s.draft.duplicate_of = dup
				return go("r_duplicate")
		return submit(s, ctx)


class RDuplicate(State):
	def options(self, s, ctx):
		return [
			{
				"id": "submit",
				"title": t(s)["submitAnyway"],
				"aliases": ["submit", "yes", "new", "tuma", "ndiyo"],
			},
			{"id": "cancel", "title": t(s)["cancel"], "aliases": ["no", "discard", "hapana"]},
		]

	def prompt(self, s, ctx):
		return [choose(s, t(s)["duplicate"](s.draft.duplicate_of), self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "cancel":
			s.draft = None
			return go("r_done", text(t(s)["cancelled"]))
		if choice != "submit":
			return None
		s.draft.skip_duplicate_check = True
		return submit(s, ctx)


class REdit(State):
	def options(self, s, ctx):
		return [
			*({"id": sid, "title": step_name(s, sid)} for sid in active_steps(s, ctx)),
			{"id": "back", "title": t(s)["editBack"]},
			*nav(s),
		]

	def prompt(self, s, ctx):
		opts = self.options(s, ctx)
		sections = [o for o in opts if o["id"].startswith("r_")]
		return [ask(s, t(s)["editPrompt"], sections, extra=[next(o for o in opts if o["id"] == "back")])]

	def on(self, s, inp, choice, ctx):
		moved = paging(s, choice)
		if moved:
			return moved
		if not choice:
			return None
		if choice == "back":
			return go("r_review")
		s.editing = True
		if choice == "r_symptoms":
			s.draft.symptoms = []
			s.symptom_group = None
		return go(choice)


class RDone(State):
	def options(self, s, ctx):
		return [
			{"id": "another", "title": t(s)["another"]},
			*([] if s.mode == "staff" else [{"id": "advice", "title": t(s)["advice"]}]),
			{
				"id": "menu",
				"title": t(s)["finish"] if s.mode == "staff" else t(s)["backToMenu"],
				"aliases": ["done", "maliza"],
			},
		]

	def prompt(self, s, ctx):
		return [choose(s, t(s)["next"], self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "another":
			return start_report(s, ctx)
		if choice == "advice":
			return stay(text(C.HEALTH_TIPS))
		if choice == "menu":
			return go(home(s))
		ref = ref_from(inp)
		if ref:
			return stay(text(one_report(s, ctx, ref)))
		return None


def verify_staff(s, ctx):
	s.staff = AttrDict.wrap(ctx.data.find_staff(s.phone))
	if not s.staff:
		s.mode = None
		return go("not_staff")
	s.mode = "staff"
	s.lang = s.lang or "en"
	s.greet = True
	return go("menu")


def begin_report(s, ctx):
	"""From a "Submit a report" button outside the staff portal: community members pick a language first."""
	if not s.mode:
		s.mode = "community"
	if s.mode == "community" and not s.lang:
		return go("lang")
	return start_report(s, ctx)


def start_report(s, ctx):
	if s.mode == "staff":
		s.staff = AttrDict.wrap(ctx.data.find_staff(s.phone))
		if not s.staff:
			s.mode = None
			return go("not_staff")
	else:
		s.staff = None
	s.draft = new_draft(s)
	s.editing = False
	s.symptom_group = None
	if not s.staff:
		# Community members describe it in their own words; trained staff keep the guided steps (AI/ML §1.4).
		s.draft.free = True
		seed, s.seed = s.seed, None
		return describe(s, seed["text"], ctx, seed["extraction"]) if seed else go("r_describe")
	return go(first_step(s, ctx))


def summary(s, ctx):
	d = s.draft
	f = t(s)["f"]
	symptoms = ctx.data.catalog()["symptoms"]
	place = d.location_name or (f"{d.latitude:.5f}, {d.longitude:.5f}" if d.latitude is not None else None)
	lines = [
		d.description and (f["description"], "_" + _clip(re.sub(r"[_*~]", "", d.description), 160) + "_"),
		(f["region"], region_label(d.region, ctx)),
		d.sub_county and (f["sub_county"], sub_county_label(d.region, d.sub_county, ctx)),
		place and (f["place"], place),
		not s.staff and (f["reporter_name"], d.reporter_name),
		(f["category"], d.category and L(s, "category", d.category)),
		s.staff and (f["signal_type"], d.signal_type),
		(f["symptoms"], symptom_labels(d.symptoms, symptoms)),
		(f["affected_count"], d.affected_count),
		d.sex and (f["sex"], L(s, "sex", d.sex)),
		d.age_group and (f["age_group"], L(s, "age_group", d.age_group)),
		d.animal_exposure and (f["animal_exposure"], L(s, "animal_exposure", d.animal_exposure)),
		(f["deaths_count"], d.deaths_count),
		(f["onset_date"], show_date(d.onset_date)),
		(d.media or d.notes) and (f["extra"], t(s)["attached"](len(d.media), len(d.notes))),
	]
	body = "\n".join(
		f"*{k}:* {'—' if v is None or v == '' else v}" for k, v in (line for line in lines if line)
	)
	filled = d.free and d.extraction and d.extraction.get("filled")
	return f"{body}\n\n_{t(s)['reviewFilled']}_" if filled else body


def build_doc(s, ctx):
	"""The Case Report exactly as the web form would create it, with channel = WhatsApp.
	Photos and voice notes are attached afterwards by a background job (jobs.attach_media)."""
	d = s.draft
	return {
		"doctype": "Case Report",
		"reported_by": s.staff.user if s.staff else ctx.data.community_user(),
		"reporter_name": d.reporter_name,
		"phone_number": f"+{normalize_phone(s.phone)}",
		"signal_type": d.signal_type,
		"category": d.category,
		"region": d.region,
		"sub_county": d.sub_county,
		"location_name": d.location_name,
		"latitude": d.latitude,
		"longitude": d.longitude,
		"affected_count": d.affected_count,
		**({"sex": d.sex} if d.sex else {}),  # the field was removed from Case Report on 16/10/2026
		"symptoms": [{"symptom": sid} for sid in d.symptoms],
		"onset_date": d.onset_date,
		"age_group": d.age_group,
		"animal_exposure": d.animal_exposure,
		"deaths_count": d.deaths_count or 0,
		"additional_notes": "\n\n".join(x for x in [*d.notes, extraction_note(s)] if x) or None,
		"channel": "WhatsApp",
		"status": "Submitted",
	}


def submit(s, ctx):
	try:
		report = ctx.data.create_report(build_doc(s, ctx))
	except Exception:
		if getattr(ctx, "log_error", None):
			ctx.log_error("WhatsApp report could not be saved")
		return quiet(text(t(s)["saveFailed"]))
	# SRS R10: community reporters get advice for what they reported; staff get the mobile app's next steps.
	advice = next_steps(s, report, ctx) if s.mode == "staff" else [text(advice_for(s, ctx))]
	draft = s.draft
	s.draft = None
	if draft.description:
		_call(ctx, "on_extract", report=report, session=s, draft=draft)
	_call(ctx, "on_submit", report=report, session=s, media=list(draft.media), extraction=draft.extraction)
	return go("r_done", text(t(s)["done"](report["name"])), *advice)


def next_steps(s, report, ctx):
	"""The protocol's steps for reporters and the general lines, as in the mobile app. Without the protocol
	(none approved, no permission, Frappe unreachable) the general lines still apply."""
	N = C.NEXT_STEPS.get(s.lang) or C.NEXT_STEPS["en"]
	try:
		a = ctx.data.reporter_advice(report.get("suspected_disease"), s.staff.user) or {}
	except Exception:
		if getattr(ctx, "log_error", None):
			ctx.log_error("WhatsApp next steps could not be loaded")
		a = {}
	disease, steps = a.get("disease"), a.get("steps") or []
	parts = [N["title"]]
	if disease:
		parts.append(N["disease"](disease))
	if steps:
		numbered = (
			f"{i}. {x['step']}" + (f" _({x['timeframe']})_" if x.get("timeframe") else "")
			for i, x in enumerate(steps, 1)
		)
		parts.append("\n".join([N["steps"](disease), *numbered]))
	parts.append("\n".join([N["also"] if steps else N["next"], *(f"• {g}" for g in N["general"])]))
	return [text(p) for p in split_text("\n\n".join(parts))]


def seed_report(s, value, ctx):
	"""A report typed outside the report flow (the welcome screen, a question the chatbot routes as a report)
	starts a free-text report from it. A staff number keeps the staff portal."""
	x = extract_report(value, ctx, nairobi_date(ctx.now()), s.lang)
	if not x["is_report"] or ctx.data.find_staff(s.phone):
		return None
	s.mode = "community"
	s.staff = None
	s.lang = s.lang or x["language"]
	s.seed = {"text": value, "extraction": x}
	return start_report(s, ctx)
