"""WhatsApp reporting channel on the WhatsApp Cloud API.

Community members and staff report health signals over WhatsApp; each report is saved as an ordinary
Case Report with channel = WhatsApp, so it shows in the dashboard, map, alerts and exports like a web report.

	webhook.py       endpoint Meta calls (verification, signature check, queueing)
	jobs.py          background jobs: answer messages, attach media, desk alerts, escalations
	conversation/    the conversation itself (no frappe import; tested without a site; see its __init__.py)
	content.py       all wording, English and Kiswahili
	messages.py      message shapes and WhatsApp size limits
	data.py          reads and writes in Frappe (lists, staff lookup, Case Reports)
	sessions.py      conversation state per phone number, in Redis
	client.py        Cloud API payloads, sending, media download, webhook parsing
	knowledge.py     questions answered from the Knowledge Base (surveillance.knowledge_base.ask), verbatim
	chatbot.py       chatbot service client (agents/chatbot): what kind of message a question is
	extract.py       free-text reports: extraction client (POST /extract), keyword fallback, checks against Frappe
	transcribe.py    voice notes: speech-to-text client (POST /transcribe)
	redact.py        personal details taken out before text reaches the AI services and logs
	retention.py     media past its retention period; removing a reporter's details on request
	cbs.py           community reports created in CBS, which escalates them (AI/ML §6.6); retries
	setup.py         after_migrate: the community reporter account, defaults for settings added later

Configuration: the WhatsApp Settings DocType (System Manager only).
"""
