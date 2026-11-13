import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import '../charts/chartSetup'
import { FileText, AlertTriangle, ArrowRightLeft, ClipboardCheck, Plus, TrendingUp, Building2 } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { FOCUS, Skeleton } from '../components/chp/ui'
import { getFhwDashboard } from '../api/frappe'

// Facility Health Worker dashboard: report when the EMR is down, referrals to the facility, alerts nearby.
// Data: surveillance.fhw.get_dashboard

const STATUS_CLS = { Pending: 'bg-amber-50 text-amber-800', Arrived: 'bg-green-50 text-green-800', 'Did not arrive': 'bg-red-50 text-red-800' }
const SEV_CLS = { critical: 'bg-red-50 text-red-800', high: 'bg-amber-50 text-amber-800', standard: 'bg-gray-100 text-gray-800' }
// referral numbers: REF-009 (stored as task TSK-00009)
const SEV_LABEL = { critical: 'Critical', high: 'High', standard: 'Normal' }

// grey band behind the week under the mouse, as in the design
const HOVER_BAND = {
  id: 'hoverBand',
  beforeDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() || []
    if (!active.length) return
    const { ctx, chartArea } = chart
    const bar = chart.getDatasetMeta(0).data[active[0].index]
    if (!bar) return
    const w = bar.width * 1.3
    ctx.save()
    ctx.fillStyle = '#D1D5DB'
    ctx.fillRect(bar.x - w / 2, chartArea.top, w, chartArea.bottom - chartArea.top)
    ctx.restore()
  },
}

const weekLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const dateText = (v) => {
  const d = new Date(String(v || '').replace(' ', 'T'))
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function FhwDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { getFhwDashboard().then(setData).catch((e) => setError(e.message || 'Could not load the dashboard')) }, [])

  const cards = data ? [
    { label: 'Reports I sent (30 days)', value: data.cards.reports, icon: FileText, to: '/reports' },
    { label: 'Suspected cases nearby', value: data.cards.suspected, icon: AlertTriangle },
    { label: 'Referrals waiting', value: data.cards.pendingReferrals, icon: ArrowRightLeft, to: '/referrals' },
    { label: 'My tasks', value: data.cards.tasks, icon: ClipboardCheck, to: '/my-tasks' },
  ] : []

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-brand-navy">Facility Surveillance Dashboard</h2>
          <p className="flex items-center gap-1.5 text-sm text-gray-500">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            {data ? (data.facility ? `${data.facility}${data.subCounty ? ` · ${data.subCounty}` : ''}` : 'No facility assigned yet. Ask your administrator to set it in User Management.') : 'Loading…'}
          </p>
        </div>
        <Link to="/record-health-signal" className={`inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 ${FOCUS}`}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Create Report
        </Link>
      </div>

      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {!data && !error && <Skeleton rows={6} />}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {cards.map((c) => {
              const body = (
                <>
                  <div>
                    <div className="text-xs font-semibold text-white">{c.label}</div>
                    <div className="text-2xl font-bold text-white">{c.value}</div>
                  </div>
                  <div className="rounded-full bg-white/20 p-2"><c.icon className="h-4 w-4 text-white" aria-hidden="true" /></div>
                </>
              )
              return c.to
                ? <Link key={c.label} to={c.to} className={`flex items-center justify-between rounded-xl bg-red-600 p-4 hover:bg-red-700 ${FOCUS}`}>{body}</Link>
                : <div key={c.label} className="flex items-center justify-between rounded-xl bg-red-600 p-4">{body}</div>
            })}
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-base font-bold text-gray-900">Facility case trend</h3>
            <p className="mb-3 text-xs text-gray-500">Cases at {data.facility || 'your facility'} in the last {data.facilityTrend.labels.length || 8} weeks of MOH 505 reports uploaded.</p>
            {data.facilityTrend.labels.length ? (
              <div className="h-64">
                <Bar
                  data={{ labels: data.facilityTrend.labels, datasets: [{ label: 'cases', data: data.facilityTrend.cases,
                    backgroundColor: '#0EA5E9', hoverBackgroundColor: '#0EA5E9', borderRadius: 3, maxBarThickness: 64 }] }}
                  plugins={[HOVER_BAND]}
                  options={{ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false },
                      tooltip: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', borderWidth: 1, titleColor: '#4B5563', bodyColor: '#0284C7',
                        titleFont: { weight: 'normal' }, footerColor: '#374151', footerFont: { weight: 'normal' }, footerMarginTop: 6, displayColors: false, padding: 10, cornerRadius: 2,
                        callbacks: { title: (items) => data.facilityTrend.titles[items[0].dataIndex], label: (item) => `cases : ${item.parsed.y}`,
                          footer: (items) => (data.facilityTrend.top?.[items[0].dataIndex] || []).map((d) => `${d.disease} ${d.cases}`) } } },
                    scales: { x: { grid: { color: '#F3F4F6' } }, y: { beginAtZero: true, grid: { color: '#F3F4F6' }, ticks: { precision: 0 } } } }}
                  aria-label="MOH 505 cases at the facility each week"
                />
              </div>
            ) : <p className="py-10 text-center text-sm text-gray-500">{data.facility ? 'No MOH 505 weeks uploaded for this facility yet.' : 'Shows once your facility is set.'}</p>}
          </section>

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-5 py-4">
              <h3 className="text-base font-bold text-gray-900">Referrals to {data.facility || 'your facility'}</h3>
              <Link to="/referrals" className={`rounded text-sm font-semibold text-red-700 hover:underline ${FOCUS}`}>See all</Link>
            </div>
            {data.referrals.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-gray-200 [&_th]:border [&_th]:border-gray-200">
                  <thead>
                    <tr className="text-left text-xs text-gray-900 [&_th]:border-b-2 [&_th]:border-b-red-600 [&_th]:font-bold">
                      <th className="px-4 py-3">Referral</th><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Suspected condition</th>
                      <th className="px-4 py-3">From</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.referrals.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-semibold text-gray-900">{r.ref || '—'}</td>
                        <td className="px-4 py-3 text-gray-900">{r.people ? `${r.people} ${r.people === 1 ? 'person' : 'people'}` : '—'}{r.patient && <span className="block text-xs text-gray-500">{r.patient}</span>}</td>
                        <td className="px-4 py-3 text-gray-900">{r.condition || r.reason || '—'}</td>
                        <td className="px-4 py-3 text-gray-900">{r.from || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-900">{dateText(r.date)}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[r.status] || 'bg-gray-100 text-gray-800'}`}>{r.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="border-t border-gray-100 px-5 py-8 text-center text-sm text-gray-500">{data.facility ? 'No referrals to this facility yet.' : 'Referrals show here once your facility is set.'}</p>}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">Alerts near {data.facility || 'your facility'}</h3>
              {data.canSeeAlerts && <Link to="/epi-trends" className={`rounded text-sm font-semibold text-red-700 hover:underline ${FOCUS}`}>Epi Trends</Link>}
            </div>
            {data.alerts.length ? (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {data.alerts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    {a.kind === 'rise' ? <TrendingUp className="h-4 w-4 shrink-0 text-red-700" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      {a.kind === 'rise' && data.canSeeAlerts
                        ? <Link to={`/epi-trends/${a.id}`} className={`rounded text-sm font-medium text-gray-900 hover:underline ${FOCUS}`}>{a.title}</Link>
                        : <p className="text-sm font-medium text-gray-900">{a.title}</p>}
                      <p className="text-xs text-gray-500">
                        {a.kind === 'rise' ? `Unusual rise · ${a.cases} case${a.cases === 1 ? '' : 's'} in the week of ${weekLabel(a.week)}` : `${a.area || data.subCounty || ''}${a.people ? ` · ${a.people} people` : ''} · ${a.status}`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${SEV_CLS[a.severity] || SEV_CLS.standard}`}>{SEV_LABEL[a.severity] || 'Normal'}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-gray-500">No open alerts near your facility.</p>}
          </section>
        </div>
      )}
    </AppShell>
  )
}
