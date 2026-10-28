import { useState, useEffect, useMemo } from 'react'
import { Line, Bar, Radar } from 'react-chartjs-2'
import { Clock, Sparkles, AlertTriangle, Map, Download, Info, Loader2 } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import ChartCard from '../components/analytics/ChartCard'
import StatCard from '../components/analytics/StatCard'
import { CHART_FONT } from '../charts/chartSetup'
import { getAnalytics, exportCsv } from '../api/frappe'

const ICONS = { Clock, Sparkles, AlertTriangle, Map }
const iconFor = (name) => ICONS[name] || Clock
const COLORS = ['#EE2435', '#2F80ED', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#14B8A6', '#6B7280']

const PERIODS = [{ value: 4, label: '4 weeks' }, { value: 13, label: '3 months' }, { value: 52, label: '12 months' }]
const SOURCES = [
  { value: 'all', label: 'All sources' },
  { value: 'community', label: 'Community (field + CBS)' },
  { value: 'facility', label: 'Facility (MOH 505)' },
]

const GRID_COLOR = '#F0F0F0'
const TICK_COLOR = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }
const baseScales = {
  x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont, autoSkip: true } },
  y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont, precision: 0 }, beginAtZero: true },
}
const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false }, tooltip: { titleFont: tickFont, bodyFont: tickFont } },
}

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(String(v).slice(0, 10))
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Legend({ items }) {
  return (
    <div className="flex items-center gap-4 flex-wrap justify-end">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: i.color }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: i.color }} />{i.label}
        </span>
      ))}
    </div>
  )
}

function Empty({ children }) {
  return <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-6">{children}</div>
}

function Note({ children }) {
  return <p className="text-xs text-gray-400 mt-3 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{children}</p>
}

export default function Analytics() {
  const [weeks, setWeeks] = useState(13)
  const [source, setSource] = useState('all')
  const [disease, setDisease] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getAnalytics({ weeks, source, disease })
      .then((d) => { if (!cancelled) { setData(d); setError('') } })
      .catch((e) => !cancelled && setError(e.message || 'Could not load analytics'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [weeks, source, disease])

  const trends = data?.trends
  const trendsData = useMemo(() => {
    if (!trends?.series?.length) return null
    return {
      labels: trends.labels,
      datasets: trends.series.map((s, i) => ({
        label: s.name, data: s.data, borderColor: COLORS[i % COLORS.length], backgroundColor: COLORS[i % COLORS.length],
        tension: 0.35, pointRadius: 3, pointBackgroundColor: '#fff', pointBorderColor: COLORS[i % COLORS.length], pointBorderWidth: 2, borderWidth: 2,
      })),
    }
  }, [trends])

  const exp = data?.expected
  const expectedData = useMemo(() => {
    if (!exp) return null
    return {
      labels: exp.labels,
      datasets: [
        { label: 'Outbreak level', data: exp.outbreakLevel, borderColor: '#EE2435', borderDash: [6, 6], pointRadius: 0, borderWidth: 2, tension: 0, fill: false },
        { label: 'Usual level', data: exp.expected, borderColor: '#9CA3AF', backgroundColor: 'rgba(156,163,175,0.15)', pointRadius: 0, borderWidth: 2, tension: 0.3, fill: true },
        { label: 'Observed', data: exp.observed, borderColor: '#2F80ED', backgroundColor: '#2F80ED', pointRadius: 4, borderWidth: 2, tension: 0.3 },
      ],
    }
  }, [exp])

  const cmp = data?.periodCompare
  const compareData = useMemo(() => {
    if (!cmp?.labels?.length) return null
    return {
      labels: cmp.labels,
      datasets: [
        { label: `Last 4 weeks (${cmp.currentLabel})`, data: cmp.current, backgroundColor: '#EE2435', borderRadius: 4 },
        { label: `4 weeks before (${cmp.previousLabel})`, data: cmp.previous, backgroundColor: '#9CA3AF', borderRadius: 4 },
      ],
    }
  }, [cmp])

  const rt = data?.responseTime
  const responseData = useMemo(() => {
    if (!rt) return null
    return {
      labels: rt.labels,
      datasets: [
        { label: 'Median hours to start verification', data: rt.medianHours, borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.15)', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2, spanGaps: true },
        { label: `Target (${rt.target} h)`, data: rt.labels.map(() => rt.target), borderColor: '#F15A67', borderDash: [6, 6], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
      ],
    }
  }, [rt])

  const ages = data?.ageGroups
  const agesData = useMemo(() => {
    if (!ages?.labels?.length) return null
    return {
      labels: ages.labels,
      datasets: [
        { label: 'Reports', data: ages.reports, backgroundColor: '#EE2435', borderRadius: 4 },
        { label: 'People affected', data: ages.people, backgroundColor: '#F59E0B', borderRadius: 4 },
      ],
    }
  }, [ages])

  const hours = data?.hourPattern
  const hoursData = useMemo(() => {
    if (!hours || !hours.data.some((n) => n > 0)) return null
    return { labels: hours.labels, datasets: [{ label: 'Field reports', data: hours.data, backgroundColor: '#8B5CF6', borderRadius: 4 }] }
  }, [hours])

  const comp = data?.completeness
  const completenessData = useMemo(() => {
    if (!comp?.facilities?.length) return null
    return {
      labels: comp.facilities.map((f) => `${f.facility} (${f.subCounty})`),
      datasets: [{
        label: '% of weeks reported', data: comp.facilities.map((f) => f.pct),
        backgroundColor: comp.facilities.map((f) => (f.pct >= 80 ? '#10B981' : f.pct >= 50 ? '#F59E0B' : '#EE2435')), borderRadius: 4, barThickness: 22,
      }],
    }
  }, [comp])
  const horizontalOptions = {
    ...baseOptions, indexAxis: 'y',
    scales: {
      x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont, callback: (v) => `${v}%` }, beginAtZero: true, max: 100 },
      y: { grid: { display: false }, ticks: { color: TICK_COLOR, font: tickFont } },
    },
  }

  const ind = data?.indicators
  const indicatorsData = useMemo(() => {
    const items = (ind?.items || []).filter((i) => i.value != null)
    if (items.length < 3) return null
    return {
      labels: items.map((i) => i.label),
      datasets: [{ label: '%', data: items.map((i) => i.value), backgroundColor: 'rgba(220,38,38,0.25)', borderColor: '#EE2435', borderWidth: 2, pointBackgroundColor: '#EE2435' }],
    }
  }, [ind])
  const radarOptions = {
    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
    scales: { r: { min: 0, max: 100, grid: { color: GRID_COLOR }, angleLines: { color: GRID_COLOR },
      ticks: { color: TICK_COLOR, font: tickFont, backdropColor: 'transparent', stepSize: 25 }, pointLabels: { color: TICK_COLOR, font: tickFont } } },
  }

  function handleExportCsv() {
    if (!data) return
    const rows = [
      ...data.summary.map((s) => ({ section: 'Summary', item: s.label, value: s.value, detail: `${s.changePct}% vs previous period` })),
      ...(data.indicators.items || []).map((i) => ({ section: 'Performance indicators', item: i.label, value: i.value == null ? '—' : `${i.value}%`, detail: i.detail })),
      ...(data.completeness.facilities || []).map((f) => ({ section: 'MOH 505 completeness', item: f.facility, value: `${f.pct}%`, detail: `${f.reported} of ${f.weeks} weeks` })),
      ...(data.trends.series || []).map((s) => ({ section: 'Disease trends', item: s.name, value: s.total, detail: `${data.trends.labels[0]}–${data.trends.labels.at(-1)}` })),
      ...(cmp?.labels || []).map((l, i) => ({ section: 'Last 4 weeks vs 4 weeks before', item: l, value: cmp.current[i], detail: `previous ${cmp.previous[i]} (${cmp.changePct[i]}%)` })),
    ]
    exportCsv(`analytics-${data.from}-to-${data.to}.csv`, rows, [
      { label: 'Section', value: (r) => r.section }, { label: 'Item', value: (r) => r.item },
      { label: 'Value', value: (r) => r.value }, { label: 'Detail', value: (r) => r.detail },
    ])
  }

  function handleExportJson() {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `analytics-${data.from}-to-${data.to}.json`
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
  }

  const select = 'border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white'

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-brand-navy">Analytics Dashboard</h2>
          <p className="text-sm text-gray-400">
            Disease trends and surveillance performance{data ? ` · ${fmtDate(data.from)} – ${fmtDate(data.to)}` : ''}{data?.region ? ` · ${data.region}` : ' · Dadaab and Kalobeyei'}
          </p>
        </div>
        <div className="flex gap-3 flex-wrap items-center">
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-1 flex gap-1">
            {PERIODS.map((p) => (
              <button key={p.value} onClick={() => setWeeks(p.value)}
                className={['px-3 py-1.5 rounded-md text-sm font-medium', weeks === p.value ? 'bg-red-600 text-white' : 'text-gray-900'].join(' ')}>{p.label}</button>
            ))}
          </div>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={select}>
            {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button onClick={handleExportCsv} disabled={!data} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50 disabled:opacity-50">
            <Download className="w-4 h-4" /> CSV
          </button>
          <button onClick={handleExportJson} disabled={!data} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50 disabled:opacity-50">
            <Download className="w-4 h-4" /> JSON
          </button>
        </div>
      </div>

      {error && <p className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">{error}</p>}
      {loading && !data && <p className="text-sm text-gray-400 flex items-center gap-2 mb-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading analytics…</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        {(data?.summary || []).map((s) => (
          <StatCard key={s.key} icon={iconFor(s.icon)} label={s.label} value={s.value} changePct={s.changePct} trend={s.trend} sentiment={s.sentiment} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5">
        <ChartCard title="Disease Trends (reports / cases per week, top 5)" height="h-72 sm:h-96"
          legend={<Legend items={(trends?.series || []).map((s, i) => ({ label: s.name, color: COLORS[i % COLORS.length] }))} />}>
          {trendsData ? <Line data={trendsData} options={{ ...baseOptions, scales: baseScales }} /> : <Empty>{loading ? 'Loading…' : 'No reports or cases in this period.'}</Empty>}
        </ChartCard>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
            <div>
              <h3 className="text-sm sm:text-base font-medium text-gray-900">Observed vs Usual Level{exp ? `: ${exp.diseaseName}` : ''}</h3>
              <p className="text-xs text-gray-400 mt-0.5">Weekly count against the average of the previous 8 weeks; above the dashed line is outbreak level ({exp?.multiplier ?? 2.5}× usual, at least {exp?.threshold ?? 1}).</p>
            </div>
            <div className="flex items-center gap-3">
              <select value={disease} onChange={(e) => setDisease(e.target.value)} className={select}>
                <option value="">Most reported disease</option>
                {(data?.diseases || []).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <Legend items={[{ label: 'Observed', color: '#2F80ED' }, { label: 'Usual level', color: '#9CA3AF' }, { label: 'Outbreak level', color: '#EE2435' }]} />
          <div className="relative w-full h-72 sm:h-96 mt-3">
            {expectedData ? <Line data={expectedData} options={{ ...baseOptions, scales: baseScales }} /> : <Empty>{loading ? 'Loading…' : 'No data for this disease in this period.'}</Empty>}
          </div>
        </div>

        <ChartCard title="Last 4 Weeks vs the 4 Weeks Before" height="h-72 sm:h-96"
          legend={<Legend items={[{ label: 'Last 4 weeks', color: '#EE2435' }, { label: '4 weeks before', color: '#9CA3AF' }]} />}>
          {compareData ? <Bar data={compareData} options={{ ...baseOptions, scales: baseScales }} /> : <Empty>{loading ? 'Loading…' : 'No reports or cases in the last 8 weeks.'}</Empty>}
        </ChartCard>

        <ChartCard title="Time to Start Verification (median hours per week)" height="h-72 sm:h-96"
          legend={<Legend items={[{ label: 'Median hours', color: '#10B981' }, { label: `Target (${rt?.target ?? 24} h)`, color: '#F15A67' }]} />}>
          {responseData && rt.medianHours.some((h) => h != null) ? <Line data={responseData} options={{ ...baseOptions, scales: baseScales }} />
            : <Empty>{loading ? 'Loading…' : 'No events have started verification in this period.'}</Empty>}
        </ChartCard>

        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
            <div>
              <h3 className="text-sm sm:text-base font-medium text-gray-900">Surveillance Performance Indicators</h3>
              <p className="text-xs text-gray-400 mt-0.5">For events reported in this period{ind ? ` (${ind.events} events)` : ''}. Higher is better.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
            <div className="relative w-full h-80">
              {indicatorsData ? <Radar data={indicatorsData} options={radarOptions} /> : <Empty>{loading ? 'Loading…' : 'Not enough events in this period to score.'}</Empty>}
            </div>
            <div className="space-y-3">
              {(ind?.items || []).map((i) => (
                <div key={i.key}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{i.label}</span>
                    <span className="font-semibold text-gray-900">{i.value == null ? '—' : `${i.value}%`}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full mt-1 overflow-hidden">
                    <div className={['h-full rounded-full', i.value >= 80 ? 'bg-emerald-500' : i.value >= 50 ? 'bg-amber-400' : 'bg-red-500'].join(' ')} style={{ width: `${i.value || 0}%` }} />
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{i.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <ChartCard title="MOH 505 Reporting Completeness by Facility" height="h-72 sm:h-80">
          {completenessData ? <Bar data={completenessData} options={horizontalOptions} />
            : <Empty>{loading ? 'Loading…' : 'No MOH 505 reporting-rate files loaded for your area yet.'}</Empty>}
        </ChartCard>
        {comp?.upTo && <Note>{comp.overall != null ? `Overall ${comp.overall}% of facility weeks reported. ` : ''}Latest week loaded: {fmtDate(comp.upTo)}. Green ≥ 80%, amber 50–79%, red below 50%.</Note>}
        <ChartCard title="Field Reports by Age Group" height="h-72 sm:h-96"
          legend={<Legend items={[{ label: 'Reports', color: '#EE2435' }, { label: 'People affected', color: '#F59E0B' }]} />}>
          {agesData ? <Bar data={agesData} options={{ ...baseOptions, scales: baseScales }} /> : <Empty>{loading ? 'Loading…' : 'No field reports in this period.'}</Empty>}
        </ChartCard>
        {/* <Note>Sex is not recorded on reports, to keep personal data to a minimum.</Note> */}

        <ChartCard title="Field Reports by Hour of Day" height="h-72 sm:h-96">
          {hoursData ? <Bar data={hoursData} options={{ ...baseOptions, scales: baseScales }} /> : <Empty>{loading ? 'Loading…' : 'No field reports in this period.'}</Empty>}
        </ChartCard>
      </div>
    </AppShell>
  )
}
