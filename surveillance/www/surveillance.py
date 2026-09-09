import frappe
import os

def get_context(context):
    dist_path = frappe.get_app_path("surveillance", "public", "frontend", "index.html")
    with open(dist_path) as f:
        context.frontend_html = f.read()
    return context