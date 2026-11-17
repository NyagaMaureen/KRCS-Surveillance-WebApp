"""WhatsApp free-text reports (KRCS 17 Nov 2026): Additional Notes keep only what the reporter wrote. For reports already
saved, the "WhatsApp free-text report ... Message: ... Filled in from the message: ..." block becomes just the message;
the rest moves to extraction_details (Filled in from the WhatsApp message). Safe to run again."""
import re

import frappe

START = "WhatsApp free-text report ("
AFTER = re.compile(r'"\n(?:Filled in from the message: |Asked as follow-up questions: |Category: |Deaths: |'
	r'Danger signs mentioned: |Disease named by the reporter: |Note: )')


def split(notes):
	"""(new notes, extraction block) or None when the notes have no extraction block."""
	i = (notes or "").find(START)
	if i < 0:
		return None
	block = notes[i:]
	m = block.find('Message: "')
	if m < 0:
		return None
	body = block[m + len('Message: "'):]
	end = AFTER.search(body)
	message = body[:end.start()] if end else body.rstrip().removesuffix('"')
	before = notes[:i].strip()
	return "\n\n".join(x for x in [message.strip(), before] if x), block.strip()


def execute():
	if not frappe.db.has_column("Case Report", "extraction_details"):
		return
	rows = frappe.get_all("Case Report", filters={"channel": "WhatsApp", "additional_notes": ["like", f"%{START}%"]},
		fields=["name", "additional_notes", "extraction_details"], limit_page_length=0)
	n = 0
	for r in rows:
		got = split(r.additional_notes)
		if not got:
			continue
		notes, block = got
		frappe.db.set_value("Case Report", r.name, {"additional_notes": notes or None,
			"extraction_details": r.extraction_details or block}, update_modified=False)
		n += 1
	frappe.db.commit()
	print(f"WhatsApp reports: Additional Notes now show only the message on {n} report(s)")
