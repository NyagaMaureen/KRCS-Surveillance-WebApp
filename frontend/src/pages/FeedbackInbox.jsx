import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { listFeedback, setFeedbackStatus } from '../api/frappe'
import Pager from '../components/common/Pager'
import usePaged from '../components/common/usePaged'
import { FOCUS, TEXTAREA, BTN_PRIMARY, BTN_SECONDARY, Badge, Toast, shortWhen } from '../components/chp/ui'

const STATUS_TONE = { New: 'red', Seen: 'blue', Resolved: 'green' }
const TYPE_TONE = { Problem: 'softAmber', Suggestion: 'gray', Feedback: 'softGreen' }

// The inbox now lives in Settings → Feedback; old links land there.
export default function FeedbackInbox() {
  return <Navigate to="/settings?tab=feedback" replace />
}

/** Feedback list for admins (Settings → Feedback). */
export function FeedbackList({ onCounts }) {
  const countsRef = useRef(onCounts)
  countsRef.current = onCounts
  const [status, setStatus] = useState('New')
  const [type, setType] = useState('')
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [reply, setReply] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState({ text: '' })

  const load = useCallback(() => listFeedback(status, type)
    .then((r) => { setData(r); countsRef.current?.(r?.counts || {}) })
    .catch((e) => setToast({ text: e.message, error: true })), [status, type])
  useEffect(() => { load() }, [load])

  async function update(item, next) {
    setSaving(true)
    try {
      await setFeedbackStatus(item.id, next, reply.trim() ? reply.trim() : null)
      setOpen(null)
      setReply('')
      setToast({ text: reply.trim() ? 'Reply sent' : `Marked ${next.toLowerCase()}` })
      setTimeout(() => setToast({ text: '' }), 2500)
      load()
    } catch (e) {
      setToast({ text: e.message || 'Could not update', error: true })
    } finally {
      setSaving(false)
    }
  }

  const paged = usePaged(data?.items, 10, `${status}|${type}`)
  const c = data?.counts || {}
  const total = (c.new || 0) + (c.seen || 0) + (c.resolved || 0)
  const cards = [['New', c.new], ['Seen', c.seen], ['Resolved', c.resolved], ['', data ? total : null]]
  return (
    <div>
      <p className="mb-4 text-sm text-gray-900">Feedback, problems and suggestions sent by users from the Feedback page. A reply reaches the sender as a notification.</p>

      {/* red cards like Signals Captured; click one to show only those */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([s, n]) => {
          const on = status === s
          return (
            <button key={s || 'all'} type="button" aria-pressed={on} onClick={() => setStatus(s)}
              className={`rounded-xl p-4 text-left text-white ${on ? 'bg-red-700 ring-2 ring-red-300' : 'bg-red-600 hover:bg-red-700'} ${FOCUS}`}>
              <span className="block text-[11px] font-bold uppercase tracking-wide">{s || 'All feedback'}</span>
              <span className="mt-1 block text-2xl font-bold tabular-nums">{n ?? '–'}</span>
            </button>
          )
        })}
      </div>
      <div className="mb-4 flex justify-end">
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className={`h-10 w-44 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 ${FOCUS}`}>
          <option value="">All types</option><option>Feedback</option><option>Problem</option><option>Suggestion</option>
        </select>
      </div>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {!data ? <p className="p-8 text-sm text-gray-900">Loading…</p> : !data.items.length ? (
          <p className="p-10 text-center text-sm text-gray-900">Nothing here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs">
                  <th className="w-10 px-3 py-3">#</th><th className="px-3 py-3">From</th><th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Message</th><th className="px-3 py-3">Sent</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.shown.map((f, i) => (
                  <Fragment key={f.id}>
                    <tr className="align-top hover:bg-gray-50">
                      <td className="px-3 py-3 tabular-nums text-gray-900">{paged.offset + i + 1}</td>
                      <td className="px-3 py-3 text-gray-900"><span className="font-medium">{f.by || 'Unknown'}</span><span className="block text-xs">{[f.role, f.region].filter(Boolean).join(' · ')}</span></td>
                      <td className="px-3 py-3"><Badge tone={TYPE_TONE[f.type]}>{f.type}</Badge></td>
                      <td className="max-w-lg px-3 py-3 text-gray-900">
                        <p className="whitespace-pre-wrap">{f.message}</p>
                        {f.response && <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs"><span className="font-semibold">Reply{f.handledBy ? ` (${f.handledBy})` : ''}: </span>{f.response}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-900">{shortWhen(f.createdOn)}</td>
                      <td className="px-3 py-3"><Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge></td>
                      <td className="px-3 py-3 text-right">
                        {f.status !== 'Resolved' && open !== f.id && (
                          <button type="button" onClick={() => { setOpen(f.id); setReply('') }}
                            className={`inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 ${FOCUS}`}>Reply</button>
                        )}
                      </td>
                    </tr>
                    {open === f.id && (
                      <tr>
                        <td colSpan={7} className="bg-gray-50 px-3 py-3">
                          <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the sender (optional)" className={TEXTAREA} />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button" disabled={saving} onClick={() => update(f, 'Resolved')} className={BTN_PRIMARY}>Resolve</button>
                            <button type="button" disabled={saving} onClick={() => update(f, 'Seen')} className={BTN_SECONDARY}>Mark seen</button>
                            <button type="button" onClick={() => { setOpen(null); setReply('') }} className={BTN_SECONDARY}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager paged={paged} noun="items" />
      </section>
      <Toast text={toast.text} error={toast.error} />
    </div>
  )
}
