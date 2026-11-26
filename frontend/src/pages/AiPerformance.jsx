import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Cpu, ListChecks, BarChart3 } from 'lucide-react'
import '../charts/chartSetup'
import AppShell from '../components/layout/AppShell'
import DownloadMenu from '../components/dashboard/DownloadMenu'
import { Chart } from './MonitoringReports'
import { getAdminTab, getAdminModels, exportCsv } from '../api/frappe'
import { useCapabilities } from '../context/CapabilitiesContext'

// AI Performance (KRCS 26 Nov 2026): System settings menu for the System Administrator (and anyone given View AI
// Performance). How often each AI part agreed with what people decided, and the models in use. Plain tables with grid
// lines, black text and bold labels. Data: system_admin.get_tab('R38') and system_admin.get_models.

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const SELECT = `h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 ${FOCUS}`
const TH = 'border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-900'
const TD = 'border border-gray-200 px-3 py-2.5 align-top text-gray-900'
const PERIODS = [['4w', 'Last 4 weeks', 28], ['8w', 'Last 8 weeks', 56], ['12w', 'Last 12 weeks', 84], ['6m', 'Last 6 months', 182], ['12m', 'Last 12 months', 364]]
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function range(period) {
  const days = (PERIODS.find((p) => p[0] === period) || PERIODS[0])[2]
  const from = new Date()
  from.setDate(from.getDate() - (days - 1))
  return { from: iso(from), to: iso(new Date()) }
}

function when(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T'))
  return isNaN(d) ? v : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Section({ title, icon: Icon, note, children, action }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-900"><Icon className="h-4 w-4 text-red-700" aria-hidden="true" />{title}</h3>
          {note && <p className="mt-0.5 text-sm text-gray-900">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function AiPerformance() {
  const { has } = useCapabilities()
  const [period, setPeriod] = useState('4w')
  const [got, setGot] = useState(null)   // {key, tab, models, error} for the period last loaded
  const r = useMemo(() => range(period), [period])
  const label = (PERIODS.find((p) => p[0] === period) || PERIODS[0])[1]
  const key = `${r.from}|${r.to}`

  useEffect(() => {
    let off = false
    Promise.all([getAdminTab('R38', r.from, r.to), getAdminModels(r.from, r.to)])
      .then(([t, m]) => { if (!off) setGot({ key, tab: t, models: m }) })
      .catch((e) => { if (!off) setGot({ key, error: e.message || 'Could not load AI Performance' }) })
    return () => { off = true }
  }, [r.from, r.to, key])

  const current = got?.key === key ? got : null
  const tab = current?.tab
  const models = current?.models
  const error = current?.error || ''
  const s = tab?.summary

  async function download(kind) {
    if (kind === 'pdf') { window.print(); return }
    await exportCsv(`ai-performance-${r.to}.csv`, s?.measures || [], [
      { label: 'AI part', value: (m) => m.part }, { label: 'Measure', value: (m) => m.measure },
      { label: 'Value', value: (m) => (m.value == null ? 'No data yet' : `${m.value}${m.unit || '%'}`) },
      { label: 'Based on', value: (m) => m.based }, { label: 'How it is measured', value: (m) => m.how },
    ], { page: '/ai-performance', title: 'AI Performance', filters: [{ label: 'Period', value: `${label} (${r.from} to ${r.to})` }] })
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">AI Performance</h2>
          <p className="text-sm text-gray-900">How often each AI part agreed with what officers and CHAs decided, and the models in use. People always make the final decision.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <label className="text-sm font-bold text-gray-900" htmlFor="ai-period">Period</label>
          <select id="ai-period" className={SELECT} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <DownloadMenu formats={['csv', 'pdf']} onPick={download} busy={!s ? 'loading' : ''} />
        </div>
      </div>

      {error ? <p className="rounded-lg border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p> : !s ? (
        <div className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-100" />)}</div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* at a glance: one row per AI part, the headline measure */}
          <Section title="At a glance" icon={Sparkles} note={`${tab.period}`}>
            <AiGlance cards={s.cards} inShort={s.inShort} />
          </Section>

          <Section title="Models in use" icon={Cpu} note="Each model's latest measures from MLflow, and how often it was used in the period">
            <ModelsTable models={models?.models} />
          </Section>

          <Section title="How each AI part did" icon={ListChecks} note="Each measure compares what the AI suggested with what people decided"
            action={has('monitoring_r38') ? <Link to="/monitoring-reports?report=R38" className={`text-sm font-semibold text-red-700 hover:underline ${FOCUS}`}>Full report with every record</Link> : null}>
            <MeasuresTable measures={s.measures} />
          </Section>

          {(s.charts || []).length > 0 && (
            <div className="grid gap-6 xl:grid-cols-2">
              {s.charts.map((c) => (
                <Section key={c.key} title={c.title} icon={BarChart3} note={c.note}>
                  <div className="relative" style={{ height: c.type === 'hbar' ? Math.max(240, c.labels.length * 34) : 260 }}><Chart chart={c} /></div>
                </Section>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}

// ---------- shared with the Data & AI Admin dashboard's AI Performance tab ----------

export function AiGlance({ cards = [], inShort = [] }) {
  const none = inShort.find((l) => l.startsWith('No data yet'))
  return (
    <>
    <div className="grid grid-cols-1 gap-0 overflow-hidden rounded-lg border border-gray-200 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <div key={c.key} className="border-b border-r border-gray-200 p-4 last:border-r-0">
          <p className="text-sm font-bold text-gray-900">{c.label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-gray-900">{c.value}</p>
          <p className="mt-0.5 text-sm text-gray-900">{c.note}</p>
        </div>
      ))}
    </div>
      {none && <p className="mt-3 text-sm text-gray-900">{none}</p>}
    </>
  )
}

export function ModelsTable({ models }) {
  if (!models?.length) return <p className="text-sm text-gray-900">No model measures yet. They appear when the AI server sends them.</p>
  return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr><th className={TH}>Model</th><th className={TH}>Version</th><th className={TH}>Latest measures</th><th className={TH}>Used in the period</th><th className={TH}>Last updated</th></tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.model}>
                <td className={TD}><b>{m.model}</b><span className="block text-xs">{m.source}</span></td>
                <td className={TD}>{m.version || '—'}</td>
                <td className={TD}>
                  {m.measures.length ? m.measures.map((x) => <span key={x.metric} className="mr-3 inline-block"><b>{x.metric}</b> {x.value}</span>) : '—'}
                  {m.note && <span className="block text-xs text-amber-800">{m.note}</span>}
                </td>
                <td className={`${TD} tabular-nums`}>{m.used == null ? '—' : `${m.used.toLocaleString()} predictions`}</td>
                <td className={TD}>{when(m.lastUsed || m.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  )
}

export function MeasuresTable({ measures = [] }) {
  const parts = []   // measures grouped by AI part, in the order they come
  measures.forEach((m) => {
    const g = parts.find((x) => x.part === m.part) || (parts.push({ part: m.part, rows: [] }), parts[parts.length - 1])
    g.rows.push(m)
  })
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead><tr><th className={TH}>AI part</th><th className={TH}>Measure</th><th className={`${TH} text-right`}>Value</th><th className={TH}>Based on</th><th className={TH}>How it is measured</th></tr></thead>
        <tbody>
          {parts.map((g) => g.rows.map((m, i) => (
            <tr key={m.key}>
              {i === 0 && <th scope="rowgroup" rowSpan={g.rows.length} className={`${TD} w-40 bg-gray-50 font-bold`}>{g.part}</th>}
              <td className={TD}>{m.measure}</td>
              <td className={`${TD} whitespace-nowrap text-right font-bold tabular-nums`}>{m.value == null ? <span className="font-normal">No data yet</span> : `${m.value}${m.unit || '%'}`}</td>
              <td className={TD}>{m.based || '—'}</td>
              <td className={`${TD} text-xs`}>{m.how}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  )
}
