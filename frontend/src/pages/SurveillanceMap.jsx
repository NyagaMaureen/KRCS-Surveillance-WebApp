import { useState, useEffect, useMemo, useCallback } from 'react'
import { Download, RefreshCw, Search, Filter, MapPin, AlertTriangle, Radio, CheckCheck } from 'lucide-react'
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
const REPORT_COLOR = '#6B7280'

const SEVERITIES = ['critical', 'high', 'medium', 'low']
const MAP_LAYERS = [
  { value: 'both', label: 'Both' },
  { value: 'alerts', label: 'Alerts' },
  { value: 'reports', label: 'Reports' },
]

const LEGEND_ITEMS = [
  { label: 'Critical', color: SEVERITY_COLORS.critical },
  { label: 'High', color: SEVERITY_COLORS.high },
  { label: 'Medium', color: SEVERITY_COLORS.medium },
  { label: 'Low', color: SEVERITY_COLORS.low },
  { label: 'Report', color: REPORT_COLOR },
]

export default function SurveillanceMap() {
  const [data, setData] = useState({ alerts: [], reports: [], unmapped_alerts: 0, stats: { total: 0, critical: 0, investigating: 0, resolved: 0 } })
  const [diseaseOptions, setDiseaseOptions] = useState([])
  const [search, setSearch] = useState('')
  const [diseaseFilter, setDiseaseFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [mapLayer, setMapLayer] = useState('both')

  const load = useCallback(() => {
    getMapData().then(setData)
  }, [])

  useEffect(() => {
    load()
    getDiseaseOptions().then(setDiseaseOptions)
  }, [load])

  const filteredAlerts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data.alerts || []).filter((a) => {
      if (diseaseFilter && a.disease !== diseaseFilter) return false
      if (severityFilter && a.severity !== severityFilter) return false
      if (!q) return true
      return `${a.title} ${a.location}`.toLowerCase().includes(q)
    })
  }, [data.alerts, search, diseaseFilter, severityFilter])

  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data.reports || []).filter((r) => {
      if (diseaseFilter && r.disease !== diseaseFilter) return false
      if (!q) return true
      return `${r.title} ${r.location}`.toLowerCase().includes(q)
    })
  }, [data.reports, search, diseaseFilter])

  const markers = useMemo(() => {
    const alertMarkers = mapLayer === 'reports' ? [] : filteredAlerts.map((a) => ({
      id: a.id,
      lat: a.lat,
      lng: a.lng,
      color: SEVERITY_COLORS[a.severity] || REPORT_COLOR,
      kind: 'alert',
      popup: { title: a.title, severity: a.severity, location: a.location, affected: a.affected },
    }))
    const reportMarkers = mapLayer === 'alerts' ? [] : filteredReports.map((r) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lng,
      color: REPORT_COLOR,
      kind: 'report',
      popup: { title: r.title, location: r.location, affected: r.affected },
    }))
    return [...alertMarkers, ...reportMarkers]
  }, [filteredAlerts, filteredReports, mapLayer])

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
    ])
  }

  const { stats } = data

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Surveillance Map</h2>
          <p className="text-sm text-gray-400">Geographic visualization of health alerts and reports</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportReport}
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50"
          >
            <Download className="w-4 h-4" /> Export Report
          </button>
          <button
            onClick={load}
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={MapPin} label="Total Alerts" value={stats.total} />
        <StatCard icon={AlertTriangle} label="Critical Cases" value={stats.critical} />
        <StatCard icon={Radio} label="Active Investigations" value={stats.investigating} />
        <StatCard icon={CheckCheck} label="Resolved Cases" value={stats.resolved} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-3 flex-wrap mb-6">
        <div className="relative flex-1 min-w-[240px]">
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
          <select
            value={diseaseFilter}
            onChange={(e) => setDiseaseFilter(e.target.value)}
            className="appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-9 py-2.5 text-sm font-medium text-gray-900 min-w-[170px] focus:outline-none"
          >
            <option value="">Disease Type</option>
            {diseaseOptions.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-9 py-2.5 text-sm font-medium text-gray-900 min-w-[170px] focus:outline-none"
          >
            <option value="">Severity Level</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={mapLayer}
            onChange={(e) => setMapLayer(e.target.value)}
            className="appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-9 py-2.5 text-sm font-medium text-gray-900 min-w-[170px] focus:outline-none"
          >
            {MAP_LAYERS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <Filter className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden relative" style={{ height: 560 }}>
        <MapView markers={markers} />
        <div className="absolute bottom-4 left-4 bg-white border border-gray-200 rounded-lg px-5 py-3 flex items-center gap-6 flex-wrap shadow-sm">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-white shadow" style={{ backgroundColor: item.color }} />
              <span className="text-sm text-gray-900">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {data.unmapped_alerts > 0 && (
        <p className="text-sm text-gray-400 mt-3">
          {data.unmapped_alerts} alerts are in locations without map coordinates.
        </p>
      )}
    </AppShell>
  )
}
