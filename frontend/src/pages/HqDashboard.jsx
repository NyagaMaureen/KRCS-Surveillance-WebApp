import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Gauge, ShieldCheck, TrendingUp, Activity, Map as MapIcon, RefreshCw, Clock, RotateCcw,
  Radio, CheckCheck, ArrowUpRight, Hourglass, Wifi, Search, Footprints, ArrowRightLeft, ListChecks,
  Users, UserRound, UserCheck, MessageCircle, Smartphone, Bot, Percent, Sparkles,
  Download,
} from 'lucide-react'
import { DashExportContext, downloadPanel, downloadTabPng, printTab, downloadTabExcel } from '../components/dashboard/dashExport'
import '../charts/chartSetup'
import { CHART_FONT } from '../charts/chartSetup'
import AppShell from '../components/layout/AppShell'
import Embedded from '../components/layout/Embedded'
import DownloadMenu from '../components/dashboard/DownloadMenu'
import EpiTrends from './EpiTrends'
import SurveillanceMap from './SurveillanceMap'
import { useCapabilities } from '../context/CapabilitiesContext'
import { getHqGlance, getHqSurveillance, getHqPerformance, getHqStatus, getHqFilterOptions, currentUserFullName } from '../api/frappe'

// System Administrator dashboard (KRCS Dashboard re-organization, 13 Nov 2026): five tabs, each with cards and charts.
// Layout from the design Elizabeth shared; colours are the app's (red cards, red and navy charts).
// Data: surveillance.hq_dashboard

const RED = '#EE2435'
const NAVY = '#011E41'
const GREY = '#9CA3AF'
const AMBER = '#D97706'
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const SELECT = `h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 ${FOCUS}`

// requires: the permission that opens the tab; hq: KRCS Admin and other HQ users only (not sub-county dashboards)
const TABS = [
  { key: 'glance', label: 'At a Glance', icon: Gauge, filters: true },
  { key: 'surveillance', label: 'Surveillance & Response', icon: ShieldCheck, filters: true, category: true },
  { key: 'epi', label: 'Epidemiological Trends', icon: TrendingUp, requires: 'view_alerts' },
  { key: 'performance', label: 'System Performance', icon: Activity, filters: true, requires: 'view_analytics', hq: true },
  { key: 'maps', label: 'Maps', icon: MapIcon, requires: 'view_surveillance_map' },
]
// dashboard title per workspace; officers, FHWs and CHAs see their assigned sub-county only
const MOH_TITLE = 'County MOH Dashboard'
const NATIONAL_TITLE = 'National MOH Overview'   // MOH DDSR (National): every county, overview only (KRCS 23 Nov 2026)
const TITLES = { full: 'KRCS Admin Dashboard', officer: 'Surveillance Officer Dashboard', fhw: 'Facility Health Worker Dashboard', cha: 'CHA Dashboard' }

const CARD_ICONS = {
  signals: Radio, closed: CheckCheck, escalated: ArrowUpRight, pending: Hourglass, channels: Wifi,
  submitted: Radio, investigating: Search, followups: Footprints, referrals: ArrowRightLeft, responses: ListChecks,
  users: Users, chps: UserRound, chas: UserCheck, whatsapp: MessageCircle, mobile: Smartphone, questions: Bot, answer_rate: Percent,
}

const tick = { color: '#111827', font: { family: CHART_FONT.family, size: 11 } }
const grid = { color: '#F3F4F6' }
const tooltip = { titleFont: { family: CHART_FONT.family }, bodyFont: { family: CHART_FONT.family } }
const barOpts = (horizontal = false, extra = {}) => ({
  responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { display: false }, tooltip },
  scales: {
    x: { grid: horizontal ? grid : { display: false }, ticks: { ...tick, precision: 0 }, beginAtZero: true },
    y: { grid: horizontal ? { display: false } : grid, ticks: { ...tick, precision: 0 }, beginAtZero: true },
  },
  ...extra,
})
const legendBottom = { position: 'bottom', labels: { ...tick, boxWidth: 10, boxHeight: 10 } }

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
// period as on Epi Trends: last N weeks up to today
const PERIODS = [['4w', 'Last 4 weeks', 28], ['8w', 'Last 8 weeks', 56], ['12w', 'Last 12 weeks', 84], ['6m', 'Last 6 months', 182], ['12m', 'Last 12 months', 364]]
// Period and From/To side by side (KRCS, 17 Nov 2026): a period fills in the dates; changing a date makes it "Custom"
const datesFor = (period) => {
  const days = (PERIODS.find((p) => p[0] === period) || PERIODS[0])[2]
  return { from: daysAgo(days - 1), to: today() }
}
const blankFilters = () => ({ region: '', subCounty: '', period: '4w', ...datesFor('4w'), channel: '', status: '', category: '' })
const EMPTY_FILTERS = blankFilters()
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const periodText = (f) => (f.period === 'custom' ? `${fmtDay(f.from)} to ${fmtDay(f.to)}` : (PERIODS.find((p) => p[0] === f.period) || PERIODS[0])[1])
const BTN_SMALL = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50'

function ago(v) {
  if (!v) return 'never'
  const t = new Date(String(v).replace(' ', 'T')).getTime()
  if (isNaN(t)) return '—'
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export default function HqDashboard() {
  const [params, setParams] = useSearchParams()
  const { has: can, workspace, primaryRole } = useCapabilities()
  const isMoh = primaryRole === 'County MOH / PHEOC'   // county MOH: their region only, no System Performance (KRCS 17 Nov 2026)
  const isNational = primaryRole === 'MOH DDSR (National)'
  const scoped = workspace !== 'full' || isMoh || isNational   // no System Performance tab
  const tabs = TABS.filter((t) => (!t.requires || can(t.requires)) && !(t.hq && scoped))
  const tab = tabs.find((t) => t.key === params.get('tab')) || tabs[0]
  const [filters, setFilters] = useState(blankFilters)
  // what the server gets: the from / to dates (the period only fills them in)
  const query = useMemo(() => {
    const rest = { ...filters }
    delete rest.period
    return rest
  }, [filters])
  const [options, setOptions] = useState(null)
  const [status, setStatus] = useState(null)
  const [stamp, setStamp] = useState(0)   // bumps on Refresh now

  useEffect(() => { getHqFilterOptions().then(setOptions).catch(() => setOptions(null)) }, [])
  useEffect(() => { getHqStatus().then(setStatus).catch(() => setStatus(null)) }, [stamp])

  function pickTab(key) {
    setParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', key); return next })
  }
  const set = (k, v) => setFilters((f) => {
    if (k === 'period') return v === 'custom' ? { ...f, period: v } : { ...f, period: v, ...datesFor(v) }
    if (k === 'from' || k === 'to') return { ...f, [k]: v, period: 'custom' }
    return { ...f, [k]: v, ...(k === 'region' ? { subCounty: '' } : {}) }
  })
  const changed = Object.entries(filters).some(([k, v]) => (k === 'period' ? v !== EMPTY_FILTERS.period : k === 'from' || k === 'to' ? false : v))

  // downloads: what was on screen, who downloaded it and with which filters
  const panels = useRef(new Map())
  const cards = useRef([])
  const [busy, setBusy] = useState('')
  const metaRef = useRef(null)
  const buildMeta = () => {
    const regionLabel = options?.regions?.find((r) => r.value === filters.region)?.label
    const channelLabel = options?.channels?.find((c) => c.value === filters.channel)?.label
    const statusLabel = options?.statuses?.find((s) => s.value === filters.status)?.label
    const picked = filters.subCounty || (options?.pickSubCounty ? options.subCounties?.[0]?.label : '')   // an officer with several sub-counties sees one at a time
    const where = options?.lockedSubCounty ? `${options.lockedSubCounty} sub-county` : picked ? `${picked} sub-county` : regionLabel || 'All regions'
    const text = [`${periodText(filters)} (${fmtDay(filters.from)} to ${fmtDay(filters.to)})`, where, channelLabel || 'All channels',
      statusLabel || 'All statuses', tab.category && filters.category ? filters.category : null].filter(Boolean).join(' · ')
    return { dashboard: isMoh ? MOH_TITLE : isNational ? NATIONAL_TITLE : TITLES[workspace] || TITLES.full, tab: tab.label, filters: text, user: currentUserFullName(), role: primaryRole }
  }
  useEffect(() => { metaRef.current = buildMeta })
  const exportCtx = useMemo(() => ({ panels, setCards: (list) => { cards.current = list }, meta: () => metaRef.current() }), [])
  async function exportTab(kind) {
    const list = [...panels.current.values()].filter((e) => e.node.current)
    const win = kind === 'pdf' ? window.open('', '_blank') : null
    setBusy(kind)
    try {
      if (kind === 'png') await downloadTabPng(list, cards.current, buildMeta())
      else if (kind === 'pdf') { if (win) printTab(win, list, cards.current, buildMeta()) }
      else await downloadTabExcel(list, cards.current, buildMeta())
    } catch (e) {
      if (win) win.close()
      window.alert(e.message || 'The download did not work. Please try again.')
    } finally {
      setBusy('')
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="border-l-4 border-red-600 pl-3">
          <h2 className="text-xl font-bold text-gray-900">{isMoh ? MOH_TITLE : isNational ? NATIONAL_TITLE : TITLES[workspace] || TITLES.full}</h2>
          <p className="text-sm text-gray-900">
            {options?.lockedSubCounty ? `${options.lockedSubCounty} sub-county at a glance`
              : options?.pickSubCounty ? `${options.subCounties.map((x) => x.label).join(' and ')} sub-counties at a glance`
              : isMoh ? `${options?.regions?.length === 1 ? `${options.regions[0].label} region` : 'Your region'} at a glance`
              : isNational ? 'Every region at a glance. Filter by region or sub-county.'
                : 'Surveillance and system performance at a glance'}
          </p>
        </div>
      </div>

      {/* tabs: round icons on a line, as in the design */}
      <div className="mb-6 overflow-x-auto rounded-xl bg-gray-50 px-4 py-4">
        <div role="tablist" className="relative flex min-w-[640px] items-start justify-between">
          <div className="absolute left-8 right-8 top-6 h-px bg-gray-300" aria-hidden="true" />
          {tabs.map((t) => {
            const on = t.key === tab.key
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => pickTab(t.key)}
                className={`relative z-10 flex w-32 flex-col items-center gap-2 rounded-lg ${FOCUS}`}>
                <span className={['flex h-12 w-12 items-center justify-center rounded-full transition-colors',
                  on ? 'bg-red-600 text-white ring-4 ring-red-100' : 'bg-gray-800 text-white hover:bg-gray-900'].join(' ')}>
                  <t.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className={`text-center text-xs ${on ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`}>{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-bold text-gray-900">
          {tab.label}
          {tab.filters && <span className="font-normal"> · {periodText(filters)}{options?.lockedSubCounty ? ` · ${options.lockedSubCounty}` : ''}</span>}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setStamp((s) => s + 1)}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh now
          </button>
          <span className="inline-flex items-center gap-1 text-xs text-gray-900">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Last updated {status ? new Date(status.now.replace(' ', 'T')).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '…'}
          </span>
        </div>
      </div>
      {tab.filters && (
        <FilterBar filters={filters} set={set} options={options} category={tab.category} changed={changed}
          clear={() => setFilters(blankFilters())} download={<DownloadMenu onPick={exportTab} busy={busy} />} />
      )}

      <DashExportContext.Provider value={exportCtx}>
        {tab.key === 'glance' && <GlanceTab filters={query} stamp={stamp} />}
        {tab.key === 'surveillance' && <SurveillanceTab filters={query} stamp={stamp} />}
        {tab.key === 'performance' && <PerformanceTab filters={query} stamp={stamp} />}
      </DashExportContext.Provider>
      {tab.key === 'epi' && <Embedded><EpiTrends key={stamp} /></Embedded>}
      {tab.key === 'maps' && <Embedded><SurveillanceMap key={stamp} /></Embedded>}

      {/* data sync under the charts (KRCS, 16 Nov 2026) */}
      <SyncStatus status={status} />
    </AppShell>
  )
}

// ---------- shared pieces ----------

function SyncStatus({ status }) {
  if (!status) return null
  // when data last came in from each source
  const chips = status.sources.map((s) => {
    if (s.key === 'moh505') return s.week ? `MOH 505: latest week ${s.week}, loaded ${ago(s.last)}` : 'MOH 505: no weeks loaded yet'
    return s.last ? `${s.label}: latest ${ago(s.last)}` : `${s.label}: nothing received yet`
  })
  if (status.mobile) chips.push(`Mobile app: ${status.mobile.waiting ? `${status.mobile.waiting} report${status.mobile.waiting === 1 ? '' : 's'} still on phones, not sent yet` : 'all reports sent'}${status.mobile.failed ? `, ${status.mobile.failed} failed` : ''}`)
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4 text-xs text-gray-900">
      <span className="font-semibold">Last data received:</span>
      {chips.map((c) => <span key={c} className="rounded-full border border-gray-200 bg-white px-2.5 py-1">{c}</span>)}
    </div>
  )
}

function FilterBar({ filters, set, options, category, changed, clear, download }) {
  const subs = (options?.subCounties || []).filter((s) => !filters.region || s.region === filters.region)
  return (
    <div className="mb-5 flex flex-wrap items-end justify-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
      {!options?.lockedRegion && !options?.pickSubCounty && (options?.regions?.length || 0) > 1 && (
        <Field label="Region">
          <select className={SELECT} value={filters.region} onChange={(e) => set('region', e.target.value)}>
            <option value="">National (all)</option>
            {options.regions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>
      )}
      {options?.lockedSubCounty ? (
        <Field label="Sub-county">
          <span className="flex h-9 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900">{options.lockedSubCounty}</span>
        </Field>
      ) : (
      <Field label="Sub-county">
        <select className={SELECT} value={options?.pickSubCounty ? (filters.subCounty || subs[0]?.value || '') : filters.subCounty} onChange={(e) => set('subCounty', e.target.value)}>
          {!options?.pickSubCounty && <option value="">All sub-counties</option>}
          {subs.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      )}
      <Field label="Period">
        <select className={SELECT} value={filters.period} onChange={(e) => set('period', e.target.value)}>
          {PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          <option value="custom">Custom dates</option>
        </select>
      </Field>
      <Field label="From">
        <input type="date" className={SELECT} value={filters.from} max={filters.to} onChange={(e) => e.target.value && set('from', e.target.value)} />
      </Field>
      <Field label="To">
        <input type="date" className={SELECT} value={filters.to} min={filters.from} max={today()} onChange={(e) => e.target.value && set('to', e.target.value)} />
      </Field>
      <Field label="Channel">
        <select className={SELECT} value={filters.channel} onChange={(e) => set('channel', e.target.value)}>
          <option value="">All channels</option>
          {(options?.channels || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select className={SELECT} value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          {(options?.statuses || []).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      {/* one Download button next to Status: PNG, PDF or Excel (KRCS 23 Nov 2026) */}
      {download && <Field label="Download this tab">{download}</Field>}
      {category && (
        <Field label="Human or animal">
          <select className={SELECT} value={filters.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">Both</option><option value="Human">Human</option><option value="Animal">Animal</option>
          </select>
        </Field>
      )}
      {changed && (
        <button type="button" onClick={clear} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50 ${FOCUS}`}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Clear filters
        </button>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return <label className="flex flex-col gap-1 text-xs font-semibold text-gray-900">{label}{children}</label>
}

function useTabData(fetcher, filters, stamp, extra = '') {
  // one result per request key; a new key (filters, Refresh now, disease) shows loading until its answer arrives
  const key = `${JSON.stringify(filters)}|${stamp}|${extra}`
  const [result, setResult] = useState({ key: null, data: null, error: '' })
  useEffect(() => {
    let live = true
    fetcher(filters)
      .then((data) => live && setResult({ key, data, error: '' }))
      .catch((e) => live && setResult({ key, data: null, error: e.message || 'Could not load this tab' }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return result.key === key ? result : { data: null, error: '' }
}

function Cards({ cards }) {
  const exp = useContext(DashExportContext)
  useEffect(() => {
    if (!exp) return undefined
    exp.setCards(cards)   // the tab's PNG, PDF and Excel include the cards
    return () => exp.setCards([])
  }, [exp, cards])
  return (
    <div className={`mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${cards.length === 5 ? 'xl:grid-cols-5' : ''}`}>
      {cards.map((c) => {
        const Icon = CARD_ICONS[c.key] || Sparkles
        return (
          <div key={c.key} className="relative overflow-hidden rounded-xl bg-red-600 p-4 text-center text-white">
            <p className="px-7 text-[11px] font-bold uppercase tracking-wide">{c.label}</p>
            <p className="mt-1 text-3xl font-bold">{typeof c.value === 'number' ? c.value.toLocaleString() : c.value}</p>
            {c.note && <p className="mt-0.5 text-xs">{c.note}</p>}
            <Icon className="absolute right-3 top-3 h-5 w-5 text-white/50" aria-hidden="true" />
          </div>
        )
      })}
    </div>
  )
}

function Panel({ title, icon: Icon = TrendingUp, note, action, children, height = 'h-72', className = '' }) {
  const exp = useContext(DashExportContext)
  const node = useRef(null)
  const wide = className.includes('col-span-2')
  useEffect(() => {
    if (!exp) return undefined
    const list = exp.panels.current
    list.set(title, { title, note, wide, node })
    return () => { list.delete(title) }
  }, [exp, title, note, wide])
  return (
    <section ref={node} className={`min-w-0 rounded-xl border border-gray-200 bg-white p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-bold text-gray-900"><Icon className="h-4 w-4 text-red-600" aria-hidden="true" />{title}</h4>
          {note && <p className="mt-0.5 text-xs text-gray-900">{note}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          {exp && (
            <button type="button" title="Download as PNG" aria-label={`Download ${title} as PNG`}
              onClick={() => downloadPanel({ title, note, wide, node }, exp.meta())}
              className={`rounded-lg border border-gray-200 p-1.5 text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {height ? <div className={`relative ${height}`}>{children}</div> : children}
    </section>
  )
}

function Empty({ children = 'No data for these filters.' }) {
  return <div className="flex h-full items-center justify-center px-4 text-center text-sm text-gray-900">{children}</div>
}

// long disease names go on two or three lines so the chart shows them in full
function wrap(label, max = 26) {
  // the axis shows the short name (no brackets): "Suspected Viral Haemorrhagic Fever (Ebola/...)" -> "Suspected Viral
  // Haemorrhagic Fever"; the tooltip shows the full name
  const words = String(label).replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().split(' ')
  const lines = ['']
  words.forEach((w) => {
    const cur = lines[lines.length - 1]
    if (cur && (cur + ' ' + w).length > max) lines.push(w)
    else lines[lines.length - 1] = cur ? `${cur} ${w}` : w
  })
  return lines.length > 1 ? lines : lines[0]
}

const has = (series) => series && series.data && series.data.some((n) => n)

function HBar({ series, color = RED, label = 'Signals', grow = false }) {
  if (!has(series)) return <Empty />
  if (grow) {   // one row per bar, so many diseases never squash together
    return <div className="relative" style={{ height: Math.max(288, series.labels.length * 38) }}><HBar series={series} color={color} label={label} /></div>
  }
  const opts = barOpts(true)
  opts.scales.y.ticks = { ...opts.scales.y.ticks, autoSkip: false }
  return <Bar data={{ labels: series.labels.map((l) => wrap(l)), datasets: [{ label, data: series.data, backgroundColor: color, borderRadius: 3, maxBarThickness: 22 }] }}
    options={{ ...opts, plugins: { ...opts.plugins, tooltip: { ...tooltip, callbacks: { title: (items) => series.labels[items[0].dataIndex] } } } }} />
}

function VBar({ series, color = RED, label = 'Signals' }) {
  if (!has(series)) return <Empty />
  return <Bar data={{ labels: series.labels, datasets: [{ label, data: series.data, backgroundColor: color, borderRadius: 3, maxBarThickness: 44 }] }} options={barOpts(false)} />
}

function Loading({ error }) {
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{error}</div>
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}</div>
      <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
    </div>
  )
}

// ---------- At a Glance ----------

const SEV = { critical: 'bg-red-50 text-red-800', high: 'bg-amber-50 text-amber-800', standard: 'bg-gray-100 text-gray-900' }

function GlanceTab({ filters, stamp }) {
  const { has: can } = useCapabilities()
  const { data, error } = useTabData(getHqGlance, filters, stamp)
  if (!data) return <Loading error={error} />
  const dist = data.distribution
  return (
    <>
      <Cards cards={data.cards} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Top 5 suspected diseases" icon={TrendingUp}><HBar series={data.topDiseases} /></Panel>
        <Panel title="Signals by category" icon={Activity} note="Human or animal">
          {has(data.category) ? (
            <Doughnut data={{ labels: data.category.labels, datasets: [{ data: data.category.data, backgroundColor: [RED, NAVY], borderColor: '#fff', borderWidth: 2 }] }}
              options={{ responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: legendBottom, tooltip } }} />
          ) : <Empty />}
        </Panel>
        <Panel title="Priority events requiring attention" icon={ShieldCheck} note="Open critical and high events, by cluster" height={null} className="xl:col-span-2">
          {data.priorityEvents.length ? (
            <div className="overflow-x-auto">
              <table className="red-head w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs">
                    <th className="w-10 px-3 py-2">#</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Place</th><th className="px-3 py-2">Reports</th>
                    <th className="px-3 py-2">People</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.priorityEvents.map((e, i) => (
                    <tr key={e.id} className="hover:bg-red-50/40">
                      <td className="px-3 py-2 tabular-nums text-gray-900">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{e.title}</td>
                      <td className="px-3 py-2 text-gray-900">{e.place || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{e.reports}</td>
                      <td className="px-3 py-2 text-gray-900">{e.people || '—'}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${SEV[e.severity] || SEV.standard}`}>{e.severity}</span></td>
                      <td className="px-3 py-2 text-gray-900">{e.status}</td>
                      <td className="px-3 py-2 text-right">{can('view_review_queue') && <Link to={`/alerts-signals/${encodeURIComponent(e.id)}`} className={`rounded text-xs font-semibold text-red-700 hover:underline ${FOCUS}`}>Open</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="py-8 text-center text-sm text-gray-900">No open critical or high events.</p>}
        </Panel>
        <Panel title="Signals by signal type" icon={Radio}><VBar series={data.signalType} color={NAVY} /></Panel>
        <Panel title="Suspected disease distribution" icon={Activity} note="All active diseases in the period" height={has(dist) ? null : 'h-72'}>
          <HBar series={plainNames(dist)} color={NAVY} grow />
        </Panel>
      </div>
    </>
  )
}

// "Suspected" is said once, in the chart title, so the labels are plain disease names (KRCS 26 Nov 2026)
function plainNames(series) {
  if (!series?.labels) return series
  return { ...series, labels: series.labels.map((l) => String(l).replace(/^suspected\s+/i, '')) }
}

// ---------- Surveillance & Response ----------

function SurveillanceTab({ filters, stamp }) {
  const [disease, setDisease] = useState('')
  const fetcher = useCallback((f) => getHqSurveillance({ ...f, disease }), [disease])
  const { data, error } = useTabData(fetcher, filters, stamp, disease)
  if (!data) return <Loading error={error} />
  const exp = data.expected
  const pc = data.periodCompare
  const rt = data.responseTime
  return (
    <>
      <Cards cards={data.cards} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="New events per week" icon={TrendingUp}><VBar series={data.newEvents} label="New events" /></Panel>
        <Panel title="Suspected disease distribution" icon={Activity} note="Events that started in the period" height={has(data.eventDiseases) ? null : 'h-72'}>
          <HBar series={plainNames(data.eventDiseases)} color={NAVY} label="Events" grow />
        </Panel>
        <Panel title="Observed vs usual level" icon={TrendingUp} note={exp ? `${exp.diseaseName}: cases each week against the usual level (average of the 8 weeks before)` : ''}
          action={(
            <select aria-label="Disease" className={SELECT} value={disease} onChange={(e) => setDisease(e.target.value)}>
              <option value="">Most reported disease</option>
              {data.diseases.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          )}>
          {exp ? (
            <Line data={{ labels: exp.labels, datasets: [
              { label: 'Observed', data: exp.observed, borderColor: RED, backgroundColor: RED, borderWidth: 2, pointRadius: 3, tension: 0.2 },
              { label: 'Usual level', data: exp.expected, borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, borderDash: [6, 4], pointRadius: 0 },
              { label: 'Outbreak level', data: exp.outbreakLevel, borderColor: AMBER, backgroundColor: AMBER, borderWidth: 2, borderDash: [2, 3], pointRadius: 0 },
            ] }} options={{ ...barOpts(false), interaction: { mode: 'index', intersect: false }, plugins: { legend: legendBottom, tooltip } }} />
          ) : <Empty />}
        </Panel>
        <Panel title="Last 4 weeks vs the 4 weeks before" icon={ArrowRightLeft} note={pc?.currentLabel ? `${pc.currentLabel} against ${pc.previousLabel}` : ''}>
          {pc?.labels?.length ? (
            <Bar data={{ labels: pc.labels.map((l) => wrap(l)), datasets: [
              { label: 'Last 4 weeks', data: pc.current, backgroundColor: RED, borderRadius: 3, maxBarThickness: 16 },
              { label: '4 weeks before', data: pc.previous, backgroundColor: GREY, borderRadius: 3, maxBarThickness: 16 },
            ] }} options={{ ...barOpts(true), plugins: { legend: legendBottom, tooltip } }} />
          ) : <Empty />}
        </Panel>
        <Panel title="Time to start verification" icon={Clock} note="Median hours from an event arriving to verification starting, each week. Target 24 hours." className="xl:col-span-2">
          {rt?.medianHours?.some((h) => h !== null) ? (
            <Bar data={{ labels: rt.labels, datasets: [
              { type: 'bar', label: 'Median hours', data: rt.medianHours, backgroundColor: NAVY, borderRadius: 3, maxBarThickness: 36 },
              { type: 'line', label: 'Target (24 h)', data: rt.labels.map(() => rt.target), borderColor: RED, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 },
            ] }} options={{ ...barOpts(false), plugins: { legend: legendBottom, tooltip } }} />
          ) : <Empty>No events had verification started in this period.</Empty>}
        </Panel>
      </div>
    </>
  )
}

// ---------- System Performance ----------

function PerformanceTab({ filters, stamp }) {
  const { data, error } = useTabData(getHqPerformance, filters, stamp)
  const comp = useMemo(() => data?.completeness?.facilities || [], [data])
  if (!data) return <Loading error={error} />
  return (
    <>
      <Cards cards={data.cards} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="System users by role" icon={Users}><HBar series={data.usersByRole} color={NAVY} label="Users" /></Panel>
        <Panel title="Submissions per reporting channel" icon={Radio}><VBar series={data.channels} label="Submissions" /></Panel>
        <Panel title="Top 5 diseases asked about on the chatbot" icon={Bot} note="Questions that name the disease or one of its other names">
          <HBar series={data.chatbotDiseases} label="Questions" />
        </Panel>
        <Panel title="Top 5 data quality issues" icon={ListChecks}>
          {data.dataQuality ? <HBar series={data.dataQuality} color={NAVY} label="Issues" /> : <Empty>You do not have access to Data Quality.</Empty>}
        </Panel>
        <Panel title="Signals submitted by hour of day" icon={Clock}><VBar series={data.hours} color={NAVY} /></Panel>
        {/* the Monitoring Reports R38 measures for the same period and area; how each is obtained is in that report */}
        <Panel title="AI performance" icon={Sparkles} note="How often each AI part agreed with what people decided" height={null}>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {(data.aiMeasures || []).map((m) => (
              <li key={m.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{m.part}</p>
                  <p className="text-xs text-gray-900">{m.measure}</p>
                  <p className="text-[11px] text-gray-600">{m.based}</p>
                </div>
                {m.value !== null && m.value !== undefined
                  ? <span className="shrink-0 text-lg font-bold text-gray-900">{m.value}%</span>
                  : <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-900">No data yet</span>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="MOH 505 reporting completeness by facility" icon={CheckCheck} height={null} className="xl:col-span-2"
          note={data.completeness?.upTo ? `Weeks reported up to the week of ${new Date(data.completeness.upTo).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${data.completeness.overall !== null ? ` · overall ${data.completeness.overall}%` : ''}` : ''}>
          {comp.length ? (
            <div className="max-h-96 overflow-auto">
              <table className="red-head w-full border-collapse text-sm">
                <thead><tr className="text-left text-xs"><th className="px-3 py-2">Facility</th><th className="px-3 py-2">Sub-county</th><th className="px-3 py-2">Weeks reported</th><th className="w-1/3 px-3 py-2">Completeness</th></tr></thead>
                <tbody>
                  {comp.map((c) => (
                    <tr key={c.facility}>
                      <td className="px-3 py-2 font-medium text-gray-900">{c.facility}</td>
                      <td className="px-3 py-2 text-gray-900">{c.subCounty || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{c.reported} of {c.weeks}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-gray-100"><div className="h-2 rounded-full" style={{ width: `${c.pct}%`, background: c.pct >= 80 ? NAVY : RED }} /></div>
                          <span className="w-10 text-right text-xs font-semibold text-gray-900">{c.pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="py-8 text-center text-sm text-gray-900">No MOH 505 reporting files uploaded yet.</p>}
        </Panel>
      </div>
    </>
  )
}
