# Copyright (c) 2026, Good Partners and contributors

from frappe.model.document import Document


class SubCounty(Document):
	def validate(self):
		self.sub_county_name = (self.sub_county_name or "").strip()
		self.county = (self.county or "").strip()
