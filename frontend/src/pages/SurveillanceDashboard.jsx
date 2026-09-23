import { useState, useEffect, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { Link } from 'react-router-dom'
import { FileText, CheckCircle, ArrowLeftRight, CheckCheck, MapPin, ArrowRight } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import ChartCard from '../components/analytics/ChartCard'
import StatCard from '../components/analytics/StatCard'
import { CHART_FONT } from '../charts/chartSetup'
import { getSurveillanceOfficerStats, getSignalTrend, getPriorityAlertQueue } from '../api/frappe'

const ICONS = { FileText, CheckCircle, ArrowLeftRight, CheckCheck }
const iconFor = (name) => ICONS[name] || FileText

const STATUS_LABEL = { pending: 'pending', critical: 'critical' }

const GRID_COLOR = '#F0F0F0'
const TICK_COLOR = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }

export default function SurveillanceDashboard() {
  const [stats, setStats] = useState([])
  const [signalTrend, setSignalTrend] = useState({ labels: [], data: [] })
  const [alertQueue, setAlertQueue] = useState([])

  useEffect(() => {
    (async () => {
      const [statsRes, trendRes, queueRes] = await Promise.all([
        getSurveillanceOfficerStats(),
        getSignalTrend(),
        getPriorityAlertQueue(),
      ])
      setStats(statsRes)
      setSignalTrend(trendRes)
      setAlertQueue(queueRes)
    })()
  }, [])

  const signalTrendData = useMemo(() => {
    if (!signalTrend.labels.length) return null
    return {
      labels: signalTrend.labels,
      datasets: [{
        label: 'AWD',
        data: signalTrend.data,
        borderColor: '#D62728',
        backgroundColor: 'rgba(214, 39, 40, 0.15)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#D62728',
        pointBorderWidth: 2,
        borderWidth: 2,
      }],
    }
  }, [signalTrend])

  const signalTrendOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        titleFont: tickFont,
        bodyFont: tickFont,
        callbacks: { label: (ctx) => `AWD : ${ctx.parsed.y}` },
      },
    },
    scales: {
      x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont } },
      y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont }, beginAtZero: true },
    },
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Surveillance Operations Dashboard</h2>
        <p className="text-sm text-gray-400">Review priority signals, verify alerts, investigate events, and coordinate response</p>
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
        <ChartCard title="Signal Trend (6 weeks)" height="h-72 sm:h-96">
          {signalTrendData && <Line data={signalTrendData} options={signalTrendOptions} />}
        </ChartCard>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm sm:text-base font-medium text-gray-900">Priority Alert Queue</h3>
            <Link to="/alerts-signals" className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {alertQueue.map((alert) => (
              <div key={alert.id} className="border border-gray-100 rounded-xl p-4 flex items-center gap-4">
                <span className="w-12 h-12 rounded-full bg-red-600/10 flex items-center justify-center shrink-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">{alert.title}</p>
                  <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-1 truncate">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    {alert.location} • {STATUS_LABEL[alert.status] || alert.status} • {alert.affected} affected
                  </p>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-600/10 border border-red-600/50 rounded-full px-3 py-1.5">
                  Risk {alert.risk}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
