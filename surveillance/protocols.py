"""Response Protocols: the SOP library (one protocol per disease or event) and per-event checklists.

Protocol  = reference SOP for a disease: summary, ordered steps (with timeframe and who is responsible),
            source, version, review date. Draft -> Approved -> Retired. The creator (Frappe "owner") is the
            logged-in user; approval records who approved and when.
            Each step has a phase: Investigation (done in step 4) or Response (done in step 6 after the decision).
            Verification questions (Yes / No / Not sure) are asked in step 3; "Single case is an emergency" makes
            one case meeting the case definition an immediate escalation (VHF, polio...).
Checklist = the protocol's steps and questions copied onto ONE Surveillance Event the first time an officer
            opens it, so answering for one outbreak never changes the protocol or other events.

Capabilities: view_response_protocols (read), manage_response_protocols (create, edit, approve, delete).
Ticking an event checklist needs act_on_events.
"""
import frappe
from frappe import _
from frappe.utils import cint, get_fullname, now_datetime

from surveillance.capabilities import has_capability, require_capability

DOCTYPE = "Response Protocol"
VIEW = "view_response_protocols"
MANAGE = "manage_response_protocols"
STATUSES = ("Draft", "Approved", "Retired")
PHASES = ("Investigation", "Response")
KINDS = ("Key question", "Case definition", "Supports", "Red flag")
GENERIC_EVENT = "unusual-event"   # protocol used for unusual illness/death events with no protocol of their own


# ---------- shapes ----------

def _disease_meta(key):
	return frappe.db.get_value("Alert Threshold Config", key, ["disease_name", "priority"], as_dict=True) or {}


def _shape(doc, steps=True):
	meta = _disease_meta(doc.disease)
	out = {
		"id": doc.name, "title": doc.title, "disease": doc.disease,
		"diseaseName": meta.get("disease_name") or doc.disease,
		"priority": (meta.get("priority") or "Standard"),
		"status": doc.status, "version": doc.version, "summary": doc.summary,
		"source": doc.source, "sourceUrl": doc.source_url,
		"reviewDate": str(doc.review_date) if doc.review_date else None,
		"owner": get_fullname(doc.owner), "ownerId": doc.owner,
		"approvedBy": get_fullname(doc.approved_by) if doc.approved_by else None,
		"approvedOn": str(doc.approved_on) if doc.approved_on else None,
		"updated": str(doc.modified)[:10],
		"stepCount": len(doc.get("steps") or []),
		"notifyImmediately": bool(doc.get("notify_immediately")),
	}
	if steps:
		out["steps"] = [{"n": i, "step": s.step, "timeframe": s.timeframe, "responsible": s.responsible,
			"phase": s.get("phase") or "Investigation", "assignable": bool(s.get("assignable"))}
			for i, s in enumerate(doc.get("steps") or [], 1)]
		from surveillance.investigation import is_key, is_red
		out["questions"] = [{"n": i, "question": q.question, "why": q.why, "kind": q.kind or "Supports",
			"neededToStart": is_key(q), "escalateIfYes": is_red(q)}
			for i, q in enumerate(doc.get("verification_questions") or [], 1)]
	return out


# ---------- API: library ----------

@frappe.whitelist()
def list_protocols(search=None, disease=None, status=None):
	"""All protocols the user may see. Non-managers only see Approved ones."""
	require_capability(VIEW) if not has_capability(MANAGE) else None
	filters = {}
	if disease:
		filters["disease"] = disease
	if not has_capability(MANAGE):
		filters["status"] = "Approved"
	elif status:
		filters["status"] = status
	names = frappe.get_all(DOCTYPE, filters=filters, pluck="name", order_by="title asc")
	rows = [_shape(frappe.get_doc(DOCTYPE, n)) for n in names]
	if search:
		q = search.lower()
		rows = [r for r in rows if q in (r["title"] or "").lower() or q in (r["diseaseName"] or "").lower()
			or any(q in (s["step"] or "").lower() for s in r["steps"])]
	order = {"Critical": 0, "High": 1, "Standard": 2}
	rows.sort(key=lambda r: (order.get(r["priority"], 3), r["title"] or ""))
	counts = {s.lower(): frappe.db.count(DOCTYPE, {"status": s}) for s in STATUSES}
	return {"protocols": rows, "counts": counts, "canManage": has_capability(MANAGE)}


@frappe.whitelist()
def get_protocol(name):
	if not has_capability(MANAGE):
		require_capability(VIEW)
	doc = frappe.get_doc(DOCTYPE, name)
	if doc.status != "Approved" and not has_capability(MANAGE):
		frappe.throw(_("This protocol is not approved yet."), frappe.PermissionError)
	return _shape(doc)


def approved_for(disease):
	"""Approved protocol for a disease; unusual illness/death events fall back to the unusual-event protocol."""
	generic = (disease or "").startswith("unusual-") or disease == "unclassified-illness"
	for key in (disease, GENERIC_EVENT if generic else None):
		if key:
			name = frappe.db.get_value(DOCTYPE, {"disease": key, "status": "Approved"}, "name", order_by="modified desc")
			if name:
				return frappe.get_doc(DOCTYPE, name)
	return None


@frappe.whitelist()
def get_protocol_for_disease(disease):
	if not has_capability(MANAGE):
		require_capability(VIEW)
	doc = approved_for(disease)
	return _shape(doc) if doc else None


def _clean_steps(steps):
	if isinstance(steps, str):
		steps = frappe.parse_json(steps)
	out = []
	for s in steps or []:
		if isinstance(s, str):
			s = {"step": s}
		text = (s.get("step") or "").strip()
		if text:
			phase = s.get("phase") if s.get("phase") in PHASES else "Investigation"
			out.append({"step": text, "timeframe": (s.get("timeframe") or "").strip(),
				"responsible": (s.get("responsible") or "").strip(), "phase": phase,
				"assignable": 1 if s.get("assignable") else 0})
	return out


def _clean_questions(questions):
	if isinstance(questions, str):
		questions = frappe.parse_json(questions)
	out = []
	for q in questions or []:
		if isinstance(q, str):
			q = {"question": q}
		text = (q.get("question") or "").strip()
		if text:
			from surveillance.investigation import kind_for
			old = q.get("kind") if q.get("kind") in KINDS else None
			if "neededToStart" in q or "escalateIfYes" in q:
				needed, red = bool(q.get("neededToStart")), bool(q.get("escalateIfYes"))
			else:   # older callers that only send a kind
				needed, red = old in ("Key question", "Case definition"), old == "Red flag"
			out.append({"question": text, "why": (q.get("why") or "").strip(), "kind": kind_for(needed, red, old),
				"needed_to_start": 1 if needed else 0, "escalate_if_yes": 1 if red else 0})
	return out


@frappe.whitelist(methods=["POST"])
def save_protocol(title, disease, steps, summary=None, version=None, source=None, source_url=None,
		review_date=None, name=None, questions=None, notify_immediately=None):
	"""Create (name empty) or update a protocol. The creator becomes its owner automatically.
	Editing an Approved protocol sends it back to Draft so it is approved again."""
	require_capability(MANAGE)
	steps = _clean_steps(steps)
	if not (title or "").strip():
		frappe.throw(_("Title is required."))
	if not frappe.db.exists("Alert Threshold Config", disease):
		frappe.throw(_("Unknown disease: {0}").format(disease))
	if not steps:
		frappe.throw(_("Add at least one response step."))
	doc = frappe.get_doc(DOCTYPE, name) if name else frappe.new_doc(DOCTYPE)
	was_approved = doc.status == "Approved" if name else False
	doc.update({"title": title.strip(), "disease": disease, "summary": summary, "version": version or doc.version or "v1.0",
		"source": source, "source_url": source_url, "review_date": review_date or None})
	doc.set("steps", steps)
	if questions is not None:
		doc.set("verification_questions", _clean_questions(questions))
	if notify_immediately is not None:
		doc.notify_immediately = 1 if str(notify_immediately).lower() in ("1", "true", "yes") else 0
	if was_approved:
		doc.status, doc.approved_by, doc.approved_on = "Draft", None, None
	doc.save(ignore_permissions=True) if name else doc.insert(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def set_protocol_status(name, status):
	"""Approve, retire or return to draft. Approving retires any other Approved protocol for the same disease."""
	require_capability(MANAGE)
	if status not in STATUSES:
		frappe.throw(_("Status must be one of: {0}").format(", ".join(STATUSES)))
	doc = frappe.get_doc(DOCTYPE, name)
	if status == "Approved":
		for other in frappe.get_all(DOCTYPE, filters={"disease": doc.disease, "status": "Approved",
				"name": ["!=", name]}, pluck="name"):
			frappe.db.set_value(DOCTYPE, other, "status", "Retired")
		doc.approved_by, doc.approved_on = frappe.session.user, now_datetime()
	doc.status = status
	doc.save(ignore_permissions=True)
	return _shape(doc)


@frappe.whitelist(methods=["POST"])
def delete_protocol(name):
	require_capability(MANAGE)
	if frappe.db.exists("Surveillance Event", {"protocol": name}):
		frappe.throw(_("This protocol is used on events. Retire it instead of deleting it."))
	frappe.delete_doc(DOCTYPE, name, ignore_permissions=True)
	return {"deleted": name}


# ---------- API: event checklist ----------

def _checklist(doc):
	return [{"n": s.step_no, "step": s.step, "timeframe": s.timeframe, "phase": s.phase or "Investigation",
		"outcome": s.outcome or ("Done" if s.done else None), "done": bool(s.done),
		"doneBy": get_fullname(s.done_by) if s.done_by else None, "doneOn": str(s.done_on) if s.done_on else None}
		for s in (doc.get("checklist") or [])]


def _ensure_checklist(event_doc):
	"""Copy the approved protocol's steps onto the event once. Returns True if it changed the event."""
	if event_doc.get("checklist"):
		return False
	proto = approved_for(event_doc.disease)
	if not proto:
		return False
	event_doc.protocol = proto.name
	for i, s in enumerate(proto.steps or [], 1):
		event_doc.append("checklist", {"step_no": i, "step": s.step, "timeframe": s.timeframe,
			"phase": s.get("phase") or "Investigation"})
	return True


@frappe.whitelist()
def get_event_checklist(event):
	"""Protocol and checklist for one event (copies the protocol steps on first view)."""
	from surveillance.events import _check_access, VIEW as EVENT_VIEW
	require_capability(EVENT_VIEW)
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	if _ensure_checklist(doc):
		doc.save(ignore_permissions=True)
	proto = frappe.get_doc(DOCTYPE, doc.protocol) if doc.protocol else None
	items = _checklist(doc)
	return {"protocol": _shape(proto, steps=False) if proto else None, "checklist": items,
		"done": sum(1 for s in items if s["done"]), "total": len(items)}


@frappe.whitelist(methods=["POST"])
def toggle_event_step(event, step_no, done):
	"""Tick or untick one checklist step on one event. Recorded in the event timeline."""
	from surveillance.events import _check_access, ACT
	require_capability(ACT)
	doc = frappe.get_doc("Surveillance Event", event)
	_check_access(doc)
	_ensure_checklist(doc)
	done = str(done).lower() in ("1", "true", "yes")
	row = next((s for s in doc.checklist if cint(s.step_no) == cint(step_no)), None)
	if not row:
		frappe.throw(_("Step not found."))
	row.done = 1 if done else 0
	row.outcome = "Done" if done else None
	row.done_by = frappe.session.user if done else None
	row.done_on = now_datetime() if done else None
	doc.append("actions", {"at": now_datetime(), "user": frappe.session.user,
		"action": "Step done" if done else "Step reopened", "note": f"{row.step_no}. {row.step}"})
	doc.save(ignore_permissions=True)
	return get_event_checklist(event)


# ---------- one-off seed ----------

SEED_SOURCE = "Draft from MOH Kenya IDSR Technical Guidelines (3rd ed.) and WHO guidance. KRCS to verify before approval."

SEED = {
	"awd-cholera": ("Cholera / AWD Outbreak Response", "Any person 2 years or older with acute watery diarrhoea, with or without vomiting, in an area with suspected cholera.", [
		("Notify the sub-county disease surveillance coordinator (SCDSC) and county team", "Within 24 hours", "Surveillance officer"),
		("Start oral rehydration immediately; refer severe dehydration for IV fluids", "Immediately", "Health worker / CHP"),
		("Collect stool samples (rectal swab in Cary-Blair) from the first suspected cases for culture or RDT", "Within 48 hours", "Health facility"),
		("Line-list all cases and map them by block / village", "Daily", "Surveillance officer"),
		("Investigate water sources and latrines in affected areas; chlorinate water", "Within 48 hours", "WASH team"),
		("Set up or activate a cholera treatment unit / ORS points with infection control", "As needed", "Health partner"),
		("Run community hygiene and handwashing messaging; safe burial for deaths", "Ongoing", "CHPs / KRCS volunteers"),
		("Report cases and deaths daily until 2 incubation periods (10 days) pass with no new cases", "Daily", "Surveillance officer"),
	]),
	"measles": ("Measles Outbreak Response", "Any person with fever and generalised rash, with cough, runny nose or red eyes.", [
		("Notify the SCDSC and county immunisation focal person", "Within 24 hours", "Surveillance officer"),
		("Collect blood (serum) or throat swab from the first cases for laboratory confirmation", "Within 48 hours", "Health facility"),
		("Isolate cases at home or facility for 4 days after rash onset", "Immediately", "Health worker"),
		("Give vitamin A to all cases and manage complications", "Immediately", "Health worker"),
		("Line-list cases with age and vaccination status; map affected blocks", "Daily", "Surveillance officer"),
		("Check vaccination coverage and plan a reactive vaccination campaign with the county", "Within 1 week", "County team"),
		("Search for more cases door to door in affected and neighbouring blocks", "Within 72 hours", "CHPs"),
	]),
	"afp-polio": ("Acute Flaccid Paralysis (Polio) Response", "Any child under 15 with sudden weakness or floppiness of a limb, or any person with paralytic illness suspected to be polio.", [
		("Notify the SCDSC immediately (AFP is immediately notifiable)", "Within 24 hours", "Surveillance officer"),
		("Collect 2 stool samples 24 hours apart within 14 days of paralysis onset; keep cold", "Within 14 days of onset", "Health facility"),
		("Fill the AFP case investigation form", "Within 48 hours", "Surveillance officer"),
		("Check the child's polio vaccination history", "Within 48 hours", "Health worker"),
		("Search for other AFP cases in the community", "Within 1 week", "CHPs"),
		("Follow up the case at 60 days for residual paralysis", "Day 60", "Health worker"),
	]),
	"vhf": ("Viral Haemorrhagic Fever (Ebola/Marburg/CCHF) Response", "Fever with unexplained bleeding, or sudden death, especially with contact with a sick or dead person or animal.", [
		("Notify the SCDSC and county immediately; treat as a public health emergency", "Immediately", "Surveillance officer"),
		("Isolate the patient; use full PPE; do not collect samples without trained staff", "Immediately", "Health worker"),
		("Collect blood samples only by trained staff with full PPE, triple-packaged", "As directed by county", "Trained lab staff"),
		("List all contacts and follow them up daily for 21 days", "Daily for 21 days", "Contact tracing team"),
		("Ensure safe and dignified burial for any death", "Immediately", "Trained burial team"),
		("Start community engagement to prevent stigma and encourage early reporting", "Ongoing", "KRCS volunteers"),
	]),
	"bvd": ("Bundibugyo Virus Disease Response", "Suspected Ebola-like illness (fever with bleeding, or sudden death) with a link to an area reporting Bundibugyo virus.", [
		("Notify the SCDSC and county immediately; treat as an Ebola-type emergency", "Immediately", "Surveillance officer"),
		("Isolate the patient and use full PPE", "Immediately", "Health worker"),
		("Arrange sample collection only by trained staff (triple packaging)", "As directed by county", "Trained lab staff"),
		("List all contacts and follow them up daily for 21 days", "Daily for 21 days", "Contact tracing team"),
		("Ensure safe and dignified burial for any death", "Immediately", "Trained burial team"),
	]),
	"mpox": ("Mpox Response", "Unexplained rash (blisters or pustules) with fever or swollen lymph nodes, or contact with a probable or confirmed case.", [
		("Notify the SCDSC", "Within 24 hours", "Surveillance officer"),
		("Collect lesion swabs for laboratory confirmation", "Within 48 hours", "Health facility"),
		("Isolate the case until all lesions have crusted and healed", "Immediately", "Health worker"),
		("List contacts and monitor them for 21 days", "Daily for 21 days", "Contact tracing team"),
		("Give infection prevention advice to the household", "Within 48 hours", "CHPs"),
	]),
	"yellow-fever": ("Yellow Fever Response", "Fever followed by yellow eyes or skin within 2 weeks, sometimes with bleeding.", [
		("Notify the SCDSC immediately (IHR notifiable)", "Within 24 hours", "Surveillance officer"),
		("Collect blood for laboratory confirmation", "Within 48 hours", "Health facility"),
		("Check vaccination status of case and community", "Within 72 hours", "Health worker"),
		("Search for more cases and map them", "Within 1 week", "CHPs"),
		("Coordinate mosquito control and plan reactive vaccination with the county", "As directed by county", "County team"),
	]),
	"meningococcal-meningitis": ("Meningococcal Meningitis Response", "Sudden fever with stiff neck, or bulging soft spot in infants, with or without rash.", [
		("Notify the SCDSC immediately", "Within 24 hours", "Surveillance officer"),
		("Refer the patient urgently for antibiotics", "Immediately", "Health worker / CHP"),
		("Collect cerebrospinal fluid (CSF) at the facility for confirmation", "Before or soon after antibiotics", "Health facility"),
		("List close contacts and arrange preventive antibiotics as advised", "Within 24 hours", "Health worker"),
		("Monitor weekly case numbers against the epidemic threshold", "Weekly", "Surveillance officer"),
	]),
	"anthrax": ("Anthrax Response (One Health)", "Skin sore with black centre, or sudden illness, after contact with sick or dead animals or animal products.", [
		("Notify the SCDSC and the county veterinary officer (One Health)", "Within 24 hours", "Surveillance officer"),
		("Refer human cases for treatment; collect samples at the facility", "Immediately", "Health worker"),
		("Advise the community not to open, eat or sell meat from animals that died suddenly", "Immediately", "CHPs / KRCS volunteers"),
		("Ensure carcasses are buried or burned safely, not opened", "Within 24 hours", "Veterinary team"),
		("Support animal vaccination in the affected area", "As directed by county", "Veterinary team"),
	]),
	"rift-valley-fever": ("Rift Valley Fever Response (One Health)", "Fever with bleeding, eye problems or jaundice, with contact with livestock or after heavy rains/flooding.", [
		("Notify the SCDSC and county veterinary officer", "Within 24 hours", "Surveillance officer"),
		("Collect blood samples from human cases", "Within 48 hours", "Health facility"),
		("Report livestock abortions or deaths to veterinary services", "Within 24 hours", "CHPs"),
		("Advise against slaughtering sick animals and handling blood or raw milk", "Immediately", "KRCS volunteers"),
		("Support mosquito control and livestock vaccination as directed", "As directed by county", "County / veterinary team"),
	]),
	"covid-sari": ("COVID-19 / Severe Acute Respiratory Infection Response", "Sudden fever with cough or difficulty breathing needing admission, or a cluster of such cases.", [
		("Notify the SCDSC, especially for clusters or deaths", "Within 24 hours", "Surveillance officer"),
		("Collect respiratory samples (nasopharyngeal swab) for testing", "Within 48 hours", "Health facility"),
		("Isolate cases and apply infection prevention (masks, ventilation, hand hygiene)", "Immediately", "Health worker"),
		("List and monitor close contacts", "Daily", "Contact tracing team"),
		("Track admissions and deaths for the cluster", "Daily", "Surveillance officer"),
	]),
	"rabies": ("Rabies / Animal Bite Response (One Health)", "Any person bitten or scratched by a dog or other animal, or with signs of rabies (fear of water, agitation) after an animal bite.", [
		("Wash the wound with soap and running water for 15 minutes", "Immediately", "CHP / health worker"),
		("Refer for post-exposure vaccination (and immunoglobulin for severe bites)", "Within 24 hours", "Health facility"),
		("Notify the SCDSC and county veterinary officer", "Within 24 hours", "Surveillance officer"),
		("Observe the biting animal for 10 days if possible; report if it dies", "10 days", "Veterinary team / owner"),
		("Search for other people bitten by the same animal", "Within 48 hours", "CHPs"),
		("Support dog vaccination in the area", "As directed by county", "Veterinary team"),
	]),
	"unusual-event": ("Unusual Event, Illness or Death Response", "Any unusual illness, cluster of deaths, or event that may threaten health in the community (applies to unusual illness and unusual death reports).", [
		("Verify the report with the reporter and a local leader", "Within 24 hours", "Surveillance officer"),
		("Notify the SCDSC", "Within 24 hours", "Surveillance officer"),
		("Record what is happening: number affected, signs, deaths, start date, location", "Within 48 hours", "Surveillance officer"),
		("Visit the area with the health team if verified", "Within 48 hours", "Rapid response team"),
		("Collect samples if advised by the county", "As directed by county", "Health facility"),
		("Decide with the county whether a specific disease protocol applies", "Within 72 hours", "County team"),
	]),
}


def seed_protocols(overwrite=0):
	"""One-off: create Draft protocols for the priority diseases (skips diseases that already have one).
	bench --site <site> execute surveillance.protocols.seed_protocols"""
	made = 0
	for key, (title, summary, steps) in SEED.items():
		if not frappe.db.exists("Alert Threshold Config", key):
			print(f"skip {key}: not in Alert Threshold Config")
			continue
		if frappe.db.exists(DOCTYPE, {"disease": key}) and not cint(overwrite):
			continue
		doc = frappe.new_doc(DOCTYPE)
		doc.update({"title": title, "disease": key, "summary": summary, "status": "Draft", "version": "v0.1",
			"source": SEED_SOURCE, "source_url": "https://www.health.go.ke"})
		for s, t, r in steps:
			doc.append("steps", {"step": s, "timeframe": t, "responsible": r, "phase": phase_for(s, t),
				"assignable": 1 if assignable_for(key, s) else 0})
		for q, w, k in questions_for(key, summary, title):
			doc.append("verification_questions", {"question": q, "why": w, "kind": k})
		doc.notify_immediately = 1 if key in EMERGENCY else 0
		doc.insert(ignore_permissions=True)
		made += 1
	frappe.db.commit()
	print(f"Draft protocols created: {made}")
	return made


# ---------- phases, verification questions and emergency flag for the seeded protocols ----------

# Investigation = what the team does while finding out (notify, verify, sample, line-list, search) plus anything
# that must happen immediately to protect patients (first treatment, isolation), so it never waits for the decision.
# Response = what follows the decision (control measures, campaigns, contact follow-up, ongoing reporting).
RESPONSE_WORDS = ("vaccinat", "chlorinat", "treatment unit", "ors points", "hygiene", "messaging", "burial",
	"mosquito control", "community engagement", "vitamin a", "follow them up", "monitor them", "report cases and deaths daily",
	"follow up the case at 60", "monitor weekly", "isolate the case until", "infection prevention advice",
	"preventive antibiotics", "do not open", "carcasses", "advise against", "track admissions", "support dog",
	"support animal", "start oral rehydration", "give vitamin", "refer the patient", "refer human",
	"wash the wound", "isolate cases", "isolate the patient", "advise the community")
INVESTIGATION_START = ("check ", "refer ", "line-list", "investigate ", "list and monitor")

EMERGENCY = {"vhf", "bvd", "afp-polio", "yellow-fever", "mpox"}

EXTRA_QUESTIONS = {
	"awd-cholera": [
		("Was a cholera RDT done on any case, and was it positive?", "A positive RDT strongly supports cholera", "Supports"),
		("Do the cases share a water source that is not chlorinated?", "Shared unsafe water drives cholera spread", "Supports"),
		("Is any case severely dehydrated (lethargic, unable to drink)?", "Severe dehydration can kill within hours", "Red flag"),
	],
	"measles": [
		("Are most cases unvaccinated or of unknown vaccination status?", "Low vaccination makes spread likely", "Supports"),
		("Are there cases with pneumonia, severe diarrhoea or malnutrition?", "Complications drive measles deaths", "Red flag"),
	],
	"afp-polio": [
		("Did the paralysis start in the last 14 days?", "Stool samples are only useful within 14 days", "Supports"),
		("Is the child's polio vaccination incomplete or unknown?", "Unvaccinated children are at highest risk", "Supports"),
	],
	"vhf": [
		("Did the case have contact with a sick or dead person or animal, or travel to an area with VHF?", "Exposure history supports VHF", "Supports"),
		("Is there unexplained bleeding?", "Bleeding with fever is a VHF warning sign", "Red flag"),
	],
	"bvd": [
		("Did the case have contact with a sick or dead person, or travel to an area reporting Bundibugyo virus?", "Exposure history supports BVD", "Supports"),
		("Is there unexplained bleeding?", "Bleeding with fever is an Ebola-type warning sign", "Red flag"),
	],
	"mpox": [
		("Did the case have close contact with a known or suspected mpox case?", "Contact history supports mpox", "Supports"),
	],
	"yellow-fever": [
		("Is the case unvaccinated against yellow fever?", "Unvaccinated people are at risk", "Supports"),
	],
	"meningococcal-meningitis": [
		("Has a health worker confirmed stiff neck or bulging soft spot?", "Clinical signs confirm suspected meningitis", "Supports"),
		("Is there a purple rash that does not fade when pressed?", "A non-blanching rash means life-threatening infection", "Red flag"),
	],
	"anthrax": [
		("Did the cases touch or eat meat or skins from animals that died suddenly?", "Animal exposure supports anthrax", "Supports"),
		("Are animals dying suddenly in the area?", "Animal deaths point to an anthrax source", "Supports"),
	],
	"rift-valley-fever": [
		("Are livestock abortions or deaths being reported nearby?", "Animal cases usually come first", "Supports"),
		("Has there been heavy rain or flooding in the last 2 months?", "Floods drive mosquito breeding", "Supports"),
	],
	"covid-sari": [
		("Do any cases need oxygen or admission?", "Severe respiratory illness needs urgent care", "Red flag"),
	],
	"rabies": [
		("Was the animal stray, unvaccinated, sick, or did it die or disappear?", "These animals are most likely rabid", "Supports"),
		("Is the bite on the head, neck or hands, or are there several bites?", "These bites need urgent vaccine and immunoglobulin", "Red flag"),
		("Does anyone show signs of rabies (fear of water, agitation)?", "Clinical rabies is almost always fatal", "Red flag"),
	],
	"unusual-event": [
		("Is the cause still unknown after speaking to the reporter?", "Unknown causes need investigation", "Supports"),
		("Are animals also sick or dying in the area?", "Points to a One Health event", "Supports"),
	],
}


def phase_for(step_text, timeframe=None):
	t = (step_text or "").lower()
	if "campaign" in t:
		return "Response"
	if (timeframe or "").strip().lower() == "immediately" or t.startswith(INVESTIGATION_START):
		return "Investigation"
	return "Response" if any(w in t for w in RESPONSE_WORDS) else "Investigation"


def questions_for(key, summary, disease_name=None):
	from surveillance.investigation import COMMON_QUESTIONS, case_definition_question
	return [case_definition_question(summary, disease_name)] + COMMON_QUESTIONS + EXTRA_QUESTIONS.get(key, [])


def upgrade_protocols(overwrite=0):
	"""One-off after adding the investigation workflow. Keeps each protocol's status (Approved stays Approved).
	  - sets each step's phase (Investigation / Response) where it is not set yet
	  - adds verification questions to protocols that have none
	  - ticks "Single case is an emergency" for VHF, BVD, polio, yellow fever and mpox
	  - refreshes the copied checklist on open events where nobody has recorded anything yet
	bench --site <site> execute surveillance.protocols.upgrade_protocols
	Review the result in Response Protocols and adjust phases / questions there if KRCS wants changes."""
	overwrite = cint(overwrite)
	for name in frappe.get_all(DOCTYPE, pluck="name"):
		doc = frappe.get_doc(DOCTYPE, name)
		for s in doc.steps:
			if overwrite or not s.get("phase") or s.phase == "Investigation":
				s.phase = phase_for(s.step, s.timeframe)
		if overwrite or not doc.get("verification_questions"):
			meta = _disease_meta(doc.disease)
			doc.set("verification_questions", [{"question": q, "why": w, "kind": k}
				for q, w, k in questions_for(doc.disease, doc.summary, meta.get("disease_name"))])
		if doc.disease in EMERGENCY:
			doc.notify_immediately = 1
		doc.flags.ignore_validate_update_after_submit = True
		doc.save(ignore_permissions=True)
		print(f"{doc.title} [{doc.status}]")
		for s in doc.steps:
			print(f"   {s.phase:<13} {s.step[:80]}")
	refreshed = 0
	for ev in frappe.get_all("Surveillance Event", filters={"status": ["not in", ["Closed", "Discarded"]]}, pluck="name"):
		doc = frappe.get_doc("Surveillance Event", ev)
		untouched = not any(s.done or s.get("outcome") for s in (doc.get("checklist") or [])) and not any(
			a.answer for a in (doc.get("verification") or []))
		if untouched and (doc.get("checklist") or doc.get("verification")):
			doc.set("checklist", [])
			doc.set("verification", [])
			doc.protocol = None
			doc.save(ignore_permissions=True)
			refreshed += 1
	frappe.db.commit()
	print(f"Open events reset to pick up the new steps and questions: {refreshed}")


# ---------- which steps a field worker can be assigned (event Tasks) ----------
# Reviewed by hand for the seeded protocols (28 Oct 2026). A step is assignable when someone other than the
# officer does it in the community or at a facility and reports back: referrals, searches, contact follow-up,
# sample collection (by facility / trained staff, never CHPs), household visits and advice.
# Steps the officer does or only records (notify, line-list, isolate, first aid, county planning) are not.
ASSIGNABLE_STEPS = {
	"awd-cholera": ["Start oral rehydration", "Collect stool samples", "Investigate water sources", "Run community hygiene"],
	"measles": ["Collect blood (serum)", "Search for more cases door to door"],
	"afp-polio": ["Collect 2 stool samples", "Check the child's polio vaccination", "Search for other AFP cases", "Follow up the case at 60 days"],
	"vhf": ["Collect blood samples only by trained staff", "List all contacts", "Start community engagement"],
	"bvd": ["Arrange sample collection", "List all contacts"],
	"mpox": ["Collect lesion swabs", "List contacts", "Give infection prevention advice"],
	"yellow-fever": ["Collect blood for laboratory", "Check vaccination status", "Search for more cases"],
	"meningococcal-meningitis": ["Refer the patient urgently", "Collect cerebrospinal fluid", "List close contacts"],
	"anthrax": ["Refer human cases", "Advise the community", "Ensure carcasses are buried"],
	"rift-valley-fever": ["Collect blood samples from human cases", "Report livestock abortions", "Advise against slaughtering"],
	"covid-sari": ["Collect respiratory samples", "List and monitor close contacts"],
	"rabies": ["Refer for post-exposure vaccination", "Observe the biting animal", "Search for other people bitten"],
	"unusual-event": ["Visit the area with the health team", "Collect samples if advised"],
}
ASSIGNABLE_WORDS = ("refer", "search", "visit", "follow up", "follow-up", "trace", "contacts", "sample", "swab",
	"observe", "door to door", "household", "advise the community")
NOT_ASSIGNABLE_WORDS = ("notify", "line-list", "line list", "report cases", "monitor weekly", "track admissions")


def assignable_for(disease, step_text):
	text = (step_text or "").strip().lower()
	known = ASSIGNABLE_STEPS.get(disease)
	if known is not None and any(text.startswith(k.lower()) for k in known):
		return True
	if known is not None and any(SEED.get(disease) and t.lower() == text for t, *_ in SEED[disease][2]):
		return False   # a seeded step we reviewed and left unticked
	if any(w in text for w in NOT_ASSIGNABLE_WORDS):
		return False
	return any(w in text for w in ASSIGNABLE_WORDS)


def mark_assignable(overwrite=0):
	"""One-off: tick 'Field worker can do this' on protocol steps.
	Seeded steps use the reviewed list above; other steps use their wording. By default only protocols
	where no step is ticked yet are changed, so KRCS's own choices are kept. Prints the result for review.
	bench --site <site> execute surveillance.protocols.mark_assignable"""
	for name in frappe.get_all("Response Protocol", pluck="name"):
		doc = frappe.get_doc("Response Protocol", name)
		steps = doc.get("steps") or []
		if not cint(overwrite) and any(s.get("assignable") for s in steps):
			print(f"-- {doc.title}: already set, skipped")
			continue
		for s in steps:
			s.assignable = 1 if assignable_for(doc.disease, s.step) else 0
		doc.flags.ignore_permissions = True
		doc.save()
		print(f"== {doc.title}")
		for i, s in enumerate(steps, 1):
			print(f"   {'[x]' if s.assignable else '[ ]'} {i}. {s.step[:90]}")
	frappe.db.commit()
