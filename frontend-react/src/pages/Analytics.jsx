import { useState, useEffect, useMemo } from 'react'
import { Line, Bar, Doughnut, Radar } from 'react-chartjs-2'
import { Clock, Sparkles, AlertTriangle, Map, Download } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import ChartCard from '../components/analytics/ChartCard'
import StatCard from '../components/analytics/StatCard'
import { CHART_FONT } from '../charts/chartSetup'
import {
  getAnalyticsSummary,
  getDiseaseTrends,
  getReportingChannelsDistribution,
  getFacilityResponseTime,
  getAiPredictiveForecast,
  getMonthOverMonthComparison,
  getResponseTimeImprovement,
  getAgeGenderDistribution,
  getAlertReportingPattern,
  getResponseEffectivenessScore,
  exportCsv,
} from '../api/frappe'

const ICONS = { Clock, Sparkles, AlertTriangle, Map }
const iconFor = (name) => ICONS[name] || Clock

const GRID_COLOR = '#F0F0F0'
const TICK_COLOR = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }

const baseScales = {
  x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont } },
  y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont }, beginAtZero: true },
}

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { titleFont: tickFont, bodyFont: tickFont } },
}

export default function Analytics() {
  const [summary, setSummary] = useState([])
  const [diseaseTrends, setDiseaseTrends] = useState({ labels: [], series: [] })
  const [reportingChannels, setReportingChannels] = useState({ labels: [], colors: [], data: [] })
  const [facilityResponseTime, setFacilityResponseTime] = useState({ labels: [], data: [] })
  const [aiForecast, setAiForecast] = useState(null)
  const [monthOverMonth, setMonthOverMonth] = useState(null)
  const [responseTimeImprovement, setResponseTimeImprovement] = useState(null)
  const [ageGender, setAgeGender] = useState(null)
  const [alertPattern, setAlertPattern] = useState(null)
  const [effectiveness, setEffectiveness] = useState(null)

  useEffect(() => {
    (async () => {
      const [
        summaryRes, diseaseTrendsRes, reportingChannelsRes, facilityResponseTimeRes,
        aiForecastRes, monthOverMonthRes, responseTimeImprovementRes, ageGenderRes,
        alertPatternRes, effectivenessRes,
      ] = await Promise.all([
        getAnalyticsSummary(), getDiseaseTrends(), getReportingChannelsDistribution(), getFacilityResponseTime(),
        getAiPredictiveForecast(), getMonthOverMonthComparison(), getResponseTimeImprovement(), getAgeGenderDistribution(),
        getAlertReportingPattern(), getResponseEffectivenessScore(),
      ])
      setSummary(summaryRes)
      setDiseaseTrends(diseaseTrendsRes)
      setReportingChannels(reportingChannelsRes)
      setFacilityResponseTime(facilityResponseTimeRes)
      setAiForecast(aiForecastRes)
      setMonthOverMonth(monthOverMonthRes)
      setResponseTimeImprovement(responseTimeImprovementRes)
      setAgeGender(ageGenderRes)
      setAlertPattern(alertPatternRes)
      setEffectiveness(effectivenessRes)
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
        backgroundColor: s.color,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: '#fff',
        pointBorderColor: s.color,
        pointBorderWidth: 2,
        borderWidth: 2,
      })),
    }
  }, [diseaseTrends])
  const lineOptions = { ...baseOptions, scales: baseScales }

  const reportingChannelsData = useMemo(() => {
    if (!reportingChannels.labels.length) return null
    return {
      labels: reportingChannels.labels,
      datasets: [{ data: reportingChannels.data, backgroundColor: reportingChannels.colors, borderColor: '#fff', borderWidth: 2 }],
    }
  }, [reportingChannels])
  const doughnutOptions = { ...baseOptions, cutout: '55%' }

  const facilityResponseTimeData = useMemo(() => {
    if (!facilityResponseTime.labels.length) return null
    return {
      labels: facilityResponseTime.labels,
      datasets: [{ label: 'Avg Response Time (s)', data: facilityResponseTime.data, backgroundColor: '#D62728', borderRadius: 4, barThickness: 28 }],
    }
  }, [facilityResponseTime])
  const horizontalBarOptions = {
    ...baseOptions,
    indexAxis: 'y',
    scales: {
      x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont }, beginAtZero: true },
      y: { grid: { display: false }, ticks: { color: TICK_COLOR, font: tickFont } },
    },
  }

  const aiForecastData = useMemo(() => {
    const f = aiForecast
    if (!f) return null
    return {
      labels: f.labels,
      datasets: [
        { label: 'Upper bound', data: f.upperBand, borderWidth: 0, backgroundColor: 'rgba(220,38,38,0.12)', fill: '+1', pointRadius: 0, tension: 0.35, order: 3 },
        { label: 'Lower bound', data: f.lowerBand, borderWidth: 0, backgroundColor: 'rgba(220,38,38,0.12)', fill: false, pointRadius: 0, tension: 0.35, order: 3 },
        { label: 'Actual', data: f.actual, borderColor: '#10B981', backgroundColor: '#10B981', tension: 0.35, pointRadius: 4, borderWidth: 2, order: 1 },
        { label: 'Predicted', data: f.predicted, borderColor: '#DC2626', backgroundColor: '#DC2626', borderDash: [6, 6], tension: 0.35, pointRadius: 4, borderWidth: 2, order: 2 },
      ],
    }
  }, [aiForecast])
  const forecastOptions = {
    ...baseOptions,
    scales: baseScales,
    plugins: { ...baseOptions.plugins, legend: { display: false, labels: { filter: (item) => !item.text.includes('bound') } } },
  }

  const monthOverMonthData = useMemo(() => {
    const m = monthOverMonth
    if (!m) return null
    return {
      labels: m.labels,
      datasets: [
        { type: 'bar', label: 'Current Period', data: m.current, backgroundColor: '#DC2626', borderRadius: 4 },
        { type: 'bar', label: 'Previous Period', data: m.previous, backgroundColor: '#9CA3AF', borderRadius: 4 },
        { type: 'line', label: 'Target', data: m.labels.map(() => m.target), borderColor: '#3B82F6', borderDash: [6, 6], pointRadius: 0, borderWidth: 2, tension: 0 },
      ],
    }
  }, [monthOverMonth])
  const monthOverMonthOptions = { ...baseOptions, scales: baseScales }

  const responseTimeImprovementData = useMemo(() => {
    const r = responseTimeImprovement
    if (!r) return null
    return {
      labels: r.labels,
      datasets: [
        { label: 'Avg Response Time (hrs)', data: r.avgResponseTime, borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.15)', fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2 },
        { label: 'Target (2.5 hrs)', data: r.labels.map(() => r.target), borderColor: '#EF4444', borderDash: [6, 6], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
      ],
    }
  }, [responseTimeImprovement])
  const responseTimeOptions = { ...baseOptions, scales: baseScales }

  const ageGenderData = useMemo(() => {
    const a = ageGender
    if (!a) return null
    return {
      labels: a.labels,
      datasets: [
        { label: 'Female', data: a.female, backgroundColor: '#EC4899', borderRadius: 4 },
        { label: 'Male', data: a.male, backgroundColor: '#3B82F6', borderRadius: 4 },
      ],
    }
  }, [ageGender])
  const groupedBarOptions = { ...baseOptions, scales: baseScales }

  const alertPatternData = useMemo(() => {
    const a = alertPattern
    if (!a) return null
    return { labels: a.labels, datasets: [{ label: 'Alerts', data: a.data, backgroundColor: '#8B5CF6', borderRadius: 4 }] }
  }, [alertPattern])
  const singleBarOptions = { ...baseOptions, scales: baseScales }

  const effectivenessData = useMemo(() => {
    const e = effectiveness
    if (!e) return null
    return {
      labels: e.labels,
      datasets: [{ label: 'Score', data: e.data, backgroundColor: 'rgba(220,38,38,0.35)', borderColor: '#DC2626', borderWidth: 2, pointBackgroundColor: '#DC2626' }],
    }
  }, [effectiveness])
  const radarOptions = {
    ...baseOptions,
    scales: {
      r: {
        min: 0,
        max: 100,
        grid: { color: GRID_COLOR },
        angleLines: { color: GRID_COLOR },
        ticks: { color: TICK_COLOR, font: tickFont, backdropColor: 'transparent' },
        pointLabels: { color: TICK_COLOR, font: tickFont },
      },
    },
  }

  function handleExportCsv() {
    exportCsv('analytics-summary.csv', summary, [
      { label: 'Metric', value: (r) => r.label },
      { label: 'Value', value: (r) => r.value },
      { label: 'Change %', value: (r) => r.changePct },
      { label: 'Trend', value: (r) => r.trend },
    ])
  }

  function handleExportJson() {
    const payload = {
      summary,
      diseaseTrends,
      reportingChannels,
      facilityResponseTime,
      aiForecast,
      monthOverMonth,
      responseTimeImprovement,
      ageGender,
      alertPattern,
      effectiveness,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'analytics-summary.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Analytics Dashboard</h2>
          <p className="text-sm text-gray-400">Epidemiological trends, AI insights, and performance metrics</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExportCsv} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50">
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button onClick={handleExportJson} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50">
            <Download className="w-4 h-4" /> Export JSON
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        {summary.map((s) => (
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
        <ChartCard
          title="Disease Trends (6-Week View)"
          height="h-72 sm:h-96"
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
          {diseaseTrendsData && <Line data={diseaseTrendsData} options={lineOptions} />}
        </ChartCard>

        <ChartCard
          title="Reporting Channels Distribution"
          height="h-72 sm:h-80"
          legend={
            <div className="flex items-center gap-4 flex-wrap justify-end">
              {reportingChannels.labels.map((label, i) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: reportingChannels.colors[i] }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: reportingChannels.colors[i] }} />{label} {reportingChannels.data[i]}%
                </span>
              ))}
            </div>
          }
        >
          {reportingChannelsData && <Doughnut data={reportingChannelsData} options={doughnutOptions} />}
        </ChartCard>

        <ChartCard title="Facility Response Time (hours)" height="h-72 sm:h-80">
          {facilityResponseTimeData && <Bar data={facilityResponseTimeData} options={horizontalBarOptions} />}
        </ChartCard>

        <ChartCard
          title="AI Predictive Forecast"
          height="h-80 sm:h-96"
          legend={
            <div className="flex items-center gap-4 flex-wrap justify-end">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Actual
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600" />Predicted
              </span>
            </div>
          }
        >
          {aiForecastData && <Line data={aiForecastData} options={forecastOptions} />}
        </ChartCard>

        <ChartCard
          title="Month-over-Month Comparison"
          height="h-72 sm:h-96"
          legend={
            <div className="flex items-center gap-4 flex-wrap justify-end">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600" />Current Period
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />Previous Period
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-500">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />Target
              </span>
            </div>
          }
        >
          {monthOverMonthData && <Bar data={monthOverMonthData} options={monthOverMonthOptions} />}
        </ChartCard>

        <ChartCard
          title="Response Time Improvement"
          height="h-72 sm:h-96"
          legend={
            <div className="flex items-center gap-4 flex-wrap justify-end">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Avg Response Time (hrs)
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />Target (2.5 hrs)
              </span>
            </div>
          }
        >
          {responseTimeImprovementData && <Line data={responseTimeImprovementData} options={responseTimeOptions} />}
        </ChartCard>

        <ChartCard
          title="Age & Gender Distribution"
          height="h-72 sm:h-96"
          legend={
            <div className="flex items-center gap-4 flex-wrap justify-end">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-pink-500">
                <span className="w-2.5 h-2.5 rounded-full bg-pink-500" />Female
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-500">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />Male
              </span>
            </div>
          }
        >
          {ageGenderData && <Bar data={ageGenderData} options={groupedBarOptions} />}
        </ChartCard>

        <ChartCard title="Alert Reporting Pattern by Hour" height="h-72 sm:h-96">
          {alertPatternData && <Bar data={alertPatternData} options={singleBarOptions} />}
        </ChartCard>

        <ChartCard title="Response Effectiveness Score" height="h-80 sm:h-[28rem]">
          {effectivenessData && <Radar data={effectivenessData} options={radarOptions} />}
        </ChartCard>
      </div>
    </AppShell>
  )
}
