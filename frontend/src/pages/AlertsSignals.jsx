import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Download, RefreshCw, Activity, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getAlertsSignals, getAlertRegions } from '../api/frappe'
import { sev, BTN_SECONDARY, EmptyState } from '../components/surveillance/ui'

const SEVERITIES = ['critical', 'high', 'standard']
const SEVERITY_RANK = { critical: 0, high: 1, standard: 2 }
const SEVERITY_LABELS = { critical: 'Critical', high: 'High', standard: 'Standard' }

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
  Rejected: 'border-red-500 bg-red-500/10 text-red-700',
}

const TABS = [
  { key: 'open', label: 'Open', match: (a) => a.status === 'Pending' || a.status === 'Investigating' },
  { key: 'confirmed', label: 'Confirmed', match: (a) => a.status === 'Confirmed' },
  { key: 'resolved', label: 'Resolved', match: (a) => a.status === 'Resolved' },
  { key: 'rejected', label: 'Dismissed', match: (a) => a.status === 'Rejected' },
  { key: 'all', label: 'All', match: () => true },
]

const STATUS_LABELS = { Pending: 'New', Investigating: 'Under investigation', Confirmed: 'Confirmed', Resolved: 'Resolved', Rejected: 'Dismissed' }

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
  'Several diseases rose together here; may be more reporting rather than more illness.'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1'
const STATUS_TONE = { Pending: 'amber', Investigating: 'purple', Confirmed: 'blue', Resolved: 'green', Rejected: 'neutral' }
const isCommunity = (a) => !!a.sources?.length && a.sources.every((x) => x === 'CBS' || x === 'Case Report')

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
  const end = a.epiWeek || a.date
  if (weeks <= 1) return end
  return `${a.startEpiWeek || a.startDate} → ${end} · ${weeks} weeks`
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

function SkeletonRows() {
  return [0, 1, 2, 3, 4].map((i) => (
    <tr key={i} className="animate-pulse border-t border-gray-100">
      {[40, 28, 16, 10, 12, 14, 18].map((w, j) => (
        <td key={j} className="px-3 py-4"><div className="h-3 bg-gray-100 rounded" style={{ width: `${w * 3}px` }} /></td>
      ))}
    </tr>
  ))
}

const PRIORITY_STYLE = {
  critical: 'border-red-300 text-red-700',
  high: 'border-amber-300 text-amber-600',
  standard: 'border-gray-300 text-gray-500',
}
const STATUS_PILL = {
  Pending: 'bg-red-600 text-white',
  Investigating: 'bg-gray-200 text-gray-700',
  Confirmed: 'bg-sky-100 text-sky-800',
  Resolved: 'bg-green-600 text-white',
  Rejected: 'bg-gray-100 text-gray-400',
}

function AlertRow({ alert, onOpen }) {
  const community = isCommunity(alert)
  const qLink = `/alerts-signals?tab=all&q=${encodeURIComponent(diseaseOf(alert) || '')}`
  return (
    <tr onClick={onOpen} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 cursor-pointer">
      <td className="px-3 py-3.5">
        <span className="font-medium text-gray-900">{alert.title}</span>
        {(alert.surge || alert.openEvents > 0) && (
          <span className="block text-xs text-gray-400 mt-0.5">
            {alert.surge && <span className="text-amber-600" title={SURGE_TIP}>Reporting surge?</span>}
            {alert.surge && alert.openEvents > 0 && ' · '}
            {alert.openEvents > 0 && (
              <Link to={qLink} onClick={(e) => e.stopPropagation()} className={`underline underline-offset-2 hover:text-gray-700 rounded ${FOCUS}`}>
                {alert.openEvents === 1 ? 'In Review Queue' : `${alert.openEvents} in Review Queue`}
              </Link>
            )}
          </span>
        )}
      </td>
      <td className="px-3 py-3.5 text-gray-600 hidden md:table-cell">
        {alert.location}
        <span className="block text-xs text-gray-400">{alert.epiWeekShort || alert.date}{alert.ongoing ? ' · ongoing' : ''}</span>
      </td>
      <td className="px-3 py-3.5 text-gray-500 hidden lg:table-cell">{(alert.sources || []).map((x) => SOURCE_LABELS[x] || x).join(', ') || '—'}</td>
      <td className="px-3 py-3.5 text-right tabular-nums text-gray-700">
        {community ? alert.affected : alert.signals}
        <span className="block text-xs text-gray-400">{community ? 'people' : 'cases'}</span>
      </td>
      <td className="px-3 py-3.5"><span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${PRIORITY_STYLE[alert.severity] || PRIORITY_STYLE.standard}`}>{alert.severity || 'standard'}</span></td>
      <td className="px-3 py-3.5"><span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_PILL[alert.status] || STATUS_PILL.Rejected}`}>{STATUS_LABELS[alert.status] || alert.status}</span></td>
      <td className="px-3 py-3.5 text-right">
        <Link to={`/epi-trends/${alert.id}`} onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center h-8 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-white whitespace-nowrap ${FOCUS}`}>View details</Link>
      </td>
    </tr>
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
        STATUS_LABELS[a.status] || a.status,
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

  const card = 'bg-white rounded-xl border border-gray-100'
  const pageBtn = `h-9 px-4 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-white ${FOCUS}`
  const SEL = `h-9 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-700 ${FOCUS}`
  const cols = 7
  const statCards = [
    { label: 'Open', value: tabCounts.open || 0, onClick: () => setParam({ tab: '', sev: '' }), on: tab === 'open' && !severities.length },
    ...SEVERITIES.map((sv) => ({
      label: SEVERITY_LABELS[sv], value: severityCounts[sv], dot: sev(sv).dot, on: severities.length === 1 && severities[0] === sv,
      onClick: () => setParam({ sev: severities.length === 1 && severities[0] === sv ? '' : sv }),
    })),
  ]

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold text-brand-navy">Epi Trends</h1>
          <p className="text-sm text-gray-400 mt-0.5">Weekly case counts compared with what is normal for each place. An alert means a disease is rising above its usual level and may need an investigation.</p>
          <Link to="/alerts-signals" className={`inline-block text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2 mt-1 rounded ${FOCUS}`}>Looking for individual reports to verify? See the Review Queue</Link>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportReport} disabled={!total} className={`h-9 inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`}>
            <Download className="w-4 h-4" aria-hidden="true" /> Export
          </button>
          <button onClick={load} disabled={loading} className={`h-9 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium ${FOCUS}`}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {statCards.map((c) => (
            <button key={c.label} onClick={c.onClick} aria-pressed={c.on}
              className={`${card} text-left p-4 flex items-center justify-between hover:border-gray-200 ${c.on ? 'ring-1 ring-gray-300' : ''} ${FOCUS}`}>
              <span>
                <span className="block text-xs text-gray-400">{c.label}</span>
                <span className="block text-xl font-semibold text-gray-900 tabular-nums mt-1">{loading ? '–' : c.value}</span>
              </span>
              <span className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
                {c.dot ? <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} aria-hidden="true" /> : <Activity className="w-4 h-4 text-gray-500" aria-hidden="true" />}
              </span>
            </button>
          ))}
        </div>

        <div className={`${card} p-3 flex items-center gap-2 flex-wrap`}>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input value={search} onChange={(e) => setParam({ q: e.target.value })} type="text" aria-label="Search alerts" placeholder="Search by disease or place"
              className={`w-full h-9 bg-gray-50 border border-gray-100 rounded-lg pl-9 pr-3 text-sm ${FOCUS}`} />
          </div>
          <select aria-label="Status" value={ongoingOnly ? 'ongoing' : tab}
            onChange={(e) => e.target.value === 'ongoing' ? setParam({ tab: 'all', ongoing: '1' }) : setParam({ tab: e.target.value === 'open' ? '' : e.target.value, ongoing: '' })} className={SEL}>
            {TABS.map((t) => <option key={t.key} value={t.key}>{t.key === 'all' ? 'All statuses' : t.label}</option>)}
            <option value="ongoing">Ongoing only</option>
          </select>
          <select aria-label="Disease" value={disease} onChange={(e) => setParam({ disease: e.target.value })} className={SEL}>
            <option value="">All diseases</option>
            {diseases.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select aria-label="Region" value={region} onChange={(e) => setParam({ region: e.target.value })} className={SEL}>
            <option value="">All regions</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select aria-label="Period" value={period} onChange={(e) => setParam({ period: e.target.value === '4w' ? '' : e.target.value })} className={SEL}>
            {PERIODS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          {filtersActive && (
            <button onClick={clearFilters} className={`inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 rounded ${FOCUS}`}>
              <X className="w-4 h-4" aria-hidden="true" /> Clear
            </button>
          )}
        </div>

        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between mb-3 gap-3">
            <h2 className="text-sm font-medium text-gray-900">{tab === 'all' ? 'All alerts' : `${TABS.find((t) => t.key === tab).label} alerts`}</h2>
            <select aria-label="Sort" value={sort} onChange={(e) => setParam({ sort: e.target.value === 'recent' ? '' : e.target.value })} className={`${SEL} h-8`}>
              {SORTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2.5 font-medium rounded-l-lg">Alert</th>
                  <th className="px-3 py-2.5 font-medium hidden md:table-cell">Location · week</th>
                  <th className="px-3 py-2.5 font-medium hidden lg:table-cell">Source</th>
                  <th className="px-3 py-2.5 font-medium text-right">Total</th>
                  <th className="px-3 py-2.5 font-medium">Priority</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium rounded-r-lg"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows />
                ) : error ? (
                  <tr><td colSpan={cols}><EmptyState title="Couldn't load trends" body="Check your connection and try again." action={<button onClick={load} className={BTN_SECONDARY}>Try again</button>} /></td></tr>
                ) : !alerts.length ? (
                  <tr><td colSpan={cols}><EmptyState title="No trend alerts" body="No disease is above its usual level right now." /></td></tr>
                ) : !total ? (
                  <tr><td colSpan={cols}><EmptyState title="No alerts match your filters" action={filtersActive && <button onClick={clearFilters} className={BTN_SECONDARY}>Clear filters</button>} /></td></tr>
                ) : (
                  pagedAlerts.map((a) => <AlertRow key={a.id} alert={a} onOpen={() => navigate(`/epi-trends/${a.id}`)} />)
                )}
              </tbody>
            </table>
          </div>
          {!loading && !error && !!total && (
            <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
              <div className="flex gap-2">
                <button onClick={() => setPage(0)} disabled={safePage === 0} className={pageBtn}>First</button>
                <button onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} className={pageBtn}>Previous</button>
              </div>
              <span className="text-sm text-gray-500">{paginationLabel}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.min(lastPage, safePage + 1))} disabled={safePage >= lastPage} className={pageBtn}>Next</button>
                <button onClick={() => setPage(lastPage)} disabled={safePage >= lastPage} className={pageBtn}>Last</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
