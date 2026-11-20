"""Every export from every page is recorded in the Audit Log, with the filters it was made with, and every exported
file shows those filters at the top (KRCS 20 Nov 2026).

Pages that make their file in the browser (CSV, JSON, dashboard PNG / PDF / Excel) call log_export first.
Signals Captured is exported here (export_signals) so its Excel file can carry the filters.
Monitoring Reports log their own exports (monitoring._log). All go to Report Run Log; the Audit Log reads it.
"""
import io
import json

import frappe
from frappe import _
from frappe.utils import cint, get_fullname, now_datetime

from surveillance.capabilities import require_capability

RUN_LOG = "Report Run Log"
FORMATS = {"CSV", "JSON", "EXCEL", "PNG", "PDF", "JPEG", "FILE"}


def filters_text(filters):
	"""[{label, value}] (or {label: value}, or text) -> 'Label: value · Label: value'."""
	if isinstance(filters, str):
		try:
			filters = json.loads(filters)
		except ValueError:
			return filters.strip()[:1000] or "None: everything shown"
	if isinstance(filters, dict):
		filters = [{"label": k, "value": v} for k, v in filters.items()]
	parts = [f"{f.get('label')}: {f.get('value')}" for f in (filters or []) if f and f.get("value") not in (None, "", [])]
	return (" · ".join(parts) or "None: everything shown")[:1000]


def record_later(user, page, title, fmt, filters=None):
	"""For downloads made by a GET request (not saved by the request itself): saved by a background job."""
	frappe.enqueue("surveillance.exports._record_as", queue="short", user=user, page=page, title=title, fmt=fmt, filters=filters)


def _record_as(user, page, title, fmt, filters=None):
	frappe.set_user(user)
	record(page, title, fmt, 0, filters)
	frappe.db.commit()


def record(page, title, fmt, rows=0, filters=None):
	fmt = str(fmt or "").upper()
	text = filters if isinstance(filters, str) and not filters.strip().startswith(("[", "{")) else filters_text(filters)
	frappe.get_doc({"doctype": RUN_LOG, "report": str(page)[:140], "report_title": str(title or page)[:140],
		"action": "Exported", "format": "Excel" if fmt == "EXCEL" else fmt, "filters": text, "scope": text[:140],
		"rows": cint(rows), "user": frappe.session.user, "at": now_datetime()}).insert(ignore_permissions=True)
	return text


@frappe.whitelist(methods=["POST"])
def log_export(page, title, format, rows=0, filters=None):
	"""page: the app path (e.g. /audit-log); title: the page name; format: CSV, JSON, Excel, PNG, PDF, JPEG."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please sign in."), frappe.PermissionError)
	if str(format or "").upper() not in FORMATS:
		frappe.throw(_("Unknown format."))
	return {"filters": record(page, title, format, rows, filters)}


@frappe.whitelist(methods=["POST"])
def export_signals(fields, filters=None, filters_label=None):
	"""Signals Captured as Excel: who exported it, when and with which filters, then every field of the matching reports."""
	require_capability("export_reports")
	from openpyxl import Workbook
	from openpyxl.styles import Font, PatternFill
	fields = frappe.parse_json(fields) if isinstance(fields, str) else fields
	filters = frappe.parse_json(filters) if isinstance(filters, str) and filters else (filters or [])
	rows = frappe.get_list("Case Report", fields=fields, filters=filters, order_by="creation desc", limit_page_length=0)
	meta = frappe.get_meta("Case Report")
	labels = [("ID" if f == "name" else "Created" if f == "creation" else (meta.get_label(f) or f)) for f in fields]
	text = record("/reports", "Signals Captured", "Excel", len(rows), filters_label)
	wb = Workbook()
	ws = wb.active
	ws.title = "Signals"
	ws.append(["Signals Captured"])
	ws["A1"].font = Font(bold=True, size=14)
	ws.append([f"Filters: {text}"])
	ws.append([f"Exported {str(now_datetime())[:16]} by {get_fullname(frappe.session.user)} · {len(rows)} signals"])
	ws.append([])
	ws.append(labels)
	for c in ws[ws.max_row]:
		c.font, c.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="EE2435")
	for r in rows:
		ws.append([r.get(f) if isinstance(r.get(f), (int, float)) else ("" if r.get(f) is None else str(r.get(f))) for f in fields])
	buf = io.BytesIO()
	wb.save(buf)
	frappe.response["filename"] = f"signals_captured_{str(now_datetime())[:10]}.xlsx"
	frappe.response["filecontent"] = buf.getvalue()
	frappe.response["type"] = "binary"
