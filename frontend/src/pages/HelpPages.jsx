import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ChevronDown, ExternalLink, FileText, PlaySquare, Mail, Phone, Clock, Send, Plus, Settings, HelpCircle, ArrowRightLeft,
  ClipboardCheck, BarChart3, Sparkles, UserCog, Compass } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getFaqs, getHelpContact, submitSupportTicket, getHelpResources } from '../api/frappe'

// Help Center (KRCS 27 Nov 2026): each menu item is its own page. FAQs, Guides and Video Tutorials show what is
// ticked for the user's workspace; Contact Us is one block for everyone. All of it is set on Help Center Content
// (System settings, Manage Help Center). Data: surveillance.help_faqs.

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const LANGS = ['English', 'Kiswahili']

function Header({ title, note, canManage, tab }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-900">{note}</p>
      </div>
      {canManage && <Link to={`/help-center-content?tab=${tab}`} className={`text-sm font-semibold text-red-700 hover:underline ${FOCUS}`}>Change this page</Link>}
    </div>
  )
}

// load once per key; {key, data, error}
function useLoad(load, key) {
  const [got, setGot] = useState(null)
  useEffect(() => {
    let off = false
    load().then((data) => { if (!off) setGot({ key, data }) })
      .catch((e) => { if (!off) setGot({ key, error: e.message || 'Could not load this page.' }) })
    return () => { off = true }
  }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  return got?.key === key ? got : null
}

// ---------- FAQs ----------

// one icon per topic, like the reference layout (KRCS 27 Nov 2026)
const TOPIC_ICONS = { 'Getting started': Compass, Reporting: FileText, 'Referrals and follow-ups': ArrowRightLeft, Tasks: ClipboardCheck,
  'Data and figures': BarChart3, 'KRCS Data Assistant': Sparkles, 'Account and access': UserCog, Other: HelpCircle }

function FaqCard({ topic, items, open, setOpen }) {
  const Icon = TOPIC_ICONS[topic] || HelpCircle
  return (
    <section className="mb-4 inline-block w-full break-inside-avoid rounded-2xl border border-gray-200 bg-white">
      <h3 className="flex items-center gap-2 border-b border-gray-200 px-5 py-3 text-sm font-bold text-gray-900">
        <Icon className="h-4 w-4 text-red-700" aria-hidden="true" />{topic}
      </h3>
      <div className="divide-y divide-gray-100 px-5">
        {items.map((f) => (
          <div key={f.id}>
            <button type="button" aria-expanded={open === f.id} onClick={() => setOpen((x) => (x === f.id ? null : f.id))}
              className={`flex w-full items-center gap-2 py-3 text-left ${FOCUS}`}>
              <span className="flex-1 text-sm font-semibold text-gray-900">{f.question}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-gray-900 transition-transform ${open === f.id ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {open === f.id && <p className="whitespace-pre-line pb-4 pr-6 text-sm text-gray-900">{f.answer}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

export function HelpFaqs() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)
  const [language, setLanguage] = useState(null)   // null: the user's own language
  const got = useLoad(() => getFaqs(language), language || 'mine')
  const data = got?.data
  const shown = data?.language || 'English'

  const topics = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = []
    ;(data?.faqs || []).filter((f) => !q || f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q)).forEach((f) => {
      const t = out.find((x) => x.topic === f.topic) || (out.push({ topic: f.topic, items: [] }), out[out.length - 1])
      t.items.push(f)
    })
    return out
  }, [data, query])

  return (
    <AppShell>
      <h2 className="mb-4 text-xl font-bold text-gray-900">Help &amp; Frequently Asked Questions</h2>

      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white"><HelpCircle className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-gray-900">Frequently Asked Questions</p>
          <p className="text-sm text-gray-900">Quick answers to common questions about reporting, referrals, your tasks and your account.</p>
        </div>
        <div role="group" aria-label="Language" className="flex overflow-hidden rounded-lg border border-gray-200">
          {LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={shown === l} onClick={() => setLanguage(l)}
              className={`px-3 py-1.5 text-sm font-semibold ${shown === l ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-50'} ${FOCUS}`}>{l}</button>
          ))}
        </div>
        {data?.canManage && (
          <div className="flex items-center gap-2">
            <Link to="/help-center-content?tab=faqs&add=1" className={`inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 ${FOCUS}`}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add FAQ
            </Link>
            <Link to="/help-center-content?tab=faqs" className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
              <Settings className="h-4 w-4" aria-hidden="true" /> Manage FAQs
            </Link>
          </div>
        )}
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a question or keyword…" aria-label="Search the FAQs"
          className={`w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 ${FOCUS}`} />
      </div>

      {got?.error && <p className="mb-4 text-sm text-red-700">{got.error}</p>}
      {!got ? <div className="h-40 animate-pulse rounded-2xl bg-gray-100" /> : topics.length ? (
        <div className="gap-4 lg:columns-2">   {/* cards fill both columns without gaps, however many questions each has */}
          {topics.map((t) => <FaqCard key={t.topic} topic={t.topic} items={t.items} open={open} setOpen={setOpen} />)}
        </div>
      ) : data && <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-900">{query.trim() ? 'No questions match your search.' : 'No FAQs yet.'}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4">
        <div>
          <p className="font-bold text-gray-900">Still need help?</p>
          <p className="text-sm text-gray-900">Read the guides, or contact the support team.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/help-guides" className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
            <FileText className="h-4 w-4" aria-hidden="true" /> Go to Guides
          </Link>
          <Link to="/help-contact" className={`inline-flex items-center gap-1.5 rounded-lg border border-red-600 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 ${FOCUS}`}>
            <Phone className="h-4 w-4" aria-hidden="true" /> Contact Us
          </Link>
        </div>
      </div>
    </AppShell>
  )
}

// ---------- Contact Us ----------

const STATUS = { New: 'Sent', Seen: 'Seen', Resolved: 'Resolved' }

export function HelpContact() {
  const [reload, setReload] = useState(0)
  const got = useLoad(() => getHelpContact(), reload)
  const data = got?.data
  const c = data?.contact
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')

  async function send(e) {
    e.preventDefault()
    if (message.trim().length < 3) return
    setSending(true)
    setNote('')
    try {
      await submitSupportTicket(message.trim())
      setMessage('')
      setNote('Ticket sent. The support team will look at it and reply here.')
      setReload((n) => n + 1)
    } catch (err) {
      setNote(err.message || 'Could not send the ticket.')
    } finally {
      setSending(false)
    }
  }

  const rows = c ? [[Mail, 'Email', c.email && <a href={`mailto:${c.email}`} className="text-red-700 hover:underline">{c.email}</a>],
    [Phone, 'Phone', c.phone && <a href={`tel:${c.phone.replace(/\s+/g, '')}`} className="text-red-700 hover:underline">{c.phone}</a>],
    [Clock, 'Hours', c.hours]].filter((r) => r[2]) : []

  return (
    <AppShell>
      <Header title="Contact Us" note="Get help from the KRCS support team." canManage={data?.canManage} tab="contact" />
      {got?.error && <p className="mb-4 text-sm text-red-700">{got.error}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-100 bg-white p-6">
          <h3 className="mb-4 text-base font-bold text-gray-900">KRCS support</h3>
          {!data ? <div className="h-24 animate-pulse rounded-xl bg-gray-100" /> : rows.length ? (
            <table className="w-full border-collapse text-sm">
              <tbody>
                {rows.map(([Icon, label, value]) => (
                  <tr key={label}>
                    <th scope="row" className="w-32 border border-gray-200 bg-gray-50 px-3 py-2.5 text-left font-bold text-gray-900">
                      <span className="inline-flex items-center gap-2"><Icon className="h-4 w-4" aria-hidden="true" />{label}</span>
                    </th>
                    <td className="border border-gray-200 px-3 py-2.5 text-gray-900">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-900">Contact details have not been added yet. Send a support ticket instead.</p>}
          {c?.note && <p className="mt-3 whitespace-pre-line text-sm text-gray-900">{c.note}</p>}
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-6">
          <h3 className="mb-1 text-base font-bold text-gray-900">Submit a support ticket</h3>
          <p className="mb-4 text-sm text-gray-900">Tell us what went wrong. Do not write patients' names or phone numbers.</p>
          <form onSubmit={send}>
            <label htmlFor="ticket" className="mb-1 block text-sm font-bold text-gray-900">What is the problem?</label>
            <textarea id="ticket" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000}
              className={`w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 ${FOCUS}`} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="submit" disabled={sending || message.trim().length < 3}
                className={`inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 ${FOCUS}`}>
                <Send className="h-4 w-4" aria-hidden="true" /> {sending ? 'Sending…' : 'Send ticket'}
              </button>
              {note && <p className="text-sm text-gray-900" role="status">{note}</p>}
            </div>
          </form>
          {data?.tickets?.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-2 text-sm font-bold text-gray-900">Your tickets</h4>
              <table className="w-full border-collapse text-sm">
                <thead><tr>
                  <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-900">Sent</th>
                  <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-900">Problem</th>
                  <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-900">Status and reply</th>
                </tr></thead>
                <tbody>
                  {data.tickets.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap border border-gray-200 px-3 py-2 align-top text-gray-900">{t.createdOn.slice(0, 10)}</td>
                      <td className="border border-gray-200 px-3 py-2 align-top text-gray-900">{t.message}</td>
                      <td className="border border-gray-200 px-3 py-2 align-top text-gray-900"><b>{STATUS[t.status] || t.status}</b>{t.response && <span className="mt-0.5 block">{t.response}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  )
}

// ---------- Guides and Video Tutorials ----------

function Resources({ kind, title, note, tab, icon: Icon, action }) {
  const got = useLoad(() => getHelpResources(kind), kind)
  const data = got?.data
  return (
    <AppShell>
      <Header title={title} note={note} canManage={data?.canManage} tab={tab} />
      {got?.error && <p className="mb-4 text-sm text-red-700">{got.error}</p>}
      {!data ? <div className="h-40 animate-pulse rounded-2xl bg-gray-100" /> : data.items.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.items.map((r) => (
            <a key={r.id} href={r.link} target="_blank" rel="noopener noreferrer"
              className={`flex items-start gap-4 rounded-2xl border border-gray-100 bg-white px-5 py-5 hover:border-red-200 hover:shadow-sm ${FOCUS}`}>
              <Icon className="mt-0.5 h-6 w-6 shrink-0 text-gray-900" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-gray-900">{r.title}</span>
                {r.description && <span className="mt-1 block text-sm text-gray-900">{r.description}</span>}
                <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-red-700">{action(r)} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></span>
              </span>
            </a>
          ))}
        </div>
      ) : <p className="rounded-2xl border border-gray-100 bg-white p-6 text-sm text-gray-900">Nothing here yet.</p>}
    </AppShell>
  )
}

export function HelpGuides() {
  return <Resources kind="Guide" title="Guides" note="User guides and how-to documents." tab="guides" icon={FileText}
    action={(r) => (r.isFile ? 'Open the guide' : 'Open the link')} />
}

export function HelpVideos() {
  return <Resources kind="Video" title="Video Tutorials" note="Short videos that show how to use the system." tab="videos" icon={PlaySquare}
    action={() => 'Watch'} />
}
