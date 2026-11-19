import frappe
import os
from urllib.parse import quote

# Every page of the app needs a signed-in user: a signed-out visitor (an expired session, or a link from an alert
# email) goes to the login page and comes back here after signing in. The app never runs as "Guest" (KRCS 18 Nov 2026).
no_cache = 1
PUBLIC = ("/surveillance/login", "/surveillance/reset-password")


def get_context(context):
    req = getattr(frappe, "request", None)
    path = (req.path if req else "") or ""
    if frappe.session.user == "Guest" and not path.startswith(PUBLIC):
        inner = path[len("/surveillance"):] if path.startswith("/surveillance") else ""
        query = req.query_string.decode() if req and req.query_string else ""
        target = "/surveillance/login"
        if inner.strip("/"):
            target += "?next=" + quote(inner + (f"?{query}" if query else ""), safe="")
        frappe.local.flags.redirect_location = target
        raise frappe.Redirect(302)   # temporary: a 301 would be remembered by the browser after signing in
    dist_path = frappe.get_app_path("surveillance", "public", "frontend", "index.html")
    with open(dist_path) as f:
        context.frontend_html = f.read()
    return context
