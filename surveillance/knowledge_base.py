"""AI Knowledge Base: upload KRCS documents, extract text, chunk, embed and store vectors in Qdrant.

Flow: upload file -> Knowledge Document (status Processing) -> background job:
      extract text -> split into chunks -> embed locally (fastembed, nothing leaves the server)
      -> upsert into Qdrant (one point per chunk) -> status Indexed with chunk count.

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
from frappe.utils import cint

from surveillance.capabilities import require_capability

DOCTYPE = "Knowledge Document"
CAPABILITY = "manage_knowledge_base"
ALLOWED_EXTENSIONS = {"pdf", "docx", "txt", "md"}
MAX_BYTES = 25 * 1024 * 1024
CHUNK_CHARS = 1000
CHUNK_OVERLAP = 150
DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"  # English + Kiswahili

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
		client.create_payload_index(name, field_name="doc", field_schema=PayloadSchemaType.KEYWORD)
		client.create_payload_index(name, field_name="category", field_schema=PayloadSchemaType.KEYWORD)
	return name


def _delete_vectors(client, docname):
	from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue
	name = _collection()
	if client.collection_exists(name):
		client.delete(name, points_selector=FilterSelector(
			filter=Filter(must=[FieldCondition(key="doc", match=MatchValue(value=docname))])))


# ---------- text extraction and chunking ----------

def extract_text(path, ext):
	if ext == "pdf":
		from pypdf import PdfReader
		return "\n\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
	if ext == "docx":
		import docx
		d = docx.Document(path)
		parts = [p.text for p in d.paragraphs]
		for table in d.tables:
			for row in table.rows:
				parts.append(" | ".join(c.text.strip() for c in row.cells))
		return "\n".join(parts)
	with open(path, encoding="utf-8", errors="ignore") as f:
		return f.read()


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
		chunks = chunk_text(extract_text(path, doc.extension))
		if not chunks:
			raise ValueError("No readable text found. Scanned PDFs need OCR before upload.")
		client = _qdrant()
		_delete_vectors(client, docname)
		applied = [a.strip() for a in (doc.applied_to or "").split(",") if a.strip()]
		batch = 64
		for start in range(0, len(chunks), batch):
			part = chunks[start:start + batch]
			vectors = embed(part)
			collection = _ensure_collection(client, len(vectors[0]))
			client.upsert(collection, points=[
				PointStruct(
					id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{docname}:{start + i}")),
					vector=v,
					payload={"doc": docname, "title": doc.title, "category": doc.category,
						"applied_to": applied, "version": doc.version, "chunk": start + i, "text": t},
				) for i, (t, v) in enumerate(zip(part, vectors))
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
		"category": d.category, "appliedTo": [a.strip() for a in (d.applied_to or "").split(",") if a.strip()],
		"sizeBytes": cint(d.size_bytes), "status": (d.status or "").lower(), "chunks": cint(d.chunks),
		"error": d.error, "uploadedBy": frappe.utils.get_fullname(d.owner), "uploadedAt": str(d.creation),
	}


@frappe.whitelist()
def list_documents():
	require_capability(CAPABILITY)
	return [_row(d) for d in frappe.get_all(DOCTYPE, fields=["*"], order_by="creation desc")]


@frappe.whitelist(methods=["POST"])
def create_document(file_url, category, applied_to=None, version="v1.0"):
	"""Register an already uploaded file (via /api/method/upload_file) and queue indexing."""
	require_capability(CAPABILITY)
	f = frappe.get_doc("File", {"file_url": file_url})
	ext = (f.file_name.rsplit(".", 1)[-1] if "." in f.file_name else "").lower()
	if ext not in ALLOWED_EXTENSIONS:
		frappe.throw(_("Only PDF, DOCX, TXT and MD files are supported."))
	if cint(f.file_size) > MAX_BYTES:
		frappe.throw(_("File is larger than 25 MB."))
	applied = frappe.parse_json(applied_to) if isinstance(applied_to, str) and applied_to.startswith("[") else applied_to
	if isinstance(applied, list):
		applied = ", ".join(applied)
	doc = frappe.get_doc({
		"doctype": DOCTYPE, "title": f.file_name, "file": file_url, "extension": ext,
		"version": version or "v1.0", "category": category, "applied_to": applied or "All roles",
		"size_bytes": cint(f.file_size), "status": "Processing",
	}).insert(ignore_permissions=True)
	f.db_set({"attached_to_doctype": DOCTYPE, "attached_to_name": doc.name})
	_enqueue(doc.name)
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
def search(query, limit=5, category=None):
	"""Semantic search over indexed chunks. Used by the protocol assistant later."""
	from qdrant_client.models import FieldCondition, Filter, MatchValue
	query = (query or "").strip()
	if not query:
		return []
	client = _qdrant()
	if not client.collection_exists(_collection()):
		return []
	flt = Filter(must=[FieldCondition(key="category", match=MatchValue(value=category))]) if category else None
	hits = client.query_points(_collection(), query=embed([query])[0], limit=cint(limit) or 5,
		query_filter=flt, with_payload=True).points
	return [{"score": round(h.score, 3), "doc": h.payload.get("doc"), "title": h.payload.get("title"),
		"chunk": h.payload.get("chunk"), "text": h.payload.get("text")} for h in hits]
