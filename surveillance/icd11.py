"""WHO ICD-11 API integration (https://icd.who.int/icdapi).

Credentials live in site_config.json (never in git):
    bench --site <site> set-config icd_client_id "<id>"
    bench --site <site> set-config icd_client_secret "<secret>"
"""
import re

import frappe
import requests
from frappe import _

from surveillance.capabilities import require_capability

TOKEN_URL = "https://icdaccessmanagement.who.int/connect/token"
API_ROOT = "https://id.who.int/icd/release/11"
DOCTYPE = "Alert Threshold Config"
CAPABILITY = "manage_alert_thresholds"

# Curated search terms for the default priority diseases. Keys without a single
# matching ICD-11 condition (e.g. "unusual death of people", "VHF" as a group)
# are left out on purpose: officers pick a code manually if one applies.
SEARCH_TERMS = {
	"covid-sari": "COVID-19",
	"meningococcal-meningitis": "Meningococcal meningitis",
	"yellow-fever": "Yellow fever",
	"afp-polio": "Acute poliomyelitis",
	"awd-cholera": "Cholera",
	"mpox": "Mpox",
	"measles": "Measles",
	"bvd": "Bundibugyo",
	"rift-valley-fever": "Rift Valley fever",
	"anthrax": "Anthrax",
	"rabies": "Rabies",
}


# ---------- WHO API client ----------

def _token():
	token = frappe.cache.get_value("icd11_token")
	if token:
		return token
	client_id = frappe.conf.get("icd_client_id")
	client_secret = frappe.conf.get("icd_client_secret")
	if not client_id or not client_secret:
		frappe.throw(_("ICD-11 API credentials are not configured on this site."))
	r = requests.post(TOKEN_URL, timeout=15, data={
		"client_id": client_id,
		"client_secret": client_secret,
		"scope": "icdapi_access",
		"grant_type": "client_credentials",
	})
	r.raise_for_status()
	data = r.json()
	token = data["access_token"]
	ttl = max(int(data.get("expires_in", 3600)) - 120, 60)
	frappe.cache.set_value("icd11_token", token, expires_in_sec=ttl)
	return token


def _headers():
	return {
		"Authorization": f"Bearer {_token()}",
		"Accept": "application/json",
		"Accept-Language": "en",
		"API-Version": "v2",
	}


def _release():
	"""Latest ICD-11 MMS release id (e.g. '2025-01'), cached for a day."""
	release = frappe.cache.get_value("icd11_release")
	if release:
		return release
	release = frappe.conf.get("icd_release")
	if not release:
		r = requests.get(f"{API_ROOT}/mms", headers=_headers(), timeout=15)
		r.raise_for_status()
		m = re.search(r"/11/([^/]+)/mms", r.json().get("latestRelease", ""))
		release = m.group(1) if m else "2025-01"
	frappe.cache.set_value("icd11_release", release, expires_in_sec=86400)
	return release


def _clean(text):
	return re.sub(r"<[^>]+>", "", text or "").strip()


def search(q, limit=10):
	q = (q or "").strip()
	if len(q) < 2:
		return []
	r = requests.get(
		f"{API_ROOT}/{_release()}/mms/search",
		headers=_headers(),
		timeout=20,
		params={"q": q, "flatResults": "true", "highlightingEnabled": "false"},
	)
	r.raise_for_status()
	results = []
	for e in r.json().get("destinationEntities") or []:
		if not e.get("theCode"):
			continue
		results.append({"code": e["theCode"], "title": _clean(e.get("title")), "uri": e.get("id", "")})
		if len(results) >= limit:
			break
	return results


# ---------- API for the frontend ----------

@frappe.whitelist()
def search_icd11(q):
	require_capability(CAPABILITY)
	try:
		return search(q)
	except requests.RequestException:
		frappe.throw(_("Could not reach the WHO ICD-11 service. Please try again later."))


@frappe.whitelist(methods=["POST"])
def set_icd11(disease_key, code=None, title=None, uri=None):
	"""Save (or clear, if code is empty) the ICD-11 code for one disease."""
	require_capability(CAPABILITY)
	if not frappe.db.exists(DOCTYPE, disease_key):
		frappe.throw(_("Unknown disease: {0}").format(disease_key))
	doc = frappe.get_doc(DOCTYPE, disease_key)
	doc.icd11_code = (code or "").strip()
	doc.icd11_title = (title or "").strip() if doc.icd11_code else ""
	doc.icd11_uri = (uri or "").strip() if doc.icd11_code else ""
	doc.save(ignore_permissions=True)
	return {"key": disease_key, "icd11_code": doc.icd11_code, "icd11_title": doc.icd11_title, "icd11_uri": doc.icd11_uri}


# ---------- one-off / admin ----------

def autofill(overwrite=False):
	"""Fill ICD-11 codes for default diseases using SEARCH_TERMS. Safe to run again.

	bench --site <site> execute surveillance.icd11.autofill
	"""
	filled = []
	for key, term in SEARCH_TERMS.items():
		if not frappe.db.exists(DOCTYPE, key):
			continue
		doc = frappe.get_doc(DOCTYPE, key)
		if doc.icd11_code and not overwrite:
			continue
		matches = search(term, limit=1)
		if not matches:
			print(f"  no match: {key} ({term})")
			continue
		m = matches[0]
		doc.icd11_code, doc.icd11_title, doc.icd11_uri = m["code"], m["title"], m["uri"]
		doc.save(ignore_permissions=True)
		filled.append(key)
		print(f"  {key:26} -> {m['code']:10} {m['title']}")
	frappe.db.commit()
	return filled