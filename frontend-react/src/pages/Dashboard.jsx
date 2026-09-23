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
import {
  getDashboardStats,
  getDashboardDiseaseTrends,
  getDashboardAlerts,
  getDailyAlertVolume,
  getDiseaseDistribution,
  getEnvironmentalRiskFactors,
  exportCsv,
} from '../api/frappe'

const ICONS = { MapPin, AlertTriangle, Radio, CheckCheck }
const iconFor = (name) => ICONS[name] || MapPin

const SEVERITY_STYLES = {
  critical: 'bg-red-600',
  high: 'bg-amber-400',
  medium: 'bg-blue-500',
  low: 'bg-emerald-500',
}

const QUICK_ACTIONS = [
  { label: 'View All Alerts', icon: Radio, to: '/alerts-signals', color: '#3E85C5', bg: 'rgba(62, 133, 197, 0.05)' },
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
  y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont }, beginAtZero: true },
}

function formatChangePct(pct) {
  if (pct > 0) return { label: `+${pct}%`, className: 'text-red-600' }
  if (pct < 0) return { label: `${pct}%`, className: 'text-gray-600' }
  return { label: '±0%', className: 'text-gray-600' }
}

export default function Dashboard() {
  const [stats, setStats] = useState([])
  const [diseaseTrends, setDiseaseTrends] = useState({ labels: [], series: [] })
  const [alerts, setAlerts] = useState([])
  const [dailyVolume, setDailyVolume] = useState({ labels: [], data: [] })
  const [distribution, setDistribution] = useState({ labels: [], colors: [], data: [], changePct: [] })
  const [envFactors, setEnvFactors] = useState({ labels: [], colors: [], data: [] })

  useEffect(() => {
    (async () => {
      const [statsRes, trendsRes, alertsRes, volumeRes, distributionRes, envRes] = await Promise.all([
        getDashboardStats(),
        getDashboardDiseaseTrends(),
        getDashboardAlerts(),
        getDailyAlertVolume(),
        getDiseaseDistribution(),
        getEnvironmentalRiskFactors(),
      ])
      setStats(statsRes)
      setDiseaseTrends(trendsRes)
      setAlerts(alertsRes)
      setDailyVolume(volumeRes)
      setDistribution(distributionRes)
      setEnvFactors(envRes)
    })()
  }, [])

  const diseaseTrendsData = useMemo(() => {
    if (!diseaseTrends.labels.length) return null
    return {
      labels: diseaseTrends.labels,
      datasets: diseaseTrends.series.map((s) => ({
        label: s.name,
        data: s.data,
        borderColor: s.color,
        backgroundColor: `${s.color}99`,
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: '#fff',
        pointBorderColor: s.color,
        pointBorderWidth: 2,
        borderWidth: 2,
      })),
    }
  }, [diseaseTrends])
  const diseaseTrendsOptions = {
    ...baseOptions,
    scales: { ...baseScales, y: { ...baseScales.y, stacked: true }, x: { ...baseScales.x, stacked: true } },
  }

  const dailyVolumeData = useMemo(() => {
    if (!dailyVolume.labels.length) return null
    return {
      labels: dailyVolume.labels,
      datasets: [{ label: 'Alerts', data: dailyVolume.data, backgroundColor: '#D62728', borderRadius: 4, barThickness: 36 }],
    }
  }, [dailyVolume])
  const dailyVolumeOptions = { ...baseOptions, scales: baseScales }

  const distributionData = useMemo(() => {
    if (!distribution.labels.length) return null
    return {
      labels: distribution.labels,
      datasets: [{ data: distribution.data, backgroundColor: distribution.colors, borderColor: '#fff', borderWidth: 2 }],
    }
  }, [distribution])
  const distributionOptions = { ...baseOptions, plugins: { ...baseOptions.plugins, legend: { display: false } } }

  const envFactorsData = useMemo(() => {
    if (!envFactors.labels.length) return null
    return {
      labels: envFactors.labels,
      datasets: [{ label: 'Value', data: envFactors.data, backgroundColor: envFactors.colors, borderRadius: 4, barThickness: 90 }],
    }
  }, [envFactors])
  const envFactorsOptions = { ...baseOptions, scales: baseScales }

  function handleExportReport() {
    exportCsv('dashboard-overview.csv', stats, [
      { label: 'Metric', value: (r) => r.label },
      { label: 'Value', value: (r) => r.value },
      { label: 'Change %', value: (r) => r.changePct },
      { label: 'Trend', value: (r) => r.trend },
    ])
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Dashboard Overview</h2>
          <p className="text-sm text-gray-400">Real-time surveillance insights for all the locations</p>
        </div>
        <button
          onClick={handleExportReport}
          className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 flex items-center gap-2 hover:bg-gray-50"
        >
          <Download className="w-4 h-4" /> Export Report
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        {stats.map((s) => (
          <StatCard
            key={s.key}
            icon={iconFor(s.icon)}
            label={s.label}
            value={s.value}
            changePct={s.changePct}
            trend={s.trend}
            sentiment={s.sentiment}
          />
        ))}
      </div>

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

        <ChartCard
          title="Disease Trends (Cases by disease type)"
          height="h-72 sm:h-80"
          legend={
            <div className="flex items-center gap-4 flex-wrap justify-end">
              {diseaseTrends.series.map((s) => (
                <span key={s.name} className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: s.color }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />{s.name}
                </span>
              ))}
            </div>
          }
        >
          {diseaseTrendsData && <Line data={diseaseTrendsData} options={diseaseTrendsOptions} />}
        </ChartCard>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm sm:text-base font-medium text-gray-900">Alerts & Signals</h3>
            <Link to="/alerts-signals" className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="border border-gray-100 rounded-xl p-4 flex items-center gap-3">
                <MapPin className="w-5 h-5 text-gray-900 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">{alert.title}</p>
                  <p className="text-sm text-gray-500 truncate">
                    {alert.location} • {alert.date} • {alert.affected} affected • Data Source: {alert.source} • AI Score: {alert.aiScore}%
                  </p>
                </div>
                <span className={['shrink-0 text-white text-xs font-medium px-3 py-1 rounded uppercase', SEVERITY_STYLES[alert.severity]].join(' ')}>
                  {alert.severity}
                </span>
              </div>
            ))}
          </div>
        </div>

        <ChartCard title="Daily Alert Volume" height="h-72 sm:h-80">
          {dailyVolumeData && <Bar data={dailyVolumeData} options={dailyVolumeOptions} />}
        </ChartCard>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <h3 className="text-sm sm:text-base font-medium text-gray-900 mb-5">Disease Distribution</h3>
          <div className="relative w-full h-64 sm:h-72 mb-5">
            {distributionData && <Pie data={distributionData} options={distributionOptions} />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {distribution.labels.map((label, i) => {
              const change = formatChangePct(distribution.changePct[i])
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: distribution.colors[i] }} />
                  <span className="text-xs text-gray-700 flex-1">{label}</span>
                  <span className={['text-xs font-medium shrink-0', change.className].join(' ')}>{change.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        <ChartCard title="Environmental Risk Factors" height="h-72 sm:h-96">
          {envFactorsData && <Bar data={envFactorsData} options={envFactorsOptions} />}
        </ChartCard>
      </div>
    </AppShell>
  )
}
