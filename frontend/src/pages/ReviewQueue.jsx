import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link, useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { Search, RefreshCw, AlertTriangle, X, Clock, ShieldAlert } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import {
  getReviewEvents, getReviewEvent, setEventStatus, getRegions, getDiseaseOptions,
} from '../api/frappe'
import { parseDateOnly, formatDateOnly, relativeDays } from '../data/formOptions'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1'
const SELECT_CLS = `appearance-none bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-900 ${FOCUS}`

const SEVERITY_STYLES = {
  critical: 'bg-red-600 text-white',
  high: 'bg-amber-400 text-white',
  standard: 'bg-blue-500 text-white',
}

const SEVERITIES = ['critical', 'high', 'standard']

const STATUS_STYLES = {
  New: 'border-amber-400 bg-amber-400/10 text-amber-500',
  Verifying: 'border-purple-400 bg-purple-400/10 text-purple-500',
  Verified: 'border-blue-500 bg-blue-500/10 text-blue-600',
  Escalated: 'border-red-500 bg-red-500/10 text-red-600',
  Discarded: 'border-gray-300 bg-gray-100 text-gray-500',
  Closed: 'border-emerald-500 bg-emerald-500/10 text-emerald-600',
}

const TABS = [
  { key: 'new', label: 'New', status: 'New' },
  { key: 'verifying', label: 'Verifying', status: 'Verifying' },
  { key: 'verified', label: 'Verified', status: 'Verified' },
  { key: 'escalated', label: 'Escalated', status: 'Escalated' },
  { key: 'discarded', label: 'Discarded', status: 'Discarded' },
  { key: 'closed', label: 'Closed', status: 'Closed' },
  { key: 'all', label: 'All', status: 'All' },
]

const EMPTY_TEXT = {
  new: 'No new events waiting for an officer.',
  verifying: 'No events are being verified right now.',
  verified: 'No verified events.',
  escalated: 'No escalated events.',
  discarded: 'No discarded events.',
  closed: 'No closed events.',
  all: 'No events match these filters.',
}

const SOURCES = ['CBS', 'Field', 'EMR']

const ACTIONS_BY_STATUS = {
  New: ['start', 'confirm', 'escalate', 'discard', 'close'],
  Verifying: ['confirm', 'escalate', 'discard', 'close'],
  Verified: ['escalate', 'discard', 'close'],
  Escalated: ['discard', 'close'],
  Discarded: ['reopen'],
  Closed: ['reopen'],
}

const ACTION_META = {
  start: { label: 'Start verification', cls: 'bg-red-600 text-white hover:bg-red-700 border-red-600' },
  confirm: { label: 'Confirm', cls: 'bg-red-600 text-white hover:bg-red-700 border-red-600' },
  escalate: { label: 'Escalate', cls: 'bg-white text-amber-600 border-amber-300 hover:bg-amber-50' },
  discard: { label: 'Discard', cls: 'bg-white text-gray-900 border-gray-200 hover:bg-gray-50' },
  close: { label: 'Close', cls: 'bg-white text-gray-900 border-gray-200 hover:bg-gray-50' },
  reopen: { label: 'Reopen', cls: 'bg-white text-gray-900 border-gray-200 hover:bg-gray-50' },
}

const NOTE_CONFIG = {
  escalate: { label: 'Why is this being escalated?', required: true },
  discard: { label: 'What did you find?', required: true },
  confirm: { label: 'Note (optional)', required: false },
  close: { label: 'Note (optional)', required: false },
}

const FORBIDDEN_MSG = "You don't have access to the Review Queue."
const REFRESH_MS = 5 * 60 * 1000

function parseDate(v) {
  if (!v) return null
  const d = new Date(String(v).replace(' ', 'T'))
  return isNaN(d) ? null : d
}

function fmtDateTime(v) {
  if (!v) return '—'
  const dateOnly = parseDateOnly(v)
  if (dateOnly) return formatDateOnly(dateOnly)
  const d = parseDate(v)
  if (!d) return String(v)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function relTime(v) {
  const dateOnly = parseDateOnly(v)
  if (dateOnly) return relativeDays(dateOnly)
  const d = parseDate(v)
  if (!d) return '—'
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function peopleLine(e) {
  return `${e.people ?? 0} people · ${e.reports ?? 0} reports · ${(e.sources || []).join(', ')}`
}

function Badges({ event }) {
  return (
    <>
      <span className={`text-xs font-medium px-2.5 py-1 rounded uppercase tracking-wide ${SEVERITY_STYLES[event.severity] || 'bg-gray-400 text-white'}`}>
        {event.severity}
      </span>
      <span className={`inline-flex items-center text-[10px] font-medium px-2.5 py-1 rounded-full border ${STATUS_STYLES[event.status] || 'border-gray-200 bg-gray-50 text-gray-500'}`}>
        {event.status}
      </span>
    </>
  )
}

function AlertChip({ linkedAlert }) {
  if (!linkedAlert) return null
  return (
    <Link
      to={`/alerts-signals/${linkedAlert.id}`}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded-full bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 ${FOCUS}`}
    >
      Outbreak alert
    </Link>
  )
}

function WarningIcon({ text }) {
  if (!text) return null
  return (
    <span title={text} tabIndex={0} aria-label={`Data warning. ${text}`} className={`inline-flex rounded ${FOCUS}`}>
      <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
    </span>
  )
}

function ActionButtons({ event, canAct, busy, onAction, size = 'sm' }) {
  if (!canAct) return null
  const actions = ACTIONS_BY_STATUS[event.status] || []
  const pad = size === 'lg' ? 'px-5 py-2.5 text-sm' : 'px-4 py-2 text-xs'
  return (
    <>
      {actions.map((a) => (
        <button
          key={a}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onAction(event, a)
          }}
          className={`border rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${pad} ${ACTION_META[a].cls} ${FOCUS}`}
        >
          {ACTION_META[a].label}
        </button>
      ))}
    </>
  )
}

function SkeletonRow() {
  return (
    <div className="p-6 border-t border-gray-100 first:border-t-0 animate-pulse flex gap-6">
      <div className="flex-1 space-y-3">
        <div className="h-4 bg-gray-100 rounded w-1/3" />
        <div className="h-3 bg-gray-100 rounded w-2/3" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
      <div className="h-8 w-24 bg-gray-100 rounded-lg hidden md:block" />
    </div>
  )
}

function EventRow({ event, canAct, busy, onOpen, onAction }) {
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') onOpen()
      }}
      className={`flex flex-col md:flex-row md:items-start justify-between gap-4 p-4 sm:p-6 cursor-pointer hover:bg-gray-50 transition-colors ${FOCUS} focus-visible:ring-inset`}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Badges event={event} />
          <WarningIcon text={event.dataWarning} />
          <AlertChip linkedAlert={event.linkedAlert} />
        </div>
        <h3 className="text-base font-bold text-gray-900">{event.title}</h3>
        <p className="text-sm text-gray-600">
          {peopleLine(event)}
          {event.deaths > 0 && <span className="text-red-600 font-medium"> · {event.deaths} deaths</span>}
        </p>
        {event.reason && (
          <p title={event.reason} className="text-sm text-gray-400 truncate">{event.reason}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            First reported {relTime(event.firstSeen)}
          </span>
          {event.status === 'New' && event.openHours > 24 && (
            <span className="inline-flex items-center font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
              {event.openHours < 48 ? `Waiting ${Math.round(event.openHours)}h` : `Waiting ${Math.floor(event.openHours / 24)} days`}
            </span>
          )}
        </div>
      </div>
      {canAct && (
        <div className="flex gap-2 flex-wrap md:flex-col md:items-stretch md:shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-gray-100">
          <ActionButtons event={event} canAct={canAct} busy={busy} onAction={onAction} />
        </div>
      )}
    </div>
  )
}

function NoteDialog({ pending, busy, onCancel, onSubmit }) {
  const [note, setNote] = useState('')
  const cfg = NOTE_CONFIG[pending.action]
  const canSubmit = !busy && (!cfg.required || note.trim().length > 0)
  const ref = useRef(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={busy ? undefined : onCancel} />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-dialog-title"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) onSubmit(note.trim())
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onCancel()
        }}
        className="relative bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md p-6 space-y-4"
      >
        <div>
          <h3 id="note-dialog-title" className="text-base font-bold text-gray-900">
            {ACTION_META[pending.action].label}
          </h3>
          <p className="text-sm text-gray-400">{pending.event.title}</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-900">
            {cfg.label}
            {cfg.required && <span className="text-red-600"> *</span>}
          </span>
          <textarea
            ref={ref}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            required={cfg.required}
            className={`w-full bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 text-sm ${FOCUS}`}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`bg-red-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`}
          >
            {ACTION_META[pending.action].label}
          </button>
        </div>
      </form>
    </div>
  )
}

function SummaryItem({ label, value, danger }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className={`text-sm font-medium break-words ${danger ? 'text-red-600' : 'text-gray-900'}`}>{value}</dd>
    </div>
  )
}

function Drawer({ id, event, loading, error, busy, onClose, onRetry, onAction }) {
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"][aria-labelledby="note-dialog-title"]')) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const signals = useMemo(
    () => [...(event?.signals || [])].sort((a, b) => (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0)),
    [event]
  )
  const timeline = useMemo(
    () => [...(event?.timeline || [])].sort((a, b) => (parseDate(b.at)?.getTime() || 0) - (parseDate(a.at)?.getTime() || 0)),
    [event]
  )

  const hasActions = event && event.canAct && (ACTIONS_BY_STATUS[event.status] || []).length > 0

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={event?.title || `Event ${id}`}
        className="relative bg-white w-full md:max-w-3xl h-full flex flex-col shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 p-4 sm:p-6 border-b border-gray-100">
          <div className="min-w-0 space-y-2">
            {event ? (
              <>
                <h2 className="text-lg font-bold text-gray-900">{event.title}</h2>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <Badges event={event} />
                  <AlertChip linkedAlert={event.linkedAlert} />
                </div>
              </>
            ) : (
              <h2 className="text-lg font-bold text-gray-900">Event details</h2>
            )}
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close details"
            className={`border border-gray-200 rounded-lg p-2 text-gray-500 hover:bg-gray-50 shrink-0 ${FOCUS}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/3" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}
              </div>
              <div className="h-24 bg-gray-100 rounded" />
              <div className="h-32 bg-gray-100 rounded" />
            </div>
          ) : error ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-sm text-gray-500">{error}</p>
              <button onClick={onRetry} className={`bg-red-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-red-700 ${FOCUS}`}>
                Retry
              </button>
            </div>
          ) : event ? (
            <>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 bg-white rounded-2xl border border-gray-100 p-5">
                <SummaryItem label="Disease" value={event.diseaseName || event.disease || '—'} />
                <SummaryItem label="Area" value={[event.area, event.subCounty].filter(Boolean).join(', ') || 'Location missing'} />
                <SummaryItem label="County" value={event.county || '—'} />
                <SummaryItem label="Region" value={event.regionName || '—'} />
                <SummaryItem label="People" value={event.people ?? 0} />
                <SummaryItem label="Deaths" value={event.deaths ?? 0} danger={event.deaths > 0} />
                <SummaryItem label="Reports" value={event.reports ?? 0} />
                <SummaryItem label="First report" value={fmtDateTime(event.firstSeen)} />
                <SummaryItem label="Last report" value={fmtDateTime(event.lastSeen)} />
                <SummaryItem label="Sources" value={(event.sources || []).join(', ') || '—'} />
              </dl>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">Why this was flagged</h3>
                {event.dataWarning && (
                  <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{event.dataWarning}</span>
                  </div>
                )}
                <p className="text-sm text-gray-600">{event.reason || '—'}</p>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">Reports</h3>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 text-xs border-b border-gray-100">
                          <th className="px-4 py-3 font-medium whitespace-nowrap">Date</th>
                          <th className="px-4 py-3 font-medium">Source</th>
                          <th className="px-4 py-3 font-medium whitespace-nowrap">Case no.</th>
                          <th className="px-4 py-3 font-medium">Area</th>
                          <th className="px-4 py-3 font-medium">People</th>
                          <th className="px-4 py-3 font-medium">What was reported</th>
                          <th className="px-4 py-3 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {signals.length === 0 ? (
                          <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No reports</td></tr>
                        ) : signals.map((s, i) => (
                          <tr key={s.id || i} className="border-t border-gray-100 align-top">
                            <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtDateTime(s.date)}</td>
                            <td className="px-4 py-3 text-gray-900">{s.source}</td>
                            <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                              {s.source === 'Field' && s.ref ? (
                                <Link to={`/reports/${encodeURIComponent(s.ref)}`} className={`text-red-600 hover:underline rounded ${FOCUS}`}>
                                  {s.ref}
                                </Link>
                              ) : (
                                <span className="text-gray-900">{s.ref || '—'}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-600">{s.area || '—'}</td>
                            <td className="px-4 py-3 text-gray-600">{s.people ?? 0}</td>
                            <td className="px-4 py-3 text-gray-600 min-w-[160px]">{s.reported || '—'}</td>
                            <td className="px-4 py-3 text-gray-500 min-w-[160px]">{s.reason || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  Search the case number in CBS, or the report ID in Case Reports, to see the full report.
                </p>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">Timeline</h3>
                {timeline.length === 0 ? (
                  <p className="text-sm text-gray-400">No activity yet.</p>
                ) : (
                  <ol className="space-y-4">
                    {timeline.map((t, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-2 h-2 rounded-full bg-red-600 mt-1.5 shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900">
                            <span className="font-medium">{t.action}</span>
                            <span className="text-gray-500"> · {t.user} · <span title={fmtDateTime(t.at)}>{relTime(t.at)}</span></span>
                          </p>
                          {t.note && <p className="text-sm text-gray-500 break-words">{t.note}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          ) : null}
        </div>

        {event && !loading && !error && (
          <div className="sticky bottom-0 border-t border-gray-100 bg-white p-4 flex gap-2 flex-wrap">
            {hasActions ? (
              <ActionButtons event={event} canAct busy={busy} onAction={onAction} size="lg" />
            ) : !event.canAct ? (
              <p className="text-sm text-gray-400">You can view this queue but not take actions.</p>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  )
}

export default function ReviewQueue() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()

  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'new'
  const q = params.get('q') || ''
  const disease = params.get('disease') || ''
  const region = params.get('region') || ''
  const sources = (params.get('source') || '').split(',').filter((s) => SOURCES.includes(s))
  const sourceParam = sources.join(',')
  const sevs = (params.get('sev') || '').split(',').filter((s) => SEVERITIES.includes(s))
  const sevParam = sevs.join(',')

  const [events, setEvents] = useState([])
  const [counts, setCounts] = useState(null)
  const [canAct, setCanAct] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [regions, setRegions] = useState([])
  const [diseases, setDiseases] = useState([])
  const [searchText, setSearchText] = useState(q)

  const [drawerEvent, setDrawerEvent] = useState(null)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState('')

  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState({ show: false, message: '', error: false })
  const toastTimer = useRef(null)
  const reqId = useRef(0)

  const showToast = useCallback((message, isError = false) => {
    setToast({ show: true, message, error: isError })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const setParam = useCallback(
    (updates) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          Object.entries(updates).forEach(([k, v]) => {
            if (v === '' || v == null) next.delete(k)
            else next.set(k, v)
          })
          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )

  useEffect(() => {
    getRegions().then((r) => setRegions(r || [])).catch(() => {})
    getDiseaseOptions().then((d) => setDiseases(d || [])).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchText !== q) setParam({ q: searchText.trim() === '' ? '' : searchText })
    }, 300)
    return () => clearTimeout(t)
  }, [searchText, q, setParam])

  const statusParam = TABS.find((t) => t.key === tab).status

  const load = useCallback(
    ({ silent = false } = {}) => {
      const mine = ++reqId.current
      if (!silent) {
        setLoading(true)
        setError('')
      }
      return getReviewEvents({ status: statusParam, disease, region, source: sourceParam, search: q, limit: 200 })
        .then((res) => {
          if (mine !== reqId.current) return
          setEvents(res?.events || [])
          setCounts(res?.counts || null)
          setCanAct(!!res?.canAct)
          setUpdatedAt(new Date())
          setForbidden(false)
          setError('')
        })
        .catch((e) => {
          if (mine !== reqId.current) return
          if (e.status === 403) setForbidden(true)
          else if (!silent) setError(e.message || 'We could not load events.')
        })
        .finally(() => {
          if (mine === reqId.current && !silent) setLoading(false)
        })
    },
    [statusParam, disease, region, sourceParam, q]
  )

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true })
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const loadDrawer = useCallback(() => {
    if (!id) return
    let cancelled = false
    setDrawerLoading(true)
    setDrawerError('')
    getReviewEvent(id)
      .then((ev) => { if (!cancelled) setDrawerEvent(ev) })
      .catch((e) => {
        if (cancelled) return
        if (e.status === 403) setForbidden(true)
        else setDrawerError(e.message || 'We could not load this event.')
      })
      .finally(() => { if (!cancelled) setDrawerLoading(false) })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    setDrawerEvent(null)
    return loadDrawer()
  }, [loadDrawer])

  const closeDrawer = useCallback(() => {
    navigate({ pathname: '/review', search: location.search })
  }, [navigate, location.search])

  const openEvent = (ev) => navigate({ pathname: `/review/${encodeURIComponent(ev.id)}`, search: location.search })

  async function runAction(event, action, note) {
    setBusy(true)
    try {
      const updated = await setEventStatus(event.id, action, note || '')
      showToast(`${event.title}: ${ACTION_META[action].label.toLowerCase()} done`)
      setPending(null)
      setDrawerEvent((cur) => (cur && cur.id === updated.id ? updated : cur))
      setEvents((list) => {
        const stays = tab === 'all' || TABS.find((t) => t.key === tab).status === updated.status
        return stays ? list.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)) : list.filter((e) => e.id !== updated.id)
      })
      load({ silent: true })
    } catch (e) {
      if (e.status === 403) setForbidden(true)
      else showToast(e.message || 'Could not update the event', true)
    } finally {
      setBusy(false)
    }
  }

  function handleAction(event, action) {
    if (NOTE_CONFIG[action]) setPending({ event, action })
    else runAction(event, action)
  }

  const total = counts ? Object.values(counts).reduce((s, n) => s + (n || 0), 0) : 0
  const tabCount = (key) => (key === 'all' ? total : counts?.[key])
  const visibleEvents = sevs.length ? events.filter((e) => sevs.includes(e.severity)) : events
  const filtersActive = !!(q || disease || region || sourceParam || sevParam)
  const clearFilters = () => {
    setSearchText('')
    setParam({ q: '', disease: '', region: '', source: '', sev: '' })
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Review Queue</h2>
          <p className="text-sm text-gray-400">Reports from Dadaab and Kalobeyei on priority diseases and unusual events, grouped for officers to verify.</p>
        </div>
        {!forbidden && (
          <div className="flex items-center gap-3">
            {updatedAt && (
              <span className="text-sm text-gray-400">
                Updated {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            )}
            <button
              onClick={() => load()}
              disabled={loading}
              className={`border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        )}
      </div>

      {forbidden ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <ShieldAlert className="w-8 h-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-gray-500">{FORBIDDEN_MSG}</p>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Event status" className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
            {TABS.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setParam({ tab: t.key === 'new' ? '' : t.key })}
                  className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px flex items-center gap-2 ${FOCUS} ${
                    active ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {t.label}
                  <span className={`text-xs rounded-full px-2 py-0.5 ${active ? 'bg-red-600/10 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                    {tabCount(t.key) ?? '–'}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 flex items-center gap-3 flex-wrap mb-6">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                type="text"
                aria-label="Search events"
                placeholder="Search by title or area..."
                className={`w-full bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-4 py-2.5 text-sm ${FOCUS}`}
              />
            </div>

            <select aria-label="Disease" value={disease} onChange={(e) => setParam({ disease: e.target.value })} className={SELECT_CLS}>
              <option value="">All diseases</option>
              {diseases.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>

            <select aria-label="Region" value={region} onChange={(e) => setParam({ region: e.target.value })} className={SELECT_CLS}>
              <option value="">All regions</option>
              {regions.map((r) => <option key={r.name} value={r.name}>{r.region_name || r.name}</option>)}
            </select>

            <select aria-label="Source" value={sources[0] || ''} onChange={(e) => setParam({ source: e.target.value })} className={SELECT_CLS}>
              <option value="">All sources</option>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <select aria-label="Severity" value={sevs[0] || ''} onChange={(e) => setParam({ sev: e.target.value })} className={`${SELECT_CLS} capitalize`}>
              <option value="">All severities</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            {filtersActive && (
              <button onClick={clearFilters} className={`text-sm font-medium text-red-600 hover:underline rounded ${FOCUS}`}>
                Clear filters
              </button>
            )}
          </div>

          {!canAct && !loading && !error && counts && (
            <p className="text-sm text-gray-400 mb-3">You can view this queue but not take actions.</p>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {loading ? (
              [0, 1, 2, 3].map((i) => <SkeletonRow key={i} />)
            ) : error ? (
              <div className="py-16 text-center space-y-3">
                <p className="text-sm text-gray-500">{error}</p>
                <button onClick={() => load()} className={`bg-red-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-red-700 ${FOCUS}`}>
                  Retry
                </button>
              </div>
            ) : visibleEvents.length === 0 ? (
              <div className="py-16 text-center space-y-1">
                <p className="text-sm font-medium text-gray-900">Nothing here</p>
                <p className="text-sm text-gray-400">{filtersActive ? 'No events match your filters.' : EMPTY_TEXT[tab]}</p>
                {filtersActive && (
                  <button onClick={clearFilters} className={`text-sm font-medium text-red-600 hover:underline rounded ${FOCUS}`}>
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              visibleEvents.map((ev, i) => (
                <div key={ev.id} className={i !== 0 ? 'border-t border-gray-100' : ''}>
                  <EventRow event={ev} canAct={canAct} busy={busy} onOpen={() => openEvent(ev)} onAction={handleAction} />
                </div>
              ))
            )}
          </div>
        </>
      )}

      {id && !forbidden && (
        <Drawer
          id={id}
          event={drawerEvent}
          loading={drawerLoading}
          error={drawerError}
          busy={busy}
          onClose={closeDrawer}
          onRetry={loadDrawer}
          onAction={handleAction}
        />
      )}

      {pending && (
        <NoteDialog
          pending={pending}
          busy={busy}
          onCancel={() => setPending(null)}
          onSubmit={(note) => runAction(pending.event, pending.action, note)}
        />
      )}

      {toast.show && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[70] rounded-xl px-5 py-3 text-sm text-white shadow-lg ${toast.error ? 'bg-red-600' : 'bg-gray-900'}`}
        >
          {toast.message}
        </div>
      )}
    </AppShell>
  )
}
