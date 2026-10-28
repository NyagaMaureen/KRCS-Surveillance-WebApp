import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { Search, RefreshCw, ShieldAlert, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getReviewEvents, getDiseaseOptions } from '../api/frappe'
import { statusLabel, parseDate } from '../data/eventHelpers'
import { FOCUS, BTN_SECONDARY, EmptyState } from '../components/surveillance/ui'

const SEVERITY_RANK = { critical: 0, high: 1, standard: 2 }
const SEVERITIES = [
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'standard', label: 'Standard' },
]
const SOURCES = ['CBS', 'Field']
const SOURCE_NAME = { CBS: 'CBS', Field: 'Field report' }
// Target time to start verification, by severity (same as the Epi Trends recommended actions)
const TARGET_HOURS = { critical: 24, high: 48, standard: 72 }
const WAITING_STATUSES = ['New', 'Verifying']

const TABS = [
  { key: 'new', label: 'To review', statuses: ['New'] },
  { key: 'verifying', label: 'Verifying', statuses: ['Verifying'] },
  { key: 'investigating', label: 'In the field', statuses: ['Investigating'] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['Confirmed'] },
  { key: 'escalated', label: 'Escalated', statuses: ['Escalated'] },
  { key: 'closed', label: 'Closed', statuses: ['Discarded', 'Closed'] },
  { key: 'all', label: 'All', statuses: null },
]

const SORTS = [
  { key: 'urgent', label: 'Most urgent first' },
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
]

const EMPTY_TEXT = {
  new: 'No events waiting. New reports arrive every hour.',
  verifying: 'No events are being verified right now.',
  investigating: 'No field investigations under way.',
  confirmed: 'No confirmed events.',
  escalated: 'No escalated events.',
  closed: 'No closed or discarded events.',
  all: 'No events yet.',
}

const REFRESH_MS = 5 * 60 * 1000
const time = (v) => parseDate(v)?.getTime() || 0

/** How long an event has been waiting, compared with its target. */
function waitInfo(e) {
  if (!WAITING_STATUSES.includes(e.status)) return null
  const hours = e.openHours || 0
  const target = TARGET_HOURS[e.severity] || 72
  const text = hours < 1 ? '<1 h' : hours < 48 ? `${Math.round(hours)} h` : `${Math.floor(hours / 24)} d`
  const state = hours > target ? 'over' : hours > target * 0.75 ? 'near' : 'ok'
  return { hours, target, text, state }
}

function sortEvents(list, sort) {
  const out = [...list]
  if (sort === 'oldest') out.sort((a, b) => time(a.firstSeen) - time(b.firstSeen))
  else if (sort === 'newest') out.sort((a, b) => time(b.lastSeen) - time(a.lastSeen))
  else {
    // urgent: overdue first, then severity, then longest waiting
    const rank = (e) => {
      const w = waitInfo(e)
      return w?.state === 'over' ? 0 : w?.state === 'near' ? 1 : 2
    }
    out.sort((a, b) => rank(a) - rank(b) || (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || (b.openHours || 0) - (a.openHours || 0))
  }
  return out
}

const SELECT_SOFT = `h-9 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-700 ${FOCUS}`

const PRIORITY_STYLE = {
  critical: 'border-red-300 text-red-700',
  high: 'border-amber-300 text-amber-600',
  standard: 'border-gray-300 text-gray-500',
}
function PriorityPill({ severity }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${PRIORITY_STYLE[severity] || PRIORITY_STYLE.standard}`}>{(severity || 'standard').toLowerCase()}</span>
}

const STATUS_STYLE = {
  New: 'bg-red-600 text-white',
  Verifying: 'bg-gray-200 text-gray-700',
  Investigating: 'bg-gray-200 text-gray-700',
  Confirmed: 'bg-sky-100 text-sky-800',
  Escalated: 'bg-red-100 text-red-700',
  Closed: 'bg-green-600 text-white',
  Discarded: 'bg-gray-100 text-gray-400',
}
function StatusPill({ status }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLE[status] || STATUS_STYLE.Discarded}`}>{statusLabel(status)}</span>
}

function SkeletonRows() {
  return [0, 1, 2, 3, 4].map((i) => (
    <tr key={i} className="animate-pulse border-t border-gray-100">
      {[16, 24, 14, 20, 12, 14, 22].map((w, j) => (
        <td key={j} className="px-3 py-4"><div className="h-3 bg-gray-100 rounded" style={{ width: `${w * 4}px` }} /></td>
      ))}
    </tr>
  ))
}

export default function AlertsSignalsQueue() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'new'
  const sort = SORTS.some((s) => s.key === params.get('sort')) ? params.get('sort') : 'urgent'
  const q = params.get('q') || ''
  const disease = params.get('disease') || ''
  const source = SOURCES.includes(params.get('source')) ? params.get('source') : ''
  const sevFilter = SEVERITIES.some((s) => s.key === params.get('sev')) ? params.get('sev') : ''
  const overdueOnly = params.get('overdue') === '1'

  const [events, setEvents] = useState([])
  const [counts, setCounts] = useState(null)
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
      return getReviewEvents({ status: 'All', disease, source, search: q, limit: 500 })
        .then((res) => {
          if (mine !== reqId.current) return
          setEvents(res?.events || [])
          setCounts(res?.counts || null)
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
    [disease, source, q]
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

  const overdueCount = useMemo(() => events.filter((e) => waitInfo(e)?.state === 'over').length, [events])

  const visibleEvents = useMemo(() => {
    let list = events
    if (statuses) list = list.filter((e) => statuses.includes(e.status))
    if (sevFilter) list = list.filter((e) => e.severity === sevFilter)
    if (overdueOnly) list = list.filter((e) => waitInfo(e)?.state === 'over')
    return sortEvents(list, sort)
  }, [events, statuses, sevFilter, overdueOnly, sort])

  const tabCount = (t) => (t.statuses ? events.filter((e) => t.statuses.includes(e.status)).length : events.length)

  const filtersActive = !!(q || disease || source || sevFilter || overdueOnly)
  const clearFilters = () => {
    setSearchText('')
    setParam({ q: '', disease: '', source: '', sev: '', overdue: '' })
  }
  const open = (ev) => navigate({ pathname: `/alerts-signals/${encodeURIComponent(ev.id)}`, search: location.search })

  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [tab, q, disease, source, sevFilter, overdueOnly, sort])
  const PAGE = 10
  const lastPage = Math.max(0, Math.ceil(visibleEvents.length / PAGE) - 1)
  const pageRows = visibleEvents.slice(page * PAGE, page * PAGE + PAGE)
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const closedThisWeek = events.filter((e) => ['Closed', 'Discarded'].includes(e.status) && time(e.closedAt || e.modified || e.lastSeen) >= weekAgo).length
  const stats = [
    { key: 'new', label: 'To review', value: tabCount(TABS[0]) },
    { key: 'verifying', label: 'Verifying', value: tabCount(TABS[1]) },
    { key: 'investigating', label: 'In the field', value: tabCount(TABS[2]) },
    { key: 'closed', label: 'Closed this week', value: closedThisWeek },
    { key: 'overdue', label: 'Overdue', value: overdueCount },
  ]
  const card = 'bg-white rounded-xl border border-gray-100'
  const pageBtn = `h-9 px-4 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-white ${FOCUS}`
  const title = overdueOnly ? 'Overdue events' : tab === 'all' ? 'All events' : TABS.find((t) => t.key === tab).label

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold text-brand-navy">Review Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">Individual reports of priority diseases from CHPs and CBS. Each one needs an officer to verify it, investigate if needed, and record a decision.</p>
          <Link to="/epi-trends" className={`inline-block text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2 mt-1 rounded ${FOCUS}`}>Looking for diseases rising over several weeks? See Epi Trends</Link>
        </div>
        {!forbidden && (
          <button onClick={() => load()} disabled={loading} className={`h-9 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium ${FOCUS}`}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
        )}
      </div>

      {forbidden ? (
        <div className={`${card} p-10 text-center`}>
          <ShieldAlert className="w-8 h-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-gray-500">You don't have access to the Review Queue.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {stats.map(({ key, label, value }) => {
              const on = key === 'overdue' ? overdueOnly : tab === key && !overdueOnly
              const alarm = key === 'overdue' && value > 0
              return (
                <button key={key} aria-pressed={on}
                  onClick={() => key === 'overdue' ? setParam({ overdue: overdueOnly ? '' : '1', tab: 'all' }) : setParam({ tab: key === 'new' ? '' : key, overdue: '' })}
                  className={`${card} text-left px-4 py-3 hover:border-gray-200 ${on ? 'ring-1 ring-gray-300' : ''} ${alarm ? 'bg-red-50 border-red-100' : ''} ${FOCUS}`}>
                  <span className={`block text-xs ${alarm ? 'text-red-700' : 'text-gray-500'}`}>{label}</span>
                  <span className={`block text-xl font-semibold tabular-nums mt-1 ${alarm ? 'text-red-700' : 'text-gray-900'}`}>{loading ? '–' : value}</span>
                </button>
              )
            })}
          </div>

          <div className={`${card} p-3 flex items-center gap-2 flex-wrap`}>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input value={searchText} onChange={(e) => setSearchText(e.target.value)} type="text" aria-label="Search events" placeholder="Search by disease, place or ID"
                className={`w-full h-9 bg-gray-50 border border-gray-100 rounded-lg pl-9 pr-3 text-sm ${FOCUS}`} />
            </div>
            <select aria-label="Status" value={overdueOnly ? 'all' : tab} onChange={(e) => setParam({ tab: e.target.value === 'new' ? '' : e.target.value, overdue: '' })} className={SELECT_SOFT}>
              {TABS.map((t) => <option key={t.key} value={t.key}>{t.key === 'all' ? 'All statuses' : t.label}</option>)}
            </select>
            <select aria-label="Disease" value={disease} onChange={(e) => setParam({ disease: e.target.value })} className={SELECT_SOFT}>
              <option value="">All diseases</option>
              {diseases.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>
            <select aria-label="Source" value={source} onChange={(e) => setParam({ source: e.target.value })} className={SELECT_SOFT}>
              <option value="">All sources</option>
              {SOURCES.map((x) => <option key={x} value={x}>{SOURCE_NAME[x]}</option>)}
            </select>
            {filtersActive && (
              <button onClick={clearFilters} className={`inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 rounded ${FOCUS}`}>
                <X className="w-4 h-4" aria-hidden="true" /> Clear
              </button>
            )}
          </div>

          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-medium text-gray-900">{title}</h2>
              <select aria-label="Sort" value={sort} onChange={(e) => setParam({ sort: e.target.value === 'urgent' ? '' : e.target.value })} className={`${SELECT_SOFT} h-8`}>
                {SORTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Event ID</th>
                    <th className="px-3 py-2.5 font-medium">Disease</th>
                    <th className="px-3 py-2.5 font-medium hidden lg:table-cell">Source</th>
                    <th className="px-3 py-2.5 font-medium hidden md:table-cell">Location</th>
                    <th className="px-3 py-2.5 font-medium">Priority</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows />
                  ) : error ? (
                    <tr><td colSpan={7}><EmptyState title="Couldn't load the queue" body={error} action={<button onClick={() => load()} className={BTN_SECONDARY}>Try again</button>} /></td></tr>
                  ) : visibleEvents.length === 0 ? (
                    <tr><td colSpan={7}>
                      <EmptyState title={filtersActive ? 'No events match your filters' : 'Nothing here'} body={filtersActive ? null : EMPTY_TEXT[tab]}
                        action={filtersActive && <button onClick={clearFilters} className={BTN_SECONDARY}>Clear filters</button>} />
                    </td></tr>
                  ) : (
                    pageRows.map((ev) => {
                      const place = [ev.area, ev.subCounty].filter(Boolean).join(', ')
                      const w = waitInfo(ev)
                      const extra = [
                        ev.reports > 1 && `${ev.reports} reports`,
                        ev.relatedCount > 0 && `${ev.relatedCount} related`,
                      ].filter(Boolean).join(' · ')
                      return (
                        <tr key={ev.id} onClick={() => open(ev)} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 cursor-pointer">
                          <td className="px-3 py-3.5 text-gray-500 whitespace-nowrap">{ev.id}</td>
                          <td className="px-3 py-3.5">
                            <span className="font-medium text-gray-900">{ev.diseaseName || ev.title}</span>
                            {(extra || ev.deaths > 0) && (
                              <span className="block text-xs text-gray-400 mt-0.5">
                                {ev.deaths > 0 && <span className="text-red-700">{ev.deaths} death{ev.deaths === 1 ? '' : 's'}</span>}
                                {ev.deaths > 0 && extra && ' · '}
                                {extra}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3.5 hidden lg:table-cell text-gray-500 whitespace-nowrap">{(ev.sources || []).map((x) => SOURCE_NAME[x] || x).join(', ') || '—'}</td>
                          <td className="px-3 py-3.5 hidden md:table-cell text-gray-600">{place || <span className="text-amber-600">Location missing</span>}</td>
                          <td className="px-3 py-3.5 whitespace-nowrap">
                            <PriorityPill severity={ev.severity} />
                            {w && w.state !== 'ok' && (
                              <span className={`block text-xs mt-1 ${w.state === 'over' ? 'text-red-700' : 'text-amber-600'}`} title={`Target: start verification within ${w.target} h`}>
                                {w.state === 'over' ? `Overdue ${w.text}` : `Waiting ${w.text}`}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3.5"><StatusPill status={ev.status} /></td>
                          <td className="px-3 py-3.5 text-right whitespace-nowrap">
                            {['New', 'Verifying'].includes(ev.status) && (
                              <Link to={{ pathname: `/alerts-signals/${encodeURIComponent(ev.id)}`, search: '?step=3' }} onClick={(e) => e.stopPropagation()}
                                className={`mr-3 text-xs font-medium text-red-700 hover:text-red-800 hover:underline rounded ${FOCUS}`}>
                                {ev.status === 'New' ? 'Start verification' : 'Continue verification'}
                              </Link>
                            )}
                            <Link to={{ pathname: `/alerts-signals/${encodeURIComponent(ev.id)}`, search: location.search }} onClick={(e) => e.stopPropagation()}
                              className={`inline-flex items-center h-8 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-white ${FOCUS}`}>
                              View details
                            </Link>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            {!loading && !error && visibleEvents.length > 0 && (
              <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
                <div className="flex gap-2">
                  <button onClick={() => setPage(0)} disabled={page === 0} className={pageBtn}>First</button>
                  <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className={pageBtn}>Previous</button>
                </div>
                <span className="text-sm text-gray-500">Showing {page * PAGE + 1} to {Math.min(visibleEvents.length, page * PAGE + PAGE)} of {visibleEvents.length}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(Math.min(lastPage, page + 1))} disabled={page >= lastPage} className={pageBtn}>Next</button>
                  <button onClick={() => setPage(lastPage)} disabled={page >= lastPage} className={pageBtn}>Last</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}
