"""Response Protocols: the SOP library (one protocol per disease or event) and per-event checklists.

Protocol  = reference SOP for a disease: summary, ordered steps (with timeframe and who is responsible),
            source, version, review date. Draft -> Approved -> Retired. The creator (Frappe "owner") is the
            logged-in user; approval records who approved and when.
Checklist = the protocol's steps copied onto ONE Surveillance Event the first time an officer opens or
            ticks it, so ticking a step for one outbreak never changes the protocol or other events.

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
	}
	if steps:
		out["steps"] = [{"n": i, "step": s.step, "timeframe": s.timeframe, "responsible": s.responsible}
			for i, s in enumerate(doc.get("steps") or [], 1)]
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
	for key in (disease, GENERIC_EVENT if (disease or "").startswith("unusual-") else None):
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
			out.append({"step": text, "timeframe": (s.get("timeframe") or "").strip(),
				"responsible": (s.get("responsible") or "").strip()})
	return out


@frappe.whitelist(methods=["POST"])
def save_protocol(title, disease, steps, summary=None, version=None, source=None, source_url=None,
		review_date=None, name=None):
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
	return [{"n": s.step_no, "step": s.step, "timeframe": s.timeframe, "done": bool(s.done),
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
		event_doc.append("checklist", {"step_no": i, "step": s.step, "timeframe": s.timeframe})
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
			doc.append("steps", {"step": s, "timeframe": t, "responsible": r})
		doc.insert(ignore_permissions=True)
		made += 1
	frappe.db.commit()
	print(f"Draft protocols created: {made}")
	return made
