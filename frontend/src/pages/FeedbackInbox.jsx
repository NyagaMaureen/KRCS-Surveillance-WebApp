import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { listFeedback, setFeedbackStatus } from '../api/frappe'
import { FOCUS, CARD, INPUT, TEXTAREA, BTN_PRIMARY, BTN_SECONDARY, Badge, Toast, shortWhen } from '../components/chp/ui'

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

  const c = data?.counts || {}
  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">Feedback, problems and suggestions sent by users from the Feedback page. A reply reaches the sender as a notification.</p>

      <div className="grid grid-cols-3 gap-3 max-w-xl mb-4">
        {['New', 'Seen', 'Resolved'].map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(status === s ? '' : s)}
            className={`${CARD} text-left px-4 py-3 ${status === s ? 'ring-1 ring-gray-300' : ''} ${FOCUS}`}>
            <span className="block text-xs text-gray-500">{s}</span>
            <span className="block text-xl font-semibold text-gray-900 tabular-nums">{c[s.toLowerCase()] ?? '–'}</span>
          </button>
        ))}
      </div>
      <div className="mb-4 max-w-xs">
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
          <option value="">All types</option><option>Feedback</option><option>Problem</option><option>Suggestion</option>
        </select>
      </div>

      <section className={`${CARD}`}>
        {!data ? <p className="p-8 text-sm text-gray-400">Loading…</p> : !data.items.length ? (
          <p className="p-10 text-center text-sm text-gray-400">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.items.map((f) => (
              <li key={f.id} className="p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone={TYPE_TONE[f.type]}>{f.type}</Badge>
                    <span className="text-sm text-gray-900 font-medium">{f.by || 'Unknown'}</span>
                    <span className="text-xs text-gray-400">{[f.role, f.region, shortWhen(f.createdOn)].filter(Boolean).join(' · ')}</span>
                  </div>
                  <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
                </div>
                <p className="text-sm text-gray-800 mt-2 whitespace-pre-wrap">{f.message}</p>
                {f.response && <p className="text-sm text-gray-600 mt-2 rounded-lg bg-gray-50 px-3 py-2"><span className="font-medium">Reply{f.handledBy ? ` (${f.handledBy})` : ''}: </span>{f.response}</p>}
                {open === f.id ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the sender (optional)" className={TEXTAREA} />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={saving} onClick={() => update(f, 'Resolved')} className={BTN_PRIMARY}>Resolve</button>
                      <button type="button" disabled={saving} onClick={() => update(f, 'Seen')} className={BTN_SECONDARY}>Mark seen</button>
                      <button type="button" onClick={() => { setOpen(null); setReply('') }} className={BTN_SECONDARY}>Cancel</button>
                    </div>
                  </div>
                ) : f.status !== 'Resolved' && (
                  <button type="button" onClick={() => { setOpen(f.id); setReply('') }} className={`mt-3 text-sm font-medium text-red-600 hover:underline rounded ${FOCUS}`}>Reply or resolve</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Toast text={toast.text} error={toast.error} />
    </div>
  )
}
