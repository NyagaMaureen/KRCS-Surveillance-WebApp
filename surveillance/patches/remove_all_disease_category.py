import frappe


def execute():
	"""The "All Disease" category was removed (Use Human or Animal Disease). Move old reports to Human Disease."""
	for old in ("All Disease", "All Diseases"):
		frappe.db.sql("update `tabCase Report` set category = 'Human Disease' where category = %s", old)
