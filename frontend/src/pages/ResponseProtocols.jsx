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
const KINDS = ['Case definition', 'Supports', 'Red flag']
const KIND_TAG = {
  'Case definition': 'bg-blue-50 text-blue-600',
  'Red flag': 'bg-red-50 text-red-600',
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
            <ClipboardList className="w-5 h-5 text-red-600" aria-hidden="true" />
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

function ProtocolCard({ protocol: p, onOpen, cardRef }) {
  const retired = p.status === 'Retired'
  const qCount = (p.questions || []).length
  return (
    <div ref={cardRef} className={`${card} ${retired ? 'opacity-80' : ''}`}>
      <div
        role="link"
        tabIndex={0}
        onClick={() => onOpen(p)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p) } }}
        className={`p-5 sm:p-6 cursor-pointer rounded-2xl hover:bg-gray-50/60 ${FOCUS}`}
      >
        <ProtocolHeader p={p} />
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-900">
            {p.stepCount} response steps{qCount > 0 ? ` · ${qCount} verification questions` : ''}
          </span>
          <ChevronRight className="w-5 h-5 text-gray-500" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

function ProtocolDetail({ protocol: p, canManage, busy, onBack, onEdit, onStatus, onDelete }) {
  const [tab, setTab] = useState('Investigation')
  const retired = p.status === 'Retired'
  return (
    <div>
      <button type="button" onClick={onBack} className={`mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 rounded ${FOCUS}`}>
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> All protocols
      </button>
      <div className={`${card} ${retired ? 'opacity-80' : ''}`}>
      <div className="p-5 sm:p-6">
        <ProtocolHeader p={p} />
        {p.status === 'Draft' && (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            Draft: not shown to officers until approved.
          </p>
        )}

        {(
          <div className="mt-5 pt-4 border-t border-gray-100">
            <div role="tablist" aria-label="Protocol sections" className="flex gap-1 border-b border-gray-100 mb-4 overflow-x-auto">
              {TABS.map((t) => {
                const count = t === 'Verification questions'
                  ? (p.questions || []).length
                  : p.steps.filter((s) => (s.phase || 'Investigation') === t).length
                const active = tab === t
                return (
                  <button key={t} type="button" role="tab" aria-selected={active} onClick={() => setTab(t)}
                    className={`px-4 py-2 -mb-px text-sm font-medium whitespace-nowrap border-b-2 rounded-t ${FOCUS} ${active ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
                    {t}<span className="ml-1.5 text-xs opacity-70">{count}</span>
                  </button>
                )
              })}
            </div>

            {PHASES.includes(tab) && (() => {
              const group = p.steps.filter((s) => (s.phase || 'Investigation') === tab)
              if (group.length === 0) return <p className="text-sm text-gray-400">No {tab.toLowerCase()} steps.</p>
              return (
                <div role="tabpanel">
                  <ol className="flex flex-col gap-3">
                    {group.map((s) => (
                      <li key={s.n} className="flex gap-3">
                        <span className="w-6 h-6 shrink-0 rounded-full bg-gray-100 text-xs font-semibold text-gray-600 flex items-center justify-center">{s.n}</span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-gray-900">{s.step}</span>
                            {s.timeframe && <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">{s.timeframe}</span>}
                          </div>
                          {s.responsible && <p className="text-xs text-gray-400 mt-0.5">Responsible: {s.responsible}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )
            })()}

            {tab === 'Verification questions' && (!p.questions || p.questions.length === 0) && (
              <p className="text-sm text-gray-400">No verification questions.</p>
            )}
            {tab === 'Verification questions' && p.questions?.length > 0 && (
              <div role="tabpanel">
                <ol className="flex flex-col gap-3">
                  {p.questions.map((q, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-6 h-6 shrink-0 rounded-full bg-gray-100 text-xs font-semibold text-gray-600 flex items-center justify-center">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-gray-900">{q.question}</span>
                          {KIND_TAG[q.kind] && (
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_TAG[q.kind]}`}>{q.kind}</span>
                          )}
                        </div>
                        {q.why && <p className="text-xs text-gray-400 mt-0.5">Why we ask: {q.why}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-gray-100 flex flex-col gap-3">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
                {p.source && (
                  <span>
                    Source:{' '}
                    {p.sourceUrl ? (
                      <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline inline-flex items-center gap-1">
                        {p.source}<ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>
                    ) : p.source}
                  </span>
                )}
                {p.reviewDate && <span>Next review {fmtDateTime(p.reviewDate)}</span>}
                {p.approvedBy && <span>Approved by {p.approvedBy} on {fmtDateTime(p.approvedOn)}</span>}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => onEdit(p)} className={btnSecondary}>Edit</button>
                  {p.status === 'Draft' && (
                    <button type="button" disabled={busy} onClick={() => onStatus(p, 'Approved')} className={btnPrimary}>Approve</button>
                  )}
                  {p.status === 'Approved' && (
                    <button type="button" disabled={busy} onClick={() => onStatus(p, 'Draft')} className={btnSecondary}>Return to draft</button>
                  )}
                  {p.status !== 'Retired' && (
                    <button type="button" disabled={busy} onClick={() => onStatus(p, 'Retired')} className={btnSecondary}>Retire</button>
                  )}
                  <button type="button" disabled={busy} onClick={() => onDelete(p)}
                    className={`border border-red-200 text-red-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50 ${FOCUS}`}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
      <span>{text}{required && <span className="text-red-600"> *</span>}</span>
      {children}
    </label>
  )
}

const blankStep = () => ({ step: '', timeframe: '', responsible: '', phase: 'Investigation' })
const blankQuestion = () => ({ question: '', why: '', kind: 'Case definition' })

function ProtocolModal({ protocol, initialDisease, diseases, onClose, onSaved }) {
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
      ? protocol.steps.map((s) => ({ step: s.step, timeframe: s.timeframe || '', responsible: s.responsible || '', phase: s.phase || 'Investigation' }))
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
      .map((s) => ({ step: s.step.trim(), timeframe: s.timeframe.trim(), responsible: s.responsible.trim(), phase: s.phase }))
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

  return (
    <Modal title={editing ? 'Edit protocol' : 'New protocol'} onClose={saving ? () => {} : onClose} wide>
      <form onSubmit={submit} className="p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit protocol' : 'New protocol'}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className={`rounded ${FOCUS}`}><X className="w-5 h-5" /></button>
        </div>

        {editing && protocol.status === 'Approved' && (
          <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            Saving will return this protocol to Draft for re-approval.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Label text="Disease" required>
            <select className={inputCls} value={form.disease} onChange={(e) => onDisease(e.target.value)}>
              <option value="">Select a disease</option>
              {diseases.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>
          </Label>
          <Label text="Title" required>
            <input className={inputCls} value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </Label>
        </div>

        <Label text="Summary">
          <textarea rows={2} className={inputCls} value={form.summary} onChange={(e) => set({ summary: e.target.value })} />
        </Label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>

        <p className="text-sm text-gray-500">
          Owner: <span className="font-medium text-gray-900">{editing ? (protocol.owner || '—') : currentUserFullName()}</span>
        </p>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-900">Steps <span className="text-red-600">*</span></span>
          <p className="text-xs text-gray-500">
            Investigation steps are done during field investigation (including first treatment and isolation). Response steps open after the outbreak is confirmed or escalated.
          </p>
          {form.steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-gray-100 p-3">
              <span className="w-6 h-6 mt-1.5 shrink-0 rounded-full bg-gray-100 text-xs font-semibold text-gray-600 flex items-center justify-center">{i + 1}</span>
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input aria-label={`Step ${i + 1}`} className={`${inputCls} sm:col-span-3`} placeholder="Step" value={s.step} onChange={(e) => setStep(i, { step: e.target.value })} />
                <input aria-label={`Timeframe for step ${i + 1}`} className={inputCls} placeholder="Timeframe (e.g. within 24 h)" value={s.timeframe} onChange={(e) => setStep(i, { timeframe: e.target.value })} />
                <input aria-label={`Responsible for step ${i + 1}`} className={inputCls} placeholder="Responsible" value={s.responsible} onChange={(e) => setStep(i, { responsible: e.target.value })} />
                <select aria-label={`Phase for step ${i + 1}`} className={inputCls} value={s.phase} onChange={(e) => setStep(i, { phase: e.target.value })}>
                  {PHASES.map((ph) => <option key={ph} value={ph}>{ph}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-0.5 text-gray-400">
                <button type="button" aria-label="Move step up" disabled={i === 0} onClick={() => move(i, -1)} className={`p-1 rounded hover:text-gray-900 disabled:opacity-30 ${FOCUS}`}><ArrowUp className="w-4 h-4" /></button>
                <button type="button" aria-label="Move step down" disabled={i === form.steps.length - 1} onClick={() => move(i, 1)} className={`p-1 rounded hover:text-gray-900 disabled:opacity-30 ${FOCUS}`}><ArrowDown className="w-4 h-4" /></button>
                <button type="button" aria-label="Remove step" disabled={form.steps.length === 1}
                  onClick={() => set({ steps: form.steps.filter((_, idx) => idx !== i) })}
                  className={`p-1 rounded hover:text-red-600 disabled:opacity-30 ${FOCUS}`}><X className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => set({ steps: [...form.steps, blankStep()] })}
            className={`self-start text-sm font-medium text-red-600 hover:underline rounded ${FOCUS}`}>
            + Add step
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-900">Verification questions</span>
          <p className="text-xs text-gray-500">
            Officers answer each question Yes / No / Not sure. Case definition: No suggests discarding. Red flag: Yes suggests escalating at once. Supports: Yes makes a real event more likely.
          </p>
          {form.questions.map((q, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-gray-100 p-3">
              <span className="w-6 h-6 mt-1.5 shrink-0 rounded-full bg-gray-100 text-xs font-semibold text-gray-600 flex items-center justify-center">{i + 1}</span>
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <textarea rows={2} aria-label={`Question ${i + 1}`} className={`${inputCls} sm:col-span-3`} placeholder="Question" value={q.question} onChange={(e) => setQuestion(i, { question: e.target.value })} />
                <input aria-label={`Why we ask question ${i + 1}`} className={`${inputCls} sm:col-span-2`} placeholder="Why we ask" value={q.why} onChange={(e) => setQuestion(i, { why: e.target.value })} />
                <select aria-label={`Kind for question ${i + 1}`} className={inputCls} value={q.kind} onChange={(e) => setQuestion(i, { kind: e.target.value })}>
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-0.5 text-gray-400">
                <button type="button" aria-label="Move question up" disabled={i === 0} onClick={() => moveQuestion(i, -1)} className={`p-1 rounded hover:text-gray-900 disabled:opacity-30 ${FOCUS}`}><ArrowUp className="w-4 h-4" /></button>
                <button type="button" aria-label="Move question down" disabled={i === form.questions.length - 1} onClick={() => moveQuestion(i, 1)} className={`p-1 rounded hover:text-gray-900 disabled:opacity-30 ${FOCUS}`}><ArrowDown className="w-4 h-4" /></button>
                <button type="button" aria-label="Remove question" onClick={() => set({ questions: form.questions.filter((_, idx) => idx !== i) })}
                  className={`p-1 rounded hover:text-red-600 ${FOCUS}`}><X className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => set({ questions: [...form.questions, blankQuestion()] })}
            className={`self-start text-sm font-medium text-red-600 hover:underline rounded ${FOCUS}`}>
            + Add question
          </button>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-900">
          <input type="checkbox" className="mt-0.5 accent-red-600" checked={form.notifyImmediately} onChange={(e) => set({ notifyImmediately: e.target.checked })} />
          <span>
            <span className="font-medium">Single case is an emergency</span>
            <span className="block text-xs text-gray-500">One case meeting the case definition is escalated immediately (e.g. VHF, polio).</span>
          </span>
        </label>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create protocol'}
          </button>
        </div>
      </form>
    </Modal>
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
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
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
      {modal && (
        <ProtocolModal
          protocol={modal.protocol}
          initialDisease={modal.disease}
          diseases={diseases}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      )}
      {deleting && <DeleteDialog protocol={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />}
    </>
  )

  if (openProtocol) {
    return (
      <AppShell>
        {actionError && <p role="alert" className="mb-4 text-sm text-red-600">{actionError}</p>}
        <ProtocolDetail
          key={openProtocol.id}
          protocol={openProtocol}
          canManage={canManage}
          busy={busy}
          onBack={closeDetail}
          onEdit={(proto) => setModal({ protocol: proto, disease: '' })}
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
  <h2 className="text-xl font-bold text-gray-900">Response Protocols</h2>
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

      {actionError && <p role="alert" className="mb-4 text-sm text-red-600">{actionError}</p>}

      {loading ? (
        <Skeleton />
      ) : error ? (
        <div className={`${card} py-16 text-center space-y-3`}>
          <p className="text-sm text-red-500">{error}</p>
          <button type="button" onClick={() => { setLoading(true); load() }} className={btnPrimary}>Retry</button>
        </div>
      ) : visible.length === 0 ? (
        <div className={`${card} p-12 text-center text-sm text-gray-400`}>
          {protocols.length === 0
            ? (canManage ? 'No protocols yet. Click New protocol to add one.' : 'No approved protocols yet.')
            : 'No protocols match your filters.'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((p) => (
            <ProtocolCard
              key={p.id}
              protocol={p}
              onOpen={(proto) => openDetail(proto.id)}
            />
          ))}
        </div>
      )}

      {dialogs}
    </AppShell>
  )
}
