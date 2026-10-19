import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { Search, RefreshCw, AlertTriangle, Clock, ShieldAlert } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getReviewEvents, getDiseaseOptions } from '../api/frappe'
import { FOCUS, STATUS_STYLES, parseDate, relTime } from '../data/eventHelpers'

const SELECT_CLS = `appearance-none bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-900 ${FOCUS}`

const SEVERITY_BADGE = { critical: 'bg-red-600 text-white', high: 'bg-amber-400 text-white', standard: 'bg-blue-500 text-white' }
const SEVERITY_RANK = { critical: 0, high: 1, standard: 2 }
const SEVERITIES = [
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'standard', label: 'Standard' },
]
const SOURCES = ['CBS', 'Field']

const TABS = [
  { key: 'new', label: 'New', statuses: ['New'] },
  { key: 'verifying', label: 'Verifying', statuses: ['Verifying'] },
  { key: 'investigating', label: 'In the field', statuses: ['Investigating'] },
  { key: 'verified', label: 'Verified', statuses: ['Verified'] },
  { key: 'escalated', label: 'Escalated', statuses: ['Escalated'] },
  { key: 'closed', label: 'Closed & discarded', statuses: ['Discarded', 'Closed'] },
  { key: 'all', label: 'All', statuses: null },
]

const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'severe', label: 'Most severe first' },
]

const EMPTY_TEXT = {
  new: 'No new reports to review. New CBS reports arrive every hour; field reports arrive as soon as they are submitted.',
  verifying: 'No events are being verified right now. Start verification on a new report to see it here.',
  investigating: 'No field investigations under way.',
  verified: 'No verified events.',
  escalated: 'No escalated events.',
  closed: 'No closed or discarded events.',
  all: 'No events to show yet.',
}

const FORBIDDEN_MSG = "You don't have access to Alerts & Signals."
const REFRESH_MS = 5 * 60 * 1000

const time = (v) => parseDate(v)?.getTime() || 0

function sortEvents(list, sort) {
  const out = [...list]
  if (sort === 'oldest') out.sort((a, b) => time(a.firstSeen) - time(b.firstSeen))
  else if (sort === 'severe') {
    out.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || time(b.lastSeen) - time(a.lastSeen))
  } else out.sort((a, b) => time(b.lastSeen) - time(a.lastSeen))
  return out
}

function SkeletonRow() {
  return (
    <div className="p-6 border-t border-gray-100 first:border-t-0 animate-pulse flex gap-6">
      <div className="flex-1 space-y-3">
        <div className="h-4 bg-gray-100 rounded w-1/3" />
        <div className="h-3 bg-gray-100 rounded w-2/3" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
      <div className="h-9 w-20 bg-gray-100 rounded-lg hidden md:block" />
    </div>
  )
}

function SummaryCard({ label, value, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`text-left bg-white rounded-xl border px-4 py-3 hover:bg-gray-50 transition-colors ${FOCUS} ${active ? 'border-red-600' : 'border-gray-100'}`}
    >
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-2xl font-semibold text-gray-900">{value ?? '–'}</div>
    </button>
  )
}

function EventRow({ event, search }) {
  const navigate = useNavigate()
  const to = { pathname: `/alerts-signals/${encodeURIComponent(event.id)}`, search }
  const open = () => navigate(to)
  const waiting = event.status === 'New' && event.openHours > 24
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') open()
      }}
      className={`flex items-stretch gap-4 px-4 sm:px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${FOCUS} focus-visible:ring-inset`}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={`text-xs font-medium px-2.5 py-1 rounded tracking-wide ${SEVERITY_BADGE[event.severity] || 'bg-gray-300 text-white'}`}>
            {(event.severity || '').toUpperCase()}
          </span>
          <span className={`inline-flex items-center text-[10px] font-medium px-2.5 py-1 rounded-full border ${STATUS_STYLES[event.status] || 'border-gray-200 bg-gray-50 text-gray-500'}`}>
            {event.status}
          </span>
          <h3 className="text-base font-bold text-gray-900">{event.title}</h3>
          {event.dataWarning && (
            <span title={event.dataWarning} tabIndex={0} aria-label={`Data warning. ${event.dataWarning}`} className={`inline-flex rounded ${FOCUS}`}>
              <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
            </span>
          )}
          {event.linkedAlert && (
            <Link
              to={`/epi-trends/${event.linkedAlert.id}`}
              onClick={(e) => e.stopPropagation()}
              className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded-full bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 ${FOCUS}`}
            >
              Part of an outbreak
            </Link>
          )}
        </div>
        <p className="text-sm text-gray-600">
          {event.people ?? 0} people · {event.reports ?? 0} reports · {(event.sources || []).join(', ')}
          {event.deaths > 0 && <span className="text-red-600 font-medium"> · {event.deaths} deaths</span>}
        </p>
        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            First reported {relTime(event.firstSeen)}
          </span>
          {waiting && (
            <span className="inline-flex items-center font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
              {event.openHours < 48 ? `Waiting ${Math.round(event.openHours)}h` : `Waiting ${Math.floor(event.openHours / 24)} days`}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center shrink-0">
        <Link
          to={to}
          onClick={(e) => e.stopPropagation()}
          className={`border border-red-600 text-red-600 rounded-lg px-5 py-2 text-sm font-medium hover:bg-red-50 ${FOCUS}`}
        >
          View
        </Link>
      </div>
    </div>
  )
}

export default function AlertsSignalsQueue() {
  const location = useLocation()
  const [params, setParams] = useSearchParams()

  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'new'
  const sort = SORTS.some((s) => s.key === params.get('sort')) ? params.get('sort') : 'newest'
  const q = params.get('q') || ''
  const disease = params.get('disease') || ''
  const source = SOURCES.includes(params.get('source')) ? params.get('source') : ''
  const sev = SEVERITIES.some((s) => s.key === params.get('sev')) ? params.get('sev') : ''
  const waitingOnly = params.get('wait') === '1' && tab === 'new'

  const [events, setEvents] = useState([])
  const [counts, setCounts] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [diseases, setDiseases] = useState([])
  const [searchText, setSearchText] = useState(q)
  const reqId = useRef(0)

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
    getDiseaseOptions().then((d) => setDiseases(d || [])).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchText !== q) setParam({ q: searchText.trim() === '' ? '' : searchText })
    }, 300)
    return () => clearTimeout(t)
  }, [searchText, q, setParam])

  const statuses = TABS.find((t) => t.key === tab).statuses

  const load = useCallback(
    ({ silent = false } = {}) => {
      const mine = ++reqId.current
      if (!silent) {
        setLoading(true)
        setError('')
      }
      const listReq = getReviewEvents({
        status: statuses && statuses.length === 1 ? statuses[0] : 'All',
        disease, source, search: q, limit: 500,
      })
      const summaryReq = getReviewEvents({ status: 'New', limit: 500 })
      return Promise.all([listReq, summaryReq])
        .then(([res, sum]) => {
          if (mine !== reqId.current) return
          setEvents(res?.events || [])
          setCounts(res?.counts || null)
          setSummary({
            counts: sum?.counts || null,
            waiting: (sum?.events || []).filter((e) => e.openHours > 24).length,
          })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, disease, source, q]
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

  const visibleEvents = useMemo(() => {
    let list = events
    if (statuses) list = list.filter((e) => statuses.includes(e.status))
    if (sev) list = list.filter((e) => e.severity === sev)
    if (waitingOnly) list = list.filter((e) => e.openHours > 24)
    return sortEvents(list, sort)
  }, [events, statuses, sev, waitingOnly, sort])

  const sumCounts = summary?.counts || counts
  const total = counts ? Object.values(counts).reduce((s, n) => s + (n || 0), 0) : null
  const tabCount = (key) => {
    if (!counts) return null
    if (key === 'all') return total
    if (key === 'closed') return (counts.discarded || 0) + (counts.closed || 0)
    return counts[key]
  }

  const filtersActive = !!(q || disease || source || sev || waitingOnly)
  const clearFilters = () => {
    setSearchText('')
    setParam({ q: '', disease: '', source: '', sev: '', wait: '' })
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Alerts & Signals</h2>
          <p className="text-sm text-gray-400">Reports from the community and field teams, grouped by disease and place. Open each one to verify it.</p>
          <p className="text-xs text-gray-400 mt-1">
            Looking for rising trends over weeks?{' '}
            <Link to="/epi-trends" className={`font-medium text-red-600 hover:underline rounded ${FOCUS}`}>See Epi Trends →</Link>
          </p>
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <SummaryCard label="Need review" value={sumCounts?.new} active={tab === 'new' && !waitingOnly} onClick={() => setParam({ tab: '', wait: '' })} />
            <SummaryCard label="Being verified" value={sumCounts?.verifying} active={tab === 'verifying'} onClick={() => setParam({ tab: 'verifying', wait: '' })} />
            <SummaryCard label="Waiting over 24h" value={summary?.waiting} active={waitingOnly} onClick={() => setParam({ tab: '', wait: '1' })} />
            <SummaryCard label="In the field" value={sumCounts?.investigating} active={tab === 'investigating'} onClick={() => setParam({ tab: 'investigating', wait: '' })} />
          </div>

          <div role="tablist" aria-label="Event status" className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
            {TABS.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setParam({ tab: t.key === 'new' ? '' : t.key, wait: '' })}
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

            <select aria-label="Severity" value={sev} onChange={(e) => setParam({ sev: e.target.value })} className={SELECT_CLS}>
              <option value="">All severities</option>
              {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>

            <select aria-label="Source" value={source} onChange={(e) => setParam({ source: e.target.value })} className={SELECT_CLS}>
              <option value="">All sources</option>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <select aria-label="Sort" value={sort} onChange={(e) => setParam({ sort: e.target.value === 'newest' ? '' : e.target.value })} className={SELECT_CLS}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>

            {filtersActive && (
              <button onClick={clearFilters} className={`text-sm font-medium text-red-600 hover:underline rounded ${FOCUS}`}>
                Clear filters
              </button>
            )}
          </div>

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
              <div className="py-16 px-6 text-center space-y-1">
                <p className="text-sm font-medium text-gray-900">Nothing here</p>
                <p className="text-sm text-gray-400 max-w-md mx-auto">
                  {filtersActive ? 'No events match your filters.' : EMPTY_TEXT[tab]}
                </p>
                {filtersActive && (
                  <button onClick={clearFilters} className={`text-sm font-medium text-red-600 hover:underline rounded ${FOCUS}`}>
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              visibleEvents.map((ev, i) => (
                <div key={ev.id} className={i !== 0 ? 'border-t border-gray-100' : ''}>
                  <EventRow event={ev} search={location.search} />
                </div>
              ))
            )}
          </div>
        </>
      )}
    </AppShell>
  )
}
