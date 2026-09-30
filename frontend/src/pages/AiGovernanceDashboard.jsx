import { useState, useEffect, useMemo } from 'react'
import { Line, Radar } from 'react-chartjs-2'
import { Sparkles, LineChart, ThumbsDown, RefreshCw } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import ChartCard from '../components/analytics/ChartCard'
import StatCard from '../components/analytics/StatCard'
import { CHART_FONT } from '../charts/chartSetup'
import {
  getAiGovernanceStats,
  getModelRegistry,
  getConfidenceDistribution,
  getCompositePerformance,
} from '../api/frappe'

const ICONS = { Sparkles, LineChart, ThumbsDown, RefreshCw }
const iconFor = (name) => ICONS[name] || Sparkles

const GRID_COLOR = '#F0F0F0'
const TICK_COLOR = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }

const STATUS_COLORS = {
  Production: 'bg-green-50 text-green-600',
  Shadow: 'bg-amber-50 text-amber-600',
}

const DRIFT_COLORS = {
  Low: 'text-green-600',
  Moderate: 'text-amber-600',
  Monitoring: 'text-blue-600',
  High: 'text-red-600',
}

export default function AiGovernanceDashboard() {
  const [stats, setStats] = useState([])
  const [models, setModels] = useState([])
  const [confidence, setConfidence] = useState({ labels: [], data: [] })
  const [composite, setComposite] = useState({ labels: [], data: [] })

  useEffect(() => {
    (async () => {
      const [statsRes, modelsRes, confidenceRes, compositeRes] = await Promise.all([
        getAiGovernanceStats(),
        getModelRegistry(),
        getConfidenceDistribution(),
        getCompositePerformance(),
      ])
      setStats(statsRes)
      setModels(modelsRes)
      setConfidence(confidenceRes)
      setComposite(compositeRes)
    })()
  }, [])

  const confidenceData = useMemo(() => {
    if (!confidence.labels.length) return null
    return {
      labels: confidence.labels,
      datasets: [{
        label: 'Predictions',
        data: confidence.data,
        borderColor: '#F59E0B',
        backgroundColor: '#F59E0B',
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#F59E0B',
        pointBorderWidth: 2,
        borderWidth: 2,
      }],
    }
  }, [confidence])

  const confidenceOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        titleFont: tickFont,
        bodyFont: tickFont,
        callbacks: { label: (ctx) => `count : ${ctx.parsed.y}` },
      },
    },
    scales: {
      x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont } },
      y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont }, beginAtZero: true },
    },
  }

  const compositeData = useMemo(() => {
    if (!composite.labels.length) return null
    return {
      labels: composite.labels,
      datasets: [{
        label: 'Score',
        data: composite.data,
        backgroundColor: 'rgba(245, 158, 11, 0.4)',
        borderColor: '#F59E0B',
        borderWidth: 2,
        pointBackgroundColor: '#F59E0B',
      }],
    }
  }, [composite])

  const compositeOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        titleFont: tickFont,
        bodyFont: tickFont,
        callbacks: { label: (ctx) => `${ctx.label} : ${ctx.parsed.r}` },
      },
    },
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

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">AI Governance & Monitoring</h2>
        <p className="text-sm text-gray-400">Monitor model performance, explainability, feedback, and responsible AI use</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        {stats.map((s) => (
          <StatCard key={s.key} icon={iconFor(s.icon)} label={s.label} value={s.value} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
          <h3 className="text-sm sm:text-base font-medium text-gray-900 mb-5">Model Registry</h3>
          <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-900">
                  <th className="font-medium pb-3 pr-4">Model</th>
                  <th className="font-medium pb-3 pr-4">Version</th>
                  <th className="font-medium pb-3 pr-4">Status</th>
                  <th className="font-medium pb-3 pr-4">Accuracy</th>
                  <th className="font-medium pb-3 pr-4">Precision</th>
                  <th className="font-medium pb-3 pr-4">Recall</th>
                  <th className="font-medium pb-3 pr-4">Drift</th>
                  <th className="font-medium pb-3">Last retrained</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.name} className="border-b border-gray-50 last:border-0 text-gray-700">
                    <td className="py-4 pr-4 text-gray-900">{m.name}</td>
                    <td className="py-4 pr-4">{m.version}</td>
                    <td className="py-4 pr-4">
                      <span className={['inline-flex items-center rounded-full px-3 py-1 text-xs font-medium', STATUS_COLORS[m.status] || 'bg-gray-100 text-gray-600'].join(' ')}>
                        {m.status}
                      </span>
                    </td>
                    <td className="py-4 pr-4">{m.accuracy}%</td>
                    <td className="py-4 pr-4">{m.precision.toFixed(2)}</td>
                    <td className="py-4 pr-4">{m.recall.toFixed(2)}</td>
                    <td className={['py-4 pr-4 font-medium', DRIFT_COLORS[m.drift] || 'text-gray-500'].join(' ')}>{m.drift}</td>
                    <td className="py-4 text-gray-500">{m.lastRetrained}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <ChartCard title="Confidence Distribution" height="h-72 sm:h-96">
          {confidenceData && <Line data={confidenceData} options={confidenceOptions} />}
        </ChartCard>

        <ChartCard title="Composite Performance" height="h-80 sm:h-[28rem]">
          {compositeData && <Radar data={compositeData} options={compositeOptions} />}
        </ChartCard>
      </div>
    </AppShell>
  )
}
