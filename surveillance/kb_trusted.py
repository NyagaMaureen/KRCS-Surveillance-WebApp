"""Trusted external sources (WHO, PubMed, ...) for the Knowledge Base.

Approved KRCS documents always come first. Only when they do not answer a question does ask() call lookup() here.
The reply names the source and links each article; the question is also logged for the supervisor, so gaps in the
KRCS documents can be filled.

Lookup today: sources of type "PubMed" are searched through NCBI's free E-utilities API (only the question text
is sent). Sources of type "Website" (WHO, Kenya MoH, ...) are kept in the list and used once Claude is connected,
restricted to exactly these websites.

Site config:
    kb_trusted_lookup   default 1 (0 switches the fallback off)
    ncbi_api_key        optional, raises PubMed's rate limit
"""
import re
import xml.etree.ElementTree as ET

import frappe
from frappe import _
from frappe.utils import cint

from surveillance.capabilities import require_capability

DOCTYPE = "KB Trusted Source"
CAPABILITY = "manage_knowledge_base"
KINDS = ("Website", "PubMed")
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
TIMEOUT = 6
MAX_RESULTS = 3
HUMANS = " NOT (animals[mh] NOT humans[mh]) NOT (mice[tiab] OR mouse[tiab] OR swine[tiab] OR pigs[tiab] OR cattle[tiab])"
REVIEWS = "guideline[pt] OR practice guideline[pt] OR review[pt] OR systematic review[pt] OR meta-analysis[pt]"

INTRO = {
	"English": "Here is what published research on {sources} says about this:",
	"Kiswahili": "Hivi ndivyo utafiti uliochapishwa kwenye {sources} unavyosema kuhusu hili:",
}

STOPWORDS = set("""a an and are as at be by can do does for from how i if in is it of on or should the there this to
we what when where which who why with you your my our me case cases patient patients immediate first next steps step
kuna nini vipi gani ya wa na kwa ni""".split())


# ---------- list management (Knowledge Base page, "Trusted sources" tab) ----------

def _clean_site(value):
	site = (value or "").strip().lower()
	site = re.sub(r"^https?://", "", site).split("/")[0]
	return site[4:] if site.startswith("www.") else site


def _row(d):
	return {"name": d.name, "sourceName": d.source_name, "website": d.website, "kind": d.kind,
		"enabled": bool(d.enabled), "notes": d.notes or "", "modified": str(d.modified)[:16]}


@frappe.whitelist()
def list_sources():
	require_capability(CAPABILITY)
	return [_row(frappe.get_doc(DOCTYPE, n)) for n in frappe.get_all(DOCTYPE, pluck="name", order_by="source_name asc")]


@frappe.whitelist(methods=["POST"])
def save_source(source_name, website, kind="Website", enabled=1, notes=None, name=None):
	require_capability(CAPABILITY)
	source_name, site = (source_name or "").strip(), _clean_site(website)
	if not source_name or not site:
		frappe.throw(_("Enter a name and a website."))
	if "." not in site:
		frappe.throw(_("Enter a website such as who.int or pubmed.ncbi.nlm.nih.gov."))
	if kind not in KINDS:
		frappe.throw(_("Type must be Website or PubMed."))
	doc = frappe.get_doc(DOCTYPE, name) if name else frappe.new_doc(DOCTYPE)
	doc.update({"source_name": source_name, "website": site, "kind": kind, "enabled": cint(enabled), "notes": notes or ""})
	doc.save(ignore_permissions=True)
	return _row(doc)


@frappe.whitelist(methods=["POST"])
def delete_source(name):
	require_capability(CAPABILITY)
	frappe.delete_doc(DOCTYPE, name, ignore_permissions=True)
	return {"ok": True}


def allowed_websites():
	"""Enabled sources, for Claude's web search later (allowed domains)."""
	return frappe.get_all(DOCTYPE, filters={"enabled": 1}, pluck="website")


# ---------- fallback look-up, called by knowledge_base.ask() ----------

def _search_terms(query, detected=None):
	words = [w for w in re.findall(r"[A-Za-z0-9-]+", query.lower()) if w not in STOPWORDS and len(w) > 1]
	terms = [" ".join(words)] if words else []
	if detected:
		name = re.sub(r"\(.*?\)", "", detected.get("name") or "")
		name = re.sub(r"^suspected\s+", "", name.strip(), flags=re.I).split("/")[0].strip()
		if name:
			rest = [w for w in words if w not in name.lower().split() and w != (detected.get("key") or "").lower()]
			terms = [f"{name} {' '.join(rest)}".strip()] + terms + [name]   # the disease name alone only as a last try
	seen, out = set(), []
	for t in terms:
		if t and t not in seen:
			seen.add(t)
			out.append(t)
	return out


def _first_sentences(text, limit=420):
	text = re.sub(r"\s+", " ", text or "").strip()
	parts = re.split(r"(?<=[.!?])\s+", text)
	out = ""
	for p in parts:
		if len(out) + len(p) > limit and out:
			break
		out = f"{out} {p}".strip()
	return out[:limit]


def _pubmed(source, query, detected):
	import requests
	common = {"db": "pubmed", "tool": "krcs_surveillance"}
	if frappe.conf.get("ncbi_api_key"):
		common["api_key"] = frappe.conf.get("ncbi_api_key")
	ids = []
	# people, not animal studies; reviews and guidelines first, then any study
	for term in _search_terms(query, detected):
		for extra in (f" AND ({REVIEWS})", ""):
			r = requests.get(f"{EUTILS}/esearch.fcgi", params={**common, "term": f"({term}){HUMANS}{extra}",
				"retmax": MAX_RESULTS * 3, "sort": "relevance", "retmode": "json"}, timeout=TIMEOUT)
			r.raise_for_status()
			ids = r.json().get("esearchresult", {}).get("idlist", [])
			if ids:
				break
		if ids:
			break
	if not ids:
		return []
	must = set()
	if detected:
		from surveillance.knowledge_base import _disease_terms
		must = {t for t in _disease_terms(detected) if " (" not in t}
		name = re.sub(r"\(.*?\)", "", detected.get("name") or "")
		for part in re.split(r"/", name):
			part = re.sub(r"^suspected\s+", "", part.strip(), flags=re.I).lower()
			if len(part) >= 3:
				must.add(part)
		must |= {t.replace("haem", "hem") for t in must}   # British and American spelling
	r = requests.get(f"{EUTILS}/efetch.fcgi", params={**common, "id": ",".join(ids), "retmode": "xml"}, timeout=TIMEOUT)
	r.raise_for_status()
	out = []
	for art in ET.fromstring(r.content).iter("PubmedArticle"):
		pmid = art.findtext(".//PMID")
		title = "".join(art.find(".//ArticleTitle").itertext()).strip() if art.find(".//ArticleTitle") is not None else ""
		parts = [(str(a.get("Label") or "").upper(), "".join(a.itertext()).strip()) for a in art.iter("AbstractText")]
		abstract = " ".join(t for _, t in parts if t)
		# the study's own conclusion is the most useful line for a reader; otherwise its opening sentences
		finding = next((t for lbl, t in parts if lbl.startswith(("CONCLUSION", "INTERPRETATION")) and t), "")
		year = art.findtext(".//JournalIssue/PubDate/Year") or ""
		title = title.strip()
		if title.startswith("[") and title.endswith(("]", "].")):
			title = title.strip("[].").strip()   # PubMed brackets translated titles; "[Not Available]" has none
		if not (pmid and title and abstract) or title.lower() == "not available":
			continue
		if must and not any(re.search(rf"(?<!\w){re.escape(t)}(?!\w)", f"{title} {abstract}".lower()) for t in must):
			continue   # does not mention the disease asked about
		out.append({"title": title, "text": abstract, "summary": _first_sentences(finding or abstract), "year": year,
			"url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/", "source": source.source_name, "website": source.website})
	return out[:MAX_RESULTS]


def lookup(query, language="English", detected=None, level=None):
	"""Answer from enabled trusted sources, or None. Never raises: on any error the caller falls back to no-match.
	With a Claude API key: Claude searches all enabled websites (WHO, PubMed, ...). Without one, or if that finds
	nothing: PubMed's own search for sources of type PubMed."""
	if not cint(frappe.conf.get("kb_trusted_lookup", 1)) or not frappe.db.exists("DocType", DOCTYPE):
		return None
	from surveillance import kb_claude
	if kb_claude.enabled():
		trusted = frappe.get_all(DOCTYPE, filters={"enabled": 1}, fields=["source_name", "website"])
		try:
			found = kb_claude.web_answer(query, trusted, language, level)
			if found:
				return found
		except Exception as e:
			frappe.log_error(title="Knowledge Base: Claude web search failed, using PubMed search", message=str(e)[:300])
	found = []
	for s in frappe.get_all(DOCTYPE, filters={"enabled": 1, "kind": "PubMed"}, fields=["source_name", "website"]):
		try:
			found += _pubmed(frappe._dict(s), query, detected)
		except Exception as e:
			frappe.log_error(title="Knowledge Base: trusted source look-up failed", message=f"{s['source_name']}: {type(e).__name__}")
	if not found:
		return None
	found = found[:MAX_RESULTS]
	names = sorted({f["source"] for f in found})
	sources = [{"n": i, "id": f["url"], "title": f["title"], "doc": None,
		"section": f["source"] + (" · " + f["year"] if f["year"] else ""),
		"page": None, "version": None, "category": "Trusted source", "text": f["text"], "url": f["url"],
		"website": f["website"], "external": True, "score": None, "confidence": None} for i, f in enumerate(found, 1)]
	blocks = [f"**{s['title'].rstrip('.')}**{' (' + f['year'] + ')' if f['year'] else ''}\n\n{f['summary']} [{s['n']}]"
		for s, f in zip(sources, found)]
	intro = INTRO.get(language, INTRO["English"]).format(sources=" and ".join(names))
	return {"answer": intro + "\n\n" + "\n\n".join(blocks), "sources": sources, "names": names}
