"""AI Knowledge Base: upload KRCS documents, extract text, chunk, embed and store vectors in Qdrant.

Flow: upload file -> Knowledge Document (status Processing, approval Draft) -> background job:
      extract sections -> split into chunks -> embed locally (fastembed, nothing leaves the server)
      -> upsert into Qdrant (one point per chunk) -> status Indexed with chunk count.
An approver then sets approval to Approved; only Approved documents are searchable by non-editors,
filtered by audience role (applied_to). Approval, audience and diseases are copied onto every
chunk's payload and kept in sync without re-indexing.

Search contract (used by the AI Data Assistant page and the chatbot): see search() and get_passage().

Site config (bench --site <site> set-config <key> <value>):
    qdrant_url            default http://localhost:6333
    kb_score_high         default 0.60  (score at or above = confidence "high")
    kb_score_low          default 0.45  (score below = confidence "low")
    qdrant_api_key        optional
    kb_collection         default krcs_knowledge_base
    kb_embedding_model    default sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
"""
import os
import re
import time
import uuid

import frappe
from frappe import _
from frappe.utils import cint, getdate, now_datetime, today

from surveillance.capabilities import has_capability, require_capability

DOCTYPE = "Knowledge Document"
CAPABILITY = "manage_knowledge_base"
APPROVE_CAPABILITY = "approve_knowledge_base"
SEARCH_CAPABILITY = "use_knowledge_base"
SERVICE_CAPABILITY = "kb_service"
APPROVAL_STATUSES = ("Draft", "Approved", "Retired")
ALL_ROLES = "All roles"
ALL_REGIONS = "All regions"
LANGUAGES = ("English", "Kiswahili")
LANGUAGE_BOOST = 0.05   # added to the score of passages in the asker's language when ranking
MAX_LIMIT = 20
ALLOWED_EXTENSIONS = {"pdf", "docx", "txt", "md"}
MAX_BYTES = 25 * 1024 * 1024
CHUNK_CHARS = 1000
CHUNK_OVERLAP = 150
DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"  # English + Kiswahili
INDEXED_FIELDS = ("doc", "category", "approval_status", "applied_to", "diseases", "regions", "language")

_model = None


class KBUnavailable(frappe.ValidationError):
	"""Qdrant or the embedding model is not reachable. Returned as HTTP 503."""
	http_status_code = 503


# ---------- clients ----------

def _conf(key, default=None):
	return frappe.conf.get(key) or default


def _collection():
	return _conf("kb_collection", "krcs_knowledge_base")


def _qdrant():
	from qdrant_client import QdrantClient
	return QdrantClient(url=_conf("qdrant_url", "http://localhost:6333"), api_key=_conf("qdrant_api_key"), timeout=60)


def _embedder():
	global _model
	if _model is None:
		from fastembed import TextEmbedding
		cache = os.path.join(frappe.get_site_path(), "private", "fastembed_cache")
		_model = TextEmbedding(model_name=_conf("kb_embedding_model", DEFAULT_MODEL), cache_dir=cache)
	return _model


def embed(texts):
	return [list(map(float, v)) for v in _embedder().embed(texts)]


def _ensure_collection(client, size):
	from qdrant_client.models import Distance, PayloadSchemaType, VectorParams
	name = _collection()
	if not client.collection_exists(name):
		client.create_collection(name, vectors_config=VectorParams(size=size, distance=Distance.COSINE))
	for field in INDEXED_FIELDS:  # also adds new indexes to an existing collection
		try:
			client.create_payload_index(name, field_name=field, field_schema=PayloadSchemaType.KEYWORD)
		except Exception:
			pass
	return name


def _doc_filter(docname):
	from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue
	return FilterSelector(filter=Filter(must=[FieldCondition(key="doc", match=MatchValue(value=docname))]))


def _delete_vectors(client, docname):
	if client.collection_exists(_collection()):
		client.delete(_collection(), points_selector=_doc_filter(docname))


# ---------- access fields ----------

def _split(value):
	if isinstance(value, str) and value.strip().startswith("["):
		value = frappe.parse_json(value)
	if isinstance(value, (list, tuple)):
		return [str(v).strip() for v in value if str(v).strip()]
	return [v.strip() for v in (value or "").split(",") if v.strip()]


def _clean_diseases(value):
	from surveillance.case_definitions import get_disease_options
	keys = _split(value)
	valid = {d["key"] for d in get_disease_options()}
	unknown = [k for k in keys if k not in valid]
	if unknown:
		frappe.throw(_("Unknown disease key(s): {0}").format(", ".join(unknown)))
	return ", ".join(keys)


def _access_payload(doc):
	"""Fields used for filtering and citation; updated on every chunk without re-indexing."""
	return {
		"approval_status": doc.get("approval_status") or "Draft",
		"applied_to": _split(doc.applied_to) or [ALL_ROLES],
		"diseases": _split(doc.get("diseases")),
		"regions": _split(doc.get("regions")) or [ALL_REGIONS],
		"language": doc.get("language") or "English",
		"review_date": str(doc.review_date) if doc.get("review_date") else None,
		"expiry_date": str(doc.expiry_date) if doc.get("expiry_date") else None,
		"version": doc.version,
		"category": doc.category,
	}


def _clean_regions(value):
	regions = [r for r in _split(value) if r != ALL_REGIONS]
	valid = set(frappe.get_all("Region", pluck="name"))
	unknown = [r for r in regions if r not in valid]
	if unknown:
		frappe.throw(_("Unknown region(s): {0}").format(", ".join(unknown)))
	return ", ".join(regions) or ALL_REGIONS


def _check_dates(doc):
	if doc.get("language") and doc.language not in LANGUAGES:
		frappe.throw(_("Language must be one of: {0}").format(", ".join(LANGUAGES)))
	if doc.get("review_date") and doc.get("expiry_date") and getdate(doc.review_date) > getdate(doc.expiry_date):
		frappe.throw(_("Review date must be on or before the expiry date."))


def _sync_access(doc):
	"""Copy approval, audience and diseases onto every chunk of this document. No re-embedding."""
	try:
		client = _qdrant()
		if client.collection_exists(_collection()):
			client.set_payload(_collection(), payload=_access_payload(doc), points=_doc_filter(doc.name))
	except Exception:
		frappe.log_error(title=f"Knowledge Base: access sync failed for {doc.name}")


# ---------- text extraction and chunking ----------

def extract_units(path, ext):
	"""return [{section, page, text}] so every chunk can be cited.
	PDF: one unit per page. DOCX: one per heading section, one per table row (named by its first cell).
	TXT/MD: one per # heading."""
	units = []
	if ext == "pdf":
		from pypdf import PdfReader
		for i, page in enumerate(PdfReader(path).pages, 1):
			t = (page.extract_text() or "").strip()
			if t:
				units.append({"section": f"Page {i}", "page": i, "text": t})
		return units

	if ext == "docx":
		import docx
		from docx.table import Table
		from docx.text.paragraph import Paragraph
		d = docx.Document(path)
		state = {"heading": "", "buf": []}

		def flush():
			if state["buf"]:
				units.append({"section": state["heading"] or "Introduction", "page": None, "text": "\n".join(state["buf"])})
				state["buf"] = []

		for el in d.element.body.iterchildren():
			tag = el.tag.split("}")[-1]
			if tag == "p":
				p = Paragraph(el, d)
				t = p.text.strip()
				if not t:
					continue
				style = (p.style.name if p.style is not None else "").lower()
				if style.startswith(("heading", "title")):
					flush()
					state["heading"] = t
				else:
					state["buf"].append(t)
			elif tag == "tbl":
				flush()
				rows = Table(el, d).rows
				if not rows:
					continue
				header = [c.text.strip() for c in rows[0].cells]
				for r in rows[1:]:
					lines, seen = [], set()
					for h, c in zip(header, r.cells):
						t = c.text.strip()
						if t and t not in seen:  # merged cells repeat their text
							seen.add(t)
							lines.append(f"{h}: {t}" if h and h != t else t)
					if lines:
						first = r.cells[0].text.strip()
						units.append({"section": (first or state["heading"] or "Table")[:140], "page": None, "text": "\n".join(lines)})
		flush()
		return units

	with open(path, encoding="utf-8", errors="ignore") as f:
		heading, buf = "", []
		for line in f:
			if line.startswith("#"):
				if "".join(buf).strip():
					units.append({"section": heading or "Introduction", "page": None, "text": "".join(buf).strip()})
				buf, heading = [], line.lstrip("#").strip()
			else:
				buf.append(line)
		if "".join(buf).strip():
			units.append({"section": heading or "Introduction", "page": None, "text": "".join(buf).strip()})
	return units


def chunk_text(text, size=CHUNK_CHARS, overlap=CHUNK_OVERLAP):
	"""Split on paragraphs, pack paragraphs into ~size character chunks with a small overlap."""
	paras = [p.strip() for p in text.replace("\r", "").split("\n") if p.strip()]
	chunks, current = [], ""
	for p in paras:
		while len(p) > size:  # very long paragraph: hard split
			if current:
				chunks.append(current)
				current = ""
			chunks.append(p[:size])
			p = p[size - overlap:]
		if len(current) + len(p) + 1 > size and current:
			chunks.append(current)
			current = current[-overlap:] + "\n" + p
		else:
			current = f"{current}\n{p}" if current else p
	if current.strip():
		chunks.append(current)
	return chunks


# ---------- background job ----------

def index_document(docname):
	"""Background job: (re)build all vectors for one Knowledge Document."""
	from qdrant_client.models import PointStruct
	doc = frappe.get_doc(DOCTYPE, docname)
	try:
		path = frappe.get_doc("File", {"file_url": doc.file}).get_full_path()
		chunks = [{**u, "text": piece} for u in extract_units(path, doc.extension) for piece in chunk_text(u["text"])]
		if not chunks:
			raise ValueError("No readable text found. Scanned PDFs need OCR before upload.")
		client = _qdrant()
		_delete_vectors(client, docname)
		access = _access_payload(doc)
		batch = 64
		for start in range(0, len(chunks), batch):
			part = chunks[start:start + batch]
			vectors = embed([c["text"] for c in part])
			collection = _ensure_collection(client, len(vectors[0]))
			client.upsert(collection, points=[
				PointStruct(
					id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{docname}:{start + i}")),
					vector=v,
					payload={"doc": docname, "title": doc.title, "category": doc.category, "version": doc.version,
						"chunk": start + i, "section": c["section"], "page": c["page"], "text": c["text"], **access},
				) for i, (c, v) in enumerate(zip(part, vectors))
			])
		doc.db_set({"status": "Indexed", "chunks": len(chunks), "error": ""})
	except Exception as e:
		frappe.db.rollback()
		frappe.log_error(title=f"Knowledge Base indexing failed: {docname}")
		frappe.db.set_value(DOCTYPE, docname, {"status": "Failed", "chunks": 0, "error": str(e)[:500]})
	frappe.db.commit()
	frappe.publish_realtime("kb_document_updated", {"name": docname}, after_commit=True)


def _enqueue(docname):
	frappe.enqueue("surveillance.knowledge_base.index_document", queue="long", timeout=1800,
		docname=docname, enqueue_after_commit=True, job_id=f"kb-index-{docname}", deduplicate=True)


# ---------- API ----------

def _row(d):
	return {
		"id": d.name, "name": d.title, "extension": (d.extension or "").upper(), "version": d.version,
		"category": d.category, "appliedTo": _split(d.applied_to),
		"diseases": _split(d.get("diseases")),
		"regions": _split(d.get("regions")) or [ALL_REGIONS],
		"language": d.get("language") or "English",
		"reviewDate": str(d.review_date) if d.get("review_date") else None,
		"expiryDate": str(d.expiry_date) if d.get("expiry_date") else None,
		"approvalStatus": (d.get("approval_status") or "Draft").lower(),
		"approvedBy": frappe.utils.get_fullname(d.approved_by) if d.get("approved_by") else None,
		"approvedAt": str(d.approved_on) if d.get("approved_on") else None,
		"sizeBytes": cint(d.size_bytes), "status": (d.status or "").lower(), "chunks": cint(d.chunks),
		"error": d.error, "uploadedBy": frappe.utils.get_fullname(d.owner), "uploadedAt": str(d.creation),
	}


@frappe.whitelist()
def list_documents():
	if not (has_capability(CAPABILITY) or has_capability(APPROVE_CAPABILITY)):
		require_capability(CAPABILITY)
	return [_row(d) for d in frappe.get_all(DOCTYPE, fields=["*"], order_by="creation desc")]


@frappe.whitelist(methods=["POST"])
def create_document(file_url, category, applied_to=None, version="v1.0", diseases=None,
		regions=None, language="English", review_date=None, expiry_date=None):
	"""Register an already uploaded file (via /api/method/upload_file) and queue indexing. Starts as Draft."""
	require_capability(CAPABILITY)
	f = frappe.get_doc("File", {"file_url": file_url})
	ext = (f.file_name.rsplit(".", 1)[-1] if "." in f.file_name else "").lower()
	if ext not in ALLOWED_EXTENSIONS:
		frappe.throw(_("Only PDF, DOCX, TXT and MD files are supported."))
	if cint(f.file_size) > MAX_BYTES:
		frappe.throw(_("File is larger than 25 MB."))
	doc = frappe.get_doc({
		"doctype": DOCTYPE, "title": f.file_name, "file": file_url, "extension": ext,
		"version": version or "v1.0", "category": category, "applied_to": ", ".join(_split(applied_to)) or ALL_ROLES,
		"diseases": _clean_diseases(diseases), "approval_status": "Draft",
		"regions": _clean_regions(regions), "language": language or "English",
		"review_date": review_date or None, "expiry_date": expiry_date or None,
		"size_bytes": cint(f.file_size), "status": "Processing",
	})
	_check_dates(doc)
	doc.insert(ignore_permissions=True)
	f.db_set({"attached_to_doctype": DOCTYPE, "attached_to_name": doc.name})
	_enqueue(doc.name)
	return _row(doc)


@frappe.whitelist(methods=["POST"])
def update_document(name, category=None, applied_to=None, diseases=None, version=None,
		regions=None, language=None, review_date=None, expiry_date=None):
	"""Edit document details. Everything is copied to Qdrant without re-embedding."""
	require_capability(CAPABILITY)
	doc = frappe.get_doc(DOCTYPE, name)
	if category is not None:
		doc.category = category
	if version is not None:
		doc.version = version
	if applied_to is not None:
		doc.applied_to = ", ".join(_split(applied_to)) or ALL_ROLES
	if diseases is not None:
		doc.diseases = _clean_diseases(diseases)
	if regions is not None:
		doc.regions = _clean_regions(regions)
	if language is not None:
		doc.language = language or "English"
	if review_date is not None:
		doc.review_date = review_date or None
	if expiry_date is not None:
		doc.expiry_date = expiry_date or None
	_check_dates(doc)
	doc.save(ignore_permissions=True)
	_sync_access(doc)
	return _row(doc)


@frappe.whitelist(methods=["POST"])
def set_approval(name, status):
	"""approve, retire or send back to draft. Only Approved documents are searchable."""
	require_capability(APPROVE_CAPABILITY)
	if status not in APPROVAL_STATUSES:
		frappe.throw(_("Status must be one of: {0}").format(", ".join(APPROVAL_STATUSES)))
	doc = frappe.get_doc(DOCTYPE, name)
	if status == "Approved" and doc.status != "Indexed":
		frappe.throw(_("Only an indexed document can be approved. Wait for indexing to finish."))
	doc.approval_status = status
	if status == "Approved":
		doc.approved_by = frappe.session.user
		doc.approved_on = now_datetime()
	doc.save(ignore_permissions=True)
	_sync_access(doc)
	return _row(doc)


@frappe.whitelist(methods=["POST"])
def reindex_document(name):
	require_capability(CAPABILITY)
	frappe.db.set_value(DOCTYPE, name, {"status": "Processing", "chunks": 0, "error": ""})
	_enqueue(name)
	return _row(frappe.get_doc(DOCTYPE, name))

def reindex_all():
	"""Queue indexing for every Knowledge Document. Use after Qdrant data is lost or the model changes.

	bench --site <site> execute surveillance.knowledge_base.reindex_all
	"""
	names = frappe.get_all(DOCTYPE, pluck="name")
	for name in names:
		frappe.db.set_value(DOCTYPE, name, {"status": "Processing", "chunks": 0, "error": ""})
		_enqueue(name)
	frappe.db.commit()
	print(f"Queued {len(names)} documents for indexing")
	return len(names)


@frappe.whitelist(methods=["POST"])
def delete_document(name):
	require_capability(CAPABILITY)
	doc = frappe.get_doc(DOCTYPE, name)
	try:
		_delete_vectors(_qdrant(), name)
	except Exception:
		frappe.log_error(title=f"Knowledge Base: could not delete vectors for {name}")
	file_name = frappe.db.get_value("File", {"file_url": doc.file})
	doc.delete(ignore_permissions=True)
	if file_name:
		frappe.delete_doc("File", file_name, ignore_permissions=True)
	return {"deleted": name}


# ---------- search contract ----------
#
# GET /api/method/surveillance.knowledge_base.search
#     query     required, the question (English or Kiswahili)
#     audience  role or comma-separated roles of the person asking (chatbot service / editors only)
#     region    region or comma-separated regions (chatbot service / editors only); others use their assigned region
#     language  "English" or "Kiswahili": passages in that language are ranked first when relevant
#     disease   disease key filter (see get_disease_vocabulary); category; limit (1-20, default 5)
#     include_drafts=1  editors only
# Returns {"query", "count", "results": [...], "detected_disease", "score_range", "confidence_thresholds", "took_ms"}
# Each result: id, score (cosine similarity 0-1, higher = closer), confidence (high|medium|low), text (verbatim),
#     title, doc, version, category, section, page, chunk, diseases (always a list), regions (list), language,
#     review_date, expiry_date, approval_status.
# Errors: empty query or unknown audience/region -> 417; no permission -> 403; passage not found -> 404;
#     knowledge base unavailable -> 503. Zero matches -> 200 with "results": [].

def _thresholds():
	return {"high": float(_conf("kb_score_high", 0.60)), "low": float(_conf("kb_score_low", 0.45))}


def _confidence(score, t):
	return "high" if score >= t["high"] else ("medium" if score >= t["low"] else "low")


def _assigned_region(user):
	if frappe.get_meta("User").has_field("assigned_region"):
		return frappe.db.get_value("User", user, "assigned_region")
	return None


def _access_context(audience=None, region=None, include_drafts=0):
	"""Who is asking and what they may see. Raises 403/417 on bad requests."""
	is_editor = has_capability(CAPABILITY)
	if not is_editor:
		require_capability(SEARCH_CAPABILITY)
	can_proxy = is_editor or has_capability(SERVICE_CAPABILITY)
	if (audience or region) and not can_proxy:
		frappe.throw(_("You cannot search on behalf of another role or region."), frappe.PermissionError)

	if audience:
		roles = _split(audience)
		valid = set(frappe.get_all("Surveillance Role", pluck="name"))
		unknown = [r for r in roles if r not in valid and r != ALL_ROLES]
		if unknown:
			frappe.throw(_("Unknown audience role(s): {0}").format(", ".join(unknown)))
	elif is_editor:
		roles = None  # editors see every audience
	else:
		role = frappe.db.get_value("User", frappe.session.user, "primary_role")
		roles = [role] if role else []

	if region:
		regions = [r for r in _split(region) if r != ALL_REGIONS]
		valid = set(frappe.get_all("Region", pluck="name"))
		unknown = [r for r in regions if r not in valid]
		if unknown:
			frappe.throw(_("Unknown region(s): {0}").format(", ".join(unknown)))
	elif is_editor:
		regions = None
	else:
		r = _assigned_region(frappe.session.user)
		regions = [r] if r else None  # no assigned region = national user, sees every region

	return {"approved_only": not (is_editor and cint(include_drafts)), "roles": roles, "regions": regions}


def _filter(ctx, category=None, disease=None):
	from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue
	must = []
	if ctx["approved_only"]:
		must.append(FieldCondition(key="approval_status", match=MatchValue(value="Approved")))
	if ctx["roles"] is not None:
		must.append(FieldCondition(key="applied_to", match=MatchAny(any=[ALL_ROLES] + ctx["roles"])))
	if ctx["regions"] is not None:
		must.append(FieldCondition(key="regions", match=MatchAny(any=[ALL_REGIONS] + ctx["regions"])))
	if category:
		must.append(FieldCondition(key="category", match=MatchValue(value=category)))
	if disease:
		must.append(FieldCondition(key="diseases", match=MatchValue(value=disease)))
	return Filter(must=must) if must else None


def _visible(payload, ctx):
	"""Same rules as _filter, for a single passage fetched by id."""
	if ctx["approved_only"] and payload.get("approval_status") != "Approved":
		return False
	if ctx["roles"] is not None and not ({ALL_ROLES, *ctx["roles"]} & set(payload.get("applied_to") or [ALL_ROLES])):
		return False
	if ctx["regions"] is not None and not ({ALL_REGIONS, *ctx["regions"]} & set(payload.get("regions") or [ALL_REGIONS])):
		return False
	return not _expired(payload)


def _expired(payload):
	return bool(payload.get("expiry_date")) and payload["expiry_date"] < today()


def _result(point_id, score, p, t):
	return {
		"id": str(point_id),
		"score": round(float(score), 3),
		"confidence": _confidence(float(score), t),
		"text": p.get("text"),
		"title": p.get("title"),
		"doc": p.get("doc"),
		"version": p.get("version"),
		"category": p.get("category"),
		"section": p.get("section"),
		"page": p.get("page"),
		"chunk": p.get("chunk"),
		"diseases": list(p.get("diseases") or []),
		"regions": list(p.get("regions") or [ALL_REGIONS]),
		"language": p.get("language") or "English",
		"review_date": p.get("review_date"),
		"expiry_date": p.get("expiry_date"),
		"approval_status": p.get("approval_status"),
	}


def _vocabulary():
	meta = frappe.get_meta("Alert Threshold Config")
	fields = ["name", "disease_name"] + (["synonyms"] if meta.has_field("synonyms") else [])
	out = []
	for d in frappe.get_all("Alert Threshold Config", filters={"is_active": 1}, fields=fields):
		out.append({"key": d.name, "name": d.disease_name, "synonyms": _split(d.get("synonyms"))})
	return out


def _detect_disease(query):
	"""Find a disease named in the question by key, name or synonym (e.g. 'kipindupindu' -> awd-cholera)."""
	text = query.lower()
	for d in _vocabulary():
		for term in [d["key"], d["name"], *d["synonyms"]]:
			term = (term or "").strip().lower()
			if len(term) >= 3 and re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text):
				return d
	return None


def _client():
	try:
		client = _qdrant()
		client.get_collections()
		return client
	except Exception:
		frappe.log_error(title="Knowledge Base: Qdrant unreachable")
		frappe.throw(_("The knowledge base is temporarily unavailable. Please try again shortly."), KBUnavailable)


@frappe.whitelist()
def search(query, limit=5, category=None, disease=None, audience=None, region=None, language=None, include_drafts=0):
	"""Semantic search over approved, unexpired passages the asker may see. Passages are returned verbatim."""
	started = time.monotonic()
	ctx = _access_context(audience, region, include_drafts)
	query = (query or "").strip()
	if not query:
		frappe.throw(_("Query is empty."))
	if language and language not in LANGUAGES:
		frappe.throw(_("Language must be one of: {0}").format(", ".join(LANGUAGES)))
	limit = max(1, min(cint(limit) or 5, MAX_LIMIT))
	t = _thresholds()

	detected = _detect_disease(query)
	expanded = f"{query} ({detected['name']})" if detected else query  # helps match synonyms like "kipindupindu"

	client = _client()
	results = []
	if client.collection_exists(_collection()):
		try:
			hits = client.query_points(_collection(), query=embed([expanded])[0], limit=limit * 3,
				query_filter=_filter(ctx, category, disease), with_payload=True).points
		except Exception:
			frappe.log_error(title="Knowledge Base: search failed")
			frappe.throw(_("The knowledge base is temporarily unavailable. Please try again shortly."), KBUnavailable)
		ranked = []
		for h in hits:
			if _expired(h.payload):
				continue
			boost = LANGUAGE_BOOST if language and h.payload.get("language") == language else 0
			ranked.append((h.score + boost, _result(h.id, h.score, h.payload, t)))
		ranked.sort(key=lambda x: -x[0])
		results = [r for _, r in ranked[:limit]]

	return {
		"query": query,
		"count": len(results),
		"results": results,
		"detected_disease": {"key": detected["key"], "name": detected["name"]} if detected else None,
		"score_range": [0, 1],
		"confidence_thresholds": t,
		"took_ms": int((time.monotonic() - started) * 1000),
	}


@frappe.whitelist()
def get_passage(id, audience=None, region=None):
	"""Fetch one passage by the id returned from search, with the same access rules."""
	ctx = _access_context(audience, region)
	client = _client()
	points = []
	if client.collection_exists(_collection()):
		points = client.retrieve(_collection(), ids=[id], with_payload=True)
	if not points or not _visible(points[0].payload, ctx):
		frappe.throw(_("Passage not found or not available for this audience."), frappe.DoesNotExistError)
	return _result(points[0].id, 1.0, points[0].payload, _thresholds()) | {"score": None, "confidence": None}


@frappe.whitelist()
def get_disease_vocabulary():
	"""Disease keys, display names and synonyms (editable in Alert Threshold Config) for the chatbot."""
	if not (has_capability(CAPABILITY) or has_capability(SEARCH_CAPABILITY)):
		require_capability(SEARCH_CAPABILITY)
	return _vocabulary()


def retire_expired():
	"""Daily: move Approved documents past their expiry date to Retired (search also hides them immediately)."""
	names = frappe.get_all(DOCTYPE, filters={"approval_status": "Approved", "expiry_date": ["<", today()]}, pluck="name")
	for name in names:
		doc = frappe.get_doc(DOCTYPE, name)
		doc.approval_status = "Retired"
		doc.save(ignore_permissions=True)
		doc.add_comment("Comment", "Retired automatically: expiry date passed.")
		_sync_access(doc)
	frappe.db.commit()
	return len(names)