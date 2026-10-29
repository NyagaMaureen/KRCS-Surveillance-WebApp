import { useEffect, useState } from 'react'
import { ThumbsUp, TriangleAlert, Lightbulb, Send } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { submitFeedback, getMyFeedback } from '../api/frappe'
import { FOCUS, CARD, TEXTAREA, BTN_PRIMARY, PageTitle, Badge, Toast, shortWhen } from '../components/chp/ui'

const TYPES = [
  { key: 'Feedback', label: 'Give feedback', icon: ThumbsUp, color: 'text-green-600' },
  { key: 'Problem', label: 'Report a problem', icon: TriangleAlert, color: 'text-red-600' },
  { key: 'Suggestion', label: 'Suggest improvement', icon: Lightbulb, color: 'text-amber-500' },
]
const STATUS_TONE = { New: 'gray', Seen: 'blue', Resolved: 'green' }

export default function Feedback() {
  const [type, setType] = useState('Feedback')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [mine, setMine] = useState([])
  const [toast, setToast] = useState({ text: '', error: false })

  const load = () => getMyFeedback().then(setMine).catch(() => {})
  useEffect(() => { load() }, [])
  const flash = (text, error = false) => { setToast({ text, error }); setTimeout(() => setToast({ text: '' }), 3000) }

  async function send() {
    setSending(true)
    try {
      let from = ''
      try { from = document.referrer ? new URL(document.referrer).pathname : '' } catch { from = '' }
      await submitFeedback(type, message.trim(), from)
      setMessage('')
      flash('Thank you. Your message was sent to the team.')
      load()
    } catch (e) {
      flash(e.message || 'Could not send', true)
    } finally {
      setSending(false)
    }
  }

  return (
    <AppShell>
      <PageTitle title="Community Feedback" subtitle="Tell us what works, what doesn't, and how we can improve surveillance and response." />

      <section className={`${CARD} p-5`}>
        <div role="radiogroup" aria-label="Type of message" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {TYPES.map((t) => (
            <button key={t.key} type="button" role="radio" aria-checked={type === t.key} onClick={() => setType(t.key)}
              className={`rounded-xl px-4 py-5 flex flex-col items-center gap-2 text-sm ${FOCUS} ${type === t.key ? 'bg-white ring-2 ring-gray-900' : 'bg-gray-50 hover:bg-gray-100'}`}>
              <t.icon className={`w-6 h-6 ${t.color}`} aria-hidden="true" />
              <span className={type === t.key ? 'font-medium text-gray-900' : 'text-gray-700'}>{t.label}</span>
            </button>
          ))}
        </div>
        <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Your message"
          placeholder="Write your message..." className={TEXTAREA} />
        <button type="button" onClick={send} disabled={sending || message.trim().length < 3} className={`${BTN_PRIMARY} w-full mt-4`}>
          <Send className="w-4 h-4" aria-hidden="true" /> {sending ? 'Sending…' : 'Submit feedback'}
        </button>
      </section>

      {mine.length > 0 && (
        <section className={`${CARD} p-5 mt-5`}>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Your messages</h2>
          <ul className="divide-y divide-gray-100">
            {mine.map((f) => (
              <li key={f.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">{f.type} · {shortWhen(f.createdOn)}</p>
                  <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
                </div>
                <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{f.message}</p>
                {f.response && <p className="text-sm text-gray-600 mt-2 rounded-lg bg-gray-50 px-3 py-2"><span className="font-medium">Reply: </span>{f.response}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Toast text={toast.text} error={toast.error} />
    </AppShell>
  )
}
