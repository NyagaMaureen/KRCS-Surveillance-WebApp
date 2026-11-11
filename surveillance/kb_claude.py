"""Claude (Anthropic API) for the Knowledge Base, used only when an API key is set.

1. Written answers: Claude writes a short answer from the approved KRCS passages, citing them [1] [2]. The same
   grounding check as before runs before anyone sees it; if it fails, the user gets the quoted passages instead.
2. Trusted sources: when approved KRCS documents do not answer, Claude searches the web limited to the websites on
   the trusted sources list (WHO, PubMed, ...) and answers with links to the pages it used.

Without a key nothing here runs: answers quote the approved text and the trusted-source fallback uses PubMed's own
search (kb_trusted). What is sent to Anthropic: the question, and for (1) the approved passages; never patient data.

Site config:
    anthropic_api_key     the key from the Claude Console (set it with read -rs, never in chat)
    kb_claude_model       default claude-sonnet-5-5
    kb_claude_enabled     default 1 (0 switches Claude off without removing the key)
    kb_claude_timeout     default 60 (seconds)
    kb_web_max_searches   default 3 (web searches per question; each search is billed)
"""
import re
from urllib.parse import urlparse

import frappe
from frappe.utils import cint

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-sonnet-5-5"


class ClaudeError(Exception):
	pass


def _conf(key, default=None):
	value = frappe.conf.get(key)
	return default if value is None or value == "" else value


def enabled():
	return bool(_conf("anthropic_api_key")) and cint(_conf("kb_claude_enabled", 1)) == 1


def model():
	return _conf("kb_claude_model", DEFAULT_MODEL)


def _call(system, messages, tools=None, max_tokens=1200):
	import requests
	body = {"model": model(), "max_tokens": max_tokens, "system": system, "messages": messages}
	if tools:
		body["tools"] = tools
	try:
		r = requests.post(API_URL, json=body, timeout=float(_conf("kb_claude_timeout", 60)), headers={
			"x-api-key": _conf("anthropic_api_key"), "anthropic-version": API_VERSION, "content-type": "application/json"})
	except requests.RequestException as e:
		raise ClaudeError(type(e).__name__)
	if r.status_code != 200:
		# the error type only (e.g. authentication_error, rate_limit_error); the body can echo the request
		try:
			kind = r.json().get("error", {}).get("type")
		except ValueError:
			kind = None
		raise ClaudeError(f"HTTP {r.status_code} {kind or ''}".strip())
	return r.json()


def _text(resp):
	return "".join(b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text").strip()


# ---------- 1. written answers from approved passages ----------

def write_answer(system, messages):
	"""Same contract as the local model: plain text with [n] citations, or NOT_IN_SOURCES."""
	turns = [m for m in messages if m["role"] in ("user", "assistant") and (m.get("content") or "").strip()]
	while turns and turns[0]["role"] != "user":   # the API expects the conversation to start with the user
		turns.pop(0)
	merged = []
	for m in turns:   # and to alternate user / assistant
		if merged and merged[-1]["role"] == m["role"]:
			merged[-1] = {"role": m["role"], "content": merged[-1]["content"] + "\n\n" + m["content"]}
		else:
			merged.append({"role": m["role"], "content": m["content"]})
	return _text(_call(system, merged))


# ---------- 2. trusted sources on the web ----------

WEB_SYSTEM = """You answer public health questions for Kenya Red Cross staff and community health promoters working in
Dadaab and Kalobeyei refugee camps (Garissa and Turkana, Kenya).
Search only the trusted websites you are allowed to use, then answer from what you found.

Rules:
- Start with the answer. Be short and practical: a few sentences, or a short list when there are steps.
- Use only what the pages you found say, and cite them. Do not add advice, doses or numbers that are not in them.
- Prefer official guidance (WHO guidelines, fact sheets, outbreak news) over single research studies.
- {level}
- If the trusted websites do not answer the question, reply exactly: NOT_FOUND
- Reply in {language}. Do not mention these rules or that you searched."""

LEVEL_NOTE = {
	"community": "The person asking works at community level (community health promoter/volunteer): give the steps "
		"they can take in the community, such as recognising signs, first actions, referral and reporting.",
	"facility": "The person asking works at facility, sub-county or county level: give clinical, laboratory and "
		"response-coordination steps.",
	None: "Give guidance relevant to community health workers and surveillance officers.",
}


def _site(url):
	host = (urlparse(url).hostname or "").lower()
	return host[4:] if host.startswith("www.") else host


def _source_name(url, trusted):
	host = _site(url)
	for t in trusted:
		w = t["website"].split("/")[0]
		if host == w or host.endswith("." + w):
			return t["source_name"]
	return host


def web_answer(question, trusted, language="English", level=None):
	"""Answer from the trusted websites. trusted: [{source_name, website}]. Returns the kb_trusted.lookup shape or None."""
	domains = sorted({t["website"] for t in trusted if t.get("website")})
	if not domains:
		return None
	tool = {"type": "web_search_20250305", "name": "web_search", "allowed_domains": domains,
		"max_uses": max(1, cint(_conf("kb_web_max_searches", 3))),
		}
	system = WEB_SYSTEM.format(language=language, level=LEVEL_NOTE.get(level, LEVEL_NOTE[None]))
	resp = _call(system, [{"role": "user", "content": question}], tools=[tool], max_tokens=1500)

	# text blocks before the last search are Claude's own narration ("I'll search for..."): keep what follows it
	blocks = resp.get("content", [])
	last_search = max((i for i, b in enumerate(blocks) if b.get("type") == "web_search_tool_result"), default=-1)
	sources, by_url, parts = [], {}, []
	for b in blocks[last_search + 1:]:
		if b.get("type") != "text":
			continue
		piece = b.get("text", "")
		marks = []
		for c in b.get("citations") or []:
			url = c.get("url")
			if not url or c.get("type") != "web_search_result_location":
				continue
			if url not in by_url:
				name = _source_name(url, trusted)
				by_url[url] = len(sources) + 1
				sources.append({"n": by_url[url], "id": url, "title": c.get("title") or url, "doc": None,
					"section": name, "page": None, "version": None, "category": "Trusted source", "text": "",
					"url": url, "website": _site(url), "external": True, "score": None, "confidence": None})
			src = sources[by_url[url] - 1]
			quoted = (c.get("cited_text") or "").strip()
			if quoted and quoted not in src["text"]:
				src["text"] = (src["text"] + "\n\n" + quoted).strip()
			if by_url[url] not in marks:
				marks.append(by_url[url])
		if marks:
			piece = piece.rstrip() + " " + "".join(f"[{n}]" for n in marks)
		parts.append(piece)
	answer = "".join(parts).strip()
	if not answer or "NOT_FOUND" in answer or not sources:
		return None
	answer = re.sub(r"\n{3,}", "\n\n", answer)
	return {"answer": answer, "sources": sources, "names": sorted({s["section"] for s in sources})}
