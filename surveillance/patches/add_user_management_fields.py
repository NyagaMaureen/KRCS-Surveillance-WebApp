import frappe


def execute():
    fields = [
        {
            "label": "Primary Role",
            "fieldname": "primary_role",
            "fieldtype": "Select",
            "options": "\n".join([
                "HQ Admin",
                "CHP",
                "Facility Health Worker",
                "Surveillance Officer",
                "Public Health Manager",
                "ICT Admin",
                "Data & AI Administrator",
                "Government / MoH / IDSR",
                "Humanitarian / Partner Org",
                "County Officer",
                "Public Health Specialist",
            ]),
            "insert_after": "user_type",
        },
        {
            "label": "Assigned Region",
            "fieldname": "assigned_region",
            "fieldtype": "Link",
            "options": "Region",
            "insert_after": "primary_role",
        },
        {
            "label": "Account Status",
            "fieldname": "account_status",
            "fieldtype": "Select",
            "options": "\n".join([
                "Active",
                "Inactive",
                "Suspended",
            ]),
            "default": "Active",
            "insert_after": "assigned_region",
        },
    ]

    for field in fields:
        existing = frappe.db.exists(
            "Custom Field",
            {
                "dt": "User",
                "fieldname": field["fieldname"],
            },
        )

        if existing:
            # Update the field if it already exists
            doc = frappe.get_doc("Custom Field", existing)

            for key, value in field.items():
                if key not in ("fieldname",):
                    setattr(doc, key, value)

            doc.save(ignore_permissions=True)

        else:
            # Create the field if it doesn't exist
            doc = frappe.get_doc({
                "doctype": "Custom Field",
                "dt": "User",
                **field,
            })

            doc.insert(ignore_permissions=True)

    frappe.clear_cache(doctype="User")
