"""Building blocks shared by every state: session, results (go/stay/quiet), choices, phones, dates, labels."""

import re
from datetime import date, datetime, timedelta, timezone

from surveillance.whatsapp import content as C
from surveillance.whatsapp.messages import LIMITS

MIN = 60


HOUR = 60 * MIN


EAT = timezone(timedelta(hours=3))  # Africa/Nairobi, no daylight saving


HUMANS = "Human Disease"


ANIMALS = "Animal Disease"


COMMUNITY_SIGNAL = "Community Signal"


GROUPS = "*"  # s.symptom_group while the list of symptom groups is shown


STATES = {}  # state id -> State, filled in by the package __init__


class AttrDict(dict):
	"""dict with attribute access (like frappe._dict); a missing attribute reads as None."""

	__getattr__ = dict.get

	def __setattr__(self, key, value):
		self[key] = value

	@classmethod
	def wrap(cls, value):
		if isinstance(value, dict):
			return cls({k: cls.wrap(v) for k, v in value.items()})
		if isinstance(value, list):
			return [cls.wrap(v) for v in value]
		return value


def new_session(phone):
	return AttrDict(
		phone=phone,
		profile_name=None,
		lang=None,
		mode=None,  # "staff" | "community", chosen on the welcome screen
		state="welcome",
		last_active=0,
		staff=None,
		greet=False,
		view=None,
		draft=None,
		editing=False,
		resume_state=None,
		paused_idle=False,
		logo_sent=False,
		page=0,
		shown=[],
		symptom_group=None,
		question=None,
		seed=None,  # a report typed outside the report flow: {text, extraction}
	)


def go(state, *say):
	return {"go": state, "say": list(say)}


def stay(*say):
	return {"say": list(say), "reprompt": True}


def quiet(*say):
	return {"say": list(say)}


def run(s, res, ctx):
	out = list(res.get("say") or [])
	if res.get("go"):
		if res["go"] != s.state:
			s.page = 0
		s.state = res["go"]
		out += STATES[res["go"]].prompt(s, ctx)
	elif res.get("reprompt"):
		out += STATES[s.state].prompt(s, ctx)
	return out


def enter(s, state, ctx):
	return run(s, go(state), ctx)


def home(s):
	return "menu" if s.mode == "staff" else "welcome"


def pause(s, ctx, idle=False):
	s.resume_state = s.state
	s.paused_idle = idle
	return enter(s, "resume", ctx)


def t(s):
	return C.T.get(s.lang) or C.T["en"]


def L(s, field, value):
	return C.label(s.lang or "en", field, value)


def normalize(value):
	value = re.sub(r"[^\w' ]+|_", " ", str(value or "").lower())
	return re.sub(r"\s+", " ", value).strip()


def resolve_choice(options, inp, shown=()):
	"""A tap matches by id; a typed number matches the rows last shown; typed text matches a title or alias."""
	if not options:
		return None
	if inp["type"] == "reply":
		return next((o["id"] for o in options if o["id"] == inp.get("id")), None)
	if inp["type"] != "text":
		return None
	raw = (inp.get("text") or "").strip()
	if re.fullmatch(r"\d{1,2}", raw) and 1 <= int(raw) <= len(shown):
		oid = shown[int(raw) - 1]
		if any(o["id"] == oid for o in options):
			return oid
	n = normalize(raw)
	if not n:
		return None
	return next(
		(
			o["id"]
			for o in options
			if normalize(o["title"]) == n or normalize(o.get("full")) == n or n in (o.get("aliases") or [])
		),
		None,
	)


def fit(o):
	"""Long titles are shortened and shown in full as the row description."""
	if len(o["title"]) <= LIMITS["row_title"]:
		return {
			"id": o["id"],
			"title": o["title"],
			**({"desc": o["desc"][: LIMITS["row_desc"]]} if o.get("desc") else {}),
		}
	short = o["title"][: LIMITS["row_title"] - 1].rstrip() + "…"
	return {"id": o["id"], "title": short, "desc": (o.get("desc") or o["title"])[: LIMITS["row_desc"]]}


def nav(s):
	return [{"id": "more", "title": t(s)["more"]}, {"id": "prev", "title": t(s)["prev"]}]


def paging(s, choice):
	if choice == "more":
		s.page += 1
	elif choice == "prev":
		s.page -= 1
	else:
		return None
	return stay()


def normalize_phone(raw, country_code="254"):
	"""WhatsApp sends "254712345678"; Frappe users may have 0712…, +254 712…, 254712… or 712…."""
	d = re.sub(r"\D", "", str(raw or ""))
	if d.startswith("00"):
		d = d[2:]
	if len(d) == 10 and d.startswith("0"):
		d = country_code + d[1:]
	if len(d) == 9 and d[0] in "71":
		d = country_code + d
	return d


def format_phone(p):
	m = re.fullmatch(r"254(\d{3})(\d{3})(\d{3})", str(p))
	return f"+254 {m.group(1)} {m.group(2)} {m.group(3)}" if m else f"+{p}"


def nairobi_date(ts):
	"""YYYY-MM-DD in Kenya for an epoch time."""
	return datetime.fromtimestamp(ts, EAT).date().isoformat()


def parse_date(value, now):
	m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", str(value).strip())
	if not m:
		return None
	d, mo, y = (int(x) for x in m.groups())
	try:
		iso = date(y, mo, d).isoformat()
	except ValueError:
		return None
	if iso > nairobi_date(now) or iso < nairobi_date(now - 365 * 24 * HOUR):
		return None
	return iso


def show_date(iso):
	return "/".join(reversed(str(iso).split("-"))) if iso else "—"


def to_media(inp):
	return AttrDict(
		{k: inp.get(k) for k in ("kind", "media_id", "mime_type", "filename", "caption", "voice")}
	)


class State:
	def options(self, s, ctx):
		return []

	def prompt(self, s, ctx):
		raise NotImplementedError

	def on(self, s, inp, choice, ctx):
		return None


def split_text(body, limit=LIMITS["text"]):
	parts = []
	rest = str(body)
	while len(rest) > limit:
		cut = max(rest.rfind("\n\n", 0, limit + 2), rest.rfind("\n", 0, limit + 1))
		at = cut if cut > limit / 2 else limit
		parts.append(rest[:at].rstrip())
		rest = rest[at:].lstrip()
	return [p for p in [*parts, rest] if p]


def _call(ctx, hook, **kwargs):
	fn = getattr(ctx, hook, None)
	if fn:
		fn(**kwargs)


def _unique(values):
	return list(dict.fromkeys(values))


def whole_number(value):
	v = re.sub(r"[, ]", "", str(value).strip())
	return int(v) if re.fullmatch(r"\d{1,6}", v) else None


def attached_count(s):
	return len(s.draft.media) + len(s.draft.notes)


def media_ack(s, inp):
	media = t(s)["media"]
	return t(s)["mediaAdded"](media.get(inp.get("kind")) or media["document"], attached_count(s))


def ref_from(inp):
	m = (
		re.fullmatch(r"rpt[\s-]?(\d+)", (inp.get("text") or "").strip(), re.I)
		if inp["type"] == "text"
		else None
	)
	return f"RPT-{m.group(1).zfill(3)}" if m else None


def symptom_labels(ids, symptoms):
	labels = {x["name"]: x["label"] for x in symptoms}
	return ", ".join(labels.get(i, i) for i in ids)


def region_label(name, ctx):
	if not name:
		return "—"
	return next((r["label"] for r in ctx.data.catalog()["regions"] if r["name"] == name), name)


def sub_county_label(region, name, ctx):
	if not name:
		return "—"
	return next((x["label"] for x in ctx.data.sub_counties(region) if x["name"] == name), name)
