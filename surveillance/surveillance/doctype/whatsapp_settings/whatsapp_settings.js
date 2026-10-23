// Copyright (c) 2026, Good Partners and contributors
// For license information, please see license.txt

frappe.ui.form.on("WhatsApp Settings", {
	refresh(frm) {
		if (frm.is_dirty() || !frm.doc.phone_number_id) return;
		frm.add_custom_button(__("Send Test Message"), () => {
			frappe.prompt(
				{ fieldname: "to", fieldtype: "Data", label: __("WhatsApp number"), reqd: 1, description: __("e.g. 254712345678") },
				({ to }) =>
					frm.call("send_test_message", { to }).then((r) => {
						frappe.show_alert({ message: __("Sent to {0}", [r.message]), indicator: "green" });
					}),
				__("Send Test Message"),
				__("Send")
			);
		});
	},
});
