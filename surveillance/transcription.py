"""Voice notes to text, in the background (AI server speech-to-text, Whisper medium).

When a report (or a report update) has a voice note, a background job sends the audio to the AI server and saves
the text on the attachment row (Case Report Attachment: transcript, transcript_status, transcript_language).
The reporter is never kept waiting: the report is saved first, the text appears a minute or so later.
Officers read it, and can listen to the original, on the event's Signal captured step and on the report page.

Site config (set with read -rs, never in chat):
    stt_url      e.g. http://10.249.99.50:3100   (no stt_url: nothing is sent, voice notes stay audio only)
    stt_token    the token in ~/stt_token.txt on the AI server
Statuses: Queued -> Done | No speech | Failed (retried hourly, up to MAX_TRIES).
Only the audio file is sent; nothing else about the report or the reporter.
"""
import frappe
from frappe.utils import add_to_date, cint, now_datetime

CHILD = "Case Report Attachment"
MAX_TRIES = 3
TIMEOUT = 600   # a long voice note on a busy CPU can take several minutes


def enabled():
	return bool(frappe.conf.get("stt_url") and frappe.conf.get("stt_token"))


def queue_report(report):
	"""Queue every voice note on this report that has no transcript yet."""
	if not enabled():
		return 0
	rows = frappe.get_all(CHILD, filters={"parent": report, "parenttype": "Case Report", "attachment_type": "Voice Note",
		"file": ["is", "set"], "transcript_status": ["in", ["", None]]}, pluck="name")
	for name in rows:
		_queue(name)
	return len(rows)


def _queue(name):
	frappe.db.set_value(CHILD, name, "transcript_status", "Queued", update_modified=False)
	frappe.enqueue("surveillance.transcription.transcribe", queue="long", timeout=TIMEOUT + 60, name=name,
		job_id=f"stt-{name}", deduplicate=True, enqueue_after_commit=True)


def on_case_report(doc, method=None):
	"""Case Report on_update hook."""
	if any(r.attachment_type == "Voice Note" and r.file and not r.get("transcript_status") for r in doc.get("attachments") or []):
		queue_report(doc.name)


def transcribe(name):
	"""Background job: one voice note."""
	import requests
	row = frappe.db.get_value(CHILD, name, ["file", "transcript_tries"], as_dict=True)
	if not row or not row.file:
		return
	frappe.db.set_value(CHILD, name, "transcript_tries", cint(row.transcript_tries) + 1, update_modified=False)
	frappe.db.commit()
	try:
		file_name = frappe.db.get_value("File", {"file_url": row.file}, "name")
		if not file_name:
			raise FileNotFoundError(row.file)
		content = frappe.get_doc("File", file_name).get_content()
		if isinstance(content, str):
			content = content.encode()
		base = frappe.conf.get("stt_url").rstrip("/")
		r = requests.post(f"{base}/transcribe", files={"file": (row.file.rsplit("/", 1)[-1], content)},
			headers={"Authorization": f"Bearer {frappe.conf.get('stt_token')}"}, timeout=TIMEOUT)
		if r.status_code != 200:
			raise RuntimeError(f"speech-to-text returned {r.status_code}")
		out = r.json()
		text = (out.get("text") or "").strip()
		frappe.db.set_value(CHILD, name, {"transcript": text or None, "transcript_status": "Done" if text else "No speech",
			"transcript_language": out.get("language"), "transcribed_on": now_datetime()}, update_modified=False)
	except Exception as e:
		frappe.db.rollback()
		frappe.db.set_value(CHILD, name, "transcript_status", "Failed", update_modified=False)
		# the error type and the row only: never the audio or any text
		frappe.log_error(title="Voice note transcription failed", message=f"{name}: {type(e).__name__}: {str(e)[:200]}")
	frappe.db.commit()


def retry_failed():
	"""Hourly: queue again voice notes that failed (AI server down, timeout) or got stuck, up to MAX_TRIES."""
	if not enabled():
		return
	stuck = add_to_date(now_datetime(), hours=-2)
	rows = frappe.db.sql(f"""select name from `tab{CHILD}` where attachment_type='Voice Note' and ifnull(file,'')!=''
		and ifnull(transcript_tries,0) < %s and (transcript_status='Failed' or (transcript_status='Queued' and modified < %s)
		or (ifnull(transcript_status,'')='' and creation > %s))""", (MAX_TRIES, stuck, add_to_date(now_datetime(), days=-7)), pluck=True)
	for name in rows:
		_queue(name)


@frappe.whitelist(methods=["POST"])
def retry(name):
	"""Officer: try a voice note again (button on the event)."""
	from surveillance.capabilities import require_capability
	require_capability("act_on_events")
	if not enabled():
		frappe.throw("Speech-to-text is not set up on this site.")
	if frappe.db.get_value(CHILD, name, "attachment_type") != "Voice Note":
		frappe.throw("Not a voice note.")
	frappe.db.set_value(CHILD, name, "transcript_tries", 0, update_modified=False)
	_queue(name)
	return {"status": "Queued"}
