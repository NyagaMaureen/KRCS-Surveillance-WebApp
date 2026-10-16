import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Download, RefreshCw, MapPin, Calendar, Users, TrendingUp, AlertTriangle } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getAlertsSignals, getAlertRegions } from '../api/frappe'

const SEVERITIES = ['critical', 'high', 'standard']
const SEVERITY_RANK = { critical: 0, high: 1, standard: 2 }
const SEVERITY_LABELS = { critical: 'Critical', high: 'High', standard: 'Standard' }

const SEVERITY_STYLES = {
  critical: 'bg-red-600 text-white',
  high: 'bg-amber-400 text-white',
  standard: 'bg-blue-500 text-white',
}
const SEVERITY_BAR = {
  critical: 'bg-red-600',
  high: 'bg-amber-400',
  standard: 'bg-blue-500',
}

const STATUS_STYLES = {
  Pending: 'border-amber-400 bg-amber-400/10 text-amber-500',
  Resolved: 'border-emerald-500 bg-emerald-500/10 text-emerald-600',
  Investigating: 'border-purple-400 bg-purple-400/10 text-purple-500',
  Confirmed: 'border-blue-500 bg-blue-500/10 text-blue-600',
  Rejected: 'border-red-500 bg-red-500/10 text-red-600',
}

const TABS = [
  { key: 'open', label: 'Open', match: (a) => a.status === 'Pending' || a.status === 'Investigating' },
  { key: 'confirmed', label: 'Confirmed', match: (a) => a.status === 'Confirmed' },
  { key: 'resolved', label: 'Resolved', match: (a) => a.status === 'Resolved' },
  { key: 'rejected', label: 'Rejected', match: (a) => a.status === 'Rejected' },
  { key: 'all', label: 'All', match: () => true },
]

const SOURCE_LABELS = {
  CBS: 'Community (CBS)',
  'Case Report': 'Field reports',
  IDSR: 'Health facilities (MOH 505)',
}

const PERIODS = [
  { key: '4w', label: 'Last 4 weeks', days: 28 },
  { key: '3m', label: 'Last 3 months', days: 92 },
  { key: '12m', label: 'Last 12 months', days: 365 },
  { key: 'all', label: 'All time', days: null },
]

const SORTS = [
  { key: 'recent', label: 'Most recent' },
  { key: 'severity', label: 'Severity' },
  { key: 'cases', label: 'Most cases' },
]

const PAGE_SIZES = [10, 25, 50]
const SURGE_TIP =
  'Several diseases rose together here. This may be more reporting rather than more disease. Verify before acting.'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1'
const SELECT_CLS = `appearance-none bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-900 ${FOCUS}`

const diseaseOf = (a) => a.disease || a.title || ''
const timeOf = (a) => (a.lastWeek ? new Date(a.lastWeek).getTime() : 0)

function whyFlagged(a) {
  const tags = a.tags || []
  const out = []
  if (tags.includes('threshold')) out.push('Reached alert threshold')
  if (tags.includes('baseline')) out.push('Well above the usual level')
  if (tags.includes('ears_c2') || tags.includes('ears_c3')) out.push('Statistical methods: unusual rise')
  return out
}

function periodText(a) {
  const weeks = a.weeks || 1
  if (weeks <= 1) return a.date
  return `${a.startDate} – ${a.date} · ${weeks} weeks`
}

function startOfWeek(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

function groupOf(a, now) {
  const t = timeOf(a)
  const thisWeek = startOfWeek(now).getTime()
  if (t >= thisWeek) return 'This week'
  if (t >= thisWeek - 7 * 86400000) return 'Last week'
  const d = new Date(t)
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'Earlier this month'
  return 'Older'
}

const GROUP_ORDER = ['This week', 'Last week', 'Earlier this month', 'Older']

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function SkeletonRow() {
  return (
    <div className="p-6 border-t border-gray-100 first:border-t-0 animate-pulse flex gap-6">
      <div className="flex-1 space-y-3">
        <div className="h-4 bg-gray-100 rounded w-1/3" />
        <div className="h-3 bg-gray-100 rounded w-2/3" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
      <div className="h-8 w-16 bg-gray-100 rounded-lg" />
    </div>
  )
}

function AlertCard({ alert, onOpen }) {
  const reasons = whyFlagged(alert)
  const weeks = alert.weeks || 1
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') onOpen()
      }}
      className={`relative flex items-start justify-between gap-4 p-6 flex-wrap sm:flex-nowrap cursor-pointer hover:bg-gray-50 transition-colors ${FOCUS} focus-visible:ring-inset`}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h3 className="text-base text-gray-900">{alert.title}</h3>
          <span className={`text-xs font-medium px-2.5 py-1 rounded uppercase tracking-wide ${SEVERITY_STYLES[alert.severity] || 'bg-gray-400 text-white'}`}>
            {alert.severity}
          </span>
          <span className={`inline-flex items-center text-[10px] font-medium px-2.5 py-1 rounded-full border ${STATUS_STYLES[alert.status] || 'border-gray-200 bg-gray-50 text-gray-500'}`}>
            {alert.status}
          </span>
          {alert.ongoing ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
              <span className="relative flex w-2 h-2" aria-hidden="true">
                <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
              </span>
              Ongoing
            </span>
          ) : (
            <span className="text-xs font-medium text-gray-400">Ended</span>
          )}
          {alert.surge && (
            <span
              title={SURGE_TIP}
              tabIndex={0}
              aria-label={`Check reporting. ${SURGE_TIP}`}
              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-200 ${FOCUS}`}
            >
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Check reporting
            </span>
          )}
        </div>

        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-sm text-gray-500">
          <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" aria-hidden="true" />{alert.location}</span>
          <span className="inline-flex items-center gap-1.5"><Calendar className="w-4 h-4" aria-hidden="true" />{periodText(alert)}</span>
          <span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4" aria-hidden="true" />{alert.affected} cases</span>
          {weeks > 1 && (
            <span className="inline-flex items-center gap-1.5"><TrendingUp className="w-4 h-4" aria-hidden="true" />peak {alert.peak}/week</span>
          )}
        </div>

        {reasons.length > 0 && (
          <p className="text-sm text-gray-500">
            <span className="font-medium text-gray-700">Why flagged:</span> {reasons.join(' · ')}
          </p>
        )}

        {!!alert.sources?.length && (
          <div className="flex gap-1.5 flex-wrap">
            {alert.sources.map((s) => (
              <span key={s} className="text-xs text-gray-600 bg-gray-100 rounded-full px-2.5 py-0.5">
                {SOURCE_LABELS[s] || s}
              </span>
            ))}
          </div>
        )}
      </div>
      <Link
        to={`/epi-trends/${alert.id}`}
        onClick={(e) => e.stopPropagation()}
        className={`border border-gray-200 bg-white rounded-lg px-5 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50 shrink-0 ${FOCUS}`}
      >
        View
      </Link>
    </div>
  )
}

export default function AlertsSignals() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [alerts, setAlerts] = useState([])
  const [regions, setRegions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(0)

  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'open'
  const severities = (params.get('sev') || '').split(',').filter((s) => SEVERITIES.includes(s))
  const search = params.get('q') || ''
  const region = params.get('region') || ''
  const disease = params.get('disease') || ''
  const source = params.get('source') || ''
  const period = PERIODS.some((p) => p.key === params.get('period')) ? params.get('period') : '4w'
  const ongoingOnly = params.get('ongoing') === '1'
  const sort = SORTS.some((s) => s.key === params.get('sort')) ? params.get('sort') : 'recent'
  const pageSize = PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : 10

  const setParam = useCallback(
    (updates) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          Object.entries(updates).forEach(([k, v]) => {
            if (v === '' || v == null || v === false) next.delete(k)
            else next.set(k, v === true ? '1' : v)
          })
          return next
        },
        { replace: true }
      )
      setPage(0)
    },
    [setParams]
  )

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    Promise.all([getAlertsSignals({ limit: 500 }), getAlertRegions()])
      .then(([a, r]) => {
        setAlerts(a || [])
        setRegions(r || [])
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const filtersActive =
    !!search || !!region || !!disease || !!source || period !== '4w' || ongoingOnly || severities.length > 0

  const clearFilters = () =>
    setParam({ q: '', region: '', disease: '', source: '', period: '', ongoing: false, sev: '' })

  const diseases = useMemo(
    () => [...new Set(alerts.map(diseaseOf).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [alerts]
  )

  const tabCounts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, alerts.filter(t.match).length])),
    [alerts]
  )

  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const days = PERIODS.find((p) => p.key === period).days
    const cutoff = days ? Date.now() - days * 86400000 : null
    const tabMatch = TABS.find((t) => t.key === tab).match
    return alerts.filter((a) => {
      if (!tabMatch(a)) return false
      if (region && a.region !== region) return false
      if (disease && diseaseOf(a) !== disease) return false
      if (source && !(a.sources || []).includes(source)) return false
      if (ongoingOnly && !a.ongoing) return false
      if (cutoff && timeOf(a) < cutoff) return false
      if (q && !`${a.title} ${a.location} ${a.disease} ${a.description}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [alerts, tab, search, region, disease, source, period, ongoingOnly])

  const severityCounts = useMemo(
    () => Object.fromEntries(SEVERITIES.map((s) => [s, baseFiltered.filter((a) => a.severity === s).length])),
    [baseFiltered]
  )

  const filteredAlerts = useMemo(() => {
    const list = baseFiltered.filter((a) => !severities.length || severities.includes(a.severity))
    const bySev = (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    const byRecent = (a, b) => timeOf(b) - timeOf(a)
    const cmp =
      sort === 'severity'
        ? (a, b) => bySev(a, b) || byRecent(a, b)
        : sort === 'cases'
          ? (a, b) => (b.affected || 0) - (a.affected || 0)
          : (a, b) => byRecent(a, b) || bySev(a, b)
    return [...list].sort(cmp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFiltered, params.get('sev'), sort])

  const total = filteredAlerts.length
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)
  const safePage = Math.min(page, lastPage)
  const pagedAlerts = filteredAlerts.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const paginationLabel = total
    ? `Showing ${safePage * pageSize + 1} to ${Math.min((safePage + 1) * pageSize, total)} of ${total}`
    : 'Showing 0 of 0'

  const sections = useMemo(() => {
    if (sort !== 'recent') return [{ title: null, items: pagedAlerts }]
    const now = new Date()
    const totals = {}
    filteredAlerts.forEach((a) => {
      const g = groupOf(a, now)
      totals[g] = (totals[g] || 0) + 1
    })
    const map = {}
    pagedAlerts.forEach((a) => {
      const g = groupOf(a, now)
      ;(map[g] = map[g] || []).push(a)
    })
    return GROUP_ORDER.filter((g) => map[g]).map((g) => ({ title: g, count: totals[g], items: map[g] }))
  }, [pagedAlerts, filteredAlerts, sort])

  function handleExportReport() {
    const header = ['ID', 'Disease', 'Location', 'Severity', 'Status', 'Start week', 'Latest week', 'Weeks', 'Cases', 'Peak/week', 'Sources', 'Why flagged']
    const rows = filteredAlerts.map((a) =>
      [
        a.id,
        diseaseOf(a),
        a.location,
        a.severity,
        a.status,
        a.startWeek,
        a.lastWeek,
        a.weeks,
        a.affected,
        a.peak,
        (a.sources || []).map((s) => SOURCE_LABELS[s] || s).join('; '),
        whyFlagged(a).join('; '),
      ]
        .map(csvCell)
        .join(',')
    )
    const csv = [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'epi-trends-report.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const pageBtn = `border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50 ${FOCUS}`

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Epi Trends</h2>
          <p className="text-sm text-gray-400">Weekly case counts compared with what is normal for each area. Use this to spot rising diseases and confirm outbreaks.</p>
          <p className="text-sm text-gray-500 mt-1">
            Individual reports waiting for verification are in the{' '}
            <Link to="/alerts-signals" className={`font-medium text-red-600 hover:underline rounded ${FOCUS}`}>
              Alerts & Signals →
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportReport}
            disabled={!total}
            className={`border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`}
          >
            <Download className="w-4 h-4" /> Export Report
          </button>
          <button
            onClick={load}
            disabled={loading}
            className={`border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Alert status" className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setParam({ tab: t.key === 'open' ? '' : t.key })}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px flex items-center gap-2 ${FOCUS} ${
                active ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.label}
              <span className={`text-xs rounded-full px-2 py-0.5 ${active ? 'bg-red-600/10 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                {tabCounts[t.key]}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex gap-2 flex-wrap mb-4" role="group" aria-label="Filter by severity">
        {SEVERITIES.map((s) => {
          const on = severities.includes(s)
          return (
            <button
              key={s}
              aria-pressed={on}
              onClick={() =>
                setParam({ sev: (on ? severities.filter((x) => x !== s) : [...severities, s]).join(',') })
              }
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium ${FOCUS} ${
                on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${SEVERITY_BAR[s]}`} aria-hidden="true" />
              {SEVERITY_LABELS[s]}
              <span className={on ? 'text-white/80' : 'text-gray-400'}>{severityCounts[s]}</span>
            </button>
          )
        })}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-3 flex-wrap mb-6">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setParam({ q: e.target.value })}
            type="text"
            aria-label="Search alerts"
            placeholder="Search by title, location, disease or description..."
            className={`w-full bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-4 py-2.5 text-sm ${FOCUS}`}
          />
        </div>

        <select aria-label="Region or county" value={region} onChange={(e) => setParam({ region: e.target.value })} className={SELECT_CLS}>
          <option value="">All regions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <select aria-label="Disease" value={disease} onChange={(e) => setParam({ disease: e.target.value })} className={SELECT_CLS}>
          <option value="">All diseases</option>
          {diseases.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        <select aria-label="Data source" value={source} onChange={(e) => setParam({ source: e.target.value })} className={SELECT_CLS}>
          <option value="">All data sources</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <select aria-label="Period" value={period} onChange={(e) => setParam({ period: e.target.value === '4w' ? '' : e.target.value })} className={SELECT_CLS}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>

        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-900 cursor-pointer">
          <input
            type="checkbox"
            checked={ongoingOnly}
            onChange={(e) => setParam({ ongoing: e.target.checked })}
            className="w-4 h-4 accent-red-600 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1"
          />
          Ongoing only
        </label>

        {filtersActive && (
          <button onClick={clearFilters} className={`text-sm font-medium text-red-600 hover:underline rounded ${FOCUS}`}>
            Clear filters
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-sm text-gray-500">{loading ? 'Loading alerts…' : `${total} alert${total === 1 ? '' : 's'}`}</p>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          Sort by
          <select value={sort} onChange={(e) => setParam({ sort: e.target.value === 'recent' ? '' : e.target.value })} className={SELECT_CLS}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          [0, 1, 2, 3].map((i) => <SkeletonRow key={i} />)
        ) : error ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-sm text-gray-500">We couldn't load alerts. Please check your connection and try again.</p>
            <button onClick={load} className={`bg-red-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-red-700 ${FOCUS}`}>
              Try again
            </button>
          </div>
        ) : !alerts.length ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            No active outbreaks. The engine checks all data sources daily.
          </div>
        ) : !total ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-sm text-gray-400">No alerts match your filters</p>
            {filtersActive && (
              <button onClick={clearFilters} className={`text-sm font-medium text-red-600 hover:underline rounded ${FOCUS}`}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.title || 'all'}>
              {section.title && (
                <div className="flex items-center gap-2 px-6 py-2.5 bg-gray-50 border-y border-gray-100 first:border-t-0">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{section.title}</h3>
                  <span className="text-xs text-gray-500 bg-white border border-gray-100 rounded-full px-2 py-0.5">{section.count}</span>
                </div>
              )}
              {section.items.map((alert, i) => (
                <div key={alert.id} className={i !== 0 ? 'border-t border-gray-100' : ''}>
                  <AlertCard alert={alert} onOpen={() => navigate(`/epi-trends/${alert.id}`)} />
                </div>
              ))}
            </div>
          ))
        )}

        {!loading && !error && !!total && (
          <div className="flex items-center justify-between p-5 border-t border-gray-100 flex-wrap gap-3">
            <div className="flex gap-2">
              <button onClick={() => setPage(0)} disabled={safePage === 0} className={pageBtn}>First</button>
              <button onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} className={pageBtn}>Previous</button>
            </div>
            <div className="flex items-center gap-4 flex-wrap justify-center">
              <span className="text-sm text-gray-500">{paginationLabel}</span>
              <label className="flex items-center gap-2 text-sm text-gray-500">
                Per page
                <select
                  value={pageSize}
                  onChange={(e) => setParam({ size: Number(e.target.value) === 10 ? '' : e.target.value })}
                  className={SELECT_CLS}
                >
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.min(lastPage, safePage + 1))} disabled={safePage >= lastPage} className={pageBtn}>Next</button>
              <button onClick={() => setPage(lastPage)} disabled={safePage >= lastPage} className={pageBtn}>Last</button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
