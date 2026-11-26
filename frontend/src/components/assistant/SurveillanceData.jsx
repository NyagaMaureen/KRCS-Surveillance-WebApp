import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, Line, Pie } from 'react-chartjs-2'
import { ArrowUp, BarChart3, Database, Download, ExternalLink, History, LineChart, PieChart, Plus, Search, Trash2, X } from 'lucide-react'
import '../../charts/chartSetup'
import { CHART_FONT } from '../../charts/chartSetup'
import { askSurveillanceData, rerunSurveillanceData, exportCsv, listAssistantChats, getAssistantChat, saveAssistantChat, deleteAssistantChat } from '../../api/frappe'

// KRCS Data Assistant, Surveillance data tab (KRCS 26 Nov 2026): ask about figures ("trends of cholera in my region in the
// last 4 weeks") and get a table and a chart. The server reads the question into a fixed form, checks it, limits it to
// the user's own area and runs its own query (surveillance.data_questions). The AI model only ever reads the question.

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const TH = 'border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-900'
const TD = 'border border-gray-200 px-3 py-2 text-gray-900'
const COLORS = ['#C8102E', '#1F3A5F', '#D97706', '#0F766E', '#7C3AED', '#64748B', '#DB2777', '#0284C7', '#9CA3AF']
const EXAMPLES = [
  'Show me trends of cholera in my region in the last 4 weeks',
  'Measles cases by sub-county in the last 3 months',
  'Which diseases were reported this month, by source?',
  'Deaths by disease in the last 12 weeks',
]
const tick = { color: '#111827', font: { family: CHART_FONT.family, size: 12 } }
const CHARTS = [['bar', 'Bar', BarChart3], ['line', 'Line', LineChart], ['pie', 'Pie', PieChart]]
const TIME = ['week', 'month']
const SELECT = `h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 disabled:bg-gray-50 ${FOCUS}`

function AnswerChart({ chart, type, split, totals }) {
  if (!chart.labels.length || !chart.series.some((s) => s.data.some(Boolean))) {
    return <p className="py-8 text-center text-sm text-gray-900">Nothing to chart: no figures for this.</p>
  }
  if (type === 'pie') {   // one slice per row of the table, from its total
    const data = { labels: chart.labels, datasets: [{ data: totals, backgroundColor: chart.labels.map((_, i) => COLORS[i % COLORS.length]), borderColor: '#fff', borderWidth: 2 }] }
    return (
      <div className="relative h-72">
        <Pie data={data} options={{ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'right', labels: { ...tick, boxWidth: 12 } } } }} />
      </div>
    )
  }
  const many = chart.series.length > 1
  const datasets = chart.series.map((s, i) => {
    const color = COLORS[i % COLORS.length]
    return type === 'line'
      ? { label: s.name, data: s.data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, tension: 0 }
      : { label: s.name, data: s.data, backgroundColor: color, borderRadius: 3, maxBarThickness: 36, stack: 'all' }
  })
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: many || !!split, position: 'bottom', labels: { ...tick, boxWidth: 12 } } },   // a split always says what the colours are
    scales: {
      x: { stacked: type !== 'line' && many, grid: { display: false }, ticks: { ...tick, maxRotation: 45, autoSkip: true } },
      y: { stacked: type !== 'line' && many, beginAtZero: true, grid: { color: '#F0F0F0' }, ticks: { ...tick, precision: 0 } },
    },
  }
  return (
    <div className="relative h-72">
      {type === 'line' ? <Line data={{ labels: chart.labels, datasets }} options={options} /> : <Bar data={{ labels: chart.labels, datasets }} options={options} />}
    </div>
  )
}

function explorerLink(e, view) {
  const p = new URLSearchParams()
  if (e.diseases?.length) p.set('diseases', e.diseases.join(','))
  if (e.sub_counties?.length) p.set('sub_counties', e.sub_counties.join(','))
  if (e.sources?.length) p.set('sources', e.sources.join(','))
  ;['date_from', 'date_to', 'group_by', 'split_by', 'metric'].forEach((k) => { if (e[k]) p.set(k, e[k]) })
  p.set('view', view || 'bar')
  return `/data-explorer?${p}`
}

// Chart, By, Split by and Measure under each answer, like Data Explorer (KRCS 26 Nov 2026), for everyone who can ask,
// also those without Data Explorer. Changing By, Split by or Measure asks the server again (rerun), with the same checks.
function Controls({ a, type, setType, onRerun, busy }) {
  const f = a.form
  const change = (k, v) => onRerun({ ...f, [k]: v, ...(k === 'by' && f.split === v ? { split: '' } : {}) })
  function pick(t) {
    setType(t)
    if (t === 'line' && !TIME.includes(f.by)) onRerun({ ...f, by: 'week', split: f.split === 'week' ? '' : f.split })
    if (t === 'pie' && TIME.includes(f.by)) onRerun({ ...f, by: 'disease', split: '' })
  }
  const byOptions = a.choices.by.filter((o) => type !== 'line' || TIME.includes(o.value))
  return (
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <legend className="sr-only">Change this chart</legend>
      <div>
        <span className="mb-1 block text-xs font-bold text-gray-900">Chart</span>
        <div className="flex gap-1">
          {CHARTS.map(([k, l, Icon]) => (
            <button key={k} type="button" aria-pressed={type === k} onClick={() => pick(k)}
              className={`inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-semibold ${type === k ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 text-gray-900 hover:bg-gray-50'} ${FOCUS}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />{l}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-gray-900">{type === 'line' ? 'Over' : 'By'}</span>
        <select className={SELECT} value={f.by} onChange={(e) => change('by', e.target.value)}>
          {byOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-gray-900">Split by</span>
        <select className={SELECT} value={type === 'pie' ? '' : f.split} disabled={type === 'pie'} onChange={(e) => change('split', e.target.value)}>
          <option value="">{type === 'pie' ? 'Not for a pie' : 'Nothing'}</option>
          {a.choices.by.filter((o) => o.value !== f.by).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-gray-900">Measure</span>
        <select className={SELECT} value={f.measure} onChange={(e) => change('measure', e.target.value)}>
          {a.choices.measure.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    </fieldset>
  )
}

function Answer({ a, onRerun, busy }) {
  const [showSql, setShowSql] = useState(false)
  const [type, setType] = useState('bar')   // bars first (KRCS 26 Nov 2026)
  const download = () => exportCsv(`surveillance-data-${new Date().toISOString().slice(0, 10)}.csv`, a.table.rows,
    a.table.columns.map((c, i) => ({ label: c, value: (r) => r[i] })),
    { page: '/ai-data-assistant', title: a.title, filters: a.understood.map((u) => ({ label: u.label, value: u.value })) })
  return (
    <div className="min-w-0 flex-1 space-y-4">
      <h3 className="text-base font-bold text-gray-900">{a.title}</h3>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="mb-1 text-left text-xs font-bold text-gray-900">How I read your question</caption>
          <thead><tr>{a.understood.map((u) => <th key={u.label} className={TH}>{u.label}</th>)}</tr></thead>
          <tbody><tr>{a.understood.map((u) => <td key={u.label} className={TD}>{u.value}</td>)}</tr></tbody>
        </table>
      </div>
      {a.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-900">{a.notes.map((n) => <li key={n}>{n}</li>)}</ul>}

      <div className="space-y-3 rounded-lg border border-gray-200 p-3">
        <Controls a={a} type={type} setType={setType} onRerun={onRerun} busy={busy} />
        {busy && <p className="text-sm text-gray-900">Updating…</p>}
        <AnswerChart chart={a.chart} type={type} split={type === 'pie' ? '' : a.form.split} totals={a.table.rows.map((r) => r[r.length - 1])} />
      </div>

      {a.table.rows.length > 0 && (
        <div className="max-h-80 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0"><tr>{a.table.columns.map((c, i) => <th key={c} className={`${TH} ${i ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
            <tbody>
              {a.table.rows.map((r) => (
                <tr key={r[0]}>{r.map((v, i) => <td key={i} className={`${TD} ${i ? 'text-right tabular-nums' : ''}`}>{typeof v === 'number' ? v.toLocaleString() : v}</td>)}</tr>
              ))}
              <tr>
                <td className={`${TD} font-bold`}>Total</td>
                {a.table.columns.slice(1).map((c, i) => (
                  <td key={c} className={`${TD} text-right font-bold tabular-nums`}>
                    {a.table.rows.reduce((n, r) => n + (Number(r[i + 1]) || 0), 0).toLocaleString()}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        {a.canExplorer && (
          <Link to={explorerLink(a.explorer, type)} className={`inline-flex items-center gap-1.5 font-semibold text-red-700 hover:underline ${FOCUS}`}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in Data Explorer
          </Link>
        )}
        {a.canExport && a.table.rows.length > 0 && (
          <button type="button" onClick={download} className={`inline-flex items-center gap-1.5 font-semibold text-red-700 hover:underline ${FOCUS}`}>
            <Download className="h-4 w-4" aria-hidden="true" /> Download CSV
          </button>
        )}
        <button type="button" aria-expanded={showSql} onClick={() => setShowSql((v) => !v)} className={`font-semibold text-gray-900 underline underline-offset-2 ${FOCUS}`}>
          {showSql ? 'Hide the query' : 'Show the query'}
        </button>
      </div>
      {showSql && <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-900">{a.sql}</pre>}
      <p className="text-xs text-gray-700">
        Figures come straight from the database, for the area you can see.{' '}
        {a.understoodBy === 'model' ? 'The AI model read only your question, never the figures.' : 'Your question was read with word rules; no AI model was used.'}
      </p>
    </div>
  )
}

// History (Elizabeth, 26 Nov 2026): earlier questions, like Recent chats in the Knowledge base. Only the questions and
// the checked choices are kept (assistant_chats, ids starting "sd:"); opening one runs it again, so the figures are
// always today's and still limited to the user's area.
function toDate(v) { return new Date(String(v || '').replace(' ', 'T')) }
function groupChats(list) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const day = 86400000
  const groups = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Older', []]]
  list.forEach((c) => {
    const t = toDate(c.updatedAt).getTime()
    groups[t >= start.getTime() ? 0 : t >= start.getTime() - day ? 1 : t >= start.getTime() - 7 * day ? 2 : 3][1].push(c)
  })
  return groups.filter(([, items]) => items.length)
}

export default function SurveillanceData({ incoming = null }) {
  const [items, setItems] = useState([])   // {question, answer?, error?}
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [chatId, setChatId] = useState(null)
  const [chats, setChats] = useState(null)
  const [search, setSearch] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)   // the history list on small screens
  const dirty = useRef(false)   // something new to save
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [items.length, busy])   // not when a chart is changed

  function loadChats(term = search) {
    return listAssistantChats(term.trim(), 'sd').then(setChats).catch(() => setChats([]))
  }
  useEffect(() => {
    const t = setTimeout(() => { loadChats(search) }, 250)
    return () => clearTimeout(t)
  }, [search])   // eslint-disable-line react-hooks/exhaustive-deps

  // save after a new answer or a changed chart
  useEffect(() => {
    if (!dirty.current || !chatId || busy || items.some((it) => it.busy || (!it.answer && !it.error))) return
    dirty.current = false
    const messages = items.filter((it) => it.answer).map((it) => ({ role: 'user', content: it.question, form: it.answer.form }))
    if (!messages.length) return
    saveAssistantChat({ id: chatId, title: messages[0].content.slice(0, 80), messages }).then(() => loadChats()).catch(() => {})
  }, [items, busy, chatId])   // eslint-disable-line react-hooks/exhaustive-deps

  function newChat() {
    setItems([])
    setChatId(null)
    setPanelOpen(false)
  }

  async function openChat(id) {
    if (busy) return
    setPanelOpen(false)
    let saved
    try {
      saved = await getAssistantChat(id)
    } catch {
      return
    }
    const list = (saved.messages || []).filter((m) => m.role === 'user' && m.content)
    dirty.current = false
    setChatId(id)
    setItems(list.map((m) => ({ question: m.content, busy: true })))
    // run each one again: today's figures, checked against the user's area again
    list.forEach((m, index) => {
      const run = m.form ? rerunSurveillanceData({ ...m.form, question: m.content }) : askSurveillanceData(m.content)
      run.then((answer) => setItems((x) => x.map((it, i) => (i === index ? { ...it, answer, busy: false } : it))))
        .catch((e) => setItems((x) => x.map((it, i) => (i === index ? { ...it, busy: false, error: e.message || 'Could not answer that.' } : it))))
    })
  }

  async function removeChat(id) {
    try {
      await deleteAssistantChat(id)
    } catch {
      return
    }
    if (id === chatId) newChat()
    loadChats()
  }

  async function rerun(index, form) {
    dirty.current = true
    setItems((x) => x.map((it, i) => (i === index ? { ...it, busy: true, rerunError: '' } : it)))
    try {
      const answer = await rerunSurveillanceData(form)
      setItems((x) => x.map((it, i) => (i === index ? { ...it, answer, busy: false } : it)))
    } catch (e) {
      setItems((x) => x.map((it, i) => (i === index ? { ...it, busy: false, rerunError: e.message || 'Could not change the chart.' } : it)))
    }
  }

  async function send(q = text) {
    const question = q.trim()
    if (!question || busy) return
    setText('')
    setBusy(true)
    if (!chatId) setChatId(`sd:${crypto.randomUUID()}`)
    dirty.current = true
    setItems((x) => [...x, { question }])
    try {
      const answer = await askSurveillanceData(question)
      setItems((x) => x.map((it, i) => (i === x.length - 1 ? { ...it, answer } : it)))
    } catch (e) {
      setItems((x) => x.map((it, i) => (i === x.length - 1 ? { ...it, error: e.message || 'Could not answer that.' } : it)))
    } finally {
      setBusy(false)
    }
  }

  // a figures question sent over from the Knowledge base tab
  const took = useRef(0)
  useEffect(() => {
    if (incoming && incoming.n !== took.current) {
      took.current = incoming.n
      send(incoming.question)
    }
  }, [incoming])   // eslint-disable-line react-hooks/exhaustive-deps

  const composer = (
    <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
      <label className="sr-only" htmlFor="sd-question">Your question about surveillance figures</label>
      <textarea id="sd-question" rows={1} value={text} disabled={busy} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        placeholder="Ask about cases, deaths or trends, e.g. cholera cases by week in the last 8 weeks"
        className="max-h-40 min-h-[44px] flex-1 resize-none px-3 py-2.5 text-[15px] text-gray-900 focus:outline-none" />
      <button type="submit" disabled={busy || !text.trim()} aria-label="Ask"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-200 ${FOCUS}`}>
        <ArrowUp className="h-5 w-5" aria-hidden="true" />
      </button>
    </form>
  )

  const grouped = groupChats(chats || [])
  const history = (
    <>
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={newChat}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-red-700 ${FOCUS}`}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New question
          </button>
          <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close history" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 md:hidden">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search history" aria-label="Search history"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-100" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="px-2 pb-1 pt-2 text-xs font-bold text-gray-900">History</div>
        {chats && !chats.length && (
          <p className="px-2 py-4 text-sm text-gray-700">{search.trim() ? 'Nothing matches your search.' : 'Your questions will appear here.'}</p>
        )}
        {grouped.map(([label, list]) => (
          <div key={label} className="mb-2">
            <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</div>
            {list.map((c) => (
              <div key={c.id} className={`group flex items-center rounded-lg ${c.id === chatId ? 'bg-white shadow-sm ring-1 ring-gray-100' : 'hover:bg-gray-100'}`}>
                <button type="button" onClick={() => openChat(c.id)} title={c.title} className={`min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm text-gray-900 ${FOCUS}`}>{c.title}</button>
                <button type="button" onClick={() => removeChat(c.id)} aria-label={`Delete: ${c.title}`}
                  className="mr-1 shrink-0 rounded p-1.5 text-gray-400 opacity-0 hover:text-red-700 focus:opacity-100 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )

  return (
    <div className="relative flex h-full min-h-0 bg-white">
      {panelOpen && <button type="button" aria-label="Close history" onClick={() => setPanelOpen(false)} className="absolute inset-0 z-20 bg-black/20 md:hidden" />}
      <aside className={`z-30 w-72 shrink-0 flex-col border-r border-gray-100 bg-gray-50 ${panelOpen ? 'absolute inset-y-0 left-0 flex shadow-xl' : 'hidden'} md:static md:flex md:shadow-none`}>
        {history}
      </aside>
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 md:hidden">
        <button type="button" onClick={() => setPanelOpen(true)} className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-900 ${FOCUS}`}>
          <History className="h-4 w-4" aria-hidden="true" /> History
        </button>
      </div>
      {!items.length ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-10">
          <div className="w-full max-w-2xl">
            <h1 className="mb-2 text-center text-3xl font-medium text-gray-900">Ask about surveillance figures</h1>
            <p className="mb-6 text-center text-sm text-gray-900">Cases, people affected and deaths from reports, CBS and MOH 505, for the area you can see.</p>
            {composer}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((q) => (
                <button key={q} type="button" onClick={() => send(q)} className={`rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 ${FOCUS}`}>{q}</button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 pt-6">
            <div className="mx-auto max-w-4xl space-y-8 pb-6">
              {items.map((it, i) => (
                <div key={i} className="space-y-4">
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl bg-gray-100 px-4 py-2.5 text-[15px] text-gray-900">{it.question}</div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700"><Database className="h-4 w-4" aria-hidden="true" /></div>
                    {it.answer ? (
                      <div className="min-w-0 flex-1 space-y-2">
                        <Answer a={it.answer} busy={it.busy} onRerun={(form) => rerun(i, form)} />
                        {it.rerunError && <p className="text-sm text-red-700">{it.rerunError}</p>}
                      </div>
                    ) : it.error ? <p className="text-sm text-red-700">{it.error}</p> : (
                      <p className="py-1 text-sm text-gray-900">Working it out…</p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={end} />
            </div>
          </div>
          <div className="px-4 pb-5 pt-2"><div className="mx-auto max-w-4xl">{composer}</div></div>
        </>
      )}
    </div>
    </div>
  )
}
