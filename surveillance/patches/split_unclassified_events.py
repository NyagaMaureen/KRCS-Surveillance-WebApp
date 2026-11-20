"""Unclassified reports are one per event (KRCS 20 Nov 2026). An open event that is still New or Verifying and holds
several unclassified reports keeps its first report; each other report gets its own new event. Events already
verified or further on are left as they are. Safe to run again."""
import frappe

UNCLASSIFIED = "unclassified-illness"


def execute():
	from surveillance.events import _assign, recompute_event
	frappe.flags.krcs_no_alerts = True   # no new-signal emails for the reports moved out
	try:
		events = frappe.get_all("Surveillance Event", filters={"disease": UNCLASSIFIED, "status": ["in", ["New", "Verifying"]]},
			pluck="name")
		for ev in events:
			sigs = frappe.get_all("Surveillance Signal", filters={"event": ev}, fields=["name"], order_by="signal_date asc, creation asc")
			if len(sigs) < 2:
				continue
			for s in sigs[1:]:
				frappe.db.set_value("Surveillance Signal", s.name, "event", None, update_modified=False)
				_assign(frappe.get_doc("Surveillance Signal", s.name))
			doc = frappe.get_doc("Surveillance Event", ev)
			doc.append("actions", {"at": frappe.utils.now_datetime(), "user": "Administrator", "action": "Split",
				"note": f"Unclassified reports are one per event: {len(sigs) - 1} report(s) moved to their own events."})
			doc.save(ignore_permissions=True)
			recompute_event(ev)
		frappe.db.commit()
	finally:
		frappe.flags.krcs_no_alerts = False
