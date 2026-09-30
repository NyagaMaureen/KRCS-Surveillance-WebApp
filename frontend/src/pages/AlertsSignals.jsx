import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search, Filter, Map, List, Download } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getAlertsSignals, getAlertRegions } from '../api/frappe'

const PAGE_SIZE = 6

const SEVERITY_STYLES = {
  critical: 'bg-red-600 text-white',
  high: 'bg-amber-400 text-white',
  medium: 'bg-blue-500 text-white',
  low: 'bg-emerald-500 text-white',
}

const STATUS_STYLES = {
  Pending: 'border-amber-400 bg-amber-400/10 text-amber-500',
  Resolved: 'border-emerald-500 bg-emerald-500/10 text-emerald-600',
  Investigating: 'border-purple-400 bg-purple-400/10 text-purple-500',
  Rejected: 'border-red-500 bg-red-500/10 text-red-600',
}

const SEVERITIES = ['critical', 'high', 'medium', 'low']

export default function AlertsSignals() {
  const [alerts, setAlerts] = useState([])
  const [regions, setRegions] = useState([])
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [view, setView] = useState('list')
  const [page, setPage] = useState(0)

  useEffect(() => {
    getAlertsSignals({ limit: 500 }).then(setAlerts)
    getAlertRegions().then(setRegions)
  }, [])

  const filteredAlerts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return alerts.filter((a) => {
      if (severityFilter && a.severity !== severityFilter) return false
      if (regionFilter && a.region !== regionFilter) return false
      if (!q) return true
      return `${a.title} ${a.location} ${a.description}`.toLowerCase().includes(q)
    })
  }, [alerts, search, severityFilter, regionFilter])

  useEffect(() => setPage(0), [search, severityFilter, regionFilter])

  const lastPage = Math.max(0, Math.ceil(filteredAlerts.length / PAGE_SIZE) - 1)
  const pagedAlerts = filteredAlerts.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const paginationLabel = (() => {
    if (!filteredAlerts.length) return 'Showing 0 of 0'
    const start = page * PAGE_SIZE + 1
    const end = Math.min(start + PAGE_SIZE - 1, filteredAlerts.length)
    return `Showing ${start} to ${end} of ${filteredAlerts.length}`
  })()

  function handleExportReport() {
    const rows = filteredAlerts.map((a) =>
      [a.id, a.title, a.location, a.severity, a.status, a.affected, a.aiScore, a.date].join(',')
    )
    const csv = ['ID,Title,Location,Severity,Status,Affected,AI Score,Date', ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'alerts-signals-report.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Alerts & Signals</h2>
          <p className="text-sm text-gray-400">Review AI-assisted signals and prioritise events requiring human verification</p>
        </div>
        <button
          onClick={handleExportReport}
          className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50"
        >
          <Download className="w-4 h-4" /> Export Report
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-3 flex-wrap mb-6">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4.5 h-4.5 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search alerts by location or condition..."
            className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div className="relative">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-9 py-2.5 text-sm font-medium text-gray-900 min-w-[170px] focus:outline-none"
          >
            <option value="">All Severity</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-9 py-2.5 text-sm font-medium text-gray-900 min-w-[170px] focus:outline-none"
          >
            <option value="">All Regions</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <div className="bg-gray-50 border border-gray-100 rounded-lg p-1 flex gap-1">
          <button
            onClick={() => setView('map')}
            className={['flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              view === 'map' ? 'bg-red-600 text-white' : 'text-gray-900'].join(' ')}
          >
            <Map className="w-4 h-4" /> Map
          </button>
          <button
            onClick={() => setView('list')}
            className={['flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              view === 'list' ? 'bg-red-600 text-white' : 'text-gray-900'].join(' ')}
          >
            <List className="w-4 h-4" /> List
          </button>
        </div>
      </div>

      {view === 'map' ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 flex flex-col items-center justify-center text-center gap-3">
          <span className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
            <Map className="w-6 h-6 text-gray-400" />
          </span>
          <p className="text-sm font-medium text-gray-900">Map view coming soon</p>
          <p className="text-sm text-gray-400 max-w-sm">Use the Surveillance Map page for a full geographic view of active alerts.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {pagedAlerts.map((alert, i) => (
            <div
              key={alert.id}
              className={['flex items-start justify-between gap-6 p-6 flex-wrap sm:flex-nowrap', i !== 0 ? 'border-t border-gray-100' : ''].join(' ')}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <h3 className="text-base text-gray-900">{alert.title}</h3>
                  <span className={['text-xs font-medium px-2.5 py-1 rounded uppercase tracking-wide', SEVERITY_STYLES[alert.severity] || 'bg-gray-400 text-white'].join(' ')}>
                    {alert.severity}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mb-3">{alert.description}</p>
                <div className="flex items-center gap-2 flex-wrap text-sm text-gray-500">
                  <span>{alert.location}</span>
                  <span>•</span>
                  <span>{alert.date}</span>
                  <span>•</span>
                  <span>{alert.affected} affected</span>
                  <span>•</span>
                  <span>AI Score: {alert.aiScore}%</span>
                  <span className={['inline-flex items-center text-[10px] font-medium px-2.5 py-1 rounded-full border ml-1', STATUS_STYLES[alert.status] || 'border-gray-200 bg-gray-50 text-gray-500'].join(' ')}>
                    {alert.status}
                  </span>
                </div>
              </div>
              <Link
                to={`/alerts-signals/${alert.id}`}
                className="border border-gray-200 rounded-lg px-5 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50 shrink-0"
              >
                View
              </Link>
            </div>
          ))}
          {!pagedAlerts.length && (
            <div className="py-16 text-center text-gray-400 text-sm">No alerts match your filters</div>
          )}

          {!!filteredAlerts.length && (
            <div className="flex items-center justify-between p-5 border-t border-gray-100 flex-wrap gap-3">
              <div className="flex gap-2">
                <button onClick={() => setPage(0)} disabled={page === 0} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">First</button>
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Previous</button>
              </div>
              <span className="text-sm text-gray-500">{paginationLabel}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.min(lastPage, page + 1))} disabled={page >= lastPage} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Next</button>
                <button onClick={() => setPage(lastPage)} disabled={page >= lastPage} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Last</button>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
