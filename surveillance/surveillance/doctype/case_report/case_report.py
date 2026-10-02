# Copyright (c) 2026, Good Partners and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class CaseReport(Document):
	def validate(self):
		self.set_symptom_tags()

	def set_symptom_tags(self):
		ids = [row.symptom for row in self.symptoms if row.symptom]
		names = dict(frappe.get_all("Symptom", filters={"name": ["in", ids]}, fields=["name", "symptom_name"], as_list=True)) if ids else {}
		self.symptom_tags = ", ".join(names.get(i) or i for i in ids)