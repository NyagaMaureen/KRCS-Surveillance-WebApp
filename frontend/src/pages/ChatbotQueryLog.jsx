import { useCallback, useEffect, useState } from 'react'
import AppShell from '../components/layout/AppShell'
import Pager from '../components/common/Pager'
import usePaged from '../components/common/usePaged'
import { TEXTAREA, BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, Badge, Toast, shortWhen } from '../components/chp/ui'
import { getChatbotLog, getChatbotMetrics, listChatbotLogs, updateChatbotEscalation } from '../api/frappe'
import { useCapabilities } from '../context/CapabilitiesContext'

const OUTCOME_TONE = {
  Matched: 'softGreen', 'No Match': 'softAmber', Restricted: 'red', Escalated: 'amber', Conflict: 'amber',
  Clarify: 'gray', Routed: 'gray', Info: 'gray', Error: 'red',
}
const ESC_TONE = { Open: 'red', 'In Progress': 'amber', Answered: 'green', Closed: 'gray' }
const OUTCOMES = ['Matched', 'No Match', 'Restricted', 'Escalated', 'Conflict', 'Clarify', 'Routed', 'Info', 'Error']
const CHANNELS = ['Web', 'Mobile', 'WhatsApp', 'SMS', 'USSD', 'API']
const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

function Detail({ id, onClose, canHandle, onChanged }) {
  const [d, setD] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { getChatbotLog(id).then((r) => { setD(r); setNote(r.responseNote || '') }).catch((e) => setErr(e.message)) }, [id])
  async function move(status) {
    setBusy(true); setErr('')
    try { const r = await updateChatbotEscalation(id, status, note); setD({ ...d, ...r }); onChanged() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Query details" className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-xl h-full overflow-y-auto bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Query {id}</h2>
          <button type="button" className={BTN_SMALL} onClick={onClose}>Close</button>
        </div>
        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
        {!d ? <p className="text-sm text-gray-400">Loading…</p> : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={OUTCOME_TONE[d.outcome]}>{d.outcome}</Badge>
              <Badge tone={d.accessDecision === 'DENY' ? 'red' : 'softGreen'}>{d.accessDecision || '—'}</Badge>
              {d.escalationStatus && <Badge tone={ESC_TONE[d.escalationStatus]}>{d.escalationStatus}</Badge>}
              {d.preview ? <Badge tone="amber">Editor preview</Badge> : null}
            </div>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5">
              {[
                ['When', shortWhen(d.createdAt)], ['Channel', d.channel], ['Level', d.level], ['Route', d.route],
                ['User', d.userName || d.user || d.userRef], ['Actor class', d.actorClass], ['Audience', d.audience],
                ['Scope', d.scope], ['Language', d.language], ['Reason', d.reason], ['Deny reason', d.denyReason],
                ['Confidence', d.confidence != null ? `${d.confidence} (${d.band || '—'})` : null],
                ['Document', d.matchedDocument], ['Protocol', d.matchedProtocol], ['Content version', d.contentVersion],
                ['Policy', d.policyVersion], ['Retrieval config', d.retrievalConfig], ['Latency', d.latencyMs != null ? `${d.latencyMs} ms` : null],
                ['Escalated to', d.escalatedTo], ['Helpful', d.helpful], ['Correlation', d.correlationId],
              ].filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-gray-500">{k}</dt><dd className="col-span-2 text-gray-900 break-words">{v}</dd></div>
              ))}
            </dl>
            <div><h3 className="font-medium text-gray-900 mb-1">Question</h3><p className="whitespace-pre-wrap text-gray-700">{d.question}</p></div>
            {d.answer && <div><h3 className="font-medium text-gray-900 mb-1">Reply shown</h3><p className="whitespace-pre-wrap text-gray-700">{d.answer}</p></div>}
            {d.error && <div><h3 className="font-medium text-gray-900 mb-1">Error</h3><p className="text-red-600">{d.error}</p></div>}
            {d.feedbackComment && <div><h3 className="font-medium text-gray-900 mb-1">Feedback</h3><p className="text-gray-700">{d.feedbackComment}</p></div>}
            {!!d.passages?.length && (
              <div>
                <h3 className="font-medium text-gray-900 mb-1">Passages considered</h3>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-500"><th className="py-1">Document</th><th>Section</th><th>Score</th><th>Shown</th></tr></thead>
                  <tbody>{d.passages.map((p, i) => (
                    <tr key={p.id || i} className="border-t border-gray-100"><td className="py-1">{p.doc || p.title}{p.version ? ` ${p.version}` : ''}</td><td>{p.section}</td><td className="tabular-nums">{p.score ?? '—'}</td><td>{p.shown ? 'yes' : ''}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {!!d.related?.length && (
              <div>
                <h3 className="font-medium text-gray-900 mb-1">Linked records</h3>
                <ul className="text-xs text-gray-600 space-y-0.5">{d.related.map((r) => <li key={r.id}>{r.id} · {r.level} · {r.route} · {r.outcome} · {r.accessDecision}</li>)}</ul>
              </div>
            )}
            {canHandle && d.escalated ? (
              <div className="border-t border-gray-100 pt-4">
                <h3 className="font-medium text-gray-900 mb-2">Follow-up</h3>
                <label className="block text-xs text-gray-500 mb-1" htmlFor="esc-note">Response note</label>
                <textarea id="esc-note" rows={3} className={TEXTAREA} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex flex-wrap gap-2 mt-2">
                  {['In Progress', 'Answered', 'Closed'].map((s) => (
                    <button key={s} type="button" disabled={busy || d.escalationStatus === s} className={s === 'Answered' ? BTN_PRIMARY : BTN_SECONDARY} onClick={() => move(s)}>Mark {s.toLowerCase()}</button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

// how long answers took, in words: 386083 ms -> "6.4 min"
function duration(ms) {
  if (ms == null) return null
  if (ms < 1000) return 'under 1 s'
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60000).toFixed(1)} min`
}

// red card like Signals Captured; note explains the number in plain words, warn when a target is missed
function StatCard({ label, value, note, warn }) {
  return (
    <div className="rounded-xl bg-red-600 p-4 text-white">
      <p className="text-[11px] font-bold uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value ?? '—'}</p>
      {note && <p className="mt-0.5 text-xs">{note}</p>}
      {warn && <p className="mt-1 inline-block rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">{warn}</p>}
    </div>
  )
}

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const FILTER = `h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 ${FOCUS_RING}`

export default function ChatbotQueryLog() {
  const { has } = useCapabilities()
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [channel, setChannel] = useState('')
  const [level, setLevel] = useState('Conversation')
  const [outcome, setOutcome] = useState('')
  const [esc, setEsc] = useState('')
  const [rows, setRows] = useState(null)
  const [m, setM] = useState(null)
  const [open, setOpen] = useState(null)
  const [toast, setToast] = useState({ text: '' })

  const load = useCallback(() => {
    listChatbotLogs({ from_date: from, to_date: to, channel, level, outcome, escalation_status: esc })
      .then(setRows).catch((e) => setToast({ text: e.message, error: true }))
    getChatbotMetrics({ from_date: from, to_date: to, channel }).then(setM).catch(() => {})
  }, [from, to, channel, level, outcome, esc])
  useEffect(() => { load() }, [load])

  const paged = usePaged(rows, 10, `${from}|${to}|${channel}|${level}|${outcome}|${esc}`)
  const pct = (v) => (v == null ? null : `${v}%`)
  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-brand-navy">AI Assistant Query Log</h2>
        <p className="text-sm text-gray-900">Every question asked to the KRCS Data Assistant and the chatbot: what was answered, and who could see it.</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Questions asked" value={m?.guidance_questions} note={m ? `${m.questions} records in total` : ''} />
        <StatCard label="Answered from approved content" value={pct(m?.match_rate)} note="Target: 75% or more"
          warn={m?.match_rate != null && m.match_rate < 75 ? 'Below target' : ''} />
        <StatCard label="Passed on to a person" value={pct(m?.escalation_rate)} note="Target: 25% or less"
          warn={m?.escalation_rate != null && m.escalation_rate > 25 ? 'Above target' : ''} />
        <StatCard label="Answers rated helpful" value={pct(m?.helpful_rate)} note={m?.helpful_rate == null ? 'No ratings yet' : 'Of the answers users rated'} />
        <StatCard label="Time to answer" value={duration(m?.p95_latency_ms)} note="95 out of 100 answers came within this time" />
        <StatCard label="Waiting for a reply" value={m?.open_escalations} note="Questions passed on, still open" />
        <StatCard label="Requests refused" value={m?.denied} note="The user was not allowed to see the answer" />
        <StatCard label="Restricted content shown to the public" value={m?.public_restricted_leaks} note="Must stay at 0"
          warn={m?.public_restricted_leaks ? 'Check these now' : ''} />
      </div>

      {/* filters in one row, as on the Review Queue */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-white p-3">
        <label className="inline-flex items-center gap-1.5 text-sm text-gray-900">From <input type="date" aria-label="From" className={FILTER} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline-flex items-center gap-1.5 text-sm text-gray-900">To <input type="date" aria-label="To" className={FILTER} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select aria-label="Channel" className={FILTER} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All channels</option>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
        <select aria-label="Records" className={FILTER} value={level} onChange={(e) => setLevel(e.target.value)}><option value="">Questions and searches</option><option value="Conversation">Questions</option><option value="Retrieval">Searches behind them</option></select>
        <select aria-label="Outcome" className={FILTER} value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">All outcomes</option>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select>
        <select aria-label="Passed on" className={FILTER} value={esc} onChange={(e) => setEsc(e.target.value)}><option value="">Passed on: all</option>{['Open', 'In Progress', 'Answered', 'Closed'].map((o) => <option key={o}>{o}</option>)}</select>
        <button type="button" className={`inline-flex h-9 items-center rounded-lg bg-red-600 px-3.5 text-sm font-medium text-white hover:bg-red-700 ${FOCUS_RING}`} onClick={load}>Refresh</button>
      </div>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {!rows ? <p className="p-8 text-sm text-gray-900">Loading…</p> : !rows.length ? <p className="p-10 text-center text-sm text-gray-900">No questions in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs">
                  <th className="w-10 px-3 py-3">#</th><th className="px-3 py-3">When</th><th className="px-3 py-3">Channel</th><th className="px-3 py-3">Who</th>
                  <th className="px-3 py-3">Question</th><th className="px-3 py-3">Outcome</th><th className="px-3 py-3">Access</th><th className="px-3 py-3">Passed on</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.shown.map((r, i) => (
                  <tr key={r.id} className="align-top hover:bg-gray-50">
                    <td className="px-3 py-3 tabular-nums text-gray-900">{paged.offset + i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-900">{shortWhen(r.createdAt)}</td>
                    <td className="px-3 py-3 text-gray-900">{r.channel}</td>
                    <td className="px-3 py-3 text-gray-900">{r.userName || r.userRef || r.user || '—'}<span className="block text-xs text-gray-900">{r.actorClass || r.audience}</span></td>
                    <td className="max-w-md px-3 py-3 text-gray-900"><span className="line-clamp-2">{r.question}</span></td>
                    <td className="px-3 py-3"><Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Badge>{r.reason && <span className="mt-0.5 block text-xs text-gray-900">{r.reason}</span>}</td>
                    <td className="px-3 py-3"><Badge tone={r.accessDecision === 'DENY' ? 'red' : 'softGreen'}>{r.accessDecision === 'DENY' ? 'Refused' : r.accessDecision ? 'Allowed' : '—'}</Badge>{r.denyReason && <span className="mt-0.5 block text-xs text-gray-900">{r.denyReason}</span>}</td>
                    <td className="px-3 py-3">{r.escalationStatus ? <Badge tone={ESC_TONE[r.escalationStatus]}>{r.escalationStatus}</Badge> : '—'}</td>
                    <td className="px-3 py-3 text-right"><button type="button" className={`inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 ${FOCUS_RING}`} onClick={() => setOpen(r.id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager paged={paged} noun="questions" />
      </section>
      {open && <Detail id={open} onClose={() => setOpen(null)} canHandle={has('handle_chatbot_escalations')} onChanged={load} />}
      <Toast {...toast} />
    </AppShell>
  )
}
