import { useState, useEffect, useMemo } from 'react'
import { Bar, Line, Pie } from 'react-chartjs-2'
import { Search, Download, Table, BarChart3, LineChart, PieChart } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { CHART_FONT } from '../charts/chartSetup'
import { getDataExplorerRecords, exportCsv } from '../api/frappe'

const PAGE_SIZE = 6

const SEVERITY_COLORS = {
  critical: 'border-red-200 text-red-600',
  high: 'border-orange-200 text-orange-600',
  medium: 'border-yellow-200 text-yellow-600',
  low: 'border-emerald-200 text-emerald-600',
}
const severityColor = (s) => SEVERITY_COLORS[s] || 'border-gray-200 text-gray-600'

const CHART_COLORS = ['#DC2626', '#F2C94C', '#2F80ED', '#27AE60', '#8B5CF6', '#EC4899', '#F97316', '#0EA5E9']

const views = [
  { key: 'table', label: 'Table', icon: Table },
  { key: 'bar', label: 'Bar', icon: BarChart3 },
  { key: 'line', label: 'Line', icon: LineChart },
  { key: 'pie', label: 'Pie', icon: PieChart },
]
const quickSearchTags = ['AWD', 'Malaria', 'Measles', 'Respiratory', 'Fever']

const GRID_COLOR = '#F0F0F0'
const TICK_COLOR = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { titleFont: tickFont, bodyFont: tickFont } },
  scales: {
    x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont } },
    y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont }, beginAtZero: true },
  },
}
const pieOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom', labels: { font: tickFont, color: TICK_COLOR } } },
}

export default function DataExplorer() {
  const [records, setRecords] = useState([])
  const [search, setSearch] = useState('')
  const [view, setView] = useState('table')
  const [page, setPage] = useState(0)

  useEffect(() => {
    getDataExplorerRecords({ limit: 500 }).then(setRecords)
  }, [])

  function applyQuickSearch(tag) {
    setSearch((prev) => (prev === tag ? '' : tag))
    setPage(0)
  }

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return records
    return records.filter((r) => {
      const haystack = `${r.name} ${r.title} ${r.disease} ${r.region} ${r.severity} ${r.status}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [search, records])

  const lastPage = Math.max(0, Math.ceil(filteredRecords.length / PAGE_SIZE) - 1)
  const pagedRecords = filteredRecords.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const paginationLabel = (() => {
    if (!filteredRecords.length) return 'Showing 0 of 0'
    const start = page * PAGE_SIZE + 1
    const end = Math.min(start + PAGE_SIZE - 1, filteredRecords.length)
    return `Showing ${start} to ${end} of ${filteredRecords.length}`
  })()

  const diseaseCounts = useMemo(() => {
    const counts = {}
    for (const r of filteredRecords) counts[r.disease] = (counts[r.disease] || 0) + 1
    return counts
  }, [filteredRecords])

  const chartData = useMemo(() => {
    const labels = Object.keys(diseaseCounts)
    if (!labels.length) return null
    const data = Object.values(diseaseCounts)
    const colors = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
    if (view === 'pie') {
      return { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#fff', borderWidth: 2 }] }
    }
    if (view === 'line') {
      return { labels, datasets: [{ label: 'Records', data, borderColor: '#DC2626', backgroundColor: '#DC2626', tension: 0.35, pointRadius: 4, borderWidth: 2 }] }
    }
    return { labels, datasets: [{ label: 'Records', data, backgroundColor: '#DC2626', borderRadius: 4 }] }
  }, [diseaseCounts, view])

  function handleExportCsv() {
    exportCsv('data-explorer.csv', filteredRecords, [
      { label: 'Data ID', value: (r) => r.name },
      { label: 'Title', value: (r) => r.title },
      { label: 'Disease', value: (r) => r.disease },
      { label: 'Region', value: (r) => r.region },
      { label: 'Severity', value: (r) => r.severity },
      { label: 'Status', value: (r) => r.status },
      { label: 'Risk Score', value: (r) => r.riskScore },
    ])
  }

  function handleExportJson() {
    const blob = new Blob([JSON.stringify(filteredRecords, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'data-explorer.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Data Explorer</h2>
          <p className="text-sm text-gray-400">Search database by keywords, visualize trends, and set AI notification alerts</p>
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

      <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 mb-6">
        <div className="relative">
          <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search"
            className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-12 pr-28 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100"
            onKeyUp={(e) => { if (e.key === 'Enter') setPage(0) }}
          />
          <button
            onClick={() => setPage(0)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold"
          >
            Search
          </button>
        </div>
        <div className="flex items-center gap-3 flex-wrap mt-4">
          <span className="text-sm font-medium text-gray-500">Quick search:</span>
          {quickSearchTags.map((tag) => (
            <button
              key={tag}
              onClick={() => applyQuickSearch(tag)}
              className={['text-sm font-medium px-3 py-1 rounded-md transition-colors',
                search === tag ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'].join(' ')}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-center mb-6">
        <div className="bg-gray-100 rounded-full p-1 inline-flex gap-1 flex-wrap justify-center">
          {views.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={['flex items-center gap-2 px-6 py-2 rounded-full text-sm font-medium transition-colors',
                view === v.key ? 'bg-red-600 text-white' : 'bg-white text-gray-900'].join(' ')}
            >
              <v.icon className="w-4 h-4" /> {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
        <h3 className="text-base font-medium text-gray-900 mb-4">Query Results</h3>

        {view === 'table' ? (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs font-medium border-b border-gray-100">
                    <th className="py-3 pr-4 font-medium">Data ID</th>
                    <th className="py-3 pr-4 font-medium">Title</th>
                    <th className="py-3 pr-4 font-medium">Disease</th>
                    <th className="py-3 pr-4 font-medium">Region</th>
                    <th className="py-3 pr-4 font-medium">Severity</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 pr-4 font-medium">Risk Score</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRecords.map((r) => (
                    <tr key={r.name} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-4 pr-4 text-gray-900 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="py-4 pr-4 text-gray-900 whitespace-nowrap">{r.title}</td>
                      <td className="py-4 pr-4 text-gray-500 whitespace-nowrap">{r.disease}</td>
                      <td className="py-4 pr-4 text-gray-500 whitespace-nowrap">{r.region}</td>
                      <td className="py-4 pr-4">
                        <span className={['inline-block text-xs font-medium px-3 py-1 rounded-full border', severityColor(r.severity)].join(' ')}>{r.severity}</span>
                      </td>
                      <td className="py-4 pr-4">
                        <span className="inline-block text-xs font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-400">{r.status}</span>
                      </td>
                      <td className="py-4 pr-4 text-gray-900 font-medium whitespace-nowrap">{r.riskScore}%</td>
                    </tr>
                  ))}
                  {!pagedRecords.length && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-gray-400">No records match your search</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-5 mt-2 border-t border-gray-100 flex-wrap gap-3">
              <div className="flex gap-2">
                <button onClick={() => setPage(0)} disabled={page === 0} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">First</button>
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Previous</button>
              </div>
              <span className="text-sm text-gray-500">{paginationLabel}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.min(lastPage, page + 1))} disabled={page >= lastPage} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Next</button>
                <button onClick={() => setPage(lastPage)} disabled={page >= lastPage} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Last</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative w-full h-72 sm:h-96">
            {view === 'bar' && chartData && <Bar data={chartData} options={chartOptions} />}
            {view === 'line' && chartData && <Line data={chartData} options={chartOptions} />}
            {view === 'pie' && chartData && <Pie data={chartData} options={pieOptions} />}
            {!filteredRecords.length && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">No records match your search</div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
