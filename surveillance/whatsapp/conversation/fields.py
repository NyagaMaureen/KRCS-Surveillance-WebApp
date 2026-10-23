"""One state per report field, in the order of the web "Record Health Signal" form."""

import re

from surveillance.whatsapp.conversation.core import (
	ANIMALS,
	GROUPS,
	HOUR,
	HUMANS,
	L,
	State,
	_unique,
	attached_count,
	go,
	media_ack,
	nairobi_date,
	nav,
	normalize,
	paging,
	parse_date,
	quiet,
	region_label,
	stay,
	symptom_labels,
	t,
	to_media,
	whole_number,
)
from surveillance.whatsapp.conversation.steps import (
	_clear_place,
	add_typed_symptoms,
	after,
	ask,
	choose,
	common_symptoms,
	examples,
	place_ack,
	place_answer,
	place_required,
	select_options,
	set_place,
	step_no,
	step_text,
	value_of,
	with_hint,
)
from surveillance.whatsapp.messages import LIMITS, location_request, text


class RName(State):
	def options(self, s, ctx):
		return (
			[{"id": "profile", "title": s.profile_name[: LIMITS["button_title"]]}] if s.profile_name else []
		)

	def prompt(self, s, ctx):
		n, total = step_no(s, "r_name", ctx)
		body = t(s)["name"](n, total, s.profile_name)
		if not s.profile_name:
			return [step_text(s, body)]
		return [choose(s, body, self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "profile":
			s.draft.reporter_name = s.profile_name
		elif inp["type"] == "text" and sum(ch.isalpha() for ch in inp["text"]) >= 2:
			s.draft.reporter_name = inp["text"].strip()[:140]
		elif inp["type"] == "text":
			return quiet(text(t(s)["nameInvalid"]))
		else:
			return None
		return go(after(s, "r_name", ctx))


class SelectStep(State):
	"""A required step answered from a Case Report Select field."""

	def __init__(self, sid, field, prompt_key):
		self.sid, self.field, self.prompt_key = sid, field, prompt_key

	def options(self, s, ctx):
		return select_options(s, ctx.data.catalog(), self.field)

	def prompt(self, s, ctx):
		n, total = step_no(s, self.sid, ctx)
		return [ask(s, t(s)[self.prompt_key](n, total), self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		v = value_of(choice)
		if not v:
			return None
		s.draft[self.field] = v
		if self.field == "category" and v == ANIMALS:
			s.draft.age_group = s.draft.animal_exposure = None
		return go(after(s, self.sid, ctx))


class OptionalSelect(SelectStep):
	"""A Select step with a Skip row."""

	def options(self, s, ctx):
		return [*super().options(s, ctx), {"id": "skip", "title": t(s)["skip"], "aliases": ["skip", "ruka"]}]

	def on(self, s, inp, choice, ctx):
		if choice == "skip":
			s.draft[self.field] = None
		elif value_of(choice):
			s.draft[self.field] = value_of(choice)
		else:
			return None
		return go(after(s, self.sid, ctx))


class RSymptoms(State):
	"""When the symptoms don't fit in one list: the common ones first, then "Other symptoms" -> groups
	(Symptom.category in everyday words, with examples) -> the symptoms of one group.
	Symptoms can also be typed in the reporter's own words, several at once."""

	def options(self, s, ctx):
		symptoms = ctx.data.catalog()["symptoms"]
		groups = [
			{"id": f"g:{g}", "title": L(s, "symptom_group", g), "full": g}
			for g in _unique(x["category"] for x in symptoms)
		]
		every = [{"id": f"s:{x['name']}", "title": x["label"], "full": x["label"]} for x in symptoms]
		return [
			*groups,
			*every,
			{"id": "other", "title": t(s)["symptomOther"]},
			{"id": "common", "title": t(s)["symptomCommonBack"]},
			{"id": "back", "title": t(s)["symptomBack"]},
			*nav(s),
		]

	def prompt(self, s, ctx):
		symptoms = ctx.data.catalog()["symptoms"]
		remaining = [x for x in symptoms if x["name"] not in s.draft.symptoms]
		n, total = step_no(s, "r_symptoms", ctx)
		chosen = symptom_labels(s.draft.symptoms, symptoms)

		def row(x):
			return {"id": f"s:{x['name']}", "title": x["label"]}

		if len(remaining) <= LIMITS["max_rows"]:
			return [ask(s, t(s)["symptomAll"](n, total, chosen), [row(x) for x in remaining])]

		common = common_symptoms(remaining)
		if not s.symptom_group and common:
			other = {"id": "other", "title": t(s)["symptomOther"], "desc": t(s)["symptomOtherDesc"]}
			return [ask(s, t(s)["symptomCommon"](n, total, chosen), [row(x) for x in common], extra=[other])]
		if not s.symptom_group or s.symptom_group == GROUPS:
			groups = [
				{
					"id": f"g:{g}",
					"title": L(s, "symptom_group", g),
					"desc": examples([x for x in remaining if x["category"] == g]),
				}
				for g in _unique(x["category"] for x in remaining)
			]
			extra = [{"id": "common", "title": t(s)["symptomCommonBack"]}] if common else []
			return [ask(s, t(s)["symptomGroup"](n, total, chosen), groups, extra=extra)]
		items = [row(x) for x in remaining if x["category"] == s.symptom_group]
		return [
			ask(
				s,
				t(s)["symptom"](L(s, "symptom_group", s.symptom_group)),
				items,
				extra=[{"id": "back", "title": t(s)["symptomBack"]}],
			)
		]

	def on(self, s, inp, choice, ctx):
		moved = paging(s, choice)
		if moved:
			return moved
		view = {"other": GROUPS, "back": GROUPS, "common": None}
		if choice in view or (choice and choice.startswith("g:")):
			s.symptom_group = view[choice] if choice in view else choice[2:]
			s.page = 0
			return stay()
		if choice and choice.startswith("s:"):
			sid = choice[2:]
			if sid not in s.draft.symptoms:
				s.draft.symptoms.append(sid)
			s.symptom_group = None
			return go("r_symptoms_more")
		if inp["type"] != "text":
			return None
		if not add_typed_symptoms(s, inp["text"], ctx):
			return quiet(text(t(s)["symptomNotFound"]))
		s.symptom_group = None
		return go("r_symptoms_more")


class RSymptomsMore(State):
	"""Typed symptoms here are added directly."""

	def options(self, s, ctx):
		return [
			{
				"id": "done",
				"title": t(s)["symptomsDone"],
				"aliases": ["next", "done", "no", "endelea", "hapana"],
			},
			{"id": "add", "title": t(s)["symptomsAdd"], "aliases": ["add", "yes", "ongeza", "ndiyo"]},
			{"id": "clear", "title": t(s)["symptomsClear"]},
		]

	def prompt(self, s, ctx):
		symptoms = ctx.data.catalog()["symptoms"]
		labels = {x["name"]: x["label"] for x in symptoms}
		items = "\n".join(f"• {labels.get(sid, sid)}" for sid in s.draft.symptoms)
		return [choose(s, t(s)["symptomsMore"](items), self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if not choice and inp["type"] == "text":
			return stay() if add_typed_symptoms(s, inp["text"], ctx) else quiet(text(t(s)["symptomNotFound"]))
		if choice == "done":
			return go(after(s, "r_symptoms", ctx))
		if choice == "add":
			return go("r_symptoms")
		if choice == "clear":
			s.draft.symptoms = []
			return go("r_symptoms")
		return None


class RCount(State):
	def prompt(self, s, ctx):
		n, total = step_no(s, "r_count", ctx)
		cat = s.draft.category
		who = "animals" if cat == ANIMALS else "both" if cat and cat != HUMANS else "people"
		return [step_text(s, t(s)["count"](n, total, who))]

	def on(self, s, inp, choice, ctx):
		if inp["type"] != "text":
			return None
		v = whole_number(inp["text"])
		if v is None or not 1 <= v <= 100_000:
			return quiet(text(t(s)["countInvalid"]))
		s.draft.affected_count = v
		return go(after(s, "r_count", ctx))


class RDeaths(State):
	def options(self, s, ctx):
		return [
			{"id": "none", "title": t(s)["deathsNone"], "aliases": ["none", "no", "0", "hakuna", "hapana"]}
		]

	def prompt(self, s, ctx):
		n, total = step_no(s, "r_deaths", ctx)
		return [choose(s, t(s)["deaths"](n, total), self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		v = 0 if choice == "none" else whole_number(inp["text"]) if inp["type"] == "text" else None
		if v is None or not 0 <= v <= 100_000:
			if inp["type"] != "text":
				return None
			return quiet(text(t(s)["deathsInvalid"]))
		s.draft.deaths_count = v
		return go(after(s, "r_deaths", ctx))


class RRegion(State):
	"""The staff member's assigned region is listed first."""

	def options(self, s, ctx):
		regions = ctx.data.catalog()["regions"]
		mine = s.staff.region if s.staff else None
		ordered = [r for r in regions if r["name"] == mine] + [r for r in regions if r["name"] != mine]
		return [
			*(
				{
					"id": f"r:{r['name']}",
					"title": r["label"],
					"full": r["label"],
					**({"desc": t(s)["regionYours"]} if r["name"] == mine else {}),
				}
				for r in ordered
			),
			*nav(s),
		]

	def prompt(self, s, ctx):
		n, total = step_no(s, "r_region", ctx)
		opts = [o for o in self.options(s, ctx) if o["id"].startswith("r:")]
		return [ask(s, t(s)["region"](n, total), opts)]

	def on(self, s, inp, choice, ctx):
		moved = paging(s, choice)
		if moved:
			return moved
		if not (choice and choice.startswith("r:")):
			return None
		region = choice[2:]
		if region != s.draft.region:
			s.draft.sub_county = None
		s.draft.region = region
		# A new region needs a new sub-county, even when editing.
		next_state = after(s, "r_region", ctx, ignore_editing=not s.draft.sub_county)
		return go(next_state if next_state == "r_subcounty" or not s.editing else "r_review")


class RSubCounty(State):
	def options(self, s, ctx):
		rows = ctx.data.sub_counties(s.draft.region)
		return [
			*(
				{"id": f"c:{x['name']}", "title": x["label"], "full": x["label"], "desc": x.get("county")}
				for x in rows
			),
			*nav(s),
		]

	def prompt(self, s, ctx):
		n, total = step_no(s, "r_subcounty", ctx)
		opts = [o for o in self.options(s, ctx) if o["id"].startswith("c:")]
		return [ask(s, t(s)["subCounty"](n, total, region_label(s.draft.region, ctx)), opts)]

	def on(self, s, inp, choice, ctx):
		moved = paging(s, choice)
		if moved:
			return moved
		if not (choice and choice.startswith("c:")):
			return None
		s.draft.sub_county = choice[2:]
		return go(after(s, "r_subcounty", ctx))


class RPlace(State):
	"""Optional unless Case Report requires the GPS pin and place name; then both are asked for until given."""

	def options(self, s, ctx):
		return [
			{"id": "gps", "title": t(s)["placeGps"], "aliases": ["gps", "location"]},
			{"id": "skip", "title": t(s)["skip"], "aliases": ["skip", "ruka", "no", "hapana"]},
		]

	def prompt(self, s, ctx):
		n, total = step_no(s, "r_place", ctx)
		if place_required(ctx):
			return [location_request(with_hint(s, t(s)["placeRequired"](n, total)))]
		return [choose(s, t(s)["place"](n, total), self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if place_required(ctx):
			return place_answer(s, inp, ctx)
		if choice == "gps":
			return go("r_place_gps")
		if choice == "skip":
			_clear_place(s)
			return go(after(s, "r_place", ctx))
		if not set_place(s, inp):
			return None
		return go(after(s, "r_place", ctx), *place_ack(s, inp))


class RPlaceGps(State):
	def prompt(self, s, ctx):
		return [
			location_request(
				with_hint(s, t(s)["placePinPrompt"] if place_required(ctx) else t(s)["placeGpsPrompt"])
			)
		]

	def on(self, s, inp, choice, ctx):
		if place_required(ctx):
			return place_answer(s, inp, ctx)
		if inp["type"] == "text" and normalize(inp["text"]) in ("skip", "ruka"):
			_clear_place(s)
			return go(after(s, "r_place", ctx))
		if not set_place(s, inp):
			return None
		return go(after(s, "r_place", ctx), *place_ack(s, inp))


class RPlaceName(State):
	"""A shared pin without a place name, when the name is required."""

	def prompt(self, s, ctx):
		return [step_text(s, t(s)["placeName"])]

	def on(self, s, inp, choice, ctx):
		if inp["type"] != "text" or not set_place(s, inp):
			return None
		return go(after(s, "r_place", ctx))


class ROnset(State):
	def options(self, s, ctx):
		return [
			{"id": "today", "title": t(s)["onsetToday"]},
			{"id": "yesterday", "title": t(s)["onsetYesterday"]},
			{"id": "other", "title": t(s)["onsetOther"]},
		]

	def prompt(self, s, ctx):
		n, total = step_no(s, "r_onset", ctx)
		return [choose(s, t(s)["onset"](n, total), self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		now = ctx.now()
		if choice == "other":
			return go("r_onset_date")
		if choice == "today":
			s.draft.onset_date = nairobi_date(now)
		elif choice == "yesterday":
			s.draft.onset_date = nairobi_date(now - 24 * HOUR)
		elif inp["type"] == "text" and parse_date(inp["text"], now):
			s.draft.onset_date = parse_date(inp["text"], now)
		else:
			return None
		return go(after(s, "r_onset", ctx))


class ROnsetDate(State):
	def prompt(self, s, ctx):
		return [step_text(s, t(s)["onsetDate"])]

	def on(self, s, inp, choice, ctx):
		day = parse_date(inp["text"], ctx.now()) if inp["type"] == "text" else None
		if not day:
			return quiet(text(t(s)["onsetInvalid"])) if inp["type"] == "text" else None
		s.draft.onset_date = day
		return go(after(s, "r_onset", ctx))


class RExtra(State):
	def options(self, s, ctx):
		return [
			{
				"id": "review",
				"title": t(s)["extraReview"] if attached_count(s) else t(s)["extraSkip"],
				"aliases": [
					"review",
					"proceed",
					"proceed to review",
					"skip",
					"next",
					"done",
					"kagua",
					"ruka",
				],
			}
		]

	def prompt(self, s, ctx):
		n, total = step_no(s, "r_extra", ctx)
		return [choose(s, t(s)["extra"](n, total, attached_count(s)), self.options(s, ctx))]

	def on(self, s, inp, choice, ctx):
		if choice == "review":
			return go("r_review")
		if inp["type"] == "media":
			s.draft.media.append(to_media(inp))
			if inp.get("caption"):
				s.draft.notes.append(inp["caption"][:1000])
			return quiet(choose(s, f"{media_ack(s, inp)}\n{t(s)['moreOrReview']}", self.options(s, ctx)))
		if inp["type"] == "text" and inp["text"].strip():
			note = inp["text"].strip()[:1000]
			s.draft.notes.append(note)
			echo = re.sub(r"\s+", " ", note)
			body = t(s)["noteAdded"](f"{echo[:199]}…" if len(echo) > 200 else echo, attached_count(s))
			return quiet(choose(s, f"{body}\n{t(s)['moreOrReview']}", self.options(s, ctx)))
		return None
