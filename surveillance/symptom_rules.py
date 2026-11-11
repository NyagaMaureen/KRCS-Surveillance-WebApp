"""Turn clinic free text (or the app's symptom names) into the 28 symptoms the KRCS app uses.

The same code runs at training time (EMR notes) and at serving time (the report), so the model always sees
the same kind of input. Rules, not AI: every match can be explained. Negations ("no fever") are removed first.
"""
import re
from difflib import get_close_matches
from functools import lru_cache

# key -> the exact symptom name used in the KRCS app (Symptom list)
SYMPTOMS = {
	"abdominal_pain": "Abdominal Pain", "black_skin_sore": "Black Skin Sore", "bloody_stool": "Bloody Stool",
	"bulging_soft_spot": "Bulging Soft Spot (infant)", "chest_pain": "Chest Pain", "chills": "Chills",
	"confusion": "Confusion or Unconsciousness", "cough": "Cough", "dehydration": "Dehydration",
	"diarrhea": "Diarrhea", "difficulty_breathing": "Difficulty Breathing", "fatigue": "Fatigue",
	"fever": "Fever (hot body)", "headache": "Headache", "itching": "Itching", "joint_pain": "Joint Pain",
	"rash": "Rash", "red_eyes": "Red Eyes", "runny_nose": "Runny Nose",
	"severe_body_pain": "Severe Body or Muscle Pain", "skin_lesions": "Skin Lesions", "stiff_neck": "Stiff Neck",
	"sudden_weakness": "Sudden Weakness of Arm or Leg", "swelling": "Swelling",
	"swollen_lymph_nodes": "Swollen Lymph Nodes", "unexplained_bleeding": "Unexplained Bleeding",
	"vomiting": "Vomiting", "yellow_eyes_skin": "Yellow Eyes or Skin",
}
KEYS = list(SYMPTOMS)

# Order matters: a match is blanked out so later rules cannot match the same words again.
# (key or keys, regex)
RULES = [
	((), r"(?:pv|p\.v\.|per\s*vaginal|vaginal|menstrual|menses|mensural|antepartum|postpartum|pph)\s*(?:bleed\w*|h[a]?emorrh\w*)|menorrhagia|sore\s*(?:throat|mouth|tongue|eyes?)|oral\s*(?:thrush|ulcers?)|peptic\s*ulcers?"),
	(("bloody_stool", "diarrhea"), r"blood(?:y|-stained)?\s*diarr\w*|dysenter\w*"),
	(("diarrhea", "vomiting"), r"\bd\s*(?:&|and|/)\s*v\b|\bd\+v\b"),
	("swollen_lymph_nodes", r"swollen\s*(?:lymph\s*)?(?:nodes?|glands?)|lymph\w*\s*nodes?|lymphadenopath\w*|\blns\b"),
	("bloody_stool", r"blood(?:y|-stained)?\s*(?:in\s*(?:the\s*)?)?(?:stools?|diarr\w*)|melena|mel[ae]na|haematochezia|hematochezia|red\s*stools?"),
	("difficulty_breathing", r"difficult\w*\s*(?:in\s*)?breath\w*|short(?:ness)?\s*of\s*breath|\bsob\b|\bdib\b|dyspn\w*|breathless\w*|(?:fast|rapid|laboured|labored)\s*breathing|wheez\w*|chest\s*indrawing|kupumua\s*kwa\s*shida"),
	("sudden_weakness", r"(?:sudden|acute)\s*(?:onset\s*)?(?:weakness|paralysis)|(?:limb|arm|leg)\s*weakness|weak(?:ness)?\s*of\s*(?:the\s*)?(?:arm|leg|limb)s?|hemipar\w*|paralys\w*|flaccid"),
	("stiff_neck", r"stiff\s*neck|neck\s*(?:stiff\w*|rigid\w*)|nuchal\s*rigid\w*"),
	("black_skin_sore", r"eschar|black\s*(?:skin\s*)?(?:sores?|lesions?|ulcers?)"),
	("bulging_soft_spot", r"bulging\s*(?:fontanel+e|soft\s*spot)|fontanel+e"),
	("chest_pain", r"chest\s*(?:pains?|tightness|discomfort)"),
	("abdominal_pain", r"abdom\w*\s*pains?|abd\w*\s*pains?|stomach\s*(?:ache|pain)s?|epigastric\s*pains?|tummy\s*(?:ache|pain)s?|\blap\b|\buap\b|colicky|lower\s*abd\w*|upper\s*abd\w*|tumbo"),
	("yellow_eyes_skin", r"jaundic\w*|yellow\w*\s*(?:eyes?|skin|sclera\w*|discolou?ration)|icter\w*|macho\s*manjano"),
	("unexplained_bleeding", r"(?<!vaginal\s)(?<!pv\s)bleed\w*|h[a]?emorrh\w*|epistaxis|haematemesis|hematemesis|haemoptysis|hemoptysis"),
	("dehydration", r"dehydrat\w*|sunken\s*eyes|dry\s*mouth|poor\s*skin\s*turgor|excessive\s*thirst"),
	("confusion", r"confus\w*|unconscious\w*|altered\s*(?:consciousness|mental\s*status|sensorium)|loss\s*of\s*consciousness|drowsy|unresponsive|semi-?conscious|coma\b"),
	("red_eyes", r"red\s*eyes?|conjunc?tiv\w*|conjuctiv\w*|pink\s*eye|eye\s*redness|macho\s*mekundu"),
	("runny_nose", r"runny\s*nose|rhin\w*rr?h?o?e\w*|cor[yh]+za|corhyza|\bflu\b|common\s*cold|nasal\s*(?:discharge|congestion)|blocked\s*nose|stuffy\s*nose|catarrh|sneez\w*|mafua"),
	("severe_body_pain", r"(?:general\w*\s*)?body\s*(?:pains?|aches?)|myalgi\w*|muscle\s*(?:pains?|aches?)|maumivu\s*ya\s*mwili"),
	("joint_pain", r"joint\s*(?:pains?|aches?)|arthralgi\w*|\bjp\b|painful\s*joints?|(?:knee|elbow|ankle|wrist)\s*pains?|maumivu\s*ya\s*viungo"),
	("headache", r"head\s*ache\w*|headache\w*|\bhdc\b|migraine|maumivu\s*ya\s*kichwa"),
	("chills", r"chill\w*|rigors?\b|shiver\w*"),
	("fever", r"fever\w*|febrile|pyrexi\w*|hot(?:ness)?\s*of\s*(?:the\s*)?body|\bh\.?o\.?b\b|hot\s*body|high\s*(?:grade\s*)?temp\w*|\bhoma\b|joto\s*la\s*mwili|\bjoto\b"),
	("cough", r"cou?gh\w*|cought\w*|couf\w*|kikohozi"),
	("diarrhea", r"diarr?h?[oe]*a\w*|diarhorea|diarhoea|diahorrea|diarrhoeal|(?:loose|watery|runny)\s*(?:stools?|motions?)|frequent\s*stools?|kuhara"),
	("vomiting", r"vomit\w*|emesis|retching|nausea\w*|throwing\s*up|\bn\s*/\s*v\b|kutapika"),
	("rash", r"\brash\w*|maculo\s*papular|maculopapular|skin\s*eruptions?|pustul\w*|upele"),
	("itching", r"itch\w*|prur\w*|kuwasha"),
	("skin_lesions", r"skin\s*(?:lesions?|sores?|ulcers?|wounds?)|\bboils?\b|abscess\w*|blisters?|vesicles?|vesicular|(?:leg|foot|buttock|genital)\s*ulcers?|\bsores?\b"),
	("swelling", r"swell\w*|o?edema|puffiness"),
	("fatigue", r"fatigue\w*|tired\w*|weakness|\bweak\b|\bgbw\b|general\s*body\s*weakness|malaise|lethargi\w*|uchovu"),
]
_COMPILED = [((k,) if isinstance(k, str) else k, re.compile(rx, re.I)) for k, rx in RULES]

# misspelt single words that the regexes would miss: matched by closeness to these anchors
_ANCHORS = {
	"diarrhoea": "diarrhea", "diarrhea": "diarrhea", "vomiting": "vomiting", "vomitting": "vomiting",
	"headache": "headache", "headaches": "headache", "fever": "fever", "fevers": "fever", "cough": "cough",
	"coughing": "cough", "dehydration": "dehydration", "dehydrated": "dehydration", "rashes": "rash",
	"chills": "chills", "jaundice": "yellow_eyes_skin", "swelling": "swelling", "itching": "itching",
	"bleeding": "unexplained_bleeding", "weakness": "fatigue", "fatigue": "fatigue",
}
_NEG = re.compile(r"\b(?:no|nil|denies|denied|without|not|negative|neg|absent|never)\b[^,.;\n]{0,40}?(?=,|\.|;|\n|\band\b|\bbut\b|\bwith\b|\bc/o\b|$)", re.I)
_TOKEN = re.compile(r"[a-z]{5,}")


@lru_cache(maxsize=200000)
def _fuzzy(token):
	hit = get_close_matches(token, list(_ANCHORS), n=1, cutoff=0.85)
	return _ANCHORS[hit[0]] if hit and hit[0][0] == token[0] else None


@lru_cache(maxsize=500000)
def extract(text):
	"""Return a frozenset of symptom keys found in the text."""
	t = " " + re.sub(r"\s+", " ", (text or "").lower()) + " "
	if len(t) < 5:
		return frozenset()
	t = _NEG.sub(" ", t)
	found = set()
	for keys, rx in _COMPILED:
		def take(m, keys=keys):
			found.update(keys)
			return " " * len(m.group(0))
		t = rx.sub(take, t)
	for tok in _TOKEN.findall(t):          # typos left over after the rules
		key = _fuzzy(tok)
		if key:
			found.add(key)
	return frozenset(found)


_BY_NAME = {re.sub(r"\W+", "", v.lower()): k for k, v in SYMPTOMS.items()}


def from_names(names, free_text=""):
	"""Serving: the app's symptom names (exact match first, then the text rules) plus optional free text."""
	found = set()
	for n in names or []:
		exact = _BY_NAME.get(re.sub(r"\W+", "", str(n).lower()))
		found.update([exact] if exact else extract(str(n)))
	if free_text:
		found.update(extract(free_text))
	return found


def age_band(age_years):
	"""The app's four age groups, as 0..3 (None if unknown or impossible)."""
	try:
		a = float(age_years)
	except (TypeError, ValueError):
		return None
	if a != a or a < 0 or a > 110:
		return None
	return 0 if a < 1 else 1 if a < 5 else 2 if a < 15 else 3


BAND_NAMES = ["Under 1", "1-4 years", "5-14 years", "15+ years"]


def band_from_name(name):
	n = re.sub(r"\s+", "", str(name or "").lower().replace("–", "-"))
	return {"under1": 0, "1-4years": 1, "5-14years": 2, "15+years": 3}.get(n)
