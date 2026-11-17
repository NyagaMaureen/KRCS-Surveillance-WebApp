import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Download, FileSpreadsheet, FileText, Image as ImageIcon, X, RefreshCw, Search, LayoutGrid, Table2,
  ChevronLeft, ChevronRight, Radio, BellRing, ClipboardCheck, CircleDashed, Sparkles, Gauge, Plug, Server,
} from 'lucide-react'
import '../charts/chartSetup'
import { CHART_FONT } from '../charts/chartSetup'
import AppShell from '../components/layout/AppShell'
import Pager from '../components/common/Pager'
import usePaged from '../components/common/usePaged'
import {
  listMonitoringReports, getMonitoringReport, logMonitoringExport, downloadMonitoringExport,
} from '../api/frappe'

// Monitoring Reports (SRS D.5, KRCS 16 Nov 2026): R34 to R40b, each with a summary (cards and charts) and a detail
// table, the same filters, and exports (CSV and Excel from the server; PDF and JPEG made here). Every view and export
// is recorded in the Audit Log. Data: surveillance.monitoring

const RED = '#EE2435'
const NAVY = '#011E41'
const GREY = '#9CA3AF'
const COLORS = [RED, NAVY, GREY]
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const BTN = `inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const PERIODS = [['4w', 'Last 4 weeks', 28], ['8w', 'Last 8 weeks', 56], ['12w', 'Last 12 weeks', 84], ['6m', 'Last 6 months', 182],
  ['12m', 'Last 12 months', 364], ['custom', 'Choose dates', 0]]
const EMPTY = { region: '', subCounty: '', period: '4w', from: daysAgo(27), to: today(), disease: '', channel: '' }

const tick = { color: '#111827', font: { family: CHART_FONT.family, size: 11 } }
const grid = { color: '#F3F4F6' }
const tooltip = { titleFont: { family: CHART_FONT.family }, bodyFont: { family: CHART_FONT.family } }
const legend = { position: 'bottom', labels: { ...tick, boxWidth: 10, boxHeight: 10 } }

// long labels on two or three lines (no brackets), full text in the tooltip
function wrap(label, max = 28) {
  const words = String(label).replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().split(' ')
  const lines = ['']
  words.forEach((w) => {
    const cur = lines[lines.length - 1]
    if (cur && (cur + ' ' + w).length > max) lines.push(w)
    else lines[lines.length - 1] = cur ? `${cur} ${w}` : w
  })
  return lines.length > 1 ? lines : lines[0]
}

// what each report is for, on the list page
const REPORT_ICONS = { R34: Radio, R35: BellRing, R36: ClipboardCheck, R37: CircleDashed, R38: Sparkles, R39: Gauge, R40: Plug, R40b: Server }

export default function MonitoringReports() {
  const [params, setParams] = useSearchParams()
  const [meta, setMeta] = useState(null)
  const [metaError, setMetaError] = useState('')
  const [filters, setFilters] = useState(EMPTY)
  const [view, setView] = useState('summary')
  const [table, setTable] = useState('main')
  const [q, setQ] = useState('')   // search in the detail table
  const [stamp, setStamp] = useState(0)
  const [result, setResult] = useState({ key: null, data: null, error: '' })
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState(null)
  const charts = useRef({})

  useEffect(() => { listMonitoringReports().then(setMeta).catch((e) => setMetaError(e.message || 'Could not load the reports')) }, [])

  const reports = meta?.reports || []
  const current = reports.find((r) => r.key === params.get('report')) || null   // none: the list of reports
  const options = meta?.options

  // what the server gets: only the filters this report uses, the period as dates
  const query = useMemo(() => {
    if (!current) return null
    const use = new Set(current.filters)
    const days = (PERIODS.find((p) => p[0] === filters.period) || PERIODS[0])[2]
    const q = filters.period === 'custom' ? { from_date: filters.from, to_date: filters.to } : { from_date: daysAgo(days - 1), to_date: today() }
    if (use.has('region') && filters.region) q.region = filters.region
    if (use.has('sub_county') && filters.subCounty) q.sub_county = filters.subCounty
    if (use.has('disease') && filters.disease) q.disease = filters.disease
    if (use.has('channel') && filters.channel) q.channel = filters.channel
    return q
  }, [current, filters])

  const key = current && query ? `${current.key}|${JSON.stringify(query)}|${stamp}` : null
  useEffect(() => {
    if (!key) return undefined
    let live = true
    getMonitoringReport(current.key, query)
      .then((data) => live && setResult({ key, data, error: '' }))
      .catch((e) => live && setResult({ key, data: null, error: e.message || 'Could not make this report' }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const data = result.key === key ? result.data : null
  const error = result.key === key ? result.error : ''
  const tables = data?.detail?.tables || []
  const shownTable = tables.find((x) => x.key === table) || tables[0]

  function open(k) {
    charts.current = {}
    setView('summary')
    setTable('main')
    setQ('')
    setParams((prev) => { const next = new URLSearchParams(prev); if (k) next.set('report', k); else next.delete('report'); return next })
  }
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v, ...(k === 'region' ? { subCounty: '' } : {}) }))
  const changed = ['region', 'subCounty', 'disease', 'channel'].some((k) => filters[k]) || filters.period !== EMPTY.period
  const flash = (text, bad = false) => { setToast({ text, bad }); setTimeout(() => setToast(null), 4000) }

  async function exportAs(format) {
    if (!data) return
    setBusy(format)
    // the PDF opens in a new window: open it now, while the click still counts, and fill it once the charts are drawn
    const win = format === 'PDF' ? window.open('', '_blank') : null
    try {
      if (format === 'csv' || format === 'xlsx') await downloadMonitoringExport(current.key, format, query, shownTable?.key)
      else {
        if (format === 'PDF' && !win) throw new Error('Allow pop-ups for this site to save the PDF.')
        if (view !== 'summary') {   // the charts are on the summary view
          setView('summary')
          await new Promise((r) => setTimeout(r, 600))
        }
        if (format === 'PDF') printReport(data, charts.current, win)
        else await saveJpeg(data, charts.current)
        await logMonitoringExport(current.key, format, query, data.detail.rows.length)
      }
    } catch (e) {
      if (win) win.close()
      flash(e.message || 'Export failed', true)
    } finally {
      setBusy('')
    }
  }

  if (metaError) return <AppShell><p className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{metaError}</p></AppShell>

  return (
    <AppShell>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900">Monitoring Reports</h2>
        <p className="text-sm text-gray-900">Standard reports on surveillance, response, data quality, AI and the system{options?.lockedSubCounty ? `, for ${options.lockedSubCounty} sub-county` : ''}.</p>
      </div>

      {!meta ? <div className="h-40 animate-pulse rounded-xl bg-gray-100" /> : !current ? (
        /* the reports, as a list to open */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {reports.map((r) => {
            const Icon = REPORT_ICONS[r.key] || FileText
            return (
              <button key={r.key} type="button" onClick={() => open(r.key)}
                className={`group flex flex-col rounded-xl border border-gray-200 bg-white p-5 text-left hover:border-red-300 hover:shadow-sm ${FOCUS}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                  <h3 className="text-base font-bold text-gray-900">{r.title}</h3>
                </div>
                <p className="mt-1 flex-1 text-sm text-gray-900">{r.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-red-700 group-hover:underline">Open report <ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="min-w-0">
          <button type="button" onClick={() => open(null)} className={`mb-3 inline-flex items-center gap-1 rounded text-sm font-semibold text-red-700 hover:underline ${FOCUS}`}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> All reports
          </button>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <h3 className="text-lg font-bold text-gray-900">{current.title}</h3>
              <p className="text-sm text-gray-900">{current.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="View" className="flex rounded-lg border border-gray-200 bg-white p-0.5">
                {[['summary', 'Summary', LayoutGrid], ['detail', 'Detail', Table2]].map(([k, label, Icon]) => (
                  <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm ${FOCUS} ${view === k ? 'bg-red-600 font-semibold text-white' : 'text-gray-900 hover:bg-gray-50'}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />{label}
                  </button>
                ))}
              </div>
              <button type="button" className={BTN} onClick={() => setStamp((s) => s + 1)}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</button>
            </div>
          </div>

          <FilterBar report={current} filters={filters} set={set} options={options} changed={changed} clear={() => setFilters(EMPTY)}
            search={view === 'detail'} q={q} setQ={setQ} />

          {data?.canExport && (
            <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
              {data.canExport && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-gray-900">Export</span>
                  <button type="button" className={BTN} disabled={!!busy} onClick={() => exportAs('xlsx')}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
                  <button type="button" className={BTN} disabled={!!busy} onClick={() => exportAs('csv')} title={tables.length > 1 ? `CSV of ${shownTable?.title}` : undefined}><Download className="h-4 w-4" aria-hidden="true" />{busy === 'csv' ? 'Preparing…' : 'CSV'}</button>
                  <button type="button" className={BTN} disabled={!!busy} onClick={() => exportAs('PDF')}><FileText className="h-4 w-4" aria-hidden="true" />PDF</button>
                  <button type="button" className={BTN} disabled={!!busy} onClick={() => exportAs('JPEG')}><ImageIcon className="h-4 w-4" aria-hidden="true" />{busy === 'JPEG' ? 'Preparing…' : 'JPEG'}</button>
                </div>
              )}
            </div>
          )}

          {!data ? <Loading error={error} /> : view === 'summary'
            ? <Summary data={data} charts={charts} />
            : <Detail data={data} tables={tables} table={shownTable} setTable={setTable} q={q} setQ={setQ} />}
        </div>
      )}
      {toast && <div role="status" className={`fixed bottom-6 right-6 z-[70] rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${toast.bad ? 'bg-red-700' : 'bg-gray-900'}`}>{toast.text}</div>}
    </AppShell>
  )
}

function fmtWhen(v) {
  const d = new Date(String(v).replace(' ', 'T'))
  return isNaN(d) ? v : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// one row like the Review Queue: search (detail view), then the report's filters, no labels
const SELECT_SOFT = `h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 ${FOCUS}`

function FilterBar({ report, filters, set, options, changed, clear, search, q, setQ }) {
  if (!report) return null
  const use = new Set(report.filters)
  const subs = (options?.subCounties || []).filter((s) => !filters.region || s.region === filters.region)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
      {search && (
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="text" aria-label="Search the table" placeholder="Search the table"
            className={`h-9 w-full rounded-lg border border-gray-100 bg-gray-50 pl-9 pr-3 text-sm ${FOCUS}`} />
        </div>
      )}
      {use.has('region') && !options?.lockedRegion && (options?.regions?.length || 0) > 1 && (
        <select aria-label="Region" className={SELECT_SOFT} value={filters.region} onChange={(e) => set('region', e.target.value)}>
          <option value="">All regions</option>
          {options.regions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      )}
      {use.has('sub_county') && (options?.lockedSubCounty ? (
        <span className="inline-flex h-9 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700">{options.lockedSubCounty}</span>
      ) : (
        <select aria-label="Sub-county" className={SELECT_SOFT} value={filters.subCounty} onChange={(e) => set('subCounty', e.target.value)}>
          <option value="">All sub-counties</option>
          {subs.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      ))}
      <select aria-label="Period" className={SELECT_SOFT} value={filters.period} onChange={(e) => set('period', e.target.value)}>
        {PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {filters.period === 'custom' && (
        <>
          <input type="date" aria-label="From" className={SELECT_SOFT} value={filters.from} max={filters.to} onChange={(e) => set('from', e.target.value)} />
          <span className="text-sm text-gray-500">to</span>
          <input type="date" aria-label="To" className={SELECT_SOFT} value={filters.to} min={filters.from} max={today()} onChange={(e) => set('to', e.target.value)} />
        </>
      )}
      {use.has('disease') && (
        <select aria-label="Disease" className={`${SELECT_SOFT} max-w-[16rem]`} value={filters.disease} onChange={(e) => set('disease', e.target.value)}>
          <option value="">All diseases</option>
          {(options?.diseases || []).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      )}
      {use.has('channel') && (
        <select aria-label="Channel" className={SELECT_SOFT} value={filters.channel} onChange={(e) => set('channel', e.target.value)}>
          <option value="">All channels</option>
          {(options?.channels || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      )}
      {(changed || (search && q)) && (
        <button type="button" onClick={() => { clear(); setQ('') }} className={`inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-900 ${FOCUS}`}>
          <X className="h-4 w-4" aria-hidden="true" /> Clear
        </button>
      )}
    </div>
  )
}

function Loading({ error }) {
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{error}</div>
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}</div>
      <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
    </div>
  )
}

// ---------- summary ----------

// summary: a few plain sentences, the key numbers, at most two charts; the explanations fold away
function Summary({ data, charts }) {
  const s = data.summary
  return (
    <>
      {s.inShort?.length > 0 && (
        <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
          <h4 className="text-sm font-bold text-gray-900"> At a Glance</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-900">
            {s.inShort.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
      )}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {s.cards.map((c) => (
          <div key={c.key} className="rounded-xl bg-red-600 p-4 text-center text-white">
            <p className="text-[11px] font-bold uppercase tracking-wide">{c.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{typeof c.value === 'number' ? c.value.toLocaleString() : c.value}</p>
            {c.note && <p className="mt-0.5 text-xs">{c.note}</p>}
          </div>
        ))}
      </div>
      {s.charts.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          {s.charts.map((c) => (
            <section key={c.key} className="rounded-xl border border-gray-200 bg-white p-5">
              <h4 className="text-sm font-bold text-gray-900">{c.title}</h4>
              {c.note && <p className="mt-0.5 text-xs text-gray-900">{c.note}</p>}
              <div className="relative mt-3" style={{ height: c.type === 'hbar' ? Math.max(240, c.labels.length * 34) : 260 }}>
                <Chart chart={c} onRef={(inst) => { if (inst) charts.current[c.key] = { chart: c, inst }; else delete charts.current[c.key] }} />
              </div>
            </section>
          ))}
        </div>
      )}
      {s.measures && <AiMeasures measures={s.measures} />}
    </>
  )
}

function Chart({ chart, onRef }) {
  const any = chart.series.some((s) => s.data.some((n) => n))
  if (!any) return <div className="flex h-full items-center justify-center text-sm text-gray-900">No data for these filters.</div>
  const many = chart.series.length > 1
  const datasets = chart.series.map((s, i) => ({
    label: s.label, data: s.data, backgroundColor: COLORS[i % COLORS.length], borderColor: COLORS[i % COLORS.length],
    borderRadius: 3, maxBarThickness: chart.type === 'hbar' ? 22 : 40, borderWidth: chart.type === 'line' ? 2 : 0, pointRadius: 3, tension: 0.2, spanGaps: false,
  }))
  const horizontal = chart.type === 'hbar'
  const labels = chart.labels.map((l) => (horizontal ? wrap(l) : l))
  const opts = {
    responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x', animation: false,
    plugins: { legend: many ? legend : { display: false }, tooltip: { ...tooltip, callbacks: { title: (items) => chart.labels[items[0].dataIndex] } } },
    scales: {
      x: { grid: horizontal ? grid : { display: false }, ticks: { ...tick, precision: 0 }, beginAtZero: true },
      y: { grid: horizontal ? { display: false } : grid, ticks: { ...tick, precision: 0, autoSkip: !horizontal }, beginAtZero: true },
    },
  }
  if (chart.type === 'doughnut') {
    return <Doughnut ref={onRef} data={{ labels, datasets: [{ data: chart.series[0].data, backgroundColor: [RED, NAVY, GREY, '#D97706', '#6B7280'] }] }}
      options={{ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend, tooltip } }} />
  }
  if (chart.type === 'line') return <Line ref={onRef} data={{ labels, datasets }} options={opts} />
  return <Bar ref={onRef} data={{ labels, datasets }} options={opts} />
}

// AI Performance: every AI measure in one short table
function AiMeasures({ measures }) {
  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <h4 className="px-5 pt-4 text-sm font-bold text-gray-900">All AI measures</h4>
      <div className="pb-3" />
      <div className="overflow-x-auto">
        <table className="red-head w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs">
              <th className="px-3 py-2">AI part</th><th className="px-3 py-2">Measure</th><th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2">Based on</th>
            </tr>
          </thead>
          <tbody>
            {measures.map((m) => (
              <tr key={m.key} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 font-semibold text-gray-900">{m.part}</td>
                <td className="px-3 py-2 text-gray-900">{m.measure}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-gray-900">{m.value == null ? <span className="font-normal">No data yet</span> : `${m.value}%`}</td>
                <td className="px-3 py-2 text-xs text-gray-900">{m.based}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------- detail ----------

function Detail({ data, tables, table, setTable, q, setQ }) {
  const { columns, rows } = table || data.detail
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? rows.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(t))) : rows
  }, [q, rows, columns])
  const paged = usePaged(shown, 25, `${data.report}|${data.from}|${data.to}|${table?.key}|${q}`)
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {tables.length > 1 && (
            <div role="tablist" aria-label="Table" className="flex rounded-lg border border-gray-200 p-0.5">
              {tables.map((x) => (
                <button key={x.key} type="button" role="tab" aria-selected={x.key === table?.key} onClick={() => { setTable(x.key); setQ('') }}
                  className={`h-8 rounded-md px-3 text-sm ${FOCUS} ${x.key === table?.key ? 'bg-red-600 font-semibold text-white' : 'text-gray-900 hover:bg-gray-50'}`}>
                  {x.title} ({x.rows.length})
                </button>
              ))}
            </div>
          )}
          <p className="text-sm text-gray-900">{shown.length.toLocaleString()} {shown.length === 1 ? 'row' : 'rows'}</p>
        </div>
      </div>
      {!shown.length ? <p className="p-10 text-center text-sm text-gray-900">No rows for these filters.</p> : (
        <div className="overflow-x-auto">
          <table className="red-head w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs">
                <th className="w-10 px-3 py-3">#</th>
                {columns.map((c) => <th key={c.key} className="px-3 py-3">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {paged.shown.map((r, i) => (
                <tr key={i} className="align-top hover:bg-gray-50">
                  <td className="px-3 py-2.5 tabular-nums text-gray-900">{paged.offset + i + 1}</td>
                  {columns.map((c) => <td key={c.key} className="px-3 py-2.5 text-gray-900">{cell(r[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager paged={paged} />
    </section>
  )
}

function cell(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (v === 'Yes' || v === 'OK') return <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">{v}</span>
  if (v === 'No' || v === 'Down') return <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">{v}</span>
  if (v === 'Warning') return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Needs a look</span>
  return typeof v === 'number' ? v.toLocaleString() : String(v)
}

// ---------- PDF (print to PDF) and JPEG, made in the browser ----------

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function printReport(data, charts, w) {
  const s = data.summary
  const cards = s.cards.map((c) => `<div class="card"><b>${esc(c.label)}</b><span>${esc(c.value)}</span><i>${esc(c.note)}</i></div>`).join('')
  const measures = s.measures ? `<h2>All AI measures</h2><table><tr><th>AI part</th><th>Measure</th><th>Value</th><th>Based on</th></tr>${
    s.measures.map((m) => `<tr><td>${esc(m.part)}</td><td>${esc(m.measure)}</td><td>${m.value == null ? 'No data yet' : esc(m.value) + '%'}</td><td>${esc(m.based)}</td></tr>`).join('')}</table>` : ''
  const images = Object.values(charts).filter((c) => c.inst?.canvas)
    .map((c) => `<figure><figcaption>${esc(c.chart.title)}</figcaption><img src="${c.inst.toBase64Image('image/png', 1)}" /></figure>`).join('')
  const short = s.inShort?.length ? `<h2>Key points</h2><ul>${s.inShort.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''
  const detail = (data.detail.tables || [{ title: 'Detail', columns: data.detail.columns, rows: data.detail.rows }]).map((tb) =>
    `<h2>${esc(tb.title === 'Details' ? 'Detail' : tb.title)} (${tb.rows.length} rows)</h2><table><tr><th>#</th>${tb.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>${
      tb.rows.map((r, i) => `<tr><td>${i + 1}</td>${tb.columns.map((c) => `<td>${esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</table>`).join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title><style>
    body{font-family:Inter,Arial,sans-serif;color:#111827;margin:24px;font-size:11px}
    h1{font-size:18px;margin:0}h2{font-size:13px;margin:18px 0 6px}
    .meta{margin:4px 0 14px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .card{background:#EE2435;color:#fff;border-radius:8px;padding:8px;display:flex;flex-direction:column;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .card b{font-size:9px;text-transform:uppercase}.card span{font-size:18px;font-weight:700}.card i{font-style:normal;font-size:9px}
    .charts{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0;break-inside:avoid}figcaption{font-weight:700;margin-bottom:4px}
    img{width:100%}table{border-collapse:collapse;width:100%}th{text-align:left;border-bottom:2px solid #EE2435;padding:4px}
    td{border-bottom:1px solid #E5E7EB;padding:4px;vertical-align:top}tr{break-inside:avoid}
  </style></head><body><h1>${esc(data.title)}</h1>
  <p class="meta">${esc(data.scope)} · ${esc(data.period)} · made ${esc(fmtWhen(data.generatedAt))} by ${esc(data.generatedBy)} · Kenya Red Cross Society</p>
  ${short}<div class="cards">${cards}</div>${measures}<h2>Charts</h2><div class="charts">${images || '<p>No chart data.</p>'}</div>${detail}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
}

async function saveJpeg(data, charts) {
  const W = 1400
  const pad = 32
  const s = data.summary
  const list = Object.values(charts).filter((c) => c.inst?.canvas)
  const perRow = 3
  const cardW = (W - pad * 2 - 16 * (perRow - 1)) / perRow
  const cardRows = Math.ceil(s.cards.length / perRow)
  const chartW = (W - pad * 2 - 24) / 2
  const chartH = list.map((c) => (c.inst.canvas.height / c.inst.canvas.width) * chartW + 30)
  let chartsH = 0
  for (let i = 0; i < chartH.length; i += 2) chartsH += Math.max(chartH[i], chartH[i + 1] || 0) + 24
  const H = pad + 70 + cardRows * 96 + 24 + chartsH + pad
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')
  const font = (size, weight = 400) => `${weight} ${size}px ${CHART_FONT.family || 'Arial'}, Arial, sans-serif`
  g.fillStyle = '#fff'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#111827'
  g.font = font(24, 700)
  g.fillText(data.title, pad, pad + 22)
  g.font = font(14)
  g.fillText(`${data.scope} · ${data.period} · made ${fmtWhen(data.generatedAt)} by ${data.generatedBy} · Kenya Red Cross Society`, pad, pad + 44)
  let y = pad + 70
  s.cards.forEach((c, i) => {
    const x = pad + (i % perRow) * (cardW + 16)
    const yy = y + Math.floor(i / perRow) * 96
    g.fillStyle = RED
    g.beginPath()
    g.roundRect ? g.roundRect(x, yy, cardW, 82, 10) : g.rect(x, yy, cardW, 82)
    g.fill()
    g.fillStyle = '#fff'
    g.font = font(12, 700)
    g.fillText(String(c.label).toUpperCase().slice(0, 60), x + 14, yy + 22)
    g.font = font(26, 700)
    g.fillText(String(c.value ?? '—'), x + 14, yy + 54)
    g.font = font(12)
    g.fillText(String(c.note || '').slice(0, 70), x + 14, yy + 73)
  })
  y += cardRows * 96 + 24
  for (let i = 0; i < list.length; i += 2) {
    const rowH = Math.max(chartH[i], chartH[i + 1] || 0)
    ;[list[i], list[i + 1]].forEach((c, j) => {
      if (!c) return
      const x = pad + j * (chartW + 24)
      g.fillStyle = '#111827'
      g.font = font(15, 700)
      g.fillText(c.chart.title, x, y + 16)
      g.drawImage(c.inst.canvas, x, y + 26, chartW, chartH[i + j] - 30)
    })
    y += rowH + 24
  }
  const url = cv.toDataURL('image/jpeg', 0.92)
  const link = document.createElement('a')
  link.href = url
  link.download = `${data.title.replace(/\s+/g, '_')}_${data.from}_${data.to}.jpg`
  document.body.appendChild(link)
  link.click()
  link.remove()
}
