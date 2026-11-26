import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, Line, Pie } from 'react-chartjs-2'
import { Search, Table, BarChart3, LineChart, PieChart, RotateCcw, Loader2, Info } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import DownloadMenu from '../components/dashboard/DownloadMenu'
import { CHART_FONT } from '../charts/chartSetup'
import { getDataExplorerOptions, queryDataExplorer, exportDataExplorer, exportCsv, exportJson, logExport } from '../api/frappe'

// Data Explorer (back in the menu, KRCS 26 Nov 2026): search and filter surveillance data for the user's own area
// (CHA, officer and FHW: their sub-county; region users: their region; national: everything) and see it as a table
// or a chart. Data: surveillance.data_explorer. Weeks and months with nothing reported show as 0, small split groups
// are added up as "Other", and a pie always shows totals, so every chart adds up to the table and the totals.

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const INPUT = `h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 ${FOCUS}`
const TH = 'border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-900'
const TD = 'border border-gray-200 px-3 py-2 text-gray-900'
const COLORS = ['#C8102E', '#1F3A5F', '#D97706', '#0F766E', '#7C3AED', '#64748B', '#DB2777', '#0284C7', '#9CA3AF']
const PAGE_SIZE = 25
const tick = { color: '#111827', font: { family: CHART_FONT.family, size: 12 } }

const DATASETS = [
  { key: 'counts', label: 'Weekly counts (all sources)', hint: 'Reports (web, mobile, WhatsApp), CBS and MOH 505, counted per disease, sub-county and week.' },
  { key: 'reports', label: 'Individual reports (web, mobile, WhatsApp)', hint: 'One row per report from web, mobile and WhatsApp. No reporter names or phone numbers.' },
]
const GROUPS = {
  counts: [['week', 'Week'], ['month', 'Month'], ['disease', 'Disease'], ['sub_county', 'Sub-county'], ['county', 'County'], ['source', 'Data source']],
  reports: [['week', 'Week'], ['month', 'Month'], ['disease', 'Disease'], ['sub_county', 'Sub-county'], ['county', 'County'], ['status', 'Status'], ['channel', 'Channel']],
}
const METRICS = {
  counts: [['affected', 'People affected'], ['count', 'Cases and reports'], ['deaths', 'Deaths']],   // people affected first (KRCS 26 Nov 2026)
  reports: [['affected', 'People affected'], ['count', 'Reports'], ['deaths', 'Deaths']],
}
const CHARTS = [['line', 'Line', LineChart], ['bar', 'Bar', BarChart3], ['pie', 'Pie', PieChart]]
const TIME = ['week', 'month']
const label = (list, v) => (list.find((x) => x[0] === v) || [v, v])[1]
const list = (v) => (v ? String(v).split(',').filter(Boolean) : [])

const blank = () => ({ search: '', sources: [], diseases: [], sub_counties: [], county: '', statuses: [], channels: [], date_from: '', date_to: '', pilot_only: 1 })

function fromUrl(sp) {
  const f = blank()
  ;['diseases', 'sub_counties', 'sources'].forEach((k) => { if (sp.get(k)) f[k] = list(sp.get(k)) })
  ;['date_from', 'date_to', 'county', 'search'].forEach((k) => { if (sp.get(k)) f[k] = sp.get(k) })
  return f
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(String(v).slice(0, 10))
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Field({ label: text, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold text-gray-900">{text}</span>{children}</label>
}

function Pick({ value, onChange, options, all }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      {all != null && <option value="">{all}</option>}
      {options.map((o) => <option key={o.value ?? o[0] ?? o} value={o.value ?? o[0] ?? o}>{o.label ?? o[1] ?? o}</option>)}
    </select>
  )
}

export default function DataExplorer() {
  const [sp] = useSearchParams()
  const [options, setOptions] = useState(null)
  const [dataset, setDataset] = useState('counts')
  const [view, setView] = useState(sp.get('view') ? 'chart' : 'table')
  const [chartType, setChartType] = useState(['line', 'bar', 'pie'].includes(sp.get('view')) ? sp.get('view') : 'bar')   // bars first (KRCS 26 Nov 2026)
  const [draft, setDraft] = useState(() => fromUrl(sp))
  const [filters, setFilters] = useState(() => fromUrl(sp))
  const [groupBy, setGroupBy] = useState(sp.get('group_by') || 'week')
  const [splitBy, setSplitBy] = useState(sp.get('split_by') || '')
  const [metric, setMetric] = useState(sp.get('metric') || 'affected')
  const [sort, setSort] = useState({ key: 'week', order: 'desc' })
  const [page, setPage] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState('')
  const chartRef = useRef(null)

  useEffect(() => { getDataExplorerOptions().then(setOptions).catch((e) => setError(e.message || 'Could not load the filters')) }, [])

  const params = useMemo(() => ({
    dataset, ...filters, group_by: groupBy, split_by: chartType === 'pie' ? '' : splitBy, metric,
    sort: sort.key, order: sort.order, page, page_size: PAGE_SIZE,
  }), [dataset, filters, groupBy, splitBy, metric, sort, page, chartType])

  const run = useCallback(() => {
    setLoading(true)
    queryDataExplorer(params)
      .then((r) => { setResult(r); setError('') })
      .catch((e) => setError(e.message || 'Query failed'))
      .finally(() => setLoading(false))
  }, [params])
  useEffect(run, [run])

  const apply = (next = draft) => { setFilters(next); setPage(0) }
  const reset = () => { const f = blank(); setDraft(f); apply(f) }
  function switchDataset(key) {
    setDataset(key); setPage(0)
    if (!GROUPS[key].some((g) => g[0] === groupBy)) setGroupBy('week')
    if (splitBy && !GROUPS[key].some((g) => g[0] === splitBy)) setSplitBy('')
    setSort({ key: 'week', order: 'desc' })
  }
  function pickChart(type) {   // a line is over time; a pie is one set of totals
    setChartType(type)
    if (type === 'line' && !TIME.includes(groupBy)) setGroupBy('week')
    if (type === 'pie' && TIME.includes(groupBy)) setGroupBy('disease')
  }
  function pickGroup(g) {
    setGroupBy(g)
    if (g === splitBy) setSplitBy('')
    if (chartType === 'line' && !TIME.includes(g)) setChartType('bar')
  }
  const toggleSort = (key) => { setSort((s) => ({ key, order: s.key === key && s.order === 'desc' ? 'asc' : 'desc' })); setPage(0) }

  const name = (opts, v) => (opts || []).find((o) => o.value === v)?.label || v
  const many = (opts, vs) => (vs || []).map((v) => name(opts, v)).join(', ')
  const filterLine = [
    { label: 'Search', value: filters.search }, { label: 'Disease', value: many(options?.diseases, filters.diseases) },
    { label: 'Sub-county', value: many(options?.subCounties, filters.sub_counties) }, { label: 'County', value: filters.county },
    { label: 'Status', value: (filters.statuses || []).join(', ') }, { label: 'Channel', value: (filters.channels || []).join(', ') },
    { label: 'Sources', value: many(options?.sources, filters.sources) },
    { label: 'From', value: filters.date_from }, { label: 'To', value: filters.date_to },
    { label: 'Pilot sub-counties only', value: filters.pilot_only ? 'Yes' : 'No' },
  ]

  async function download(kind) {
    setExporting(kind)
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const opts = { page: '/data-explorer', title: `Data Explorer (${dataset === 'reports' ? 'reports' : 'weekly counts'})`, filters: filterLine }
      if (kind === 'png') {
        const img = chartRef.current?.toBase64Image?.('image/png', 1)
        if (!img) throw new Error('Open the chart first, then download it.')
        await logExport({ page: '/data-explorer', title: `${opts.title}: ${chartTitle}`, format: 'PNG', rows: chart?.labels?.length || 0, filters: filterLine })
        const a = document.createElement('a'); a.href = img; a.download = `data-explorer-chart-${stamp}.png`; a.click()
        return
      }
      const { rows, truncated } = await exportDataExplorer({ ...params, page: 0 })
      if (kind === 'json') {
        await exportJson(`data-explorer-${dataset}-${stamp}.json`, rows, opts)
      } else {
        const cols = dataset === 'reports'
          ? [['Report ID', 'id'], ['Date', 'date'], ['Disease', 'diseaseName'], ['Sub-county', 'subCounty'], ['County', 'county'],
            ['Location', 'location'], ['Channel', 'channel'], ['Status', 'status'], ['People affected', 'affected'], ['Deaths', 'deaths']]
          : [['Week starting', 'week'], ['Epi week', 'epiWeek'], ['Source', 'sourceLabel'], ['Disease', 'diseaseName'],
            ['Sub-county', 'subCounty'], ['County', 'county'], ['Cases and reports', 'count'], ['People affected', 'affected'], ['Deaths', 'deaths']]
        await exportCsv(`data-explorer-${dataset}-${stamp}.csv`, rows, cols.map(([l, key]) => ({ label: l, value: (r) => r[key] })), opts)
      }
      if (truncated) setError('The download has the first 20,000 rows. Narrow the filters to get the rest.')
    } catch (e) {
      setError(e.message || 'Download failed')
    } finally {
      setExporting('')
    }
  }

  const chart = result?.chart
  const metricLabel = label(METRICS[dataset], metric)
  const groupLabel = label(GROUPS[dataset], groupBy)
  const split = chartType === 'pie' ? '' : splitBy
  const chartTitle = `${metricLabel} by ${groupLabel.toLowerCase()}${split ? `, split by ${label(GROUPS[dataset], split).toLowerCase()}` : ''}`
  const hasFigures = !!chart?.labels?.length && (chart.totals || []).some(Boolean)

  const chartData = useMemo(() => {
    if (!chart?.labels?.length) return null
    if (chartType === 'pie') {
      return { labels: chart.labels, datasets: [{ data: chart.totals, backgroundColor: chart.labels.map((_, i) => COLORS[i % COLORS.length]), borderColor: '#fff', borderWidth: 2 }] }
    }
    return {
      labels: chart.labels,
      datasets: chart.series.map((s, i) => {
        const color = chart.series.length > 1 ? COLORS[i % COLORS.length] : COLORS[0]
        return chartType === 'line'
          ? { label: s.name, data: s.data, borderColor: color, backgroundColor: color, tension: 0, pointRadius: 3, borderWidth: 2 }
          : { label: s.name, data: s.data, backgroundColor: color, borderRadius: 3, maxBarThickness: 40, stack: 'all' }
      }),
    }
  }, [chart, chartType])
  const multi = (chart?.series?.length || 0) > 1
  const chartOptions = {
    responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: multi || !!split, position: 'bottom', labels: { ...tick, boxWidth: 12 } } },
    scales: {
      x: { stacked: chartType === 'bar' && multi, grid: { display: false }, ticks: { ...tick, autoSkip: true, maxRotation: 45 } },
      y: { stacked: chartType === 'bar' && multi, grid: { color: '#F0F0F0' }, ticks: { ...tick, precision: 0 }, beginAtZero: true,
        title: { display: true, text: metricLabel, ...tick } },
    },
  }
  const pieOptions = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'right', labels: { ...tick, boxWidth: 12 } } } }

  const summary = result?.summary
  const datasetInfo = DATASETS.find((d) => d.key === dataset)
  const filtersOn = JSON.stringify(filters) !== JSON.stringify(blank())

  const th = (children, k, right) => (
    <th key={children} className={`${TH} whitespace-nowrap ${right ? 'text-right' : ''}`}>
      {k ? <button type="button" onClick={() => toggleSort(k)} className={`font-bold hover:underline ${FOCUS}`}>{children}{sort.key === k ? (sort.order === 'desc' ? ' ↓' : ' ↑') : ''}</button> : children}
    </th>
  )

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Data Explorer</h2>
          <p className="text-sm text-gray-900">Search and filter surveillance data from reports (web, mobile, WhatsApp), CBS and MOH 505, and see it as a table or a chart.
            {options?.limitedTo ? <> Showing <b>{options.limitedTo}</b>.</> : ''}</p>
        </div>
        {options?.canExport && (
          <DownloadMenu formats={view === 'chart' ? ['csv', 'json', 'png'] : ['csv', 'json']} onPick={download} busy={exporting} />
        )}
      </div>

      {/* what to look at */}
      <div role="tablist" aria-label="Data" className="mb-1 inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {DATASETS.map((d) => (
          <button key={d.key} type="button" role="tab" aria-selected={dataset === d.key} onClick={() => switchDataset(d.key)}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${dataset === d.key ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50'} ${FOCUS}`}>
            {d.label}
          </button>
        ))}
      </div>
      <p className="mb-5 text-sm text-gray-900">{datasetInfo.hint}</p>

      {/* filters, always in view */}
      <form onSubmit={(e) => { e.preventDefault(); apply() }} className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Field label="Search">
              <span className="relative block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                <input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} className={`${INPUT} pl-9`}
                  placeholder={dataset === 'reports' ? 'Disease, sub-county, location or report ID' : 'Disease, sub-county or county'} />
              </span>
            </Field>
          </div>
          <Field label="Disease"><Pick value={draft.diseases[0] || ''} onChange={(v) => setDraft({ ...draft, diseases: v ? [v] : [] })} options={options?.diseases || []} all="All diseases" /></Field>
          <Field label="Sub-county"><Pick value={draft.sub_counties[0] || ''} onChange={(v) => setDraft({ ...draft, sub_counties: v ? [v] : [] })} options={options?.subCounties || []} all="All sub-counties" /></Field>
          <Field label="County"><Pick value={draft.county} onChange={(v) => setDraft({ ...draft, county: v })} options={options?.counties || []} all="All counties" /></Field>
          <Field label="From"><input type="date" value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} className={INPUT} /></Field>
          <Field label="To"><input type="date" value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} className={INPUT} /></Field>
          {dataset === 'reports' ? (
            <>
              <Field label="Status"><Pick value={draft.statuses[0] || ''} onChange={(v) => setDraft({ ...draft, statuses: v ? [v] : [] })} options={options?.statuses || []} all="All statuses" /></Field>
              <Field label="Channel"><Pick value={draft.channels[0] || ''} onChange={(v) => setDraft({ ...draft, channels: v ? [v] : [] })} options={options?.channels || []} all="All channels" /></Field>
            </>
          ) : (
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-xs font-bold text-gray-900">Data sources</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
                {(options?.sources || []).map((s) => {
                  const on = !draft.sources.length || draft.sources.includes(s.value)
                  const all = (options?.sources || []).map((x) => x.value)
                  return (
                    <label key={s.value} className="inline-flex items-center gap-2 text-sm text-gray-900">
                      <input type="checkbox" checked={on} className="h-4 w-4 accent-red-600"
                        onChange={() => {
                          const cur = draft.sources.length ? draft.sources : all
                          const next = on ? cur.filter((x) => x !== s.value) : [...cur, s.value]
                          setDraft({ ...draft, sources: next.length === all.length ? [] : next })
                        }} />
                      {s.label}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-900">
            <input type="checkbox" checked={!!draft.pilot_only} onChange={(e) => setDraft({ ...draft, pilot_only: e.target.checked ? 1 : 0 })} className="h-4 w-4 accent-red-600" />
            Pilot sites only (Dadaab and Kalobeyei regions: Dadaab, Fafi, Liboi, Lokichogio, Turkana West)
          </label>
          <div className="flex items-center gap-3">
            {filtersOn && (
              <button type="button" onClick={reset} className={`inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 hover:underline ${FOCUS}`}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Clear filters
              </button>
            )}
            <button type="submit" className={`h-10 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-700 ${FOCUS}`}>Apply filters</button>
          </div>
        </div>
      </form>

      {/* totals */}
      {summary && (
        <div className="mb-5 grid grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-white sm:grid-cols-3">
          {[[dataset === 'reports' ? 'Reports' : 'Cases and reports', summary.count], ['People affected', summary.affected], ['Deaths', summary.deaths]].map(([l, v]) => (
            <div key={l} className="border-b border-gray-200 p-4 sm:border-b-0 sm:border-r last:border-r-0">
              <p className="text-sm font-bold text-gray-900">{l}</p>
              <p className="text-2xl font-bold tabular-nums text-gray-900">{Number(v || 0).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
      {dataset === 'counts' && !filters.sources.length && (
        <p className="mb-5 flex items-start gap-1.5 text-sm text-gray-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Reports (web, mobile, WhatsApp), CBS and MOH 505 are added together. Untick sources, or split the chart by data source, to compare them.</p>
      )}
      {error && <p className="mb-5 rounded-lg border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Show as" className="inline-flex rounded-lg border border-gray-200 p-1">
            {[['table', 'Table', Table], ['chart', 'Chart', BarChart3]].map(([k, l, Icon]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold ${view === k ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50'} ${FOCUS}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />{l}
              </button>
            ))}
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-500" aria-label="Loading" />}
        </div>

        {view === 'table' ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  {dataset === 'reports' ? (
                    <tr>{th('Report ID')}{th('Date', 'week')}{th('Disease', 'disease')}{th('Sub-county', 'sub_county')}
                      {th('Location')}{th('Channel')}{th('Status')}{th('Affected', 'affected', true)}{th('Deaths', 'deaths', true)}</tr>
                  ) : (
                    <tr>{th('Week', 'week')}{th('Source')}{th('Disease', 'disease')}{th('Sub-county', 'sub_county')}
                      {th('Cases and reports', 'count', true)}{th('Affected', 'affected', true)}{th('Deaths', 'deaths', true)}</tr>
                  )}
                </thead>
                <tbody>
                  {(result?.rows || []).map((r, i) => dataset === 'reports' ? (
                    <tr key={r.id}>
                      <td className={`${TD} whitespace-nowrap font-bold`}>{r.id}</td>
                      <td className={`${TD} whitespace-nowrap`}>{fmtDate(r.date)}</td>
                      <td className={TD}>{r.diseaseName}</td>
                      <td className={`${TD} whitespace-nowrap`}>{r.subCounty || '—'}</td>
                      <td className={TD}>{r.location || '—'}</td>
                      <td className={TD}>{r.channel || '—'}</td>
                      <td className={TD}>{r.status || '—'}</td>
                      <td className={`${TD} text-right tabular-nums`}>{r.affected}</td>
                      <td className={`${TD} text-right tabular-nums`}>{r.deaths}</td>
                    </tr>
                  ) : (
                    <tr key={`${r.source}-${r.disease}-${r.subCounty}-${r.week}-${i}`}>
                      <td className={`${TD} whitespace-nowrap`}><b>{r.epiWeek}</b><span className="block text-xs">{fmtDate(r.week)}</span></td>
                      <td className={`${TD} whitespace-nowrap`}>{r.sourceLabel}</td>
                      <td className={TD}>{r.diseaseName}</td>
                      <td className={`${TD} whitespace-nowrap`}>{r.subCounty || '—'}<span className="block text-xs">{r.county}</span></td>
                      <td className={`${TD} text-right font-bold tabular-nums`}>{r.count.toLocaleString()}</td>
                      <td className={`${TD} text-right tabular-nums`}>{r.affected.toLocaleString()}</td>
                      <td className={`${TD} text-right tabular-nums`}>{r.deaths.toLocaleString()}</td>
                    </tr>
                  ))}
                  {!loading && !result?.rows?.length && <tr><td colSpan={9} className={`${TD} py-10 text-center`}>Nothing matches these filters.</td></tr>}
                </tbody>
              </table>
            </div>
            {result && result.summary.rows > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPage(0)} disabled={page === 0} className={`rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 disabled:text-gray-300 ${FOCUS}`}>First</button>
                  <button type="button" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className={`rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 disabled:text-gray-300 ${FOCUS}`}>Previous</button>
                </div>
                <span className="text-sm text-gray-900">Rows {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, result.summary.rows)} of {result.summary.rows.toLocaleString()}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPage(Math.min(result.pages - 1, page + 1))} disabled={page >= result.pages - 1} className={`rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 disabled:text-gray-300 ${FOCUS}`}>Next</button>
                  <button type="button" onClick={() => setPage(result.pages - 1)} disabled={page >= result.pages - 1} className={`rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 disabled:text-gray-300 ${FOCUS}`}>Last</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* what the chart shows */}
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Chart">
                <span className="flex gap-1">
                  {CHARTS.map(([k, l, Icon]) => (
                    <button key={k} type="button" aria-pressed={chartType === k} onClick={() => pickChart(k)} title={l}
                      className={`inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-semibold ${chartType === k ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 text-gray-900 hover:bg-gray-50'} ${FOCUS}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />{l}
                    </button>
                  ))}
                </span>
              </Field>
              <Field label={chartType === 'line' ? 'Over' : 'Group by'}>
                <Pick value={groupBy} onChange={pickGroup} options={GROUPS[dataset].filter((g) => chartType !== 'line' || TIME.includes(g[0]))} />
              </Field>
              <Field label="Split by">
                <select value={split} disabled={chartType === 'pie'} onChange={(e) => setSplitBy(e.target.value)} className={`${INPUT} disabled:bg-gray-50`}>
                  <option value="">{chartType === 'pie' ? 'Not for a pie' : 'Nothing'}</option>
                  {GROUPS[dataset].filter((g) => g[0] !== groupBy).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Measure"><Pick value={metric} onChange={setMetric} options={METRICS[dataset]} /></Field>
            </div>

            <h3 className="text-base font-bold text-gray-900">{chartTitle}</h3>
            <p className="mb-3 text-sm text-gray-900">{filterLine.filter((f) => f.value && f.label !== 'Pilot sub-counties only').map((f) => `${f.label}: ${f.value}`).join(' · ') || 'All data you can see'}</p>
            <div className="relative h-80 w-full sm:h-96">
              {chartData && hasFigures && chartType === 'bar' && <Bar ref={chartRef} data={chartData} options={chartOptions} />}
              {chartData && hasFigures && chartType === 'line' && <Line ref={chartRef} data={chartData} options={chartOptions} />}
              {chartData && hasFigures && chartType === 'pie' && <Pie ref={chartRef} data={chartData} options={pieOptions} />}
              {!loading && !hasFigures && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-900">Nothing to chart for these filters.</div>}
            </div>
            {chart?.truncated && <p className="mt-2 text-sm text-gray-900">Showing the 30 largest groups.</p>}

            {/* the numbers behind the chart, so it can be checked */}
            {hasFigures && (
              <details className="mt-4">
                <summary className={`cursor-pointer text-sm font-semibold text-red-700 ${FOCUS}`}>Numbers in this chart</summary>
                <div className="mt-2 max-h-96 overflow-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0"><tr>
                      <th className={TH}>{groupLabel}</th>
                      {split && chart.series.map((s) => <th key={s.name} className={`${TH} text-right`}>{s.name}</th>)}
                      <th className={`${TH} text-right`}>{split ? 'Total' : metricLabel}</th>
                    </tr></thead>
                    <tbody>
                      {chart.labels.map((l, i) => (
                        <tr key={l}>
                          <td className={TD}>{l}</td>
                          {split && chart.series.map((s) => <td key={s.name} className={`${TD} text-right tabular-nums`}>{s.data[i].toLocaleString()}</td>)}
                          <td className={`${TD} text-right font-bold tabular-nums`}>{chart.totals[i].toLocaleString()}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className={`${TD} font-bold`}>Total</td>
                        {split && chart.series.map((s) => <td key={s.name} className={`${TD} text-right font-bold tabular-nums`}>{s.data.reduce((a, b) => a + b, 0).toLocaleString()}</td>)}
                        <td className={`${TD} text-right font-bold tabular-nums`}>{chart.totals.reduce((a, b) => a + b, 0).toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
