"""Questions refused before the Knowledge Base is asked (AI/ML spec 3.8.1, SRS R63, R75, R76).

The same rules as the chatbot service's safety.py (agents/chatbot), which checked WhatsApp questions while it
answered them. The Knowledge Base checks what it returns to the public (kb_safety) but not what is asked: a CHP
asking for a dose would get the approved passage that mentions it. So a request for a dose or a diagnosis gets a
referral, and an attempt to give the bot orders gets a plain refusal instead of an escalation to staff. Roles come
from Frappe, never from the message. Fixed patterns, no model: a miss goes on to the Knowledge Base, which only
returns approved text.
"""

import re

BLOCKED_INSTRUCTION = "blocked_instruction"
PRESCRIPTION_BOUNDARY = "prescription_boundary"
DIAGNOSIS_BOUNDARY = "diagnosis_boundary"

# Roles whose approved content includes facility-level clinical guidance.
CLINICAL_ROLES = frozenset({"Facility Health Worker", "Surveillance Officer", "Public Health Manager"})

_INSTRUCTION_TARGET = r"instructions?|rules?|prompts?|polic(?:y|ies)|restrictions?|safeguards?|guardrails?|filters?|access controls?"
_PRIVILEGED = r"admin\w*|root|superuser|developer|system|officer"
_INJECTION = [
	rf"\b(?:ignore|disregard|forget|override|bypass)\b.{{0,40}}\b(?:{_INSTRUCTION_TARGET})\b",
	r"\bsystem (?:override|prompt|message|instructions?)\b",
	r"\byou are now\b",
	rf"\b(?:act|behave|respond|pretend)\b.{{0,15}}\b(?:as|like|to be)\b.{{0,15}}\b(?:{_PRIVILEGED})\b",
	r"\b(?:developer|admin|god|debug) mode\b",
	r"\bjailbreak\b",
	r"\b(?:reveal|print|show|output|repeat)\b.{0,30}"
	r"\b(?:your (?:instructions|prompt)|api key|passwords?|tokens?|secrets?)\b",
	r"\b(?:output|dump|export|list|show|give)\b.{0,30}"
	r"\b(?:confidential|all (?:officer|staff|user|patient|reporter)s?\b)",
	r"\bsend\b.{0,25}\b(?:sms|alert|message)s?\b.{0,25}\b(?:all|every)\b",
	r"\b(?:puuza|usifuate|sahau)\b.{0,40}\b(?:maagizo|maelekezo|sheria)\b",
	r"\bwewe sasa ni\b",
]
_ROLE_CLAIM = (
	r"\b(?:i am|i'm|this is|mimi ni)\b.{0,60}"
	r"\b(?:dr|doctor|officer|admin\w*|director|manager|supervisor|chief|afisa|daktari|mkuu)\b"
)
_ACCESS_DEMAND = (
	r"\b(?:authenti[cz]ate|authori[sz]e|grant|elevate|unlock|give me access|my access|show me (?:all|every)"
	r"|nipe ruhusa|nionyeshe (?:zote|yote|wote))\b"
)

_NUMERIC_DOSE = r"\b\d+(?:\.\d+)?\s?(?:mg|mcg|ml|iu|tablets?|tabs?|vidonge)\b"
_DOSE_WORD = r"\b(?:dose|doses|dosage|how much (?:medicine|medication|drug)|kipimo cha dawa)\b"
_DRUG = (
	r"\b(?:amoxicillin|amoxil|ampicillin|penicillin|ciprofloxacin|cipro|doxycycline|azithromycin|erythromycin"
	r"|ceftriaxone|metronidazole|flagyl|cotrimoxazole|septrin|artemether|coartem|quinine|paracetamol|panadol"
	r"|ibuprofen|diclofenac|insulin|antibiotics?|antibiotiki)\b"
)
_MEDICINE_REQUEST = (
	r"\b(?:can i|should i|may i|shall i|can we|should we) (?:give|take|use|buy|stop|start)\b"
	r"|\b(?:what|which) (?:medicine|medication|drug|tablet)s?\b|\bprescribe\b|\bbuy\b"
	r"|\b(?:nimpe|nitumie|nimnunulie|ninunue|nimeze)\b|\bdawa gani\b"
)
# Water treatment and rehydration are public health advice; vaccines are counted in doses in protocols.
_NOT_A_PRESCRIPTION = (
	r"\b(?:chlorine|aquatabs?|water treatment|ors|oral rehydration|vaccines?|vaccination|chanjo)\b"
)

_DIAGNOSIS = [
	r"\bconfirm\b.{0,30}\b(?:this|it|that|he|she|they)\b",
	r"\bdiagnos(?:e|is)\b",
	r"\b100\s?%",
	r"\b(?:thibitisha|ni hakika)\b",
]
_IS_THIS = r"\b(?:is (?:this|it)|does (?:he|she|my \w+) have|je (?:huu|hii) ni)\b"


def _any(patterns, text):
	return any(re.search(p, text) for p in patterns)


def is_blocked_instruction(message):
	"""Orders to the assistant, or a claimed role used to ask for access (never treated as authority: R63)."""
	text = re.sub(r"\s+", " ", message.lower())
	return _any(_INJECTION, text) or bool(re.search(_ROLE_CLAIM, text) and re.search(_ACCESS_DEMAND, text))


def _is_prescription_request(text):
	if re.search(_NOT_A_PRESCRIPTION, text):
		return False
	if re.search(_NUMERIC_DOSE, text) or re.search(_DOSE_WORD, text):
		return True
	if re.search(_DRUG, text) and re.search(_MEDICINE_REQUEST, text):
		return True
	return bool(re.search(r"\b(?:what|which) (?:medicine|medication|drug)s?\b|\bdawa gani\b", text))


def check(message, roles, names_disease=False):
	"""The reason this question is refused, or None. `names_disease`: it names a disease in the catalog."""
	if is_blocked_instruction(message):
		return BLOCKED_INSTRUCTION
	text = re.sub(r"\s+", " ", message.lower())
	role_set = {r for r in roles if r and r != "Guest"}
	if not role_set & CLINICAL_ROLES and _is_prescription_request(text):
		return PRESCRIPTION_BOUNDARY
	if not role_set and (_any(_DIAGNOSIS, text) or (names_disease and re.search(_IS_THIS, text))):
		return DIAGNOSIS_BOUNDARY
	return None
