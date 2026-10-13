import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Download, RefreshCw, Search, Filter, MapPin, AlertTriangle, Radio, CheckCheck, Maximize2, Minimize2, ChevronUp } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import StatCard from '../components/analytics/StatCard'
import MapView from '../components/map/MapView'
import { getMapData, getDiseaseOptions, exportCsv } from '../api/frappe'

const SEVERITY_COLORS = {
  critical: '#DC2626',
  high: '#F2C94C',
  medium: '#3B82F6',
  low: '#22C55E',
}

const SEVERITIES = ['critical', 'high', 'medium', 'low']
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

const EMPTY_DATA = { alerts: [], unmapped_alerts: 0, stats: { total: 0, critical: 0, investigating: 0, resolved: 0 } }

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function matchesStatus(alert, status) {
  const s = String(alert.status || '').toLowerCase()
  if (status === 'all') return true
  if (status === 'open') return s === 'pending' || s === 'investigating'
  return s === status
}

function time(d) {
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? 0 : t
}

function formatTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function SurveillanceMap() {
  const [data, setData] = useState(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [diseaseOptions, setDiseaseOptions] = useState([])
  const [search, setSearch] = useState('')
  const [diseaseFilter, setDiseaseFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [ongoingOnly, setOngoingOnly] = useState(false)
  const [hoveredId, setHoveredId] = useState(null)
  const [focus, setFocus] = useState(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [toast, setToast] = useState({ show: false, message: '', error: false })
  const toastTimer = useRef(null)
  const mapBoxRef = useRef(null)

  const showToast = useCallback((message, error = false) => {
    setToast({ show: true, message, error })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000)
  }, [])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const load = useCallback(() => {
    return getMapData()
      .then((d) => {
        setData({ ...EMPTY_DATA, ...d })
        setUpdatedAt(new Date())
      })
      .catch((e) => showToast(e.message || 'Could not load map data', true))
      .finally(() => setLoading(false))
  }, [showToast])

  function refresh() {
    setLoading(true)
    load()
  }

  useEffect(() => {
    load()
    getDiseaseOptions().then(setDiseaseOptions)
  }, [load])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === mapBoxRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else mapBoxRef.current?.requestFullscreen?.()
  }

  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data.alerts || []).filter((a) => {
      if (diseaseFilter && a.disease !== diseaseFilter) return false
      if (!matchesStatus(a, statusFilter)) return false
      if (ongoingOnly && !a.ongoing) return false
      if (!q) return true
      return `${a.title} ${a.location}`.toLowerCase().includes(q)
    })
  }, [data.alerts, search, diseaseFilter, statusFilter, ongoingOnly])

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 }
    baseFiltered.forEach((a) => { if (counts[a.severity] != null) counts[a.severity] += 1 })
    return counts
  }, [baseFiltered])

  const filteredAlerts = useMemo(
    () => baseFiltered
      .filter((a) => !severityFilter || a.severity === severityFilter)
      .map((a) => ({ ...a, color: SEVERITY_COLORS[a.severity] || '#6B7280' })),
    [baseFiltered, severityFilter]
  )

  const listAlerts = useMemo(
    () => [...filteredAlerts].sort(
      (a, b) => time(b.date) - time(a.date) || (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    ),
    [filteredAlerts]
  )

  const filtersActive = !!(search || diseaseFilter || severityFilter || ongoingOnly || statusFilter !== 'open')

  function clearFilters() {
    setSearch('')
    setDiseaseFilter('')
    setSeverityFilter('')
    setStatusFilter('open')
    setOngoingOnly(false)
  }

  function applyCard(card) {
    setSearch('')
    setDiseaseFilter('')
    setOngoingOnly(false)
    if (card === 'active') { setStatusFilter('open'); setSeverityFilter('') }
    if (card === 'critical') { setStatusFilter('open'); setSeverityFilter('critical') }
    if (card === 'investigating') { setStatusFilter('investigating'); setSeverityFilter('') }
    if (card === 'resolved') { setStatusFilter('resolved'); setSeverityFilter('') }
  }

  function selectFromList(id) {
    setFocus({ id })
  }

  function handleExportReport() {
    exportCsv('surveillance-map-alerts.csv', filteredAlerts, [
      { label: 'ID', value: (a) => a.id },
      { label: 'Title', value: (a) => a.title },
      { label: 'Location', value: (a) => a.location },
      { label: 'Severity', value: (a) => a.severity },
      { label: 'Status', value: (a) => a.status },
      { label: 'Affected', value: (a) => a.affected },
      { label: 'Disease', value: (a) => a.disease },
      { label: 'Date', value: (a) => a.date },
      { label: 'Start week', value: (a) => a.startDate },
      { label: 'Latest week', value: (a) => a.lastWeek },
      { label: 'Weeks', value: (a) => a.weeks },
      { label: 'Peak/week', value: (a) => a.peak },
      { label: 'Latitude', value: (a) => a.lat },
      { label: 'Longitude', value: (a) => a.lng },
    ])
  }

  const { stats } = data
  const selectCls = 'appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-9 py-2.5 text-sm font-medium text-gray-900 min-w-[150px] focus:outline-none'
  const cardBtn = 'text-left rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-100 hover:shadow-sm transition-shadow'
  const dynamicStatus = statusFilter === 'investigating'

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Surveillance Map</h2>
          <p className="text-sm text-gray-400">Where active outbreak alerts are, coloured by severity.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {updatedAt && <span className="text-xs text-gray-400">Updated {formatTime(updatedAt)}</span>}
          <button
            onClick={handleExportReport}
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50"
          >
            <Download className="w-4 h-4" /> Export Report
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={['w-4 h-4', loading ? 'animate-spin' : ''].join(' ')} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <button type="button" className={cardBtn} onClick={() => applyCard('active')}>
          <StatCard icon={MapPin} label="Active Alerts" value={stats.total} />
        </button>
        <button type="button" className={cardBtn} onClick={() => applyCard('critical')}>
          <StatCard icon={AlertTriangle} label="Critical Alerts" value={stats.critical} />
        </button>
        <button type="button" className={cardBtn} onClick={() => applyCard('investigating')}>
          <StatCard icon={Radio} label="Active Investigations" value={stats.investigating} />
        </button>
        <button type="button" className={cardBtn} onClick={() => applyCard('resolved')}>
          <StatCard icon={CheckCheck} label="Resolved" value={stats.resolved} />
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-3 flex-wrap mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4.5 h-4.5 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search"
            className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100"
          />
        </div>

        <div className="relative">
          <select value={diseaseFilter} onChange={(e) => setDiseaseFilter(e.target.value)} className={selectCls}>
            <option value="">Disease Type</option>
            {diseaseOptions.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <div className="relative">
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className={selectCls}>
            <option value="">Severity Level</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <div className="relative">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
            {dynamicStatus && <option value="investigating">Investigating</option>}
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-gray-900 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ongoingOnly}
            onChange={(e) => setOngoingOnly(e.target.checked)}
            className="w-4 h-4 accent-red-600"
          />
          Ongoing only
        </label>

        {filtersActive && (
          <button type="button" onClick={clearFilters} className="text-sm font-medium text-red-600 hover:underline">
            Clear filters
          </button>
        )}

        <span className="text-sm text-gray-400 ml-auto whitespace-nowrap">
          Showing {filteredAlerts.length} of {data.alerts.length} alerts
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div
          ref={mapBoxRef}
          className="bg-white rounded-2xl border border-gray-100 overflow-hidden relative flex-1 min-w-0 h-[420px] lg:h-[600px]"
        >
          <div className="absolute inset-0">
            <MapView alerts={filteredAlerts} hoveredId={hoveredId} focus={focus} onToast={showToast} />
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="absolute top-4 right-4 z-[1000] bg-white border border-gray-200 rounded-lg p-2 shadow-sm hover:bg-gray-50"
          >
            {fullscreen ? <Minimize2 className="w-4 h-4 text-gray-900" /> : <Maximize2 className="w-4 h-4 text-gray-900" />}
          </button>

          <div className="absolute bottom-4 left-4 z-[1000] pointer-events-auto">
            <button
              type="button"
              onClick={() => setLegendOpen((o) => !o)}
              className="sm:hidden bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-900 shadow-sm flex items-center gap-1.5"
              aria-expanded={legendOpen}
            >
              Legend <ChevronUp className={['w-4 h-4 transition-transform', legendOpen ? '' : 'rotate-180'].join(' ')} />
            </button>
            <div
              className={[
                legendOpen ? 'flex' : 'hidden',
                'sm:flex bg-white border border-gray-200 rounded-lg px-3 py-2 gap-1 flex-wrap shadow-sm max-sm:flex-col max-sm:absolute max-sm:bottom-11 max-sm:left-0',
              ].join(' ')}
            >
              {SEVERITIES.map((s) => {
                const active = severityFilter === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeverityFilter(active ? '' : s)}
                    aria-pressed={active}
                    className={[
                      'flex items-center gap-2 rounded-md px-2 py-1 text-sm text-gray-900 hover:bg-gray-50',
                      active ? 'bg-gray-100 font-medium' : '',
                      severityFilter && !active ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <span className="w-3 h-3 rounded-full border-2 border-white shadow" style={{ backgroundColor: SEVERITY_COLORS[s] }} />
                    {cap(s)}
                    <span className="text-xs text-gray-400">{severityCounts[s]}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {loading && (
            <div className="absolute inset-0 z-[1100] bg-gray-100 animate-pulse flex items-center justify-center" aria-busy="true">
              <MapPin className="w-10 h-10 text-gray-300" />
            </div>
          )}

          {!loading && filteredAlerts.length === 0 && (
            <div className="absolute inset-0 z-[900] flex items-center justify-center pointer-events-none p-4">
              <div className="bg-white border border-gray-100 rounded-2xl shadow-lg px-8 py-6 text-center">
                <MapPin className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                <div className="text-sm font-semibold text-gray-900">No active outbreaks on the map</div>
                {filtersActive && <div className="text-xs text-gray-400 mt-1">Try clearing the filters.</div>}
              </div>
            </div>
          )}
        </div>

        <aside className="bg-white rounded-2xl border border-gray-100 lg:w-80 lg:shrink-0 lg:h-[600px] max-h-[420px] lg:max-h-none overflow-y-auto">
          {listAlerts.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">No alerts to list.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {listAlerts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => selectFromList(a.id)}
                    onMouseEnter={() => setHoveredId(a.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onFocus={() => setHoveredId(a.id)}
                    onBlur={() => setHoveredId(null)}
                    className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50"
                  >
                    <span
                      className={['w-3 h-3 rounded-full mt-1 shrink-0', a.ongoing === false ? 'opacity-50' : ''].join(' ')}
                      style={{ backgroundColor: a.color }}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">{a.title}</span>
                      <span className="block text-xs text-gray-400 truncate">{a.location}</span>
                      <span className="block text-[11px] text-gray-400">{a.date}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {data.unmapped_alerts > 0 && (
        <p className="text-sm text-gray-400 mt-3">
          {data.unmapped_alerts} alerts are in locations without map coordinates.{' '}
          <Link to="/alerts-signals" className="text-red-600 font-medium hover:underline">View them in Alerts &amp; Signals</Link>
        </p>
      )}

      {toast.show && (
        <div
          role="status"
          className={['fixed bottom-6 right-6 z-[2000] rounded-xl px-5 py-3 text-sm text-white shadow-lg', toast.error ? 'bg-red-600' : 'bg-gray-900'].join(' ')}
        >
          {toast.message}
        </div>
      )}
    </AppShell>
  )
}
