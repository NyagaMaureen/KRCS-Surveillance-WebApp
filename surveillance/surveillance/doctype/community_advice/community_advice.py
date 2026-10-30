import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class CommunityAdvice(Document):
	def validate(self):
		before = self.get_doc_before_save()
		if self.status == "Approved" and (not before or before.status != "Approved"):
			self.approved_by, self.approved_on = frappe.session.user, now_datetime()
		elif self.status != "Approved":
			self.approved_by = self.approved_on = None
