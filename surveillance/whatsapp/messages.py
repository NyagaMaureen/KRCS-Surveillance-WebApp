"""Outgoing message shapes and WhatsApp size limits.

A message is a plain dict, e.g. {"kind": "buttons", "body": ..., "buttons": [...]}; client.to_payload()
turns it into a Cloud API request. menu() picks reply buttons (<= 3) or a list (<= 10 rows).
sendable() is what jobs.process_event sends: the message cut to fit, or as plain text when it still doesn't.
"""

import re

LIMITS = {
	"text": 4096,
	"body": 1024,
	"max_buttons": 3,
	"button_title": 20,
	"list_button": 20,
	"max_rows": 10,
	"row_title": 24,
	"row_desc": 72,
	"section_title": 24,
	"header": 60,
	"footer": 60,
	"id": 256,
}

HEADER = re.compile(r"^\*([^*\n]+)\*(?: _\(([^)\n]+)\)_)?\n+(?=\S)")


def text(body):
	return {"kind": "text", "body": body}


def image(link):
	return {"kind": "image", "link": link}


def location_request(body):
	return {"kind": "location_request", "body": body}


def split_header(body):
	"""A leading "*Title*" line (optionally followed by " _(note)_") becomes the message header,
	which WhatsApp shows in bold above the body. Headers are plain text, so the markers are dropped."""
	m = HEADER.match(body)
	if not m:
		return None, body
	header = f"{m.group(1)} ({m.group(2)})" if m.group(2) else m.group(1)
	if len(header) > LIMITS["header"]:
		return None, body
	return header, body[m.end() :]


def menu(full_body, options, button="Choose an option", section="Options", footer=None):
	"""Reply buttons when they fit (<= 3, short titles, no descriptions), otherwise a list."""
	header, body = split_header(full_body)
	extra = {**({"header": header} if header else {}), **({"footer": footer} if footer else {})}
	fits_buttons = len(options) <= LIMITS["max_buttons"] and all(
		not o.get("desc") and len(o["title"]) <= LIMITS["button_title"] for o in options
	)
	if fits_buttons:
		return {
			"kind": "buttons",
			**extra,
			"body": body,
			"buttons": [{"id": o["id"], "title": o["title"]} for o in options],
		}
	rows = [
		{"id": o["id"], "title": o["title"], **({"description": o["desc"]} if o.get("desc") else {})}
		for o in options
	]
	return {
		"kind": "list",
		**extra,
		"body": body,
		"button": button,
		"sections": [{"title": section, "rows": rows}],
	}


def validate(msg):
	"""Problems with a message against WhatsApp's limits; an empty list means it can be sent."""
	problems = []

	def check(ok, what):
		if not ok:
			problems.append(what)

	if msg["kind"] == "text":
		check(len(msg["body"]) <= LIMITS["text"], f"text body > {LIMITS['text']}")
		return problems
	if msg["kind"] == "image":
		check((msg.get("link") or "").startswith("https://"), "image link must be https")
		return problems
	check(len(msg["body"]) <= LIMITS["body"], f"interactive body > {LIMITS['body']}: {msg['body'][:40]}…")
	check(
		not msg.get("header") or len(msg["header"]) <= LIMITS["header"],
		f'header too long: "{msg.get("header")}"',
	)
	check(
		not msg.get("footer") or len(msg["footer"]) <= LIMITS["footer"],
		f'footer too long: "{msg.get("footer")}"',
	)
	if msg["kind"] == "buttons":
		buttons = msg["buttons"]
		check(1 <= len(buttons) <= LIMITS["max_buttons"], "button count")
		check(len({b["id"] for b in buttons}) == len(buttons), "duplicate button ids")
		for b in buttons:
			check(len(b["title"]) <= LIMITS["button_title"], f'button title too long: "{b["title"]}"')
			check(len(b["id"]) <= LIMITS["id"], "button id too long")
	if msg["kind"] == "list":
		check(len(msg["button"]) <= LIMITS["list_button"], f'list button too long: "{msg["button"]}"')
		rows = [r for s in msg["sections"] for r in s["rows"]]
		check(1 <= len(rows) <= LIMITS["max_rows"], f"row count {len(rows)}")
		check(len({r["id"] for r in rows}) == len(rows), "duplicate row ids")
		for s in msg["sections"]:
			check(len(s["title"]) <= LIMITS["section_title"], f'section title too long: "{s["title"]}"')
		for r in rows:
			check(len(r["title"]) <= LIMITS["row_title"], f'row title too long: "{r["title"]}"')
			check(
				not r.get("description") or len(r["description"]) <= LIMITS["row_desc"],
				f'row description too long: "{r.get("description")}"',
			)
	return problems


def _cut(value, limit):
	value = value or ""
	return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def shorten(msg):
	"""The message with titles, descriptions, header and footer cut to WhatsApp's limits, so Meta doesn't
	refuse it. An interactive body that is too long goes first as its own text message."""
	if msg["kind"] not in ("buttons", "list"):
		return [msg]
	msg = dict(msg)
	before = []
	if len(msg["body"]) > LIMITS["body"]:
		before = [text(msg["body"])]
		msg["body"] = "👇"
	for k in ("header", "footer"):
		if msg.get(k):
			msg[k] = _cut(msg[k], LIMITS[k])
	if msg["kind"] == "buttons":
		msg["buttons"] = [{**b, "title": _cut(b["title"], LIMITS["button_title"])} for b in msg["buttons"]]
	else:
		msg["button"] = _cut(msg["button"], LIMITS["list_button"])
		msg["sections"] = [
			{
				"title": _cut(sec["title"], LIMITS["section_title"]),
				"rows": [
					{
						**r,
						"title": _cut(r["title"], LIMITS["row_title"]),
						**(
							{"description": _cut(r["description"], LIMITS["row_desc"])}
							if r.get("description")
							else {}
						),
					}
					for r in sec["rows"]
				],
			}
			for sec in msg["sections"]
		]
	return [*before, msg]


def options_of(msg):
	if msg["kind"] == "buttons":
		return [(b["title"], None) for b in msg["buttons"]]
	if msg["kind"] == "list":
		return [(r["title"], r.get("description")) for s in msg["sections"] for r in s["rows"]]
	return []


def as_text(msg, hint="Reply with the number of your choice."):
	"""A menu as numbered plain text. The conversation accepts a typed number for the rows it last showed
	(core.resolve_choice), so the person can still answer."""
	lines = [x for x in (f"*{msg['header']}*" if msg.get("header") else None, msg.get("body")) if x]
	options = options_of(msg)
	if options:
		lines.append("\n".join(f"{i}. {t}" + (f" ({d})" if d else "") for i, (t, d) in enumerate(options, 1)))
		lines.append(f"_{hint}_")
	body = "\n\n".join(lines)
	limit = LIMITS["text"]
	return [text(body[i : i + limit]) for i in range(0, len(body), limit)] or [text("…")]


def sendable(msg, **hint):
	"""What to send for one reply: the message cut to fit, or plain text when it would still be refused."""
	parts = shorten(msg)
	if all(not validate(m) for m in parts):
		return parts
	return as_text(msg, **hint) if msg["kind"] in ("text", "buttons", "list") else parts
