import { useEffect, useMemo, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { Link } from 'react-router-dom'
import { FileText, AlertTriangle, ShieldCheck, Search, MapPin, ArrowRight, Radio, TrendingUp } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import ChartCard from '../components/analytics/ChartCard'
import { CHART_FONT } from '../charts/chartSetup'
import { getOfficerDashboard } from '../api/frappe'
import { FOCUS, CARD, Badge } from '../components/chp/ui'

const ICONS = { new: FileText, priority: AlertTriangle, verify: ShieldCheck, investigating: Search }
const SEVERITY = { critical: { label: 'Critical', tone: 'red' }, high: { label: 'High', tone: 'amber' }, standard: { label: 'Standard', tone: 'gray' } }
const STATUS = { New: 'new', Verifying: 'verifying', Investigating: 'in the field', Confirmed: 'confirmed', Escalated: 'escalated' }
const GRID = '#F0F0F0'
const TICK = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }

export default function SurveillanceDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getOfficerDashboard().then(setData).catch((e) => setError(e.message || 'Could not load the dashboard'))
  }, [])

  const chart = useMemo(() => {
    if (!data?.trend?.length) return null
    return {
      labels: data.trend.map((w) => `Week of ${w.label}`),
      datasets: [{
        label: 'Signals',
        data: data.trend.map((w) => w.total),
        borderColor: '#EE2435',
        backgroundColor: 'rgba(238, 36, 53, 0.12)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#EE2435',
        borderWidth: 2,
      }],
    }
  }, [data])

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        titleFont: tickFont,
        bodyFont: tickFont,
        callbacks: {
          label: (ctx) => {
            const w = data.trend[ctx.dataIndex]
            return [`${w.total} signal${w.total === 1 ? '' : 's'}`, ...(w.top ? [`Most reported: ${w.top.disease} (${w.top.count})`] : [])]
          },
        },
      },
    },
    scales: {
      x: { grid: { color: GRID }, ticks: { color: TICK, font: tickFont } },
      y: { grid: { color: GRID }, ticks: { color: TICK, font: tickFont, precision: 0 }, beginAtZero: true },
    },
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-brand-navy">Surveillance Operations Dashboard</h2>
        <p className="text-sm text-gray-400">Review priority signals, verify alerts, investigate events, and coordinate response in your region</p>
      </div>

      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {(data?.stats || ['new', 'priority', 'verify', 'investigating'].map((key) => ({ key }))).map((s) => {
          const Icon = ICONS[s.key] || FileText
          return (
            <Link key={s.key} to={s.link || '/alerts-signals'} title={s.hint}
              className={`bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4 hover:border-gray-200 ${FOCUS}`}>
              <span className="bg-gray-100 rounded-full p-3.5 shrink-0"><Icon className="w-5 h-5 text-gray-500" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-gray-400">{s.label || ' '}</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-gray-900">{data ? s.value : '–'}</span>
                  {s.change != null && (
                    <span className={`text-xs font-medium ${s.change > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                      {s.change > 0 ? '+' : ''}{s.change}%
                    </span>
                  )}
                </span>
              </span>
            </Link>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-5">
        <ChartCard title="Signal Trend (6 weeks)" height="h-72 sm:h-80">
          {chart ? <Line data={chart} options={options} /> : <p className="text-sm text-gray-400">{data ? 'No signals in the last 6 weeks.' : 'Loading…'}</p>}
        </ChartCard>

        <section className={`${CARD} p-5 sm:p-6`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm sm:text-base font-medium text-gray-900">Priority Alert Queue</h3>
            <Link to="/alerts-signals?tab=all" className={`inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-800 rounded ${FOCUS}`}>
              View all <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
          {!data ? <p className="text-sm text-gray-400">Loading…</p> : !data.queue.length ? (
            <p className="text-sm text-gray-400 py-6 text-center">No open events in your region.</p>
          ) : (
            <ul className="space-y-3">
              {data.queue.map((e) => (
                <li key={e.id}>
                  <Link to={`/alerts-signals/${encodeURIComponent(e.id)}`} className={`border border-gray-100 rounded-xl p-4 flex items-center gap-4 hover:bg-gray-50/60 ${FOCUS}`}>
                    <span className="w-11 h-11 rounded-full bg-red-50 flex items-center justify-center shrink-0"><Radio className="w-4 h-4 text-red-600" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-gray-900 truncate">{e.diseaseName || e.title}</span>
                      <span className="text-sm text-gray-500 flex items-center gap-1.5 mt-1 truncate">
                        <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        {[e.area, e.subCounty].filter(Boolean).join(', ') || 'Location missing'} • {STATUS[e.status] || e.status} • {e.people} affected
                      </span>
                    </span>
                    <Badge tone={SEVERITY[e.severity]?.tone}>{SEVERITY[e.severity]?.label || 'Standard'}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {data?.trends?.length > 0 && (
          <section className={`${CARD} p-5 sm:p-6`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm sm:text-base font-medium text-gray-900">Rising trends (Epi Trends)</h3>
              <Link to="/epi-trends" className={`inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-800 rounded ${FOCUS}`}>
                View all <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
            <ul className="space-y-3">
              {data.trends.map((t) => (
                <li key={t.id}>
                  <Link to={`/epi-trends/${t.id}`} className={`border border-gray-100 rounded-xl p-4 flex items-center gap-4 hover:bg-gray-50/60 ${FOCUS}`}>
                    <span className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4 text-gray-600" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-gray-900 truncate">{t.title}</span>
                      <span className="block text-sm text-gray-500 mt-1 truncate">{t.location}{t.why ? ` • ${t.why}` : ''}</span>
                    </span>
                    <Badge tone={SEVERITY[t.severity]?.tone}>{SEVERITY[t.severity]?.label || 'Standard'}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  )
}
