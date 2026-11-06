"""The report steps: which apply, their order, going back, what is still missing, and the shared step prompts."""

import math
import re

from surveillance.whatsapp import content as C
from surveillance.whatsapp.conversation.core import (
	ANIMALS,
	COMMUNITY_SIGNAL,
	GROUPS,
	AttrDict,
	L,
	fit,
	go,
	normalize,
	quiet,
	region_label,
	stay,
	sub_county_label,
	t,
)
from surveillance.whatsapp.extract import find_symptoms
from surveillance.whatsapp.messages import LIMITS, menu, text


def ask(s, body, items, extra=()):
	"""One interactive message showing `items` (paged when they don't fit in a list) plus fixed `extra` rows."""
	rows = list(items)
	if len(items) + len(extra) > LIMITS["max_rows"]:
		size = LIMITS["max_rows"] - len(extra) - 2
		pages = math.ceil(len(items) / size)
		s.page = min(max(0, s.page), pages - 1)
		rows = list(items[s.page * size : (s.page + 1) * size])
		if s.page > 0:
			rows.append({"id": "prev", "title": t(s)["prev"]})
		if s.page < pages - 1:
			rows.append({"id": "more", "title": t(s)["more"]})
	rows = [fit(r) for r in [*rows, *extra]]
	s.shown = [r["id"] for r in rows]
	return menu(body, rows, button=t(s)["listButton"], footer=step_footer(s))


def choose(s, body, options):
	"""A fixed set of options as buttons or a list, remembering what was shown for typed numbers."""
	s.shown = [o["id"] for o in options]
	return menu(body, options, button=t(s)["listButton"], footer=step_footer(s))


def step_footer(s):
	return t(s)["stepFooter"] if s.draft and s.state in BACK_TO else None


def with_hint(s, body):
	"""Plain text and location requests have no footer, so the same hint goes on the last line."""
	return f"{body}\n\n_{step_footer(s)}._" if step_footer(s) else body


def step_text(s, body):
	return text(with_hint(s, body))


def area_locked(s):
	"""CHPs and Facility Health Workers: Frappe sets the region and sub-county from their account."""
	return bool(s.staff and s.staff.get("area_locked"))


def new_draft(s):
	locked = area_locked(s)
	return AttrDict(
		reporter_name=s.staff.full_name if s.staff else None,
		category=None,
		signal_type=None if s.staff else COMMUNITY_SIGNAL,
		symptoms=[],
		affected_count=None,
		age_group=None,
		animal_exposure=None,
		deaths_count=None,
		onset_date=None,
		region=s.staff.region if locked else None,
		sub_county=s.staff.sub_county if locked else None,
		location_name=None,
		latitude=None,
		longitude=None,
		region_from_pin=False,
		sub_county_from_pin=False,
		category_assumed=False,
		notes=[],
		media=[],
		skip_duplicate_check=False,
		# Free text (community members): the reporter's own words, what was taken from them, the questions asked.
		free=False,
		description=None,
		extraction=None,
		followups=[],
	)


def select_options(s, cat, field):
	return [{"id": f"v:{v}", "title": L(s, field, v), "full": v} for v in cat["options"].get(field) or []]


def value_of(choice):
	return choice[2:] if choice and choice.startswith("v:") else None


def is_human(s):
	return (s.draft or {}).get("category") != ANIMALS


STEPS = [
	# Location first (KRCS, 21 Oct): where it is happening is captured before anything else.
	("r_region", None),
	("r_subcounty", lambda s, ctx, cat: not s.draft.region or len(ctx.data.sub_counties(s.draft.region)) > 1),
	("r_place", None),
	("r_name", lambda s, ctx, cat: not s.staff),
	("r_category", None),
	("r_signal", lambda s, ctx, cat: bool(s.staff)),
	("r_symptoms", None),
	("r_count", None),
	("r_age", lambda s, ctx, cat: is_human(s) and bool(cat["options"].get("age_group"))),
	("r_exposure", lambda s, ctx, cat: is_human(s) and bool(cat["options"].get("animal_exposure"))),
	("r_deaths", None),
	("r_onset", None),
	("r_extra", None),
]


# Where "back" goes from each report state: None = the previous step, a name = that state.
# Review, edit and done handle "back" themselves.
BACK_TO = {
	**{sid: None for sid, _ in STEPS},
	"r_symptoms_more": "r_symptoms",
	"r_place_gps": "r_place",
	"r_place_name": "r_place",
	"r_onset_date": "r_onset",
}


def step_back(s, ctx):
	if s.state == "r_symptoms" and s.symptom_group:
		s.symptom_group = None if s.symptom_group == GROUPS else GROUPS
		return go("r_symptoms")
	if BACK_TO[s.state]:
		return go(BACK_TO[s.state])
	steps = active_steps(s, ctx)
	if s.editing or s.state not in steps:
		return go("r_review")
	i = steps.index(s.state)
	return go(steps[i - 1]) if i > 0 else stay()


def active_steps(s, ctx, editable=False):
	"""The steps that apply, in order. `editable` keeps the region and sub-county a pin gave, for Edit."""
	cat = ctx.data.catalog()
	steps = [sid for sid, when in STEPS if not when or when(s, ctx, cat)]
	if area_locked(s):
		steps = [sid for sid in steps if sid not in ("r_region", "r_subcounty")]
	if not s.staff:
		# Community reporters share the pin first; it usually gives the region and sub-county too.
		steps = ["r_place", *(sid for sid in steps if sid != "r_place")]
	return steps if editable else [sid for sid in steps if not from_pin(s, sid)]


def from_pin(s, sid):
	d = s.draft
	return (sid == "r_region" and d.region_from_pin) or (sid == "r_subcounty" and d.sub_county_from_pin)


def step_no(s, sid, ctx):
	if s.draft and s.draft.free:
		# Numbered among the follow-up questions; a step the reporter chose to edit has no number.
		q = s.draft.followups
		missing = missing_steps(s, ctx)
		if sid not in q and sid in missing:
			q.append(sid)
		# The total counts what is still missing too, so it does not grow as each question is asked.
		total = len(q) + sum(1 for m in missing if m not in q)
		return (q.index(sid) + 1, total) if sid in q else (None, None)
	steps = active_steps(s, ctx)
	return (steps.index(sid) + 1, len(steps)) if sid in steps else (None, None)


def after(s, sid, ctx, ignore_editing=False):
	"""The state after answering `sid`: back to review when editing, otherwise the next step."""
	if sid == "r_region":
		auto_sub_county(s, ctx)
	if s.editing and not ignore_editing:
		# A new pin can move the report to a region whose sub-county the pin does not settle.
		return first_missing(s, ctx) if sid == "r_place" else "r_review"
	if s.draft.free:  # free text: only what is still missing; the optional questions are left to Edit
		return first_missing(s, ctx)
	steps = active_steps(s, ctx)
	i = steps.index(sid) + 1
	return steps[i] if i < len(steps) else "r_review"


def auto_sub_county(s, ctx):
	rows = ctx.data.sub_counties(s.draft.region)
	if len(rows) == 1:
		s.draft.sub_county = rows[0]["name"]


def first_step(s, ctx):
	return active_steps(s, ctx)[0]


def _clear_place(s):
	s.draft.update(location_name=None, latitude=None, longitude=None)


PLACE_FIELDS = ("latitude", "longitude", "location_name")


def place_required(ctx):
	return any(f in PLACE_FIELDS for f in ctx.data.catalog()["required"])


def place_missing(s, ctx):
	required = ctx.data.catalog()["required"]
	return ("latitude" in required and s.draft.latitude is None) or (
		"location_name" in required and not s.draft.location_name
	)


def place_answer(s, inp, ctx):
	"""Required place: a typed name is kept and the pin asked for; a pin without a name asks for the name."""
	if inp["type"] == "text" and normalize(inp["text"]) in ("skip", "ruka", "no", "hapana"):
		return quiet(text(t(s)["placeNoSkip"]))
	if not set_place(s, inp, ctx):
		return None
	required = ctx.data.catalog()["required"]
	if "latitude" in required and s.draft.latitude is None:
		return go("r_place_gps", text(t(s)["placeNeedPin"](s.draft.location_name)))
	if place_missing(s, ctx):
		return go("r_place_name", *place_ack(s, inp, ctx))
	return go(after(s, "r_place", ctx), *place_ack(s, inp, ctx))


def set_place(s, inp, ctx):
	if inp["type"] == "location":
		name = ", ".join(x for x in (inp.get("name"), inp.get("address")) if x)[:140]
		s.draft.update(location_name=name or s.draft.location_name, latitude=inp["lat"], longitude=inp["lng"])
		area_from_pin(s, ctx)
		return True
	if inp["type"] == "text" and len(inp["text"].strip()) >= 2:
		s.draft.location_name = inp["text"].strip()[:140]
		return True
	return False


PIN_RADIUS_KM = 100  # a pin farther than this from every sub-county centre gives neither
PIN_MARGIN = 1.5  # the nearest centre must be this many times closer than the next one in the region


def area_from_pin(s, ctx):
	"""Community reports: the region and sub-county whose centre is nearest the pin, so they are not asked.
	Sub County coordinates are approximate centres, so a pin about as close to two of them leaves the
	sub-county to the reporter. What the reporter chose or typed is kept; values from an earlier pin are not."""
	d = s.draft
	if s.staff or d.latitude is None:
		return
	if d.region_from_pin:
		d.region = None
	if d.sub_county_from_pin:
		d.sub_county = None
	d.region_from_pin = d.sub_county_from_pin = False
	if d.region and d.sub_county:
		return
	ranked = sorted(
		(km(d.latitude, d.longitude, p["latitude"], p["longitude"]), p)
		for p in ctx.data.sub_county_centres()
		if p["latitude"] and p["longitude"] and (not d.region or p["region"] == d.region)
	)
	if not ranked or ranked[0][0] > PIN_RADIUS_KM:
		return
	if not d.region:
		d.region, d.region_from_pin = ranked[0][1]["region"], True
	near = [(dist, p) for dist, p in ranked if p["region"] == d.region]
	if len(near) == 1 or near[1][0] >= PIN_MARGIN * near[0][0]:
		d.sub_county, d.sub_county_from_pin = near[0][1]["name"], True


def km(lat1, lng1, lat2, lng2):
	"""Distance on the ground, close enough at this scale (equirectangular)."""
	x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2))
	return 6371 * math.hypot(x, math.radians(lat2 - lat1))


def place_ack(s, inp, ctx):
	"""Echo a shared GPS pin back, as the prototype does, with the area it gave. A typed name needs no echo."""
	if inp["type"] != "location":
		return []
	coords = f"{float(inp['lat']):.5f}, {float(inp['lng']):.5f}"
	d = s.draft
	area = None
	if d.region_from_pin or d.sub_county_from_pin:
		area = ", ".join(
			x
			for x in (
				d.sub_county and sub_county_label(d.region, d.sub_county, ctx),
				region_label(d.region, ctx),
			)
			if x
		)
	return [text(t(s)["placeReceived"](coords, d.location_name, area))]


def symptom_key(label):
	""" "Fever (hot body)" -> "fever", the form used in content.py."""
	return normalize(re.sub(r"\([^)]*\)", "", label))


def common_symptoms(symptoms):
	by_key = {}
	for x in symptoms:
		by_key.setdefault(symptom_key(x["label"]), x)
	return [by_key[key] for key in C.COMMON_SYMPTOMS if key in by_key]


def examples(symptoms):
	joined = ", ".join(x["label"] for x in symptoms)
	if len(joined) <= LIMITS["row_desc"]:
		return joined
	return re.sub(r",? [^ ]*$", "", joined[: LIMITS["row_desc"] - 1]) + "…"


def add_typed_symptoms(s, value, ctx):
	found = find_symptoms(value, ctx.data.catalog()["symptoms"])
	for sid in found:
		if sid not in s.draft.symptoms:
			s.draft.symptoms.append(sid)
	return len(found)


def step_name(s, sid):
	f = t(s)["f"]
	names = {
		"r_name": f["reporter_name"],
		"r_category": f["category"],
		"r_signal": f["signal_type"],
		"r_symptoms": f["symptoms"],
		"r_count": f["affected_count"],
		"r_age": f["age_group"],
		"r_exposure": f["animal_exposure"],
		"r_deaths": f["deaths_count"],
		"r_onset": f["onset_date"],
		"r_region": f["region"],
		"r_subcounty": f["sub_county"],
		"r_place": f["place"],
		"r_extra": f["extra"],
	}
	return names.get(sid, sid)


def missing_steps(s, ctx):
	"""Required by Case Report (or by the web form, for sub-county)."""
	d = s.draft
	filled = {
		"r_name": d.reporter_name,
		"r_category": d.category,
		"r_signal": d.signal_type,
		"r_symptoms": len(d.symptoms),
		"r_count": d.affected_count,
		"r_deaths": d.deaths_count is not None or not deaths_needed(s),
		"r_onset": d.onset_date,
		"r_region": d.region,
		"r_subcounty": d.sub_county,
		"r_place": not place_missing(s, ctx),
	}
	return [sid for sid in active_steps(s, ctx) if sid in filled and not filled[sid]]


def deaths_needed(s):
	"""A community member describing one sick person with no danger signs is not asked about deaths; the
	question is kept for staff, step-by-step reports, danger signs and more than one affected."""
	d = s.draft
	if s.staff or not d.free:
		return True
	x = d.extraction or {}
	return (
		bool(x.get("danger_signs")) or x.get("threat", "routine") != "routine" or (d.affected_count or 0) > 1
	)


def first_missing(s, ctx):
	return next(iter(missing_steps(s, ctx)), "r_review")
