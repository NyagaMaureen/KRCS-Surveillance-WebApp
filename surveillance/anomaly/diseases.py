"""Map source disease/event names (CBS, EMR, ...) to the system's priority disease keys.

Keys match Alert Threshold Config in the Frappe app. Rules are checked in order,
so more specific patterns (BVD, animal events) come before general ones.
"""
import re

RULES = [
    ("bvd", r"bundibugyo"),
    ("vhf", r"haemorrhagic|hemorrhagic|\bvhf\b|ebola|marburg|lassa|cchf"),
    ("awd-cholera", r"watery diarr|\bawd\b|cholera"),
    ("measles", r"measles"),
    ("meningococcal-meningitis", r"mening"),
    ("yellow-fever", r"yellow fever"),
    ("afp-polio", r"polio|flaccid|\bafp\b"),
    ("mpox", r"mpox|monkeypox"),
    ("covid-sari", r"covid|\bsari\b|severe acute respiratory"),
    ("rift-valley-fever", r"rift valley"),
    ("anthrax", r"anthrax"),
    ("rabies", r"rabies|animal bite|dog bite"),
    ("unusual-death-animals", r"death.*animal|animal.*death"),
    ("unusual-illness-animals", r"illness.*animal|animal.*illness"),
    ("unusual-death-people", r"death.*(people|human)|(people|human).*death"),
    ("unusual-illness-people", r"illness.*(people|human)|(people|human).*illness"),
    ("unusual-event", r"unusual event|emergency"),
]
# Note: CBS's combined event "Unusual illnesses or deaths of animals" matches
# unusual-death-animals first ("deaths of animals"). Adjust here if KRCS wants it
# counted as illness instead.

_COMPILED = [(key, re.compile(pattern, re.I)) for key, pattern in RULES]


def to_key(name):
    """Return the priority disease key for a source name, or 'other:<slug>' if unmapped."""
    text = str(name or "").strip()
    for key, rx in _COMPILED:
        if rx.search(text):
            return key
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "unknown"
    return f"other:{slug}"
