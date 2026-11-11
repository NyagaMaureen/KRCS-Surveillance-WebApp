"""Symptoms, age, people, deaths and animal contact picked out of a voice note's transcript (English or Kiswahili).

Shown to officers on the event's Signal captured step and on the report page as "Picked from the voice note":
a suggestion to check, never added to the report on its own (speech-to-text can mishear: "mvua kubwa", heavy rain,
once came out as "mbwa kubwa", big dog). Rules, not AI, so every hit can be explained; the English rules are the
ones the disease model uses (symptom_rules.py). Runs on the app server; nothing is sent anywhere.
"""
import re

import frappe

from surveillance import symptom_rules as sx

AGE_GROUPS = sx.BAND_NAMES   # Under 1, 1-4 years, 5-14 years, 15+ years

# ---------- Kiswahili: patterns are matched on the text with spaces and punctuation removed ----------
SW_RULES = [   # (keys, pattern) in order; a hit is blanked so later rules do not reuse it
	(("bloody_stool", "diarrhea"), r"(?:endesha|harisha|hara)(?:na)?damu|kinyesi(?:cha|chenye)damu|choocha?damu"),
	(("black_skin_sore",), r"(?:vidonda|kidonda|viduanda|vidwanda|mchipuko|michipuko|chipuka|vipele)\w{0,40}?(?:weusi|nyeusi)"),
	(("diarrhea",), r"harisha|kuhara|anahara|endesha"),
	(("vomiting",), r"tapika|kutapika|kichefuchefu"),
	(("headache",), r"m[ao]u?mivuyakichwa|kichwakinauma|kuumwakichwa"),
	(("severe_body_pain",), r"m[ao]u?mivuyamwili|misuli|mwiliunauma"),
	(("joint_pain",), r"m[ao]u?mivuyaviungo|viungovinauma"),
	(("abdominal_pain",), r"m[ao]u?mivuyatumbo|tumbolinauma|kuumwatumbo"),
	(("yellow_eyes_skin",), r"manjano"),
	(("red_eyes",), r"machomekundu|machoyekundu|machoyamekuwamekundu"),
	(("rash",), r"upele|vipele|mchipuko|michipuko|chipuka"),
	(("skin_lesions",), r"vidonda|kidonda|viduanda|vidwanda"),
	(("swelling",), r"vimba|(?:ame|ume|wame|ime|zime|ume|kuvi)fura(?!h)|uvimbe"),
	(("fever",), r"homa|jotojingi|jotokali|jotomwilini|jotolamwili|mwiliunamoto|jotokwamwili"),
	(("chills",), r"baridi|tetemeka"),
	(("cough",), r"kikohozi|kohoa"),
	(("difficulty_breathing",), r"(?:pumua|kupumua)(?:kwa)?shida|shidayakupumua|pumuaharaka"),
	(("sudden_weakness",), r"ulegevu|ulegefu|kupooza|amepooza|hawezikutembea|ta?a?busanakutembea|taabukutembea|shindwakutembea"),
	(("dehydration",), r"upungufuwamaji|machoyamezama|maji(?:mwilini)?yamepungua"),
	(("stiff_neck",), r"shingo(?:ime)?kakamaa|shingongumu"),
	(("confusion",), r"changanyikiwa|hajitambui|poteza?fahamu|zirai"),
	(("itching",), r"kuwasha|mwasho|inawasha"),
	(("swollen_lymph_nodes",), r"tezi(?:za|zime|zimevimba|zilizovimba)|matezi"),
	(("unexplained_bleeding",), r"(?:toka|tokwa)(?:na)?damu|damupuani|damukinywani|kutapikadamu"),
	(("fatigue",), r"mnyong|wanyong|mnionge|unyonge|uchovu|amechoka|dhaifu"),
]
SW_RULES = [(k, re.compile(p)) for k, p in SW_RULES]
SW_NEG = re.compile(r"\b(?:hana|hakuna|hawana|bila|sio|si)\s+(?:na\s+)?\w+")

SW_NUM = {"moja": 1, "mmoja": 1, "mbili": 2, "miwili": 2, "wawili": 2, "tatu": 3, "mitatu": 3, "watatu": 3, "nne": 4,
	"minne": 4, "wanne": 4, "tano": 5, "mitano": 5, "watano": 5, "sita": 6, "saba": 7, "nane": 8, "minane": 8, "wanane": 8,
	"tisa": 9, "kumi": 10, "ishirini": 20, "thelathini": 30, "arobaini": 40, "hamsini": 50, "sitini": 60,
	"sabini": 70, "themanini": 80, "tisini": 90}
EN_NUM = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen "
	"fourteen fifteen sixteen seventeen eighteen nineteen".split())}
EN_NUM.update({"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
	"a": 1, "an": 1})


def _num(words, table):
	"""'twenty two' / 'ishirini na miwili' / '22' -> 22"""
	total, seen = 0, False
	for w in words:
		w = w.strip(".,").lower()
		if w.isdigit():
			return int(w)
		if w in ("na", "and", "-"):
			continue
		if w in table:
			total += table[w]
			seen = True
		elif seen:
			break
	return total if seen else None


def _age_en(t):
	for m in re.finditer(r"(?:aged?\s+(?:about\s+|around\s+)?)?((?:[a-z0-9]+[\s-]){0,1}[a-z0-9]+)[\s-]+(years?|months?|weeks?)[\s-]*(?:old|of\s+age)?", t):
		n = _num(re.split(r"[\s-]+", m.group(1)), EN_NUM)
		if n is None:
			continue
		if not re.search(r"aged?|old|child|baby|boy|girl|man|woman|infant|of\s*$|of\s+\w+\s*$", t[max(0, m.start() - 25):m.start()] + m.group(0)):
			continue   # "for five days", "two months ago"
		unit = m.group(2)
		return n if unit.startswith("year") else n / 12 if unit.startswith("month") else n / 52
	m = re.search(r"\baged?\s+(?:about\s+|around\s+)?([a-z0-9]+(?:[\s-][a-z]+)?)", t) or re.search(
		r"\b(?:boy|girl|child|baby|man|woman|son|daughter)\s+of\s+(?:about\s+)?([a-z0-9]+(?:[\s-][a-z]+)?)", t)
	if m:
		n = _num(re.split(r"[\s-]+", m.group(1)), EN_NUM)
		if n:
			return float(n)
	return None


def _age_sw(t):
	for m in re.finditer(r"(?:umri\s*wa\s*|umru\s*wa\s*)?(mi[yie]*a?ka|mieka|miezi|wiki)\s+((?:\w+\s*){1,3})", t):
		before = t[max(0, m.start() - 30):m.start()]
		if "umri" not in m.group(0) and "umru" not in m.group(0) and not re.search(r"mtoto|mdoto|kijana|kijano|kichana|kidzana|mzee|mama|baba|dada|\bwa\s*$", before):
			continue   # "kwa miezi miwili" (how long), not an age
		n = _num(m.group(2).split(), SW_NUM)
		if n is None:
			continue
		return n if m.group(1).startswith(("mi", "mie")) and "miezi" not in m.group(1) else n / 12 if "miezi" in m.group(1) else n / 52
	return None


def extract(text, lang=None):
	raw = (text or "").lower()
	lang = lang or ("sw" if re.search(r"\b(?:na|kwa|ya|wa|ni|kuna|ambaye|ambae|mtoto|kijana|mama)\b", raw)
		and len(re.findall(r"\b(?:the|and|has|with|is)\b", raw)) < 3 else "en")
	found, why = set(), {}
	if lang == "en":
		found = set(sx.extract(re.sub(r"\bnone\b[^,.;]*", " ", raw)))   # "none of them has blood in the stool"
		if re.search(r"\b(?:could\s*not|cannot|can't|unable\s+to|not\s+able\s+to)\s+(?:move|walk|stand)", raw):
			found.add("sudden_weakness")
		if re.search(r"\bswollen\b(?!\s+(?:lymph|glands?|nodes?))", raw):
			found.add("swelling")
	else:
		t = SW_NEG.sub(" ", raw)
		flat = re.sub(r"[^a-z]", "", t)
		for keys, rx in SW_RULES:
			def take(m, keys=keys):
				for k in keys:
					found.add(k)
					why.setdefault(k, m.group(0))
				return "_" * len(m.group(0))
			flat = rx.sub(take, flat)
		found |= set(sx.extract(raw)) & {"fever", "cough", "diarrhea", "vomiting", "rash", "headache"}   # English words said in Kiswahili notes
	age = _age_en(raw) if lang == "en" else _age_sw(raw)
	group = AGE_GROUPS[sx.age_band(age)] if age is not None and sx.age_band(age) is not None else None
	flat_all = re.sub(r"[^a-z]", "", raw)
	animal = None
	if re.search(r"(?:umwa|ngatwa|ngʼatwa)(?:na)?mbwa|bittenbyadog|dogbite|bitebyadog", flat_all):
		animal = "Bite or scratch"
	elif re.search(r"(?:mifugo|mifugu|ngombe|mbuzi|kondoo|ngamia|livestock|cattle|goats?|cows?|animals?)\w{0,60}?(?:wameaga|meaga|kuaga|waga|wamekufa|kufa|fariki|died|dead|dying)", flat_all) \
			or re.search(r"(?:kula|kuchinja|chinja|ate|eating|slaughter)\w{0,30}?(?:nyama|minofu|meat)", flat_all) \
			or re.search(r"rawmilk|maziwamabichi", flat_all):
		animal = "Handled sick or dead animal"
	died = bool(re.search(r"\b(?:died|death|dead|passed away)\b", raw) or re.search(
		r"(?:ameaga|ameweza\s*ku[aw]*aga|amefariki|amekufa|wamefariki|wamekufa|kuwaga|kuaga)", raw)) and not (
		animal == "Handled sick or dead animal" and not re.search(r"(?:kijana|mtoto|mzee|mama|mtu|watu|man|woman|child|boy|girl|patient)\w{0,40}?(?:aga|fariki|kufa|died)", flat_all))
	people = None
	for m in re.finditer(r"\b(\w+)\s+(?:people|persons|children|cases|patients|watu|watoto|wagonjwa)\b|\b(?:watu|watoto|wagonjwa)\s+(?:wengine\s+)?(\w+)\b", raw):
		n = _num([m.group(1) or m.group(2)], {**EN_NUM, **SW_NUM})
		if n and n > 1 and n < 1000:
			people = max(people or 0, n)
	return {"language": lang, "symptoms": sorted(sx.SYMPTOMS[k] for k in found), "matched": why,
		"age_years": round(age, 1) if age is not None else None, "age_group": group, "people": people,
		"death_mentioned": died, "animal_exposure": animal}



def _norm(name):
	return re.sub(r"\W+", "", str(name or "").lower())


def picked(transcript, language=None, reported=None):
	"""For one voice note. reported: the symptom names already on the report (to mark what the note adds)."""
	if not (transcript or "").strip():
		return None
	r = extract(transcript, "sw" if language == "sw" else "en" if language == "en" else None)
	have = {_norm(n) for n in (reported or [])}
	symptoms = [{"name": n, "onReport": _norm(n) in have} for n in r["symptoms"]]
	if not (symptoms or r["age_group"] or r["people"] or r["death_mentioned"] or r["animal_exposure"]):
		return {"empty": True}
	return {"symptoms": symptoms, "ageYears": r["age_years"], "ageGroup": r["age_group"], "people": r["people"],
		"death": r["death_mentioned"], "animal": r["animal_exposure"]}


def reported_symptoms(report):
	ids = frappe.get_all("Case Report Symptom", filters={"parent": report, "parenttype": "Case Report"}, pluck="symptom")
	if not ids:
		return []
	return [(s.symptom_name or s.name).strip() for s in frappe.get_all("Symptom", filters={"name": ["in", ids]},
		fields=["name", "symptom_name"])]


@frappe.whitelist()
def for_report(report):
	"""Report page: {attachment row: picked} for the report's transcribed voice notes."""
	if not frappe.has_permission("Case Report", "read", doc=report):
		frappe.throw("Not permitted", frappe.PermissionError)
	rows = frappe.get_all("Case Report Attachment", filters={"parent": report, "parenttype": "Case Report",
		"attachment_type": "Voice Note", "transcript_status": "Done"}, fields=["name", "transcript", "transcript_language"])
	have = reported_symptoms(report) if rows else []
	return {r.name: picked(r.transcript, r.transcript_language, have) for r in rows}
