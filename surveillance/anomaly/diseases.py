"""Map source disease/event names (CBS, MOH 505/IDSR, EMR, ...) to the system's disease keys.

Keys match Alert Threshold Config in the Frappe app. Rules are checked in order,
so more specific patterns (BVD, dengue, animal events) come before general ones.
"""
import re

RULES = [
    ("bvd", r"bundibugyo"),
    ("dengue", r"dengue"),
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
    ("neonatal-tetanus", r"neonatal tetanus"),
    ("neonatal-death", r"neonatal death"),
    ("plague", r"\bplague\b"),
    ("guinea-worm", r"guinea worm|dracuncul"),
    ("maternal-death", r"maternal death"),
    ("aefi", r"\baefi\b|adverse event.*immuni"),
    ("mdr-tb", r"\bmdr\b|\bxdr\b"),
    ("acute-jaundice", r"jaundice"),
    ("dysentery", r"dysentery|dysentry"),
    ("typhoid", r"typhoid"),
    ("acute-malnutrition", r"malnutrition"),
    ("malaria", r"malaria"),
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
    """Return the disease key for a source name, or 'other:<slug>' if unmapped."""
    text = str(name or "").strip()
    for key, rx in _COMPILED:
        if rx.search(text):
            return key
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "unknown"
    return f"other:{slug}"