import { useState, useEffect, useMemo, useCallback } from 'react'
import { Bar, Line, Pie } from 'react-chartjs-2'
import { Search, Download, Table, BarChart3, LineChart, PieChart, X, Filter, Loader2, Info } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { CHART_FONT } from '../charts/chartSetup'
import { getDataExplorerOptions, queryDataExplorer, exportDataExplorer, exportCsv } from '../api/frappe'

const CHART_COLORS = ['#DC2626', '#2F80ED', '#F2C94C', '#27AE60', '#8B5CF6', '#EC4899', '#F97316', '#0EA5E9']
const PAGE_SIZE = 25

const VIEWS = [
  { key: 'table', label: 'Table', icon: Table },
  { key: 'bar', label: 'Bar', icon: BarChart3 },
  { key: 'line', label: 'Line', icon: LineChart },
  { key: 'pie', label: 'Pie', icon: PieChart },
]

const DATASETS = [
  { key: 'counts', label: 'Weekly counts (all sources)', hint: 'Field reports, CBS and MOH 505, counted per disease, sub-county and week.' },
  { key: 'reports', label: 'Individual field reports', hint: 'One row per report from web, mobile and WhatsApp. No reporter names or phone numbers.' },
]

const GROUPS = {
  counts: [
    { value: 'disease', label: 'Disease' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' },
    { value: 'sub_county', label: 'Sub-county' }, { value: 'county', label: 'County' }, { value: 'source', label: 'Data source' },
  ],
  reports: [
    { value: 'disease', label: 'Disease' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' },
    { value: 'sub_county', label: 'Sub-county' }, { value: 'county', label: 'County' }, { value: 'status', label: 'Status' },
    { value: 'channel', label: 'Channel' },
  ],
}

const METRICS = {
  counts: [{ value: 'count', label: 'Reports / cases' }, { value: 'affected', label: 'People affected' }, { value: 'deaths', label: 'Deaths' }],
  reports: [{ value: 'count', label: 'Reports' }, { value: 'affected', label: 'People affected' }, { value: 'deaths', label: 'Deaths' }],
}

const QUICK_TAGS = ['Cholera', 'Malaria', 'Measles', 'Malnutrition', 'Rabies']

const GRID_COLOR = '#F0F0F0'
const TICK_COLOR = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }

const emptyFilters = () => ({ search: '', sources: [], diseases: [], sub_counties: [], county: '', statuses: [], channels: [],
  date_from: '', date_to: '', pilot_only: 1 })

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(String(v).slice(0, 10))
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-red-100">
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    </label>
  )
}

export default function DataExplorer() {
  const [options, setOptions] = useState(null)
  const [dataset, setDataset] = useState('counts')
  const [view, setView] = useState('table')
  const [draft, setDraft] = useState(emptyFilters())
  const [filters, setFilters] = useState(emptyFilters())
  const [groupBy, setGroupBy] = useState('disease')
  const [splitBy, setSplitBy] = useState('')
  const [metric, setMetric] = useState('count')
  const [sort, setSort] = useState({ key: 'week', order: 'desc' })
  const [page, setPage] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    getDataExplorerOptions().then(setOptions).catch((e) => setError(e.message || 'Could not load the filters'))
  }, [])

  const params = useMemo(() => ({
    dataset, ...filters, group_by: groupBy, split_by: splitBy, metric,
    sort: sort.key, order: sort.order, page, page_size: PAGE_SIZE,
  }), [dataset, filters, groupBy, splitBy, metric, sort, page])

  const run = useCallback(() => {
    setLoading(true)
    queryDataExplorer(params)
      .then((r) => { setResult(r); setError('') })
      .catch((e) => setError(e.message || 'Query failed'))
      .finally(() => setLoading(false))
  }, [params])
  useEffect(run, [run])

  function apply(next = draft) {
    setFilters(next)
    setPage(0)
  }
  function reset() {
    const f = emptyFilters()
    setDraft(f)
    apply(f)
  }
  function quickTag(tag) {
    const next = { ...draft, search: draft.search === tag ? '' : tag }
    setDraft(next)
    apply(next)
  }
  function switchDataset(key) {
    setDataset(key)
    setPage(0)
    if (!GROUPS[key].some((g) => g.value === groupBy)) setGroupBy('disease')
    if (splitBy && !GROUPS[key].some((g) => g.value === splitBy)) setSplitBy('')
    setSort({ key: 'week', order: 'desc' })
  }
  function toggleSort(key) {
    setSort((s) => ({ key, order: s.key === key && s.order === 'desc' ? 'asc' : 'desc' }))
    setPage(0)
  }
  function toggleIn(list, value) {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
  }

  async function doExport(kind) {
    setExporting(kind)
    try {
      const { rows, truncated } = await exportDataExplorer({ ...params, page: 0 })
      const stamp = new Date().toISOString().slice(0, 10)
      if (kind === 'json') {
        const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `data-explorer-${dataset}-${stamp}.json`
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      } else {
        const cols = dataset === 'reports'
          ? [['Report ID', 'id'], ['Date', 'date'], ['Disease', 'diseaseName'], ['Sub-county', 'subCounty'], ['County', 'county'],
            ['Location', 'location'], ['Channel', 'channel'], ['Status', 'status'], ['People affected', 'affected'], ['Deaths', 'deaths']]
          : [['Week starting', 'week'], ['Epi week', 'epiWeek'], ['Source', 'sourceLabel'], ['Disease', 'diseaseName'],
            ['Sub-county', 'subCounty'], ['County', 'county'], ['Reports / cases', 'count'], ['People affected', 'affected'], ['Deaths', 'deaths']]
        exportCsv(`data-explorer-${dataset}-${stamp}.csv`, rows, cols.map(([label, key]) => ({ label, value: (r) => r[key] })))
      }
      if (truncated) setError('Export limited to the first 20,000 rows. Narrow the filters to export the rest.')
    } catch (e) {
      setError(e.message || 'Export failed')
    } finally {
      setExporting('')
    }
  }

  const chart = result?.chart
  const chartData = useMemo(() => {
    if (!chart?.labels?.length) return null
    if (view === 'pie') {
      const total = chart.series[0]
      return { labels: chart.labels, datasets: [{ data: total.data, backgroundColor: chart.labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]), borderColor: '#fff', borderWidth: 2 }] }
    }
    return {
      labels: chart.labels,
      datasets: chart.series.map((s, i) => {
        const color = chart.series.length > 1 ? CHART_COLORS[i % CHART_COLORS.length] : '#DC2626'
        return view === 'line'
          ? { label: s.name, data: s.data, borderColor: color, backgroundColor: color, tension: 0.3, pointRadius: 3, borderWidth: 2 }
          : { label: s.name, data: s.data, backgroundColor: color, borderRadius: 4, stack: 'stack' }
      }),
    }
  }, [chart, view])

  const multi = (chart?.series?.length || 0) > 1
  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: multi, position: 'bottom', labels: { font: tickFont, color: TICK_COLOR } }, tooltip: { titleFont: tickFont, bodyFont: tickFont } },
    scales: {
      x: { stacked: view === 'bar' && multi, grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont, autoSkip: true, maxRotation: 45 } },
      y: { stacked: view === 'bar' && multi, grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont, precision: 0 }, beginAtZero: true },
    },
  }
  const pieOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: tickFont, color: TICK_COLOR } } } }

  const summary = result?.summary
  const datasetInfo = DATASETS.find((d) => d.key === dataset)
  const activeCount = ['sources', 'diseases', 'sub_counties', 'statuses', 'channels'].reduce((n, k) => n + (filters[k]?.length ? 1 : 0), 0)
    + (filters.county ? 1 : 0) + (filters.date_from || filters.date_to ? 1 : 0) + (filters.pilot_only ? 0 : 1)

  const Th = ({ k, children, right }) => (
    <th className={['py-3 pr-4 font-medium whitespace-nowrap', right ? 'text-right' : ''].join(' ')}>
      {k ? <button onClick={() => toggleSort(k)} className="hover:text-gray-800">{children}{sort.key === k ? (sort.order === 'desc' ? ' ↓' : ' ↑') : ''}</button> : children}
    </th>
  )

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Data Explorer</h2>
          <p className="text-sm text-gray-400">Search and filter surveillance data from field reports, CBS and MOH 505, and see it as a table or chart</p>
        </div>
        {options?.canExport && (
          <div className="flex gap-3">
            <button onClick={() => doExport('csv')} disabled={!!exporting} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50 disabled:opacity-60">
              {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export CSV
            </button>
            <button onClick={() => doExport('json')} disabled={!!exporting} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50 disabled:opacity-60">
              {exporting === 'json' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export JSON
            </button>
          </div>
        )}
      </div>

      {/* dataset */}
      <div className="flex w-full gap-1 bg-white border border-gray-100 rounded-2xl p-1.5 mb-2">
        {DATASETS.map((d) => (
          <button key={d.key} onClick={() => switchDataset(d.key)}
            className={['flex-1 px-4 py-2 rounded-full text-sm font-medium transition-colors', dataset === d.key ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50'].join(' ')}>
            {d.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400 mb-6 px-2">{datasetInfo.hint}{options?.limitedToRegion ? ' Showing your region only.' : ''}</p>

      {/* search + filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 mb-6">
        <form onSubmit={(e) => { e.preventDefault(); apply() }} className="relative">
          <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} type="text"
            placeholder={dataset === 'reports' ? 'Search disease, sub-county, location or report ID' : 'Search disease, sub-county or county'}
            className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-12 pr-28 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" />
          <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold">Search</button>
        </form>

        <div className="flex items-center gap-3 flex-wrap mt-4">
          <span className="text-sm font-medium text-gray-500">Quick search:</span>
          {QUICK_TAGS.map((tag) => (
            <button key={tag} onClick={() => quickTag(tag)}
              className={['text-sm font-medium px-3 py-1 rounded-md transition-colors', filters.search === tag ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'].join(' ')}>
              {tag}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowFilters((v) => !v)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50">
              <Filter className="w-4 h-4" /> Filters{activeCount ? ` (${activeCount})` : ''}
            </button>
            {(activeCount > 0 || filters.search) && <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"><X className="w-4 h-4" /> Clear</button>}
          </div>
        </div>

        {showFilters && options && (
          <div className="mt-5 pt-5 border-t border-gray-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Select label="Disease" value={draft.diseases[0] || ''} onChange={(v) => setDraft({ ...draft, diseases: v ? [v] : [] })} options={options.diseases} placeholder="All diseases" />
              <Select label="Sub-county" value={draft.sub_counties[0] || ''} onChange={(v) => setDraft({ ...draft, sub_counties: v ? [v] : [] })} options={options.subCounties} placeholder="All sub-counties" />
              <Select label="County" value={draft.county} onChange={(v) => setDraft({ ...draft, county: v })} options={options.counties} placeholder="All counties" />
              {dataset === 'reports' && (
                <Select label="Status" value={draft.statuses[0] || ''} onChange={(v) => setDraft({ ...draft, statuses: v ? [v] : [] })} options={options.statuses} placeholder="All statuses" />
              )}
              <label className="block">
                <span className="block text-xs font-medium text-gray-500 mb-1">From</span>
                <input type="date" value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-500 mb-1">To</span>
                <input type="date" value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
              {dataset === 'reports' && (
                <Select label="Channel" value={draft.channels[0] || ''} onChange={(v) => setDraft({ ...draft, channels: v ? [v] : [] })} options={options.channels} placeholder="All channels" />
              )}
            </div>

            {dataset === 'counts' && (
              <div className="mt-4">
                <span className="block text-xs font-medium text-gray-500 mb-2">Data sources</span>
                <div className="flex flex-wrap gap-2">
                  {options.sources.map((s) => {
                    const on = !draft.sources.length || draft.sources.includes(s.value)
                    return (
                      <button key={s.value} onClick={() => setDraft({ ...draft, sources: toggleIn(draft.sources.length ? draft.sources : options.sources.map((x) => x.value), s.value) })}
                        className={['text-sm px-3 py-1.5 rounded-full border transition-colors', on ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 text-gray-500'].join(' ')}>
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={!!draft.pilot_only} onChange={(e) => setDraft({ ...draft, pilot_only: e.target.checked ? 1 : 0 })} className="w-4 h-4 accent-red-600" />
                Pilot sites only (Dadaab and Kalobeyei)
              </label>
              <button onClick={() => apply()} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2 text-sm font-semibold">Apply filters</button>
            </div>
          </div>
        )}
      </div>

      {/* summary */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {(dataset === 'reports' ? [
            { label: 'Reports', value: summary.rows },
            { label: 'People affected', value: summary.affected },
            { label: 'Deaths', value: summary.deaths },
          ] : [
            { label: 'Rows (source × disease × place × week)', value: summary.rows },
            { label: 'Reports / cases', value: summary.count },
            { label: 'People affected', value: summary.affected },
            { label: 'Deaths', value: summary.deaths },
          ]).map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="text-xs text-gray-400">{c.label}</div>
              <div className="text-2xl font-bold text-gray-900">{Number(c.value || 0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* view switch */}
      <div className="flex justify-center mb-6">
        <div className="bg-gray-100 rounded-full p-1 inline-flex gap-1 flex-wrap justify-center">
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={['flex items-center gap-2 px-6 py-2 rounded-full text-sm font-medium transition-colors', view === v.key ? 'bg-red-600 text-white' : 'bg-white text-gray-900'].join(' ')}>
              <v.icon className="w-4 h-4" /> {v.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-6">{error}</p>}

      <div className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <h3 className="text-base font-medium text-gray-900 flex items-center gap-2">Query Results {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}</h3>
          {view !== 'table' && (
            <div className="flex items-end gap-3 flex-wrap">
              <div className="w-40"><Select label="Group by" value={groupBy} onChange={setGroupBy} options={GROUPS[dataset]} /></div>
              {view !== 'pie' && (
                <div className="w-40"><Select label="Split by" value={splitBy} onChange={setSplitBy} options={GROUPS[dataset].filter((g) => g.value !== groupBy)} placeholder="Nothing" /></div>
              )}
              <div className="w-44"><Select label="Measure" value={metric} onChange={setMetric} options={METRICS[dataset]} /></div>
            </div>
          )}
        </div>

        {view === 'table' ? (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  {dataset === 'reports' ? (
                    <tr className="text-left text-gray-500 text-xs border-b border-gray-100">
                      <Th>Report ID</Th><Th k="week">Date</Th><Th k="disease">Disease</Th><Th k="sub_county">Sub-county</Th>
                      <Th>Location</Th><Th>Channel</Th><Th>Status</Th><Th k="affected" right>Affected</Th><Th k="deaths" right>Deaths</Th>
                    </tr>
                  ) : (
                    <tr className="text-left text-gray-500 text-xs border-b border-gray-100">
                      <Th k="week">Week</Th><Th>Source</Th><Th k="disease">Disease</Th><Th k="sub_county">Sub-county</Th>
                      <Th k="count" right>Reports / cases</Th><Th k="affected" right>Affected</Th><Th k="deaths" right>Deaths</Th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {(result?.rows || []).map((r, i) => dataset === 'reports' ? (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 pr-4 font-medium text-gray-900 whitespace-nowrap">{r.id}</td>
                      <td className="py-3 pr-4 text-gray-600 whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="py-3 pr-4 text-gray-900">{r.diseaseName}</td>
                      <td className="py-3 pr-4 text-gray-600 whitespace-nowrap">{r.subCounty || '—'}</td>
                      <td className="py-3 pr-4 text-gray-600">{r.location || '—'}</td>
                      <td className="py-3 pr-4 text-gray-600">{r.channel || '—'}</td>
                      <td className="py-3 pr-4"><span className="inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{r.status || '—'}</span></td>
                      <td className="py-3 pr-4 text-right text-gray-900">{r.affected}</td>
                      <td className="py-3 pr-4 text-right text-gray-900">{r.deaths}</td>
                    </tr>
                  ) : (
                    <tr key={`${r.source}-${r.disease}-${r.subCounty}-${r.week}-${i}`} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 pr-4 whitespace-nowrap"><div className="text-gray-900">{r.epiWeek}</div><div className="text-xs text-gray-400">{fmtDate(r.week)}</div></td>
                      <td className="py-3 pr-4 text-gray-600 whitespace-nowrap">{r.sourceLabel}</td>
                      <td className="py-3 pr-4 text-gray-900">{r.diseaseName}</td>
                      <td className="py-3 pr-4 text-gray-600 whitespace-nowrap">{r.subCounty || '—'}<div className="text-xs text-gray-400">{r.county}</div></td>
                      <td className="py-3 pr-4 text-right font-medium text-gray-900">{r.count.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right text-gray-700">{r.affected.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right text-gray-700">{r.deaths.toLocaleString()}</td>
                    </tr>
                  ))}
                  {!loading && !result?.rows?.length && (
                    <tr><td colSpan={9} className="py-12 text-center text-gray-400">No records match your search</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {result && result.summary.rows > 0 && (
              <div className="flex items-center justify-between pt-5 mt-2 border-t border-gray-100 flex-wrap gap-3">
                <div className="flex gap-2">
                  <button onClick={() => setPage(0)} disabled={page === 0} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 hover:bg-gray-50">First</button>
                  <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 hover:bg-gray-50">Previous</button>
                </div>
                <span className="text-sm text-gray-500">
                  Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, result.summary.rows)} of {result.summary.rows.toLocaleString()}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(Math.min(result.pages - 1, page + 1))} disabled={page >= result.pages - 1} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 hover:bg-gray-50">Next</button>
                  <button onClick={() => setPage(result.pages - 1)} disabled={page >= result.pages - 1} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 hover:bg-gray-50">Last</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="relative w-full h-80 sm:h-96">
              {chartData && view === 'bar' && <Bar data={chartData} options={chartOptions} />}
              {chartData && view === 'line' && <Line data={chartData} options={chartOptions} />}
              {chartData && view === 'pie' && <Pie data={chartData} options={pieOptions} />}
              {!loading && !chartData && <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">No records match your search</div>}
            </div>
            {chart?.truncated && <p className="text-xs text-gray-400 mt-3 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> Showing the 30 largest groups.</p>}
            {view === 'line' && !['week', 'month'].includes(groupBy) && (
              <p className="text-xs text-gray-400 mt-2 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> Line charts read best grouped by week or month.</p>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
