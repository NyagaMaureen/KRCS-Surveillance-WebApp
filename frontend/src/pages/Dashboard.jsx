import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Line, Bar, Pie } from 'react-chartjs-2'
import {
  Download,
  MapPin,
  AlertTriangle,
  Radio,
  CheckCheck,
  Sparkles,
  TrendingUp,
  FileSearch,
  Map,
  FileText,
  ArrowRight,
} from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import ChartCard from '../components/analytics/ChartCard'
import StatCard from '../components/analytics/StatCard'
import { CHART_FONT } from '../charts/chartSetup'
import { getDashboard, getAreaContext, exportCsv } from '../api/frappe'
import { ContextBody } from '../components/context/ContextPanel'

const ICONS = { MapPin, AlertTriangle, Radio, CheckCheck }
const iconFor = (name) => ICONS[name] || MapPin

const SEVERITY_STYLES = {
  critical: 'bg-red-600',
  high: 'bg-amber-400',
  standard: 'bg-blue-500',
}

const SERIES_COLORS = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6', '#6B7280']

const TREND_SOURCES = [
  { key: 'community', label: 'Community', hint: 'Field reports and CBS signals' },
  { key: 'facility', label: 'Facility', hint: 'MOH 505 (IDSR) weekly cases' },
  { key: 'all', label: 'All sources', hint: 'Community and facility together' },
]

const QUICK_ACTIONS = [
  { label: 'View All Alerts', icon: Radio, to: '/epi-trends', color: '#3E85C5', bg: 'rgba(62, 133, 197, 0.05)' },
  { label: 'Analytics', icon: TrendingUp, to: '/analytics', color: '#28A745', bg: 'rgba(40, 167, 69, 0.05)' },
  { label: 'Surveillance Map', icon: Map, to: '/surveillance-map', color: '#9810FA', bg: 'rgba(152, 16, 250, 0.05)' },
  { label: 'KRCS AI Data Assistant', icon: Sparkles, to: '/ai-data-assistant', color: '#FFC107', bg: 'rgba(255, 193, 7, 0.05)' },
  { label: 'Data Explorer', icon: FileSearch, to: '/data-explorer', color: '#DC3545', bg: 'rgba(220, 53, 69, 0.05)' },
  { label: 'Reports', icon: FileText, to: '/reports', color: '#243542', bg: 'rgba(36, 53, 66, 0.05)' },
]

const GRID_COLOR = '#F0F0F0'
const TICK_COLOR = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { titleFont: tickFont, bodyFont: tickFont } },
}
const baseScales = {
  x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont } },
  y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont, precision: 0 }, beginAtZero: true },
}

function formatChangePct(pct) {
  if (pct > 0) return { label: `+${pct}%`, className: 'text-red-600' }
  if (pct < 0) return { label: `${pct}%`, className: 'text-gray-600' }
  return { label: '±0%', className: 'text-gray-600' }
}

function fmtWeek(v) {
  if (!v) return null
  const d = new Date(String(v).slice(0, 10))
  return isNaN(d) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Empty({ children }) {
  return <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-6">{children}</div>
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [trendSource, setTrendSource] = useState('community')
  const [trends, setTrends] = useState(null)
  const [hidden, setHidden] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [areaContext, setAreaContext] = useState(null)

  useEffect(() => {
    getAreaContext().then(setAreaContext).catch(() => setAreaContext([]))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getDashboard(trendSource)
      .then((d) => {
        if (cancelled) return
        if (!data) setData(d)
        setTrends(d.trends)
        setError('')
      })
      .catch((e) => !cancelled && setError(e.message || 'Could not load the dashboard'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendSource])

  const stats = data?.stats || []
  const alerts = data?.alerts || []
  const dailyVolume = data?.dailyVolume || { labels: [], data: [] }
  const distribution = data?.distribution || { labels: [], data: [], changePct: [] }
  const series = useMemo(() => (trends?.series || []).map((s, i) => ({ ...s, color: SERIES_COLORS[i % SERIES_COLORS.length] })), [trends])
  const distributionColors = distribution.labels.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length])

  const diseaseTrendsData = useMemo(() => {
    if (!trends?.labels?.length || !series.length) return null
    return {
      labels: trends.labels,
      datasets: series.map((s) => ({
        label: s.name,
        data: s.data,
        hidden: !!hidden[s.key],
        borderColor: s.color,
        backgroundColor: s.color,
        fill: false,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: '#fff',
        pointBorderColor: s.color,
        pointBorderWidth: 2,
        borderWidth: 2,
      })),
    }
  }, [trends, series, hidden])
  const diseaseTrendsOptions = { ...baseOptions, interaction: { mode: 'index', intersect: false }, scales: baseScales }

  const dailyVolumeData = useMemo(() => {
    if (!dailyVolume.labels.length) return null
    return {
      labels: dailyVolume.labels,
      datasets: [{ label: 'New events', data: dailyVolume.data, backgroundColor: '#D62728', borderRadius: 4, barThickness: 36 }],
    }
  }, [dailyVolume])
  const dailyVolumeOptions = { ...baseOptions, scales: baseScales }

  const distributionData = useMemo(() => {
    if (!distribution.labels.length) return null
    return {
      labels: distribution.labels,
      datasets: [{ data: distribution.data, backgroundColor: distributionColors, borderColor: '#fff', borderWidth: 2 }],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distribution])
  const distributionOptions = { ...baseOptions, plugins: { ...baseOptions.plugins, legend: { display: false } } }

  function handleExportReport() {
    const rows = [
      ...stats.map((s) => ({ section: 'Summary', item: s.label, value: s.value, change: `${s.changePct}% ${s.compare || ''}`.trim() })),
      ...alerts.map((a) => ({ section: 'Open events', item: `${a.title} (${a.location})`, value: `${a.affected} affected`, change: `${a.severity} · ${a.status}` })),
      ...distribution.labels.map((l, i) => ({ section: 'Events by disease (30 days)', item: l, value: distribution.data[i], change: `${distribution.changePct[i]}%` })),
      ...series.map((s) => ({ section: `Disease trends (${trends.source}, weeks ${trends.labels[0]} to ${trends.labels[trends.labels.length - 1]})`, item: s.name, value: s.total, change: 'cases' })),
    ]
    exportCsv('dashboard-overview.csv', rows, [
      { label: 'Section', value: (r) => r.section },
      { label: 'Item', value: (r) => r.item },
      { label: 'Value', value: (r) => r.value },
      { label: 'Change / detail', value: (r) => r.change },
    ])
  }

  const sourceInfo = TREND_SOURCES.find((s) => s.key === trendSource)
  const latestWeek = fmtWeek(trends?.latestWeek)

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Dashboard Overview</h2>
          <p className="text-sm text-gray-400">Surveillance overview for your area, from live events and weekly counts</p>
        </div>
        <button
          onClick={handleExportReport}
          disabled={!data}
          className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50 disabled:opacity-50"
        >
          <Download className="w-4 h-4" /> Export Report
        </button>
      </div>

      {error && <p className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-6">{error}</p>}

      {data?.eventsAvailable && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
          {stats.map((s) => (
            <div key={s.key} title={s.compare ? `Change: ${s.compare}` : undefined}>
              <StatCard
                icon={iconFor(s.icon)}
                label={s.label}
                value={s.value}
                changePct={s.changePct}
                trend={s.trend}
                sentiment={s.sentiment}
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <h3 className="text-sm sm:text-base font-medium text-gray-900 mb-5">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.label}
                to={action.to}
                className="rounded-xl p-6 flex flex-col items-center gap-4 text-center hover:opacity-80 transition-opacity"
                style={{ backgroundColor: action.bg }}
              >
                <action.icon className="w-10 h-10" style={{ color: action.color }} />
                <span className="text-sm font-medium text-gray-700">{action.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <h3 className="text-sm sm:text-base font-medium text-gray-900">Disease Trends (cases per week, top 5 diseases)</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {sourceInfo?.hint} · {trends?.area || 'Pilot sites'} · last 12 complete weeks
                {trendSource !== 'community' && latestWeek && <> · facility data up to week of {latestWeek}</>}
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-1 flex gap-1">
              {TREND_SOURCES.map((s) => (
                <button key={s.key} onClick={() => { setTrendSource(s.key); setHidden({}) }}
                  className={['px-3 py-1.5 rounded-md text-xs font-medium transition-colors', trendSource === s.key ? 'bg-red-600 text-white' : 'text-gray-900'].join(' ')}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            {series.map((s) => (
              <button key={s.key} onClick={() => setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))}
                title={hidden[s.key] ? 'Show' : 'Hide'}
                className={['inline-flex items-center gap-1.5 text-xs font-medium rounded-full border px-2.5 py-1 transition-opacity',
                  hidden[s.key] ? 'opacity-40 border-gray-200' : 'border-gray-100'].join(' ')}
                style={{ color: s.color }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.name} <span className="text-gray-400 font-normal">{s.total.toLocaleString()}</span>
              </button>
            ))}
            {series.length > 1 && <span className="text-[11px] text-gray-400">Click a disease to hide or show it</span>}
          </div>
          <div className="relative w-full h-72 sm:h-80">
            {diseaseTrendsData ? <Line data={diseaseTrendsData} options={diseaseTrendsOptions} />
              : <Empty>{loading ? 'Loading…' : 'No cases reported for the pilot sites in the last 12 weeks from this source.'}</Empty>}
          </div>
        </div>

        {data?.eventsAvailable && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm sm:text-base font-medium text-gray-900">Alerts & Signals: most urgent open events</h3>
              <Link to="/alerts-signals" className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700">
                View all <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="space-y-3">
              {alerts.map((alert) => (
                <Link key={alert.id} to={`/alerts-signals/${encodeURIComponent(alert.id)}`}
                  className="border border-gray-100 rounded-xl p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                  <MapPin className="w-5 h-5 text-gray-900 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 truncate">{alert.title}</p>
                    <p className="text-sm text-gray-500 truncate">
                      {alert.location} • {alert.date} • {alert.affected} affected
                      {alert.deaths > 0 && <> • {alert.deaths} death{alert.deaths === 1 ? '' : 's'}</>}
                      {' '}• {alert.reports} report{alert.reports === 1 ? '' : 's'}
                      {alert.sources.length > 0 && <> • Source: {alert.sources.join(', ')}</>}
                      {' '}• {alert.status}
                    </p>
                  </div>
                  <span className={['shrink-0 text-white text-xs font-medium px-3 py-1 rounded uppercase', SEVERITY_STYLES[alert.severity] || 'bg-gray-400'].join(' ')}>
                    {alert.severity}
                  </span>
                </Link>
              ))}
              {!alerts.length && <p className="text-sm text-gray-400 text-center py-6">{loading ? 'Loading…' : 'No open events in your area.'}</p>}
            </div>
          </div>
        )}

        {data?.eventsAvailable && (
          <ChartCard title="Daily Alert Volume (new events, last 7 days)" height="h-72 sm:h-80">
            {dailyVolumeData && dailyVolume.data.some((n) => n > 0)
              ? <Bar data={dailyVolumeData} options={dailyVolumeOptions} />
              : <Empty>{loading ? 'Loading…' : 'No new events in the last 7 days.'}</Empty>}
          </ChartCard>
        )}

        {data?.eventsAvailable && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
            <h3 className="text-sm sm:text-base font-medium text-gray-900 mb-1">Disease Distribution</h3>
            <p className="text-xs text-gray-400 mb-5">Events in the last 30 days by disease (discarded left out); change vs the previous 30 days</p>
            <div className="relative w-full h-64 sm:h-72 mb-5">
              {distributionData ? <Pie data={distributionData} options={distributionOptions} />
                : <Empty>{loading ? 'Loading…' : 'No events in the last 30 days.'}</Empty>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {distribution.labels.map((label, i) => {
                const change = formatChangePct(distribution.changePct[i])
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: distributionColors[i] }} />
                    <span className="text-xs text-gray-700 flex-1">{label} <span className="text-gray-400">({distribution.data[i]})</span></span>
                    <span className={['text-xs font-medium shrink-0', change.className].join(' ')}>{change.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h3 className="text-sm sm:text-base font-medium text-gray-900">Environmental & Population Context</h3>
              <p className="text-xs text-gray-400 mt-0.5">Rainfall, population and WASH per sub-county. Background only; not used by the alert engine.</p>
            </div>
            <Link to="/context-data" className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700">
              Context data <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          {areaContext === null ? (
            <p className="text-sm text-gray-400">Loading context…</p>
          ) : !areaContext.length ? (
            <p className="text-sm text-gray-400">No context recorded for your area yet.</p>
          ) : (
            <div className="space-y-5">
              {areaContext.map((c) => (
                <div key={c.subCounty}>
                  <div className="text-sm font-semibold text-gray-900 mb-2">{c.subCountyName} <span className="text-xs font-normal text-gray-400">· {c.county}</span></div>
                  <ContextBody ctx={c} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
