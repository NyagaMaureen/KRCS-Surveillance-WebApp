import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { Search, RefreshCw, ShieldAlert, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { PageSizeSelect } from '../components/common/Pager'
import { getReviewEvents, getDiseaseOptions, getMyArea } from '../api/frappe'
import { useCapabilities } from '../context/CapabilitiesContext'
import { statusLabel, parseDate, relTime } from '../data/eventHelpers'
import { RiskPill } from '../components/risk/RiskScore'
import { FOCUS, BTN_SECONDARY, EmptyState } from '../components/surveillance/ui'

const SEVERITY_RANK = { critical: 0, high: 1, standard: 2 }
const SEVERITIES = [
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'standard', label: 'Normal' },
]
// The channel is where each report came from: Mobile, WhatsApp, Web, SMS, USSD, or CBS / EMR for those feeds
const channelsOf = (e) => (e.channels && e.channels.length ? e.channels : (e.sources || []).map((x) => (x === 'Field' ? 'Field report' : x)))
// Target time to start verification, by severity (same as the Epi Trends recommended actions)
const TARGET_HOURS = { critical: 24, high: 48, standard: 72 }
const WAITING_STATUSES = ['New', 'Verifying']

const TABS = [
  { key: 'new', label: 'To review', statuses: ['New'] },
  { key: 'verifying', label: 'Verifying', statuses: ['Verifying'] },
  { key: 'verified', label: 'Verified', statuses: ['Verified'] },   // Confirm and save done: waiting for AI triage
  { key: 'investigating', label: 'In the field', statuses: ['Investigating'] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['Confirmed'] },
  { key: 'escalated', label: 'Escalated', statuses: ['Escalated'] },
  { key: 'closed', label: 'Closed', statuses: ['Discarded', 'Closed'] },
  { key: 'all', label: 'All', statuses: null },
]

const SORTS = [
  { key: 'risk', label: 'Highest risk first' },
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
  if (sort === 'risk') out.sort((a, b) => (b.risk?.score ?? -1) - (a.risk?.score ?? -1) || (b.openHours || 0) - (a.openHours || 0))
  else if (sort === 'oldest') out.sort((a, b) => time(a.firstSeen) - time(b.firstSeen))
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

const STATUS_STYLE = {
  New: 'bg-red-600 text-white',
  Verifying: 'bg-gray-200 text-gray-700',
  Verified: 'bg-emerald-100 text-emerald-800',
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
      {[16, 24, 14, 20, 18, 12, 14, 22].map((w, j) => (
        <td key={j} className="px-3 py-4"><div className="h-3 bg-gray-100 rounded" style={{ width: `${w * 4}px` }} /></td>
      ))}
    </tr>
  ))
}

export default function AlertsSignalsQueue() {
  const location = useLocation()
  const [notice, setNotice] = useState(location.state?.notice || '')   // e.g. EVT-00012 closed (from the event page)
  useEffect(() => {
    if (!notice) return undefined
    window.history.replaceState({ ...window.history.state, usr: undefined }, '')   // not shown again on refresh
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  // the county MOH (MOH DDSR) sees the cases escalated to them first (KRCS 17 Nov 2026)
  const { primaryRole, workspace, has } = useCapabilities()
  const isMoh = primaryRole === 'MOH DDSR'
  // the CHA verifies signals without being told the suspected disease (KRCS 19 Nov 2026)
  // set in Roles & Permissions: working the queue without See AI Triage and Diseases gives the CHA view
  const isCha = workspace === 'cha' || (has(['view_review_queue', 'act_on_events', 'step_signal', 'step_verification']) && !has('ai_triage'))
  // officers start on Verified: the signals a CHA has checked, waiting for AI triage (KRCS 19 Nov 2026)
  const defaultTab = isMoh ? 'escalated' : isCha ? 'new' : 'verified'
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : defaultTab
  const sort = SORTS.some((s) => s.key === params.get('sort')) ? params.get('sort') : 'risk'
  const q = params.get('q') || ''
  const disease = params.get('disease') || ''
  const channel = params.get('channel') || ''
  const unit = params.get('unit') || ''   // Community Health Unit (KRCS 17 Nov 2026)
  const scParam = params.get('sc')   // sub-county; 'all' = every one the user can see (KRCS 19 Nov 2026)
  const sevFilter = SEVERITIES.some((s) => s.key === params.get('sev')) ? params.get('sev') : ''
  const overdueOnly = params.get('overdue') === '1'

  const [events, setEvents] = useState([])
  const [counts, setCounts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [diseases, setDiseases] = useState([])
  const [area, setArea] = useState({ locked: false, subCounties: [] })   // officers, FHWs and CHAs: where they work
  useEffect(() => { getMyArea().then(setArea).catch(() => {}) }, [])
  // pre-selected to their assigned sub-county (Elizabeth, 19 Nov 2026)
  const subCounty = scParam === 'all' ? '' : scParam || (area.locked ? area.subCounties[0]?.name || '' : '')
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
      return getReviewEvents({ status: 'All', disease, search: q, limit: 500 })
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
    [disease, q]
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

  const scKey = (x) => String(x || '').trim().toLowerCase()
  const scEvents = useMemo(() => (subCounty ? events.filter((e) => scKey(e.subCounty) === scKey(subCounty)) : events), [events, subCounty])
  const subCountyOptions = useMemo(() => (area.locked ? area.subCounties.map((x) => x.name)
    : [...new Set(events.map((e) => e.subCounty).filter(Boolean))].sort()), [area, events])
  const overdueCount = useMemo(() => scEvents.filter((e) => waitInfo(e)?.state === 'over').length, [scEvents])

  const visibleEvents = useMemo(() => {
    let list = scEvents
    if (statuses) list = list.filter((e) => statuses.includes(e.status))
    if (sevFilter) list = list.filter((e) => e.severity === sevFilter)
    if (channel) list = list.filter((e) => channelsOf(e).includes(channel))
    if (unit) list = list.filter((e) => (e.units || []).some((u) => u.id === unit))
    if (overdueOnly) list = list.filter((e) => waitInfo(e)?.state === 'over')
    const sorted = sortEvents(list, sort)
    // officers: verified signals first in any list (they are waiting for AI triage)
    return isCha ? sorted : [...sorted.filter((e) => e.status === 'Verified'), ...sorted.filter((e) => e.status !== 'Verified')]
  }, [scEvents, statuses, sevFilter, channel, unit, overdueOnly, sort, isCha])
  const channelOptions = useMemo(() => [...new Set(scEvents.flatMap(channelsOf))].sort(), [scEvents])
  const unitOptions = useMemo(() => {   // only the health units in the chosen sub-county (Elizabeth, 19 Nov 2026)
    const seen = new Map()
    scEvents.forEach((e) => (e.units || []).forEach((u) => seen.set(u.id, u.name)))
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [scEvents])

  const tabCount = (t) => (t.statuses ? scEvents.filter((e) => t.statuses.includes(e.status)).length : scEvents.length)

  const filtersActive = !!(q || disease || channel || unit || sevFilter || overdueOnly || scParam)
  const clearFilters = () => {
    setSearchText('')
    setParam({ q: '', disease: '', channel: '', unit: '', sev: '', overdue: '', sc: '' })
  }
  // View details opens on Signal captured (KRCS 19 Nov 2026); the queue's filters come along for the Back link
  const detailsSearch = (step = 1) => {
    const p = new URLSearchParams(location.search)
    p.set('step', String(step))
    return `?${p}`
  }
  // officers: a verified signal opens straight on AI triage (KRCS 19 Nov 2026)
  const triageNext = (ev) => !isCha && ev.status === 'Verified'
  const open = (ev) => navigate({ pathname: `/alerts-signals/${encodeURIComponent(ev.id)}`, search: detailsSearch(triageNext(ev) ? 3 : 1) })

  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [tab, q, disease, channel, unit, sevFilter, overdueOnly, sort])
  const [PAGE, setPAGE] = useState(10)
  const lastPage = Math.max(0, Math.ceil(visibleEvents.length / PAGE) - 1)
  const pageRows = visibleEvents.slice(page * PAGE, page * PAGE + PAGE)
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const closedThisWeek = events.filter((e) => ['Closed', 'Discarded'].includes(e.status) && time(e.closedAt || e.modified || e.lastSeen) >= weekAgo).length
  const stats = [
    { key: 'all', label: 'All statuses', value: events.length },
    { key: 'new', label: 'To review', value: tabCount(TABS[0]) },
    { key: 'verifying', label: 'Verifying', value: tabCount(TABS[1]) },
    { key: 'verified', label: 'Verified', value: tabCount(TABS[2]) },
    { key: 'investigating', label: 'In the field', value: tabCount(TABS[3]) },
    { key: 'closed', label: 'Closed this week', value: closedThisWeek },
    { key: 'overdue', label: 'Overdue', value: overdueCount },
  ]
  if (!isCha && !isMoh) {   // officers: Verified, then Verifying, right after All (an SO can verify too, KRCS 19 Nov 2026)
    for (const [key, at] of [['verified', 1], ['verifying', 2]]) {
      const v = stats.findIndex((x) => x.key === key)
      if (v >= 0) stats.splice(at, 0, ...stats.splice(v, 1))
    }
  }
  if (isMoh) {   // county MOH: Escalated to MOH instead of Overdue (verification targets are KRCS's)
    stats.splice(1, 0, { key: 'escalated', label: 'Escalated to MOH', value: tabCount(TABS.find((x) => x.key === 'escalated')) })
    stats.pop()
  }
  const card = 'bg-white rounded-xl border border-gray-100'
  const pageBtn = `h-9 px-4 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-white ${FOCUS}`
  const title = overdueOnly ? 'Overdue events' : tab === 'all' ? 'All events' : TABS.find((t) => t.key === tab).label

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="w-full max-w-none">
          <h1 className="text-xl font-semibold text-brand-navy">Review Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">{isCha
            ? 'Signals from CHPs and CBS in your area. Call the reporter, check the symptoms and answer the questions, then Confirm and save so the surveillance officer can take it on.'
            : 'Individual reports of priority diseases from CHPs and CBS. Each one needs an officer to verify it, investigate if needed, and record a decision.'}</p>
          {!isCha && <Link to="/epi-trends" className={`inline-block text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2 mt-1 rounded ${FOCUS}`}>Looking for diseases rising over several weeks? See Epi Trends</Link>}
          {notice && <p role="status" className="mt-2 text-sm font-semibold text-emerald-800">{notice}</p>}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            {stats.map(({ key, label, value }) => {
              const on = key === 'overdue' ? overdueOnly : tab === key && !overdueOnly
              const alarm = key === 'overdue' && value > 0
              return (
                <button key={key} aria-pressed={on}
                  onClick={() => key === 'overdue' ? setParam({ overdue: overdueOnly ? '' : '1', tab: 'all' }) : setParam({ tab: key === defaultTab ? '' : key, overdue: '' })}
                  className={`rounded-xl text-center px-4 py-3 text-white ${on ? 'bg-red-700 ring-2 ring-red-300' : 'bg-red-600 hover:bg-red-700'} ${FOCUS}`}>
                  <span className="block text-[11px] font-bold uppercase tracking-wide">{label}{alarm && <span className="ml-1.5 rounded bg-white/25 px-1 normal-case">act now</span>}</span>
                  <span className="block text-2xl font-bold tabular-nums mt-1">{loading ? '–' : value}</span>
                </button>
              )
            })}
          </div>

          <div className={`${card} p-3 flex items-center gap-2 flex-wrap`}>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input value={searchText} onChange={(e) => setSearchText(e.target.value)} type="text" aria-label="Search events" placeholder={isCha ? 'Search by place or ID' : 'Search by disease, place or ID'}
                className={`w-full h-9 bg-gray-50 border border-gray-100 rounded-lg pl-9 pr-3 text-sm ${FOCUS}`} />
            </div>
            <select aria-label="Status" value={overdueOnly ? 'all' : tab} onChange={(e) => setParam({ tab: e.target.value === defaultTab ? '' : e.target.value, overdue: '' })} className={SELECT_SOFT}>
              {TABS.map((t) => <option key={t.key} value={t.key}>{t.key === 'all' ? 'All statuses' : t.label}</option>)}
            </select>
            {!isCha && (
              <select aria-label="Disease" value={disease} onChange={(e) => setParam({ disease: e.target.value })} className={SELECT_SOFT}>
                <option value="">All diseases</option>
                {diseases.filter((d) => d.active || d.key === 'unclassified-illness').map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
              </select>
            )}
            <select aria-label="Channel" value={channel} onChange={(e) => setParam({ channel: e.target.value })} className={SELECT_SOFT}>
              <option value="">All channels</option>
              {channelOptions.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            {subCountyOptions.length > 0 && (
              <select aria-label="Sub-county" value={subCounty} onChange={(e) => setParam({ sc: e.target.value || 'all', unit: '' })} className={SELECT_SOFT}>
                <option value="">{area.locked ? (area.subCounties.length > 1 ? 'All my sub-counties' : 'All, incl. no location') : 'All sub-counties'}</option>
                {subCountyOptions.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
            <select aria-label="Health unit" value={unit} onChange={(e) => setParam({ unit: e.target.value })} className={SELECT_SOFT}>
              <option value="">All health units</option>
              {unitOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
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
              <select aria-label="Sort" value={sort} onChange={(e) => setParam({ sort: e.target.value === 'risk' ? '' : e.target.value })} className={`${SELECT_SOFT} h-8`}>
                {SORTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="red-head w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-900">
                    <th className="px-3 py-2.5 font-medium w-10 text-gray-900">#</th>
                    <th className="px-3 py-2.5 font-medium">Event ID</th>
                    <th className="px-3 py-2.5 font-medium">{isCha ? 'Signal' : 'Disease'}</th>
                    <th className="px-3 py-2.5 font-medium hidden lg:table-cell">Channel</th>
                    <th className="px-3 py-2.5 font-medium hidden lg:table-cell">Health unit</th>
                    <th className="px-3 py-2.5 font-medium hidden md:table-cell">Location</th>
                    <th className="px-3 py-2.5 font-medium">{isCha ? 'Waiting' : 'Risk'}</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows />
                  ) : error ? (
                    <tr><td colSpan={9}><EmptyState title="Couldn't load the queue" body={error} action={<button onClick={() => load()} className={BTN_SECONDARY}>Try again</button>} /></td></tr>
                  ) : visibleEvents.length === 0 ? (
                    <tr><td colSpan={9}>
                      <EmptyState title={filtersActive ? 'No events match your filters' : 'Nothing here'} body={filtersActive ? null : EMPTY_TEXT[tab]}
                        action={filtersActive && <button onClick={clearFilters} className={BTN_SECONDARY}>Clear filters</button>} />
                    </td></tr>
                  ) : (
                    pageRows.map((ev, i) => {
                      const place = [ev.area, ev.subCounty].filter(Boolean).join(', ')
                      const w = waitInfo(ev)
                      const extra = [
                        ev.reports > 1 && `${ev.reports} reports`,
                        ev.relatedCount > 0 && `${ev.relatedCount} related`,
                        ev.overdueTasks > 0 ? `${ev.overdueTasks} task${ev.overdueTasks === 1 ? '' : 's'} overdue` : ev.openTasks > 0 && `${ev.openTasks} open task${ev.openTasks === 1 ? '' : 's'}`,
                      ].filter(Boolean).join(' · ')
                      return (
                        <tr key={ev.id} onClick={() => open(ev)} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 cursor-pointer">
                          <td className="px-3 py-3.5 text-gray-400 tabular-nums">{page * PAGE + i + 1}</td>
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
                          <td className="px-3 py-3.5 hidden lg:table-cell text-gray-500 whitespace-nowrap">{channelsOf(ev).join(', ') || '—'}</td>
                          <td className="px-3 py-3.5 hidden lg:table-cell text-gray-500 whitespace-nowrap" title={(ev.units || []).map((u) => u.name).join(', ')}>
                            {ev.units?.length ? `${ev.units[0].name}${ev.units.length > 1 ? ` +${ev.units.length - 1}` : ''}` : '—'}
                          </td>
                          <td className="px-3 py-3.5 hidden md:table-cell text-gray-600">{place || <span className="text-amber-600">Location missing</span>}</td>
                          <td className="px-3 py-3.5 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 flex-nowrap">
                              {!isCha && <RiskPill risk={ev.risk} severity={ev.severity} />}
                            </span>
                            {w && w.state !== 'ok' && (
                              <span className={`block text-xs mt-1 ${w.state === 'over' ? 'text-red-700' : 'text-amber-600'}`} title={`Target: start verification within ${w.target} h`}>
                                {w.state === 'over' ? `Overdue ${w.text}` : `Waiting ${w.text}`}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3.5"><StatusPill status={ev.status} />
                            {ev.escalation && (
                              <span className="block text-xs text-gray-500 mt-1 whitespace-nowrap" title={ev.escalation.reason}>
                                by {ev.escalation.by || '—'}{ev.escalation.on ? ` · ${relTime(ev.escalation.on)}` : ''}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3.5 text-right whitespace-nowrap">
                            {triageNext(ev) ? (
                              <Link to={{ pathname: `/alerts-signals/${encodeURIComponent(ev.id)}`, search: detailsSearch(3) }} onClick={(e) => e.stopPropagation()}
                                className={`inline-flex items-center h-8 px-3 rounded-lg bg-red-600 text-xs font-semibold text-white hover:bg-red-700 ${FOCUS}`}>
                                Proceed to AI triage
                              </Link>
                            ) : (
                              <>
                                {!isCha && ['New', 'Verifying'].includes(ev.status) && (
                                  <Link to={{ pathname: `/alerts-signals/${encodeURIComponent(ev.id)}`, search: ev.status === 'New' ? '?step=2' : '' }} onClick={(e) => e.stopPropagation()}
                                    className={`mr-3 text-xs font-medium text-red-700 hover:text-red-800 hover:underline rounded ${FOCUS}`}>
                                    {ev.status === 'New' ? 'Start verification' : 'Continue'}
                                  </Link>
                                )}
                                <Link to={{ pathname: `/alerts-signals/${encodeURIComponent(ev.id)}`, search: detailsSearch() }} onClick={(e) => e.stopPropagation()}
                                  className={`inline-flex items-center h-8 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-white ${FOCUS}`}>
                                  View details
                                </Link>
                              </>
                            )}
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
                <span className="inline-flex items-center gap-2 text-sm text-gray-500">Showing {page * PAGE + 1} to {Math.min(visibleEvents.length, page * PAGE + PAGE)} of {visibleEvents.length}
                  <PageSizeSelect value={PAGE} onChange={(n) => { setPAGE(n); setPage(0) }} /></span>
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
