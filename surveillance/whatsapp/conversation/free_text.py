"""Community reports in the reporter's own words (AI/ML §1.4, SRS H.12): what was understood, and advice afterwards."""

from surveillance.whatsapp import content as C
from surveillance.whatsapp.conversation.core import (
	ANIMALS,
	AttrDict,
	L,
	_unique,
	go,
	nairobi_date,
	region_label,
	show_date,
	sub_county_label,
	symptom_labels,
	t,
)
from surveillance.whatsapp.conversation.steps import auto_sub_county, missing_steps, step_name
from surveillance.whatsapp.extract import extract_report
from surveillance.whatsapp.messages import text

FREE_FIELDS = [
	"region", "sub_county", "location_name", "category", "symptoms", "affected_count", "sex", "age_group",
	"animal_exposure", "deaths_count", "onset_date",
]  # fmt: skip


def _clip(value, n):
	return value if len(value) <= n else value[: n - 1] + "…"


def describe(s, value, ctx, x=None):
	"""The reporter's own words -> the fields they state, filled in for them to confirm at review (only values the
	extraction is at least 70% sure of); then questions for what is still missing only."""
	x = x or extract_report(value, ctx, nairobi_date(ctx.now()), s.lang)
	d = s.draft
	d.description = str(value).strip()[:1000]
	d.extraction = AttrDict(
		extractor=x["extractor"],
		threat=x["threat"],
		danger_signs=x["danger_signs"],
		diseases=x["diseases"],
		notes=x["notes"],
		confidence=x["confidence"],
		evidence=x["evidence"],
		filled={},
	)
	# Typed into a report, a question about symptoms is still a report ("my child has fever, what do I do?").
	if not x["is_report"] and not x["fill"].get("symptoms"):
		return go("r_not_report")
	for field, val in x["fill"].items():
		if field == "symptoms":
			d.symptoms = _unique([*d.symptoms, *val])
		else:
			d[field] = val
		d.extraction.filled[field] = val
	if d.category == ANIMALS:
		d.age_group = d.animal_exposure = None
	if d.region and not d.sub_county:
		auto_sub_county(s, ctx)
	# AI/ML §6.6: a reporter not known to Frappe goes by their WhatsApp profile name (shown at review).
	if not d.reporter_name and s.profile_name:
		d.reporter_name = s.profile_name[:140]
	d.followups = missing_steps(s, ctx)
	urgent = [text(t(s)["urgent"])] if x["threat"] == "high" else []
	noted = text(t(s)["noted"](noted_list(s, ctx), len(d.followups)))
	return go(d.followups[0] if d.followups else "r_review", *urgent, noted)


def noted_list(s, ctx):
	d = s.draft
	f = {**t(s)["f"], "location_name": t(s)["f"]["place"]}
	symptoms = ctx.data.catalog()["symptoms"]
	show = {
		"symptoms": lambda: symptom_labels(d.symptoms, symptoms),
		"onset_date": lambda: show_date(d.onset_date),
		"region": lambda: region_label(d.region, ctx),
		"sub_county": lambda: sub_county_label(d.region, d.sub_county, ctx),
	}
	lines = []
	for field in FREE_FIELDS:
		if field not in d.extraction.filled:
			continue
		if field in show:
			value = show[field]()
		elif field in ("category", "sex", "age_group", "animal_exposure"):
			value = L(s, field, d[field])
		else:
			value = d[field]
		lines.append(f"• {f[field]}: {value}")
	return "\n".join(lines)


def extraction_note(s):
	"""For the desk (SRS G.4): the reporter's words, what was filled in from them and how sure, what the reporter
	changed at review, and danger signs. Kept in additional_notes until Case Report has fields for it."""
	d = s.draft
	x = d.extraction
	if not d.description or not x:
		return None

	def kept(field, value):
		now = d.symptoms if field == "symptoms" else d[field]
		return sorted(now) == sorted(value) if field == "symptoms" else now == value

	filled = [
		f"{k} = {', '.join(v) if isinstance(v, list) else v} ({(x.confidence.get(k) or 0):.2f})"
		+ ("" if kept(k, v) else " - changed by the reporter")
		for k, v in x.filled.items()
	]
	en = AttrDict(lang="en")
	return "\n".join(
		line
		for line in [
			f"WhatsApp free-text report ({x.extractor}); every value was confirmed by the reporter at review.",
			f'Message: "{d.description}"',
			filled and "Filled in from the message: " + "; ".join(filled),
			d.followups
			and "Asked as follow-up questions: " + ", ".join(step_name(en, sid) for sid in d.followups),
			x.danger_signs and f"Danger signs mentioned: {', '.join(x.danger_signs)} (threat: {x.threat})",
			x.diseases and f"Disease named by the reporter: {', '.join(x.diseases)}",
			*(f"Note: {n}" for n in x.notes),
		]
		if line
	)


def advice_for(s, ctx):
	"""What to do while waiting, for the groups of symptoms reported (draft content, content.ADVICE)."""
	d = s.draft
	A = C.ADVICE.get(s.lang) or C.ADVICE["en"]
	categories = {x["name"]: x.get("category") for x in ctx.data.catalog()["symptoms"]}
	groups = {categories.get(sid) for sid in d.symptoms}
	signs = (d.extraction or {}).get("danger_signs") or []
	if "neurological signs" in signs or "convulsions" in signs:
		groups.add("Neurological")
	if "bleeding" in signs:
		groups.add("Haemorrhagic")
	order = [
		"Haemorrhagic",
		"Neurological",
		"Respiratory",
		"Gastrointestinal",
		"Febrile/Systemic",
		"Dermatological",
	]
	parts = [A[g] for g in order if g in groups]
	animals = (
		d.category in (ANIMALS, "All Disease")
		or d.animal_exposure == "Handled sick or dead animal"
		or "animal deaths" in signs
	)
	if animals:
		parts.append(A["animals"])
	if d.animal_exposure == "Bite or scratch":
		parts.append(A["bite"])
	if not parts or not animals:
		parts.append(A["general"])
	return "\n\n".join([A["title"], *(f"• {p}" for p in parts), A["close"]])
