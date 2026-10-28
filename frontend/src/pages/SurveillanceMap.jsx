import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Download, RefreshCw, Search, Filter, MapPin, AlertTriangle, Clock, TrendingUp, Maximize2, Minimize2, ChevronUp } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import StatCard from '../components/analytics/StatCard'
import MapView from '../components/map/MapView'
import { getMapEvents, getDiseaseOptions, exportCsv } from '../api/frappe'

const SEVERITY_COLORS = {
  critical: '#EE2435',
  high: '#F2C94C',
  standard: '#3B82F6',
}

const SEVERITIES = ['critical', 'high', 'standard']
const SEVERITY_RANK = { critical: 0, high: 1, standard: 2 }

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'New', label: 'New' },
  { value: 'Verifying', label: 'Verifying' },
  { value: 'Verified', label: 'Verified' },
  { value: 'Escalated', label: 'Escalated' },
  { value: 'Discarded', label: 'Discarded' },
  { value: 'Closed', label: 'Closed' },
  { value: 'all', label: 'All' },
]

const PERIOD_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
]

const EMPTY_DATA = { events: [], unmapped: 0, stats: { open: 0, critical: 0, waiting: 0, escalated: 0 } }

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function relTime(v) {
  const t = new Date(String(v || '').replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.round(hrs / 24)} days ago`
}

const isWaiting = (e) => e.status === 'New' && Number(e.openHours) > 24
const hasCoords = (e) => Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lng))

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
  const [days, setDays] = useState(30)
  const [waitingOnly, setWaitingOnly] = useState(false)
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
    return getMapEvents({ status: statusFilter, disease: diseaseFilter, days })
      .then((d) => {
        setData({ ...EMPTY_DATA, ...d, stats: { ...EMPTY_DATA.stats, ...(d?.stats || {}) } })
        setUpdatedAt(new Date())
      })
      .catch((e) => showToast(e.message || 'Could not load map data', true))
      .finally(() => setLoading(false))
  }, [showToast, statusFilter, diseaseFilter, days])

  function refresh() {
    setLoading(true)
    load()
  }

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    getDiseaseOptions().then(setDiseaseOptions)
  }, [])

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
    return (data.events || []).filter(hasCoords).filter((a) => {
      if (waitingOnly && !isWaiting(a)) return false
      if (!q) return true
      return `${a.title} ${a.area}`.toLowerCase().includes(q)
    })
  }, [data.events, search, waitingOnly])

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, standard: 0 }
    baseFiltered.forEach((a) => { if (counts[a.severity] != null) counts[a.severity] += 1 })
    return counts
  }, [baseFiltered])

  const filteredAlerts = useMemo(
    () => baseFiltered
      .filter((a) => !severityFilter || a.severity === severityFilter)
      .map((a) => ({ ...a, color: SEVERITY_COLORS[a.severity] || '#6B7280' })),
    [baseFiltered, severityFilter]
  )

  const mapEvents = filteredAlerts
  const mappedTotal = useMemo(() => (data.events || []).filter(hasCoords).length, [data.events])

  const listAlerts = useMemo(
    () => [...filteredAlerts].sort(
      (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || time(b.firstSeen) - time(a.firstSeen)
    ),
    [filteredAlerts]
  )

  const filtersActive = !!(search || diseaseFilter || severityFilter || waitingOnly || statusFilter !== 'open' || days !== 30)

  function clearFilters() {
    setSearch('')
    setDiseaseFilter('')
    setSeverityFilter('')
    setStatusFilter('open')
    setDays(30)
    setWaitingOnly(false)
  }

  function applyCard(card) {
    setSearch('')
    setDiseaseFilter('')
    setWaitingOnly(false)
    setSeverityFilter('')
    setStatusFilter('open')
    if (card === 'critical') setSeverityFilter('critical')
    if (card === 'waiting') { setStatusFilter('New'); setWaitingOnly(true) }
    if (card === 'escalated') setStatusFilter('Escalated')
  }

  function selectFromList(id) {
    setFocus({ id })
  }

  function handleExportReport() {
    exportCsv('surveillance-map-events.csv', filteredAlerts, [
      { label: 'ID', value: (a) => a.id },
      { label: 'Title', value: (a) => a.title },
      { label: 'Disease', value: (a) => a.diseaseName || a.disease },
      { label: 'Area', value: (a) => a.area },
      { label: 'Sub-county', value: (a) => a.subCounty },
      { label: 'Severity', value: (a) => a.severity },
      { label: 'Status', value: (a) => a.status },
      { label: 'People', value: (a) => a.people },
      { label: 'Reports', value: (a) => a.reports },
      { label: 'Sources', value: (a) => (a.sources || []).join('; ') },
      { label: 'First reported', value: (a) => a.firstSeen },
      { label: 'Last reported', value: (a) => a.lastSeen },
      { label: 'Latitude', value: (a) => a.lat },
      { label: 'Longitude', value: (a) => a.lng },
    ])
  }

  const { stats } = data
  const selectCls = 'appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-9 py-2.5 text-sm font-medium text-gray-900 min-w-[150px] focus:outline-none'
  const cardBtn = 'text-left rounded-2xl focus:outline-none focus:ring-2 focus:ring-red-100 hover:shadow-sm transition-shadow'

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-brand-navy">Surveillance Map</h2>
          <p className="text-sm text-gray-400">Where reported events are in Dadaab and Kalobeyei, coloured by severity.</p>
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
        <button type="button" className={cardBtn} onClick={() => applyCard('open')}>
          <StatCard icon={MapPin} label="Open events" value={stats.open} />
        </button>
        <button type="button" className={cardBtn} onClick={() => applyCard('critical')}>
          <StatCard icon={AlertTriangle} label="Critical" value={stats.critical} />
        </button>
        <button type="button" className={cardBtn} onClick={() => applyCard('waiting')}>
          <StatCard icon={Clock} label="Waiting over 24h" value={stats.waiting} />
        </button>
        <button type="button" className={cardBtn} onClick={() => applyCard('escalated')}>
          <StatCard icon={TrendingUp} label="Escalated" value={stats.escalated} />
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
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setWaitingOnly(false) }} className={selectCls} aria-label="Status">
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <div className="relative">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={selectCls} aria-label="Period">
            {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {filtersActive && (
          <button type="button" onClick={clearFilters} className="text-sm font-medium text-red-700 hover:underline">
            Clear filters
          </button>
        )}

        <span className="text-sm text-gray-400 ml-auto whitespace-nowrap">
          Showing {filteredAlerts.length} of {mappedTotal} events
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div
          ref={mapBoxRef}
          className="bg-white rounded-2xl border border-gray-100 overflow-hidden relative flex-1 min-w-0 h-[420px] lg:h-[600px]"
        >
          <div className="absolute inset-0">
            <MapView events={mapEvents} hoveredId={hoveredId} focus={focus} onToast={showToast} />
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

          {!loading && mapEvents.length === 0 && (
            <div className="absolute inset-0 z-[900] flex items-center justify-center pointer-events-none p-4">
              <div className="bg-white border border-gray-100 rounded-2xl shadow-lg px-8 py-6 text-center">
                <MapPin className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                <div className="text-sm font-semibold text-gray-900">No events on the map</div>
                {filtersActive && <div className="text-xs text-gray-400 mt-1">Try clearing the filters.</div>}
              </div>
            </div>
          )}
        </div>

        <aside className="bg-white rounded-2xl border border-gray-100 lg:w-80 lg:shrink-0 lg:h-[600px] max-h-[420px] lg:max-h-none overflow-y-auto">
          {listAlerts.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">No events to list.</p>
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
                      className="w-3 h-3 rounded-full mt-1 shrink-0"
                      style={{ backgroundColor: a.color }}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">{a.title}</span>
                      <span className="block text-xs text-gray-400 truncate">{a.area}</span>
                      <span className="block text-[11px] text-gray-400">{relTime(a.firstSeen)}</span>
                      {isWaiting(a) && (
                        <span className="inline-block mt-1 text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                          {Number(a.openHours) < 48 ? `Waiting ${a.openHours}h` : `Waiting ${Math.floor(a.openHours / 24)} days`}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {data.unmapped > 0 && (
        <p className="text-sm text-gray-400 mt-3">
          {data.unmapped} events have no map location.{' '}
          <Link to="/alerts-signals" className="text-red-700 font-medium hover:underline">View them in Review Queue.</Link>
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
