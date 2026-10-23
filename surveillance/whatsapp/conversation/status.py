"""Report status, recent reports and lookup by reference (own reports only)."""

from surveillance.whatsapp.conversation.core import L, normalize_phone, show_date, t


def _region_of(r, regions):
	return next((x["label"] for x in regions if x["name"] == r.get("region")), None) or r.get("region") or "—"


def report_card(s, r, regions):
	c = t(s)["card"]
	place = f", {r['location_name']}" if r.get("location_name") else ""
	affected = r.get("affected_count")
	return "\n".join(
		[
			f"*{r['name']}*",
			f"• {c['what']}: {r.get('symptom_tags') or '—'}",
			f"• {c['where']}: {_region_of(r, regions)}{place}",
			f"• {c['affected']}: {'—' if affected is None else affected} · {c['reported']} {show_date(r.get('report_date'))}",
			f"• {c['status']}: *{L(s, 'status', r.get('status'))}*",
		]
	)


def own_reports(s, ctx, limit):
	return ctx.data.my_reports(user=s.staff.user if s.staff else None, phone=s.phone, limit=limit)


def report_status(s, ctx):
	rows = own_reports(s, ctx, 5)
	if not rows:
		return t(s)["mineEmpty"]
	regions = ctx.data.catalog()["regions"]
	cards = "\n\n".join(report_card(s, r, regions) for r in rows)
	return f"{t(s)['statusTitle']}\n\n{cards}\n\n{t(s)['mineHint']}"


def recent_reports(s, ctx):
	rows = own_reports(s, ctx, 9)
	if not rows:
		return t(s)["mineEmpty"]
	lines = [
		f"{i}. `{r['name']}` · {show_date(r.get('report_date'))} · {r.get('symptom_tags') or '—'} · *{L(s, 'status', r.get('status'))}*"
		for i, r in enumerate(rows, 1)
	]
	return f"{t(s)['recentTitle']}\n\n" + "\n".join(lines) + f"\n\n{t(s)['mineHint']}"


def one_report(s, ctx, ref):
	"""Only the sender's own reports: same reporting user for staff, same phone number for the community."""
	r = ctx.data.get_report(ref)
	mine = r and (
		r.get("reported_by") == s.staff.user
		if s.staff
		else r.get("phone_number") == f"+{normalize_phone(s.phone)}"
	)
	if not mine:
		return t(s)["refNotFound"](ref)
	return report_card(s, r, ctx.data.catalog()["regions"])
