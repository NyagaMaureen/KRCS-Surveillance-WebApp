"""Outgoing message shapes and WhatsApp size limits.

A message is a plain dict, e.g. {"kind": "buttons", "body": ..., "buttons": [...]}; client.to_payload()
turns it into a Cloud API request. menu() picks reply buttons (<= 3) or a list (<= 10 rows).
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
