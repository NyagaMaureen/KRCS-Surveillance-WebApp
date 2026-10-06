# Copyright (c) 2026, Good Partners and contributors

from frappe.model.document import Document

from surveillance.weekly_counts import location_label, row_name, week_start


class WeeklyCount(Document):
	def autoname(self):
		self.week_start = week_start(self.week_start)
		self.location = location_label(self.county, self.sub_county)
		self.name = row_name(self.source, self.disease, self.location, self.week_start)
