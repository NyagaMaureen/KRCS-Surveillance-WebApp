"""Start the trusted sources list with WHO and PubMed (editable on the Knowledge Base page)."""
import frappe

SEED = [
	{"source_name": "World Health Organization", "website": "who.int", "kind": "Website"},
	{"source_name": "PubMed", "website": "pubmed.ncbi.nlm.nih.gov", "kind": "PubMed"},
]


def execute():
	frappe.reload_doc("surveillance", "doctype", "kb_trusted_source")
	for s in SEED:
		if not frappe.db.exists("KB Trusted Source", s["source_name"]):
			frappe.get_doc({"doctype": "KB Trusted Source", "enabled": 1, **s}).insert(ignore_permissions=True)
