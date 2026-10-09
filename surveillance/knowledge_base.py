"""AI Knowledge Base: upload KRCS documents, extract text, chunk, embed and store vectors in Qdrant.

Flow: upload file -> Knowledge Document (status Processing, approval Draft) -> background job:
      extract sections -> split into chunks -> embed locally (fastembed, nothing leaves the server)
      -> upsert into Qdrant (one point per chunk) -> status Indexed with chunk count.
An approver then sets approval to Approved; only Approved documents are searchable by non-editors,
filtered by audience role (applied_to). Approval, audience and diseases are copied onto every
chunk's payload and kept in sync without re-indexing.

Site config (bench --site <site> set-config <key> <value>):
    qdrant_url            default http://localhost:6333
    qdrant_api_key        optional
    kb_collection         default krcs_knowledge_base
    kb_embedding_model    default sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
"""
import os
import uuid

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from surveillance.capabilities import has_capability, require_capability

DOCTYPE = "Knowledge Document"
CAPABILITY = "manage_knowledge_base"
APPROVE_CAPABILITY = "approve_knowledge_base"  # NEW
SEARCH_CAPABILITY = "use_knowledge_base"  # NEW
SERVICE_CAPABILITY = "kb_service"  # NEW
APPROVAL_STATUSES = ("Draft", "Approved", "Retired")  # NEW
ALL_ROLES = "All roles"  # NEW
ALLOWED_EXTENSIONS = {"pdf", "docx", "txt", "md"}
MAX_BYTES = 25 * 1024 * 1024
CHUNK_CHARS = 1000
CHUNK_OVERLAP = 150
DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"  # English + Kiswahili
INDEXED_FIELDS = ("doc", "category", "approval_status", "applied_to", "diseases")  # NEW

_model = None


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
	for field in INDEXED_FIELDS:  # NEW: also adds the new indexes to an existing collection
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


# ---------- access fields (NEW) ----------

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
	return {
		"approval_status": doc.get("approval_status") or "Draft",
		"applied_to": _split(doc.applied_to) or [ALL_ROLES],
		"diseases": _split(doc.get("diseases")),
	}


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
	"""NEW: return [{section, page, text}] so every chunk can be cited.
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
		"diseases": _split(d.get("diseases")),  # NEW
		"approvalStatus": (d.get("approval_status") or "Draft").lower(),  # NEW
		"approvedBy": frappe.utils.get_fullname(d.approved_by) if d.get("approved_by") else None,  # NEW
		"approvedAt": str(d.approved_on) if d.get("approved_on") else None,  # NEW
		"sizeBytes": cint(d.size_bytes), "status": (d.status or "").lower(), "chunks": cint(d.chunks),
		"error": d.error, "uploadedBy": frappe.utils.get_fullname(d.owner), "uploadedAt": str(d.creation),
	}


@frappe.whitelist()
def list_documents():
	if not (has_capability(CAPABILITY) or has_capability(APPROVE_CAPABILITY)):
		require_capability(CAPABILITY)
	return [_row(d) for d in frappe.get_all(DOCTYPE, fields=["*"], order_by="creation desc")]


@frappe.whitelist(methods=["POST"])
def create_document(file_url, category, applied_to=None, version="v1.0", diseases=None):
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
		"size_bytes": cint(f.file_size), "status": "Processing",
	}).insert(ignore_permissions=True)
	f.db_set({"attached_to_doctype": DOCTYPE, "attached_to_name": doc.name})
	_enqueue(doc.name)
	return _row(doc)


@frappe.whitelist(methods=["POST"])
def update_document(name, category=None, applied_to=None, diseases=None, version=None):
	"""NEW: edit audience, diseases, category or version. Synced to Qdrant without re-indexing."""
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
	doc.save(ignore_permissions=True)
	_sync_access(doc)
	if category is not None or version is not None:  # these live in the payload too
		_enqueue(doc.name)
	return _row(doc)


@frappe.whitelist(methods=["POST"])
def set_approval(name, status):
	"""NEW: approve, retire or send back to draft. Only Approved documents are searchable."""
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


@frappe.whitelist()
def search(query, limit=5, category=None, disease=None, audience=None, include_drafts=0):
	"""Semantic search over chunks.
	Editors (manage_knowledge_base): every audience; drafts too when include_drafts=1.
	Everyone else (use_knowledge_base): Approved only, for their own role plus "All roles".
	The chatbot service account (kb_service) passes audience=<role of the person asking>."""
	from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue
	is_editor = has_capability(CAPABILITY)
	if not is_editor:
		require_capability(SEARCH_CAPABILITY)
	query = (query or "").strip()
	if not query:
		return []
	client = _qdrant()
	if not client.collection_exists(_collection()):
		return []

	must = []
	if not (is_editor and cint(include_drafts)):
		must.append(FieldCondition(key="approval_status", match=MatchValue(value="Approved")))
	if not is_editor:
		if audience and not has_capability(SERVICE_CAPABILITY):
			frappe.throw(_("You cannot search on behalf of another role."), frappe.PermissionError)
		role = audience or frappe.db.get_value("User", frappe.session.user, "primary_role")
		must.append(FieldCondition(key="applied_to", match=MatchAny(any=[ALL_ROLES] + ([role] if role else []))))
	if category:
		must.append(FieldCondition(key="category", match=MatchValue(value=category)))
	if disease:
		must.append(FieldCondition(key="diseases", match=MatchValue(value=disease)))

	hits = client.query_points(_collection(), query=embed([query])[0], limit=min(cint(limit) or 5, 20),
		query_filter=Filter(must=must) if must else None, with_payload=True).points
	keep = ("doc", "title", "category", "version", "chunk", "section", "page", "diseases", "approval_status", "text")
	return [{"score": round(h.score, 3), **{k: h.payload.get(k) for k in keep}} for h in hits]