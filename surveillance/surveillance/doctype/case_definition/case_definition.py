# Copyright (c) 2026, Good Partners and contributors

import frappe
from frappe.model.document import Document


class CaseDefinition(Document):
	def validate(self):
		if not (self.required_symptoms or self.any_of_symptoms or self.required_exposure):
			frappe.throw("Add at least one required symptom, supporting symptom or animal exposure.")
		if (self.min_any_of or 0) > len(self.any_of_symptoms):
			frappe.throw("Minimum Supporting Symptoms is larger than the number of supporting symptoms.")
