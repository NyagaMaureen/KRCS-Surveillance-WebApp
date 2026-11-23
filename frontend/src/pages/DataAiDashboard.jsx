import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Gauge, Sparkles, Plug, CircleDashed, RefreshCw, Users, KeyRound, ClipboardList, Lock, Wand2, BookOpen, Radar, HardDrive,
  ArrowRight, Activity, Database, AlertTriangle, LogIn, Download, Clock,
  RotateCcw, ListChecks, Cpu,
} from 'lucide-react'
import '../charts/chartSetup'
import AppShell from '../components/layout/AppShell'
import DownloadMenu from '../components/dashboard/DownloadMenu'
import { Chart } from './MonitoringReports'
import { downloadPanel, downloadTabPng, printTab, downloadTabExcel } from '../components/dashboard/dashExport'
import { useCapabilities } from '../context/CapabilitiesContext'
import { getAdminOverview, getAdminTab, getAdminModels, currentUserFullName } from '../api/frappe'

// Data & AI Admin dashboard (KRCS 18 Nov 2026): the Data & AI Admin and ICT Admin designs as one workspace.
// Tabs like the admin dashboard, with its period and From/To filter and its downloads (each panel as PNG; the
// whole tab as PNG, PDF or Excel). Only what the system records; no disease figures, cases or patients.
// Data: surveillance.system_admin (the tabs reuse Monitoring Reports R38, R40, R40b and R37).

const TITLE = 'Data & AI Admin Dashboard'
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const SELECT = `h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 ${FOCUS}`
const BTN_SMALL = `inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`
const TABS = [
  { key: 'overview', label: 'Overview', icon: Gauge },
  { key: 'ai', label: 'AI Performance', icon: Sparkles, filters: true },
  { key: 'integrations', label: 'Integrations & System Health', icon: Plug, filters: true },
  { key: 'quality', label: 'Data Quality', icon: CircleDashed, filters: true },
]
// same periods as the admin dashboard; a period fills in the dates, changing a date makes it "Custom"
const PERIODS = [['4w', 'Last 4 weeks', 28], ['8w', 'Last 8 weeks', 56], ['12w', 'Last 12 weeks', 84], ['6m', 'Last 6 months', 182], ['12m', 'Last 12 months', 364]]
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => isoDay(new Date())
const datesFor = (period) => {
  const days = (PERIODS.find((p) => p[0] === period) || PERIODS[0])[2]
  const from = new Date()
  from.setDate(from.getDate() - (days - 1))
  return { from: isoDay(from), to: today() }
}
const blank = () => ({ period: '4w', ...datesFor('4w') })
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const periodText = (f) => (f.period === 'custom' ? `${fmtDay(f.from)} to ${fmtDay(f.to)}` : (PERIODS.find((p) => p[0] === f.period) || PERIODS[0])[1])

const CARD_ICONS = { users: LogIn, integrations: Plug, ai: Sparkles, errors: AlertTriangle, database: Database }
const STATUS = { OK: 'bg-green-50 text-green-800', Warning: 'bg-amber-50 text-amber-800', Down: 'bg-red-50 text-red-800', 'Not set up': 'bg-gray-100 text-gray-700' }
const STATUS_LABEL = { Warning: 'Needs a look' }

// what a tab's downloads collect: its panels (charts and tables) and its cards
const ExportCtx = createContext(null)

function when(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T'))
  if (isNaN(d)) return v
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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

// loads when the inputs change; until then the tab shows its loading state
function useLoad(fn, deps) {
  const key = JSON.stringify(deps)
  const [state, setState] = useState({ key: null, data: null, error: '' })
  useEffect(() => {
    let live = true
    fn().then((data) => live && setState({ key, data, error: '' }))
      .catch((e) => live && setState({ key, data: null, error: e.message || 'Could not load this tab.' }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? state : { data: null, error: '' }
}

export default function DataAiDashboard() {
  const [params, setParams] = useSearchParams()
  const { primaryRole } = useCapabilities()
  const tab = TABS.find((t) => t.key === params.get('tab')) || TABS[0]
  const [filters, setFilters] = useState(blank)
  const [stamp, setStamp] = useState(0)
  const [busy, setBusy] = useState('')
  const [updated, setUpdated] = useState(() => new Date())
  const pick = (key) => setParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', key); return next })
  const set = (k, v) => setFilters((f) => {
    if (k === 'period') return v === 'custom' ? { ...f, period: v } : { period: v, ...datesFor(v) }
    return { ...f, [k]: v, period: 'custom' }
  })
  const changed = filters.period !== '4w'
  const range = { from: filters.from, to: filters.to }

  // downloads: who downloaded, when, and with which filters
  const panels = useRef(new Map())
  const cards = useRef(new Map())
  const meta = () => ({
    dashboard: TITLE, tab: tab.label, user: currentUserFullName(), role: primaryRole,
    filters: tab.filters ? `${periodText(filters)} (${fmtDay(filters.from)} to ${fmtDay(filters.to)})` : 'Now (last 24 hours and last 7 days)',
  })
  const metaRef = useRef(meta)
  useEffect(() => { metaRef.current = meta })
  const ctx = useMemo(() => ({ panels, cards, meta: () => metaRef.current() }), [])
  async function exportTab(kind) {
    const list = [...panels.current.values()].filter((e) => e.node.current)
    const allCards = [...cards.current.values()].flat()
    const win = kind === 'pdf' ? window.open('', '_blank') : null
    setBusy(kind)
    try {
      if (kind === 'png') await downloadTabPng(list, allCards, meta())
      else if (kind === 'pdf') { if (win) printTab(win, list, allCards, meta()) }
      else await downloadTabExcel(list, allCards, meta())
    } catch (e) {
      if (win) win.close()
      window.alert(e.message || 'The download did not work. Please try again.')
    } finally {
      setBusy('')
    }
  }

  return (
    <AppShell>
      <div className="mb-5 border-l-4 border-red-600 pl-3">
        <h2 className="text-xl font-bold text-gray-900">{TITLE}</h2>
        <p className="text-sm text-gray-900">AI performance, integrations, system health, data quality and administration</p>
      </div>

      <div className="mb-6 overflow-x-auto rounded-xl bg-gray-50 px-4 py-4">
        <div role="tablist" className="relative flex min-w-[560px] items-start justify-between">
          <div className="absolute left-8 right-8 top-6 h-px bg-gray-300" aria-hidden="true" />
          {TABS.map((t) => {
            const on = t.key === tab.key
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => pick(t.key)}
                className={`relative z-10 flex w-36 flex-col items-center gap-2 rounded-lg ${FOCUS}`}>
                <span className={['flex h-12 w-12 items-center justify-center rounded-full transition-colors',
                  on ? 'bg-red-600 text-white ring-4 ring-red-100' : 'bg-gray-800 text-white hover:bg-gray-900'].join(' ')}>
                  <t.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className={`text-center text-xs ${on ? 'font-bold' : 'font-semibold'} text-gray-900`}>{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-bold text-gray-900">
          {tab.label}{tab.filters && <span className="font-normal"> · {periodText(filters)}</span>}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <DownloadMenu onPick={exportTab} busy={busy} />
          <button type="button" onClick={() => { setStamp((s) => s + 1); setUpdated(new Date()) }} className={BTN_SMALL}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh now
          </button>
          <span className="inline-flex items-center gap-1 text-xs text-gray-900">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Last updated {updated.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {tab.filters && (
        <div className="mb-5 flex flex-wrap items-end justify-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
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
          {changed && (
            <button type="button" onClick={() => setFilters(blank())} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50 ${FOCUS}`}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      )}

      <ExportCtx.Provider value={ctx}>
        {tab.key === 'overview' && <OverviewTab stamp={stamp} />}
        {tab.key === 'ai' && <AiTab range={range} stamp={stamp} />}
        {tab.key === 'integrations' && <IntegrationsTab range={range} stamp={stamp} />}
        {tab.key === 'quality' && <ReportTab report="R37" range={range} stamp={stamp} link={{ to: '/data-quality', label: 'Open Data Quality to check each issue' }} />}
      </ExportCtx.Provider>
    </AppShell>
  )
}

function Field({ label, children }) {
  return <label className="flex flex-col gap-1 text-xs font-semibold text-gray-900">{label}{children}</label>
}

// ---------- shared pieces ----------

/** A chart or table that the tab downloads include; it also downloads on its own as PNG. */
function Panel({ title, icon: Icon = Activity, note, action, children, wide = false }) {
  const exp = useContext(ExportCtx)
  const node = useRef(null)
  useEffect(() => {
    if (!exp) return undefined
    const list = exp.panels.current
    list.set(title, { title, note, wide, node })
    return () => { list.delete(title) }
  }, [exp, title, note, wide])
  return (
    <section ref={node} className={`min-w-0 rounded-xl border border-gray-200 bg-white p-5 ${wide ? 'xl:col-span-2' : ''}`}>
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
      {children}
    </section>
  )
}

function RedCards({ group, cards }) {
  const exp = useContext(ExportCtx)
  useEffect(() => {
    if (!exp) return undefined
    const all = exp.cards.current
    all.set(group, cards)   // the tab's PNG, PDF and Excel include the cards
    return () => { all.delete(group) }
  }, [exp, group, cards])
  return (
    <div className={`mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${cards.length >= 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
      {cards.map((c) => {
        const Icon = CARD_ICONS[c.key] || Activity
        return (
          <div key={c.key} className="relative overflow-hidden rounded-xl bg-red-600 p-4 text-center text-white">
            <p className="px-7 text-[11px] font-bold uppercase tracking-wide">{c.label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{typeof c.value === 'number' ? c.value.toLocaleString() : c.value}</p>
            {c.note && <p className="mt-0.5 text-xs">{c.note}</p>}
            <Icon className="absolute right-3 top-3 h-5 w-5 text-white/50" aria-hidden="true" />
          </div>
        )
      })}
    </div>
  )
}

// ---------- Overview ----------

const ACTIONS = [
  { key: 'users', label: 'Users', text: 'Add, edit and switch off user accounts', icon: Users, to: '/user-management?tab=users', cap: 'view_users', count: (c) => `${c.users} active` },
  { key: 'roles', label: 'Roles & Permissions', text: 'What each role can see and do', icon: KeyRound, to: '/user-management?tab=roles', cap: 'view_users', count: (c) => `${c.roles} roles` },
  { key: 'audit', label: 'Audit Log', text: 'Every change, who made it and when', icon: ClipboardList, to: '/audit-log', cap: 'view_audit_log' },
  { key: 'security', label: 'Security Settings', text: 'Password rules, sign-in limits, open sessions', icon: Lock, to: '/settings?tab=security', cap: 'settings_security', count: (c) => `${c.sessions} open sessions` },
  { key: 'risk', label: 'AI Risk Engine', text: 'Risk score weights and red-flag symptoms', icon: Wand2, to: '/settings?tab=ai-config', cap: 'settings_ai_config' },
  { key: 'kb', label: 'AI Knowledge Base', text: 'Documents the Data Assistant answers from', icon: BookOpen, to: '/knowledge-base', cap: ['view_knowledge_base', 'manage_knowledge_base', 'approve_knowledge_base'], count: (c) => `${c.kb} documents` },
  { key: 'channels', label: 'Reporting Channels', text: 'Mobile, WhatsApp, CBS and MOH 505 loads', icon: Radar, to: '/channels', cap: 'view_reporting_channels' },
  { key: 'data', label: 'Data and Database', text: 'Database size, background jobs and backups', icon: HardDrive, to: '/settings?tab=data', cap: 'settings_data' },
]

function OverviewTab({ stamp }) {
  const { has } = useCapabilities()
  const { data, error } = useLoad(getAdminOverview, [stamp])
  if (!data) return <Loading error={error} />
  const actions = ACTIONS.filter((a) => has(a.cap))
  return (
    <>
      <RedCards group="overview" cards={data.cards} />
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
        <h4 className="mb-4 text-sm font-bold text-gray-900">Quick actions</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {actions.map((a) => (
            <Link key={a.key} to={a.to} className={`group flex gap-3 rounded-xl border border-gray-200 p-4 hover:border-red-200 hover:bg-red-50/40 ${FOCUS}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600"><a.icon className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">{a.label}
                  <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-red-600" aria-hidden="true" /></span>
                <span className="block text-xs text-gray-600">{a.text}</span>
                {a.count && <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">{a.count(data.counts)}</span>}
              </span>
            </Link>
          ))}
        </div>
      </section>
      <Panel title="Recent admin activity" icon={ClipboardList} wide
        action={has('view_audit_log') && <Link to="/audit-log" className={`text-xs font-semibold text-red-700 hover:underline ${FOCUS}`}>Open the Audit Log</Link>}>
        {!data.activity.length ? <p className="p-8 text-center text-sm text-gray-600">No admin changes yet.</p> : (
          <table className="red-head w-full border-collapse text-sm">
            <thead><tr className="text-left text-xs"><th className="px-3 py-2">Change</th><th className="px-3 py-2">What</th><th className="px-3 py-2">By</th><th className="px-3 py-2">When</th></tr></thead>
            <tbody>
              {data.activity.map((a, i) => (
                <tr key={i} className="align-top">
                  <td className="px-3 py-2.5 font-semibold text-gray-900">{a.what}</td>
                  <td className="px-3 py-2.5 text-gray-900">{a.item}</td>
                  <td className="px-3 py-2.5 text-gray-900">{a.by}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-gray-900">{when(a.on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  )
}

// ---------- tabs built from Monitoring Reports ----------

const CHART_ICONS = { hbar: ListChecks, bar: Activity, line: Activity, doughnut: Activity }

function ReportTab({ report, range, stamp, link, children }) {
  const charts = useRef({})
  const { data, error } = useLoad(() => getAdminTab(report, range.from, range.to), [report, range.from, range.to, stamp])
  if (!data) return <Loading error={error} />
  const s = data.summary
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-gray-900">{data.title}</h4>
          <p className="text-xs text-gray-600">{data.description} · {data.period}</p>
        </div>
        {link && <Link to={link.to} className={`text-xs font-semibold text-red-700 hover:underline ${FOCUS}`}>{link.label}</Link>}
      </div>
      {s.inShort?.length > 0 && (
        <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
          <h4 className="text-sm font-bold text-gray-900">Key points</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-900">{s.inShort.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
      )}
      <RedCards group={report} cards={s.cards} />
      <div className="grid gap-5 xl:grid-cols-2">
        {children && children(data)}
        {s.charts.map((c) => (
          <Panel key={c.key} title={c.title} note={c.note} icon={CHART_ICONS[c.type]}>
            <div className="relative" style={{ height: c.type === 'hbar' ? Math.max(240, c.labels.length * 34) : 260 }}>
              <Chart chart={c} onRef={(inst) => { if (inst) charts.current[c.key] = inst; else delete charts.current[c.key] }} />
            </div>
          </Panel>
        ))}
        {s.measures && (
          <Panel title="All AI measures" icon={Sparkles} wide>
            <div className="overflow-x-auto">
              <table className="red-head w-full border-collapse text-sm">
                <thead><tr className="text-left text-xs">
                  <th className="px-3 py-2">AI part</th><th className="px-3 py-2">Measure</th><th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2">Based on</th>
                </tr></thead>
                <tbody>
                  {s.measures.map((m) => (
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
          </Panel>
        )}
      </div>
    </section>
  )
}

function AiTab({ range, stamp }) {
  const { data } = useLoad(() => getAdminModels(range.from, range.to), [range.from, range.to, stamp])
  return (
    <>
      <div className="mb-8 grid gap-5 xl:grid-cols-2">
        <Panel title="Models in use" icon={Cpu} wide
          note={`Each model's latest measures from MLflow, and how often the disease classifier was used${data ? ` · ${data.period}` : ''}`}>
          {!data ? <div className="h-20 animate-pulse rounded-lg bg-gray-100" /> : !data.models.length ? (
            <p className="p-8 text-center text-sm text-gray-600">No model measures yet. They appear when the AI server sends them.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="red-head w-full border-collapse text-sm">
                <thead><tr className="text-left text-xs">
                  <th className="px-3 py-2">Model</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Latest measures</th>
                  <th className="px-3 py-2">Used in the period</th><th className="px-3 py-2">Last updated</th>
                </tr></thead>
                <tbody>
                  {data.models.map((m) => (
                    <tr key={m.model} className="align-top">
                      <td className="px-3 py-2.5 font-semibold text-gray-900">{m.model}<span className="block text-[11px] font-normal text-gray-600">{m.source}</span></td>
                      <td className="px-3 py-2.5 text-gray-900">{m.version || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-900">
                        {m.measures.length ? m.measures.map((x) => `${x.metric} ${x.value}`).join(' · ') : '—'}
                        {m.more > 0 && <span className="block text-[11px] text-gray-600">{m.more} more measures in MLflow</span>}
                        {m.note && <span className="block text-xs text-amber-800">{m.note}</span>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-gray-900">{m.used == null ? '—' : `${m.used.toLocaleString()} predictions`}</td>
                      <td className="px-3 py-2.5 text-gray-900">{when(m.lastUsed || m.updated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <ReportTab report="R38" range={range} stamp={stamp} link={{ to: '/monitoring-reports?report=R38', label: 'Open the full AI Performance report' }} />
    </>
  )
}

function IntegrationTable({ table }) {
  return (
    <Panel title="Each integration" icon={Plug} wide>
      <div className="overflow-x-auto">
        <table className="red-head w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs">
            <th className="px-3 py-2">Integration</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Last data received</th>
            <th className="px-3 py-2">Errors</th><th className="px-3 py-2">What it means</th>
          </tr></thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.integration} className="align-top">
                <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-gray-900">{r.integration}</td>
                <td className="px-3 py-2.5"><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[r.status] || STATUS['Not set up']}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-gray-900">{r.lastData}</td>
                <td className="px-3 py-2.5 tabular-nums text-gray-900">{r.errors}</td>
                <td className="px-3 py-2.5 text-xs text-gray-900">{r.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function IntegrationsTab({ range, stamp }) {
  return (
    <>
      <ReportTab report="R40" range={range} stamp={stamp} link={{ to: '/channels', label: 'Open Reporting Channels' }}>
        {(data) => data.table && <IntegrationTable table={data.table} />}
      </ReportTab>
      <ReportTab report="R40b" range={range} stamp={stamp} />
    </>
  )
}

