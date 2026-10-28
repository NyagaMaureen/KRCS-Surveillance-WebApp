import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus, Download, ClipboardList, ChevronRight, ArrowLeft, X, ArrowUp, ArrowDown, Search,
  CheckCircle2, FileEdit, Stethoscope, CalendarClock, AlertTriangle, ExternalLink,
} from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import {
  getProtocols, saveProtocol, setProtocolStatus, deleteProtocol, getDiseaseOptions,
  exportCsv, currentUserFullName,
} from '../api/frappe'
import { FOCUS, SEVERITY_STYLES, fmtDateTime } from '../data/eventHelpers'

const PRIORITY_ORDER = { Critical: 0, High: 1, Standard: 2 }
const PRIORITY_BADGE = {
  Critical: SEVERITY_STYLES.critical,
  High: SEVERITY_STYLES.high,
  Standard: SEVERITY_STYLES.standard,
}
const STATUS_BADGE = {
  Approved: 'bg-emerald-100 text-emerald-700',
  Draft: 'bg-gray-100 text-gray-600',
  Retired: 'bg-gray-100 text-gray-400',
}

const card = 'bg-white rounded-2xl border border-gray-100'
const inputCls = `w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 ${FOCUS}`
const btnSecondary = `border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`
const btnPrimary = `bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50 ${FOCUS}`

const PHASES = ['Investigation', 'Response']
const KINDS = ['Key question', 'Case definition', 'Supports', 'Red flag']
const KIND_HELP = {
  'Key question': 'Decides if this is a real event. At least half of the key questions must be Yes to start the field investigation.',
  'Case definition': 'Does the case match the case definition? Counts as a key question.',
  Supports: 'Extra context. Does not block anything.',
  'Red flag': 'Yes means escalate to the county straight away.',
}
const KIND_TAG = {
  'Key question': 'bg-gray-100 text-gray-700',
  'Case definition': 'bg-blue-50 text-blue-600',
  'Red flag': 'bg-red-50 text-red-700',
}

const todayIso = () => new Date().toISOString().slice(0, 10)
const isOverdue = (p) => p.status !== 'Retired' && !!p.reviewDate && String(p.reviewDate).slice(0, 10) < todayIso()

function SummaryCard({ label, value, Icon }) {
  return (
    <div className={`${card} p-5 flex items-start justify-between`}>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-gray-400">{label}</span>
        <span className="text-2xl font-semibold text-gray-900">{value}</span>
      </div>
      <span className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-gray-500" aria-hidden="true" />
      </span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse" aria-busy="true" aria-label="Loading protocols">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${card} p-6 flex gap-4`}>
          <div className="w-12 h-12 rounded-full bg-gray-100" />
          <div className="flex-1 space-y-2.5">
            <div className="h-4 w-1/3 bg-gray-100 rounded" />
            <div className="h-3 w-2/3 bg-gray-100 rounded" />
            <div className="h-3 w-1/2 bg-gray-100 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

const TABS = [...PHASES, 'Verification questions']

function ProtocolHeader({ p }) {
  const retired = p.status === 'Retired'
  return (
        <div className="flex items-start gap-4">
          <span className="w-12 h-12 shrink-0 rounded-full bg-red-50 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-red-700" aria-hidden="true" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className={`text-base font-semibold text-gray-900 ${retired ? 'line-through text-gray-400' : ''}`}>{p.title}</h3>
            <p className="text-sm text-gray-400 mt-0.5">
              {p.diseaseName} · {p.version} · updated {fmtDateTime(p.updated)} · by {p.owner || '—'}
            </p>
            {p.summary && <p className="text-sm text-gray-500 mt-1.5">{p.summary}</p>}
          </div>
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 shrink-0">
            <span className={`px-3 h-6 inline-flex items-center rounded-full text-xs font-medium ${PRIORITY_BADGE[p.priority] || PRIORITY_BADGE.Standard}`}>
              {p.priority}
            </span>
            <span className={`px-3 h-6 inline-flex items-center rounded-full text-xs font-medium ${STATUS_BADGE[p.status] || STATUS_BADGE.Draft}`}>
              {p.status}
            </span>
            {p.notifyImmediately && (
              <span className="px-3 h-6 inline-flex items-center rounded-full text-xs font-medium bg-red-100 text-red-700">
                Single case is an emergency
              </span>
            )}
          </div>
        </div>
  )
}

function ProtocolRow({ protocol: p, onOpen }) {
  const retired = p.status === 'Retired'
  const qCount = (p.questions || []).length
  const keyCount = (p.questions || []).filter((q) => q.kind === 'Key question' || q.kind === 'Case definition').length
  return (
    <tr onClick={() => onOpen(p)} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 cursor-pointer">
      <td className="px-3 py-3.5">
        <span className={`font-medium ${retired ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{p.title}</span>
        <span className="block text-xs text-gray-400 mt-0.5">{p.diseaseName} · {p.version}</span>
      </td>
      <td className="px-3 py-3.5 hidden md:table-cell">
        <span className={`px-2.5 py-0.5 inline-flex items-center rounded-full text-xs font-medium ${PRIORITY_BADGE[p.priority] || PRIORITY_BADGE.Standard}`}>{p.priority}</span>
      </td>
      <td className="px-3 py-3.5">
        <span className={`px-2.5 py-0.5 inline-flex items-center rounded-full text-xs font-medium ${STATUS_BADGE[p.status] || STATUS_BADGE.Draft}`}>{p.status}</span>
        {p.notifyImmediately && <span className="block text-[11px] text-red-600 mt-1">Single case is an emergency</span>}
      </td>
      <td className="px-3 py-3.5 text-gray-600 hidden lg:table-cell whitespace-nowrap">{p.stepCount} steps</td>
      <td className="px-3 py-3.5 text-gray-600 hidden lg:table-cell whitespace-nowrap">
        {qCount} questions{keyCount ? <span className="text-gray-400"> · {keyCount} key</span> : ''}
      </td>
      <td className="px-3 py-3.5 text-gray-500 hidden sm:table-cell whitespace-nowrap">{fmtDateTime(p.updated)}</td>
      <td className="px-3 py-3.5 text-right">
        <span className="inline-flex items-center h-8 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 whitespace-nowrap">View</span>
      </td>
    </tr>
  )
}

function DetailSection({ title, count, help, children }) {
  return (
    <section className={`${card} p-5 sm:p-7`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {count != null && <span className="text-sm text-gray-400">{count}</span>}
      </div>
      {help && <p className="text-sm text-gray-500 mt-1">{help}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Meta({ label, children }) {
  if (!children) return null
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900 mt-0.5 break-words">{children}</dd>
    </div>
  )
}

function StepView({ s, num }) {
  return (
    <li className="flex gap-4 py-5 first:pt-0 last:pb-0">
      <span className="w-8 h-8 shrink-0 rounded-full bg-gray-100 text-sm font-semibold text-gray-600 flex items-center justify-center">{num}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-relaxed text-gray-900">{s.step}</p>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-gray-500">
          {s.timeframe && <span><span className="text-gray-400">When:</span> {s.timeframe}</span>}
          {s.responsible && <span><span className="text-gray-400">Who:</span> {s.responsible}</span>}
          {s.assignable && <span className="text-emerald-700">Can be assigned to a field worker</span>}
        </div>
      </div>
    </li>
  )
}

const DETAIL_TABS = [
  { key: 'about', label: 'Overview' },
  { key: 'questions', label: 'Verification questions' },
  { key: 'Investigation', label: 'Field investigation steps' },
  { key: 'Response', label: 'Response steps' },
]

function ProtocolDetail({ protocol: p, canManage, busy, diseases, onBack, onSaved, onStatus, onDelete }) {
  const [tab, setTab] = useState('about')
  const [editing, setEditing] = useState(false)
  const retired = p.status === 'Retired'
  const inv = p.steps.filter((s) => (s.phase || 'Investigation') === 'Investigation')
  const resp = p.steps.filter((s) => s.phase === 'Response')
  const questions = p.questions || []
  const keyCount = questions.filter((q) => q.kind === 'Key question' || q.kind === 'Case definition').length
  const counts = { about: null, questions: questions.length, Investigation: inv.length, Response: resp.length }
  const pick = (k) => { setTab(k); setEditing(false) }

  const editBar = (help) => (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
      <p className="text-sm text-gray-500 max-w-2xl">{help}</p>
      {canManage && !editing && (
        <button type="button" disabled={busy} onClick={() => setEditing(true)} className={`inline-flex items-center gap-1.5 ${btnSecondary}`}>
          <FileEdit className="w-4 h-4" aria-hidden="true" /> Edit
        </button>
      )}
    </div>
  )

  const editor = (
    <ProtocolModal protocol={p} diseases={diseases} only={tab} onClose={() => setEditing(false)}
      onSaved={(saved) => { setEditing(false); onSaved(saved) }} />
  )

  return (
    <div className={retired ? 'opacity-80' : ''}>
      <button type="button" onClick={onBack} className={`mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 rounded ${FOCUS}`}>
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> All protocols
      </button>

      <header className="flex items-start justify-between gap-6 flex-wrap mb-6">
        <div className="min-w-0 max-w-3xl">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={`px-2.5 py-0.5 inline-flex items-center rounded-full text-xs font-medium ${STATUS_BADGE[p.status] || STATUS_BADGE.Draft}`}>{p.status}</span>
            <span className={`px-2.5 py-0.5 inline-flex items-center rounded-full text-xs font-medium ${PRIORITY_BADGE[p.priority] || PRIORITY_BADGE.Standard}`}>{p.priority} priority</span>
            {p.notifyImmediately && <span className="px-2.5 py-0.5 inline-flex items-center rounded-full text-xs font-medium bg-red-50 text-red-700">Single case is an emergency</span>}
          </div>
          <h2 className={`text-2xl font-semibold text-gray-900 ${retired ? 'line-through' : ''}`}>{p.title}</h2>
          <p className="text-sm text-gray-500 mt-1">{p.diseaseName} · {p.version}</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {p.status === 'Draft' && <button type="button" disabled={busy} onClick={() => onStatus(p, 'Approved')} className={btnPrimary}>Approve</button>}
            {p.status === 'Approved' && <button type="button" disabled={busy} onClick={() => onStatus(p, 'Draft')} className={btnSecondary}>Return to draft</button>}
            {p.status !== 'Retired' && <button type="button" disabled={busy} onClick={() => onStatus(p, 'Retired')} className={btnSecondary}>Retire</button>}
            <button type="button" disabled={busy} onClick={() => onDelete(p)}
              className={`border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50 ${FOCUS}`}>Delete</button>
          </div>
        )}
      </header>

      {p.status === 'Draft' && (
        <p className="mb-6 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          Draft: officers don't see this protocol until it is approved.
        </p>
      )}

      <div role="tablist" aria-label="Protocol sections" className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {DETAIL_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => pick(t.key)}
            className={`px-4 py-3 -mb-px text-sm font-medium whitespace-nowrap border-b-2 ${FOCUS} ${tab === t.key ? 'border-red-600 text-red-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
            {t.label}{counts[t.key] != null && <span className="ml-1.5 text-xs opacity-70">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'about' && (
          editing ? editor : (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
              <section className={`${card} p-5 sm:p-7`}>
                {editBar('The case definition officers check every report against.')}
                <h3 className="text-base font-semibold text-gray-900">Case definition</h3>
                <p className="text-[15px] leading-relaxed text-gray-800 mt-2">{p.summary || <span className="text-gray-400">No case definition written yet.</span>}</p>
              </section>
              <aside className={`${card} p-5 sm:p-6`}>
                <h3 className="text-sm font-semibold text-gray-900 mb-4">About</h3>
                <dl className="divide-y divide-gray-100">
                  <Meta label="Disease">{p.diseaseName}</Meta>
                  <Meta label="Version">{p.version}</Meta>
                  <Meta label="Owner">{p.owner}</Meta>
                  <Meta label="Last updated">{fmtDateTime(p.updated)}</Meta>
                  <Meta label="Approved">{p.approvedBy ? `${p.approvedBy}, ${fmtDateTime(p.approvedOn)}` : null}</Meta>
                  <Meta label="Next review">{p.reviewDate ? fmtDateTime(p.reviewDate) : null}</Meta>
                  <Meta label="Source">
                    {p.source ? (p.sourceUrl ? (
                      <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-red-700 hover:underline inline-flex items-start gap-1">
                        {p.source}<ExternalLink className="w-3 h-3 mt-1 shrink-0" aria-hidden="true" />
                      </a>
                    ) : p.source) : null}
                  </Meta>
                </dl>
              </aside>
            </div>
          )
        )}

        {tab === 'questions' && (
          editing ? editor : (
            <section className={`${card} p-5 sm:p-7`}>
              {editBar(keyCount
                ? `Asked before the field investigation. ${keyCount} key question${keyCount === 1 ? '' : 's'}: at least half must be Yes to start investigation.`
                : 'Asked before the field investigation.')}
              {questions.length === 0 ? <p className="text-sm text-gray-400">No verification questions.</p> : (
                <ol className="divide-y divide-gray-100">
                  {questions.map((q, i) => (
                    <li key={i} className="flex gap-4 py-5 first:pt-0 last:pb-0">
                      <span className="w-8 h-8 shrink-0 rounded-full bg-gray-100 text-sm font-semibold text-gray-600 flex items-center justify-center">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] leading-relaxed text-gray-900">{q.question}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-500">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_TAG[q.kind] || 'bg-gray-50 text-gray-500'}`}>{q.kind || 'Supports'}</span>
                          {q.why && <span>{q.why}</span>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )
        )}

        {(tab === 'Investigation' || tab === 'Response') && (
          editing ? editor : (
            <section className={`${card} p-5 sm:p-7`}>
              {editBar(tab === 'Investigation'
                ? 'Done during the field investigation, including first treatment and isolation.'
                : 'Open after the event is confirmed or escalated.')}
              {(tab === 'Investigation' ? inv : resp).length === 0 ? <p className="text-sm text-gray-400">No steps yet.</p> : (
                <ol className="divide-y divide-gray-100">
                  {(tab === 'Investigation' ? inv : resp).map((s, k) => <StepView key={s.n} s={s} num={k + 1} />)}
                </ol>
              )}
            </section>
          )
        )}
      </div>
    </div>
  )
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`relative bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}>
        {children}
      </div>
    </div>
  )
}

function Label({ text, required, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
      <span>{text}{required && <span className="text-red-700"> *</span>}</span>
      {children}
    </label>
  )
}

const blankStep = () => ({ step: '', timeframe: '', responsible: '', phase: 'Investigation', assignable: false })
const blankQuestion = () => ({ question: '', why: '', kind: 'Key question' })

/** Protocol form. Full page for a new protocol; with `only` set it edits one tab in place
 *  ('about' | 'questions' | 'Investigation' | 'Response') and saves the whole protocol. */
function ProtocolModal({ protocol, initialDisease, diseases, onClose, onSaved, only = null }) {
  const show = (part) => !only || only === part
  const editing = !!protocol
  const autoTitle = (key) => {
    const d = diseases.find((x) => x.key === key)
    return d ? `${d.name} Response` : ''
  }
  const [form, setForm] = useState(() => ({
    disease: protocol?.disease || initialDisease || '',
    title: protocol?.title || (initialDisease ? autoTitle(initialDisease) : ''),
    summary: protocol?.summary || '',
    version: protocol?.version || 'v1.0',
    source: protocol?.source || '',
    source_url: protocol?.sourceUrl || '',
    review_date: protocol?.reviewDate ? String(protocol.reviewDate).slice(0, 10) : '',
    steps: protocol?.steps?.length
      ? protocol.steps.map((s) => ({ step: s.step, timeframe: s.timeframe || '', responsible: s.responsible || '', phase: s.phase || 'Investigation', assignable: !!s.assignable }))
      : [blankStep()],
    questions: (protocol?.questions || []).map((q) => ({ question: q.question || '', why: q.why || '', kind: q.kind || 'Case definition' })),
    notifyImmediately: !!protocol?.notifyImmediately,
  }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setStep = (i, patch) => set({ steps: form.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) })
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= form.steps.length) return
    const next = [...form.steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    set({ steps: next })
  }

  const setQuestion = (i, patch) => set({ questions: form.questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)) })
  const moveQuestion = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= form.questions.length) return
    const next = [...form.questions]
    ;[next[i], next[j]] = [next[j], next[i]]
    set({ questions: next })
  }

  function onDisease(key) {
    const prevAuto = autoTitle(form.disease)
    const patch = { disease: key }
    if (!form.title.trim() || form.title === prevAuto) patch.title = autoTitle(key)
    set(patch)
  }

  async function submit(e) {
    e.preventDefault()
    const steps = form.steps
      .map((s) => ({ step: s.step.trim(), timeframe: s.timeframe.trim(), responsible: s.responsible.trim(), phase: s.phase, assignable: !!s.assignable }))
      .filter((s) => s.step)
    const questions = form.questions
      .map((q) => ({ question: q.question.trim(), why: q.why.trim(), kind: q.kind }))
      .filter((q) => q.question)
    if (!form.disease) return setError('Choose a disease.')
    if (!form.title.trim()) return setError('Title is required.')
    if (steps.length === 0) return setError('Add at least one response step.')
    if (form.steps.some((s) => !s.step.trim() && (s.timeframe.trim() || s.responsible.trim()))) {
      return setError('Every step needs a description.')
    }
    setError('')
    setSaving(true)
    try {
      const saved = await saveProtocol({
        ...(editing ? { name: protocol.id } : {}),
        ...form,
        title: form.title.trim(),
        steps,
        questions,
        notifyImmediately: form.notifyImmediately,
      })
      onSaved(saved)
    } catch (err) {
      setError(err.message || 'Could not save the protocol.')
      setSaving(false)
    }
  }

  const sectionCls = `${card} p-5 sm:p-6`
  const stepRows = (phase) => form.steps.map((st, i) => ({ st, i })).filter(({ st }) => (st.phase || 'Investigation') === phase)
  const iconBtn = `p-1.5 rounded-md text-gray-400 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-30 ${FOCUS}`

  // plain function, not a component: keeps input focus while typing
  const renderStep = (st, i, num) => (
    <li key={i} className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <span className="w-7 h-7 mt-1 shrink-0 rounded-full bg-gray-100 text-xs font-semibold text-gray-600 flex items-center justify-center">{num}</span>
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <textarea rows={2} aria-label={`Step ${num}`} className={inputCls} placeholder="What needs to be done" value={st.step}
          onChange={(e) => setStep(i, { step: e.target.value })} />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 md:items-center">
          <input aria-label={`Timeframe for step ${num}`} className={inputCls} placeholder="When (e.g. within 24 hours)" value={st.timeframe}
            onChange={(e) => setStep(i, { timeframe: e.target.value })} />
          <input aria-label={`Responsible for step ${num}`} className={inputCls} placeholder="Who is responsible" value={st.responsible}
            onChange={(e) => setStep(i, { responsible: e.target.value })} />
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={!!st.assignable} onChange={(e) => setStep(i, { assignable: e.target.checked })} className="w-4 h-4 accent-red-600" />
            Field worker can do this
          </label>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <button type="button" aria-label="Move step up" disabled={i === 0} onClick={() => move(i, -1)} className={iconBtn}><ArrowUp className="w-4 h-4" /></button>
        <button type="button" aria-label="Move step down" disabled={i === form.steps.length - 1} onClick={() => move(i, 1)} className={iconBtn}><ArrowDown className="w-4 h-4" /></button>
        <button type="button" aria-label={st.phase === 'Response' ? 'Move to investigation steps' : 'Move to response steps'} title={st.phase === 'Response' ? 'Move to investigation steps' : 'Move to response steps'}
          onClick={() => setStep(i, { phase: st.phase === 'Response' ? 'Investigation' : 'Response' })} className={`${iconBtn} text-[10px] font-semibold`}>{st.phase === 'Response' ? 'INV' : 'RSP'}</button>
        <button type="button" aria-label="Remove step" disabled={form.steps.length === 1}
          onClick={() => set({ steps: form.steps.filter((_, idx) => idx !== i) })} className={`${iconBtn} hover:text-red-700`}><X className="w-4 h-4" /></button>
      </div>
    </li>
  )

  const phaseSection = (phase, title, help) => {
    const rows = stepRows(phase)
    return (
      <section className={sectionCls}>
        <h4 className="text-base font-semibold text-gray-900">{title}</h4>
        <p className="text-sm text-gray-500 mt-0.5 mb-4">{help}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 mb-3">No steps yet.</p>
        ) : (
          <ol className="divide-y divide-gray-100 mb-3">
            {rows.map(({ st, i }, k) => renderStep(st, i, k + 1))}
          </ol>
        )}
        <button type="button" onClick={() => set({ steps: [...form.steps, { ...blankStep(), phase }] })}
          className={`inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
          <Plus className="w-4 h-4" aria-hidden="true" /> Add step
        </button>
      </section>
    )
  }

  return (
    <form onSubmit={submit} className={`flex flex-col gap-5 ${only ? '' : 'pb-24'}`}>
      {!only && <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button type="button" onClick={onClose} disabled={saving} className={`mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 rounded ${FOCUS}`}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
          </button>
          <h2 className="text-xl font-semibold text-gray-900">{editing ? `Edit: ${protocol.title}` : 'New protocol'}</h2>
          <p className="text-sm text-gray-500 mt-0.5">Owner: {editing ? (protocol.owner || '—') : currentUserFullName()}</p>
        </div>
      </div>}

      {editing && protocol.status === 'Approved' && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          Saving will return this protocol to Draft so it can be approved again.
        </p>
      )}

      {show('about') && <section className={sectionCls}>
        <h4 className="text-base font-semibold text-gray-900 mb-4">About this protocol</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
          <Label text="Disease" required>
            <select className={inputCls} value={form.disease} onChange={(e) => onDisease(e.target.value)}>
              <option value="">Select a disease</option>
              {diseases.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>
          </Label>
          <Label text="Title" required>
            <input className={inputCls} value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </Label>
          <div className="md:col-span-2">
            <Label text="Case definition / summary">
              <textarea rows={3} className={inputCls} value={form.summary} onChange={(e) => set({ summary: e.target.value })} />
            </Label>
          </div>
          <Label text="Version">
            <input className={inputCls} value={form.version} onChange={(e) => set({ version: e.target.value })} />
          </Label>
          <Label text="Next review date">
            <input type="date" className={inputCls} value={form.review_date} onChange={(e) => set({ review_date: e.target.value })} />
          </Label>
          <Label text="Source">
            <input className={inputCls} value={form.source} onChange={(e) => set({ source: e.target.value })} placeholder="e.g. MoH Cholera Guidelines 2023" />
          </Label>
          <Label text="Source link">
            <input type="url" className={inputCls} value={form.source_url} onChange={(e) => set({ source_url: e.target.value })} placeholder="https://" />
          </Label>
          <label className="md:col-span-2 flex items-start gap-2.5 text-sm text-gray-900 cursor-pointer">
            <input type="checkbox" className="mt-0.5 w-4 h-4 accent-red-600" checked={form.notifyImmediately} onChange={(e) => set({ notifyImmediately: e.target.checked })} />
            <span>
              <span className="font-medium">Single case is an emergency</span>
              <span className="block text-xs text-gray-500">One case meeting the case definition must be escalated to County / National MOH (e.g. VHF, polio).</span>
            </span>
          </label>
        </div>
      </section>}

      {show('questions') && <section className={sectionCls}>
        <h4 className="text-base font-semibold text-gray-900">Verification questions</h4>
        <p className="text-sm text-gray-500 mt-0.5 mb-4">
          Asked before the field investigation. <span className="font-medium text-gray-700">At least half of the key questions must be Yes</span>; otherwise the signal is discarded.
        </p>
        {form.questions.length === 0 ? (
          <p className="text-sm text-gray-400 mb-3">No questions yet. Without key questions, officers decide from the case definition.</p>
        ) : (
          <ol className="divide-y divide-gray-100 mb-3">
            {form.questions.map((q, i) => (
              <li key={i} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                <span className="w-7 h-7 mt-1 shrink-0 rounded-full bg-gray-100 text-xs font-semibold text-gray-600 flex items-center justify-center">{i + 1}</span>
                <div className="flex-1 min-w-0 flex flex-col gap-3">
                  <textarea rows={2} aria-label={`Question ${i + 1}`} className={inputCls} placeholder="Question (answered Yes / No)" value={q.question}
                    onChange={(e) => setQuestion(i, { question: e.target.value })} />
                  <input aria-label={`Why we ask question ${i + 1}`} className={inputCls} placeholder="Why we ask (optional)" value={q.why}
                    onChange={(e) => setQuestion(i, { why: e.target.value })} />
                  <div>
                    <div role="radiogroup" aria-label={`Type of question ${i + 1}`} className="flex flex-wrap gap-2">
                      {KINDS.map((k) => (
                        <button key={k} type="button" role="radio" aria-checked={q.kind === k} onClick={() => setQuestion(i, { kind: k })}
                          className={`h-8 px-3 rounded-lg border text-sm ${FOCUS} ${q.kind === k ? 'border-gray-900 text-gray-900 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                          {k}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">{KIND_HELP[q.kind]}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <button type="button" aria-label="Move question up" disabled={i === 0} onClick={() => moveQuestion(i, -1)} className={iconBtn}><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" aria-label="Move question down" disabled={i === form.questions.length - 1} onClick={() => moveQuestion(i, 1)} className={iconBtn}><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" aria-label="Remove question" onClick={() => set({ questions: form.questions.filter((_, idx) => idx !== i) })} className={`${iconBtn} hover:text-red-700`}><X className="w-4 h-4" /></button>
                </div>
              </li>
            ))}
          </ol>
        )}
        <button type="button" onClick={() => set({ questions: [...form.questions, blankQuestion()] })}
          className={`inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
          <Plus className="w-4 h-4" aria-hidden="true" /> Add question
        </button>
      </section>}

      {show('Investigation') && phaseSection('Investigation', 'Field investigation steps', 'Done during the field investigation, including first treatment and isolation. Tick "Field worker can do this" for steps a CHP, CHA or health worker carries out and reports back on.')}
      {show('Response') && phaseSection('Response', 'Response steps', 'Open after the event is confirmed or escalated.')}

      <div className={only ? '' : 'fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-100'}>
        <div className={only ? 'flex items-center justify-end gap-3' : 'max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-end gap-3'}>
          {error && <p role="alert" className="mr-auto text-sm text-red-700">{error}</p>}
          <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create protocol'}
          </button>
        </div>
      </div>
    </form>
  )
}

function DeleteDialog({ protocol, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (e) {
      setError(e.message || 'Could not delete the protocol.')
      setBusy(false)
    }
  }
  return (
    <Modal title="Delete protocol" onClose={busy ? () => {} : onCancel}>
      <div className="p-6 flex flex-col gap-4">
        <h3 className="text-base font-semibold text-gray-900">Delete protocol?</h3>
        <p className="text-sm text-gray-600">“{protocol.title}” will be permanently deleted. This cannot be undone.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={confirm} disabled={busy} className={btnPrimary}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
    </Modal>
  )
}

export default function ResponseProtocols() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState({ protocols: [], counts: { draft: 0, approved: 0, retired: 0 }, canManage: false })
  const [diseases, setDiseases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [disease, setDisease] = useState('')
  const [status, setStatus] = useState('')
  const [modal, setModal] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const newHandled = useRef(false)

  const load = useCallback(() => {
    setError('')
    return getProtocols()
      .then((res) => setData({
        protocols: res?.protocols || [],
        counts: res?.counts || { draft: 0, approved: 0, retired: 0 },
        canManage: !!res?.canManage,
      }))
      .catch((e) => setError(e.message || 'We could not load the protocols.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { getDiseaseOptions().then((d) => setDiseases(d || [])).catch(() => {}) }, [])

  const { protocols, counts, canManage } = data

  useEffect(() => {
    const newDisease = params.get('new')
    if (!newDisease || newHandled.current || loading || !canManage || diseases.length === 0) return
    newHandled.current = true
    setModal({ protocol: null, disease: newDisease })
    const next = new URLSearchParams(params)
    next.delete('new')
    setParams(next, { replace: true })
  }, [params, setParams, loading, canManage, diseases])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return protocols
      .filter((p) => !disease || p.disease === disease)
      .filter((p) => !status || p.status === status)
      .filter((p) => {
        if (!q) return true
        return [p.title, p.diseaseName, p.disease, ...(p.steps || []).map((s) => s.step)]
          .some((t) => String(t || '').toLowerCase().includes(q))
      })
      .sort((a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3) || a.title.localeCompare(b.title))
  }, [protocols, disease, status, search])

  const openId = params.get('protocol')
  const openProtocol = openId ? protocols.find((p) => p.id === openId) : null
  const openDetail = (id) => {
    const next = new URLSearchParams(params)
    next.set('protocol', id)
    setParams(next)
    window.scrollTo({ top: 0 })
  }
  const closeDetail = () => {
    const next = new URLSearchParams(params)
    next.delete('protocol')
    setParams(next)
  }

  const diseasesCovered = useMemo(
    () => new Set(protocols.filter((p) => p.status === 'Approved').map((p) => p.disease)).size,
    [protocols]
  )
  const dueForReview = useMemo(() => protocols.filter(isOverdue).length, [protocols])

  async function changeStatus(p, next) {
    setBusy(true)
    setActionError('')
    try {
      await setProtocolStatus(p.id, next)
      await load()
    } catch (e) {
      setActionError(e.message || 'Could not update the protocol.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    await deleteProtocol(deleting.id)
    setDeleting(null)
    if (openId === deleting.id) closeDetail()
    await load()
  }

  async function onSaved(saved) {
    setModal(null)
    await load()
    if (saved?.id) openDetail(saved.id)
  }

  function exportVisible() {
    exportCsv('response-protocols.csv', visible, [
      { label: 'Title', value: (p) => p.title },
      { label: 'Disease', value: (p) => p.diseaseName },
      { label: 'Priority', value: (p) => p.priority },
      { label: 'Status', value: (p) => p.status },
      { label: 'Version', value: (p) => p.version },
      { label: 'Owner', value: (p) => p.owner },
      { label: 'Updated', value: (p) => p.updated },
      { label: 'Steps', value: (p) => (p.steps || []).map((s) => `${s.n}. ${s.step}`).join(' | ') },
    ])
  }

  const chips = [['', 'All'], ['Approved', 'Approved'], ...(canManage ? [['Draft', 'Draft'], ['Retired', 'Retired']] : [])]
  const chipCount = (k) => (k === '' ? counts.approved + counts.draft + counts.retired : counts[k.toLowerCase()])

  const dialogs = (
    <>
      {deleting && <DeleteDialog protocol={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />}
    </>
  )

  if (modal) {
    return (
      <AppShell>
        <ProtocolModal
          protocol={modal.protocol}
          initialDisease={modal.disease}
          diseases={diseases}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      </AppShell>
    )
  }

  if (openProtocol) {
    return (
      <AppShell>
        {actionError && <p role="alert" className="mb-4 text-sm text-red-700">{actionError}</p>}
        <ProtocolDetail
          key={openProtocol.id}
          protocol={openProtocol}
          canManage={canManage}
          busy={busy}
          onBack={closeDetail}
          diseases={diseases}
          onSaved={onSaved}
          onStatus={changeStatus}
          onDelete={setDeleting}
        />
        {dialogs}
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
       <div className="max-w-2xl">
  <h2 className="text-xl font-bold text-brand-navy">Response Protocols</h2>
  <p className="text-sm text-gray-400">
    What to do when each priority disease or unusual event is reported. Approved protocols appear as a checklist on every matching event in Review Queue.
  </p>
</div>
        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={exportVisible} disabled={visible.length === 0}
            className={`inline-flex items-center gap-2 ${btnSecondary}`}>
            <Download className="w-4 h-4" aria-hidden="true" /> Export
          </button>
          {canManage && (
            <button type="button" onClick={() => setModal({ protocol: null, disease: '' })}
              className={`inline-flex items-center gap-2 ${btnPrimary}`}>
              <Plus className="w-4 h-4" aria-hidden="true" /> New protocol
            </button>
          )}
        </div>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${canManage ? 'xl:grid-cols-4' : 'xl:grid-cols-3'} gap-4 mb-5`}>
        <SummaryCard label="Approved" value={counts.approved} Icon={CheckCircle2} />
        {canManage && <SummaryCard label="Drafts awaiting review" value={counts.draft} Icon={FileEdit} />}
        <SummaryCard label="Diseases covered" value={diseasesCovered} Icon={Stethoscope} />
        <SummaryCard label="Due for review" value={dueForReview} Icon={CalendarClock} />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search protocols"
            placeholder="Search title, disease or step"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputCls} pl-9`}
          />
        </div>
        <select aria-label="Disease" value={disease} onChange={(e) => setDisease(e.target.value)} className={`${inputCls} lg:w-56`}>
          <option value="">All diseases</option>
          {diseases.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
        </select>
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Status">
          {chips.map(([key, label]) => (
            <button key={label} type="button" onClick={() => setStatus(key)} aria-pressed={status === key}
              className={`rounded-full border px-4 h-9 text-sm font-medium ${FOCUS} ${status === key ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {label}{!loading && <span className="ml-1.5 opacity-70">{chipCount(key)}</span>}
            </button>
          ))}
        </div>
      </div>

      {actionError && <p role="alert" className="mb-4 text-sm text-red-700">{actionError}</p>}

      {loading ? (
        <Skeleton />
      ) : error ? (
        <div className={`${card} py-16 text-center space-y-3`}>
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={() => { setLoading(true); load() }} className={btnPrimary}>Retry</button>
        </div>
      ) : visible.length === 0 ? (
        <div className={`${card} p-12 text-center text-sm text-gray-400`}>
          {protocols.length === 0
            ? (canManage ? 'No protocols yet. Click New protocol to add one.' : 'No approved protocols yet.')
            : 'No protocols match your filters.'}
        </div>
      ) : (
        <div className={`${card} p-4`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2.5 font-medium rounded-l-lg">Protocol</th>
                  <th className="px-3 py-2.5 font-medium hidden md:table-cell">Priority</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium hidden lg:table-cell">Steps</th>
                  <th className="px-3 py-2.5 font-medium hidden lg:table-cell">Verification</th>
                  <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Updated</th>
                  <th className="px-3 py-2.5 font-medium rounded-r-lg"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => <ProtocolRow key={p.id} protocol={p} onOpen={(proto) => openDetail(proto.id)} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialogs}
    </AppShell>
  )
}
