import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AlertTriangle, Check, Link2, ShieldAlert, Sparkles, X, ExternalLink,
  Camera, Mic, FileText, Paperclip, Phone, Scissors, MapPin, Calendar, Users, Building2, ChevronDown } from 'lucide-react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { EventTasksProvider, EventTasksPanel, StepTaskLink, useStepTask, OpenTasksNotice } from '../components/tasks/EventTasks'
import AppShell from '../components/layout/AppShell'
import ContextPanel from '../components/context/ContextPanel'
import { RiskAssessment } from '../components/risk/RiskScore'
import { TILE_URL, TILE_ATTRIBUTION } from '../components/map/MapView'
import {
  getReviewEvent, setEventStatus, addEventNote, getInvestigation, answerVerification, getEscalationPreview,
  setStepOutcome, saveFindings, addEvidence, removeEvidence, uploadFile, checkReport, splitReport, getPlaceContext, mergeEvents, getCbsContact, getTrendCbsReports,
} from '../api/frappe'
import { useCapabilities } from '../context/CapabilitiesContext'
import ConsentQuestion, { consentOk, consentFields } from '../components/report/ConsentQuestion'
import { FOCUS, parseDate, fmtDateTime, relTime } from '../data/eventHelpers'

// Animal events (unusual death/illness of animals) are counted in cases, not people.
const isAnimal = (disease) => String(disease || '').includes('animal')
const countLabel = (n, disease) => `${n ?? 0} ${isAnimal(disease) ? (n === 1 ? 'case' : 'cases') : (n === 1 ? 'person' : 'people')}`

const BANNER = { critical: 'bg-red-600', high: 'bg-amber-500', standard: 'bg-blue-500' }
const SEVERITY_LABELS = { critical: 'Critical', high: 'High', standard: 'Standard' }
const STATUS_LABELS = { Investigating: 'In the field' }

const PRIMARY = 'bg-red-600 text-white hover:bg-red-700 border-red-600'
const SECONDARY = 'bg-white text-gray-900 border-gray-200 hover:bg-gray-50'
const BTN = 'border rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
const INPUT = `w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 placeholder:text-gray-300 ${FOCUS}`

const ACTION_LABELS = {
  start: 'Start verification',
  investigate: 'Proceed to field investigation',
  confirm: 'Confirm',
  escalate: 'Escalation',
  discard: 'Discard',
  close: 'Close',
  close_unconfirmed: 'Close: no event found',
  reopen: 'Reopen',
}

const STEPS = [
  { n: 1, label: 'Signal captured' },
  { n: 2, label: 'AI triage', sub: 'Case definition & context' },
  { n: 3, label: 'Verification', sub: 'Officer' },
  { n: 4, label: 'Field investigation', sub: 'Officer' },
  { n: 5, label: 'Decision', sub: 'Officer' },
  { n: 6, label: 'Response & close', sub: 'Team' },
]

const OUTCOMES = [
  { value: 'Done', label: 'Done' },
  { value: 'Not done', label: 'Not done' },
  { value: 'Not applicable', label: 'N/A' },
]

const card = 'bg-white rounded-2xl border border-gray-100 p-6 sm:p-7'

function computeSteps(event, inv) {
  const status = event.status
  const canConfirm = !!inv?.gates?.canConfirm
  const states = ['future', 'future', 'future', 'future', 'future', 'future']
  const mark = (upTo) => { for (let i = 0; i < upTo; i++) states[i] = 'done' }
  let current = 3

  if (status === 'New' || status === 'Verifying') {
    mark(2)
    states[2] = 'current'
    current = 3
  } else if (status === 'Investigating') {
    if (canConfirm) { mark(4); states[4] = 'current'; current = 5 } else { mark(3); states[3] = 'current'; current = 4 }
  } else if (status === 'Confirmed' || status === 'Escalated') {
    mark(5)
    states[5] = 'current'
    current = 6
  } else if (status === 'Closed' && inv?.decision?.decision === 'Not confirmed') {
    mark(5)
    states[5] = 'disabled'
    current = 5
  } else if (status === 'Closed') {
    mark(6)
    current = 6
  } else if (status === 'Discarded') {
    mark(2)
    const investigated = (inv?.investigationSteps || []).some((s) => s.outcome) || !!inv?.findings || (inv?.evidence || []).length > 0
    const at = investigated ? 4 : 3
    states[at - 1] = 'discarded'
    for (let i = at; i < 6; i++) states[i] = 'disabled'
    current = 6
  }
  return { states, current }
}

function Tracker({ event, states, openStep, onSelect }) {
  const sources = (event.sources || []).join(', ')
  return (
    <nav aria-label="Investigation progress" className="bg-white rounded-2xl border border-gray-100 px-4 sm:px-6 py-4 overflow-x-auto">
      <ol className="flex items-start min-w-[560px]">
        {STEPS.map((s, i) => {
          const state = states[i]
          const isOpen = openStep === s.n
          const info = s.n === 1  // Signal captured: informational only
          const clickable = !info && (state === 'done' || state === 'current' || state === 'discarded')
          // Red = the step on screen. Green tick = finished. Everything else grey.
          const circle =
            isOpen ? 'bg-red-600 text-white'
              : state === 'done' ? 'bg-emerald-500 text-white'
                : state === 'current' ? 'bg-white text-gray-700 ring-1 ring-gray-300'
                  : 'bg-gray-100 text-gray-400'
          const text = isOpen ? 'text-red-700 font-semibold' : state === 'done' || state === 'current' ? 'text-gray-800' : 'text-gray-400'
          const sub = state === 'discarded' ? 'Discarded' : s.n === 1 ? sources || 'Reports'
            : state === 'current' && !isOpen ? 'Next step' : ''
          return (
            <li key={s.n} className="flex-1 relative">
              {i > 0 && <span className={`absolute top-3.5 right-1/2 w-full h-0.5 ${state === 'done' || isOpen || state === 'current' ? 'bg-gray-300' : 'bg-gray-100'}`} aria-hidden="true" />}
              <button
                type="button"
                disabled={!clickable}
                tabIndex={info ? -1 : undefined}
                aria-label={`Step ${s.n}: ${s.label}${state === 'discarded' ? ', discarded' : ''}`}
                aria-current={isOpen ? 'step' : undefined}
                onClick={() => onSelect(s.n)}
                className={`relative z-10 w-full flex flex-col items-center gap-1.5 rounded-lg px-1 ${info ? 'cursor-default' : 'disabled:cursor-not-allowed'} ${FOCUS}`}
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${circle}`}>
                  {state === 'done' && !isOpen ? <Check className="w-4 h-4" aria-hidden="true" /> : state === 'discarded' ? <X className="w-4 h-4" aria-hidden="true" /> : s.n}
                </span>
                <span className={`text-xs text-center leading-tight ${text}`}>{s.label}</span>
                {sub && <span className="text-[11px] text-gray-400 -mt-1">{sub}</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function Seg({ options, value, onChange, disabled, label }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const selected = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            aria-label={`${label}: ${o.label}`}
            onClick={() => onChange(o.value)}
            className={`border rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed ${selected ? (o.value === 'Done' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-gray-800 border-gray-800 text-white') : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'} ${FOCUS}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function PanelHeader({ title, sub }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      {sub && <p className="text-sm text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

const SUGGESTION_STYLES = {
  critical: 'border-red-300 bg-red-50 text-red-700',
  high: 'border-amber-300 bg-amber-50 text-amber-700',
  medium: 'border-slate-300 bg-slate-50 text-slate-700',
  low: 'border-gray-200 bg-gray-50 text-gray-600',
  info: 'border-gray-200 bg-gray-50 text-gray-600',
}

function SuggestionBox({ suggestion }) {
  if (!suggestion) return null
  const cls = SUGGESTION_STYLES[suggestion.level] || SUGGESTION_STYLES.info
  const reasons = suggestion.reasons || []
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        <Sparkles className="w-4 h-4" aria-hidden="true" /> Suggestion (rule-based)
      </p>
      <p className="text-sm mt-1.5">{suggestion.text}</p>
      {reasons.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className={`cursor-pointer font-medium rounded ${FOCUS}`}>Why</summary>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

function matchedSigns(text) {
  const t = text || ''
  const i = t.indexOf('Matched:')
  if (i === -1) return t
  const rest = t.slice(i + 8)
  const j = rest.indexOf('MOH IDSR definition')
  return (j === -1 ? rest : rest.slice(0, j)).trim().replace(/[.;,]\s*$/, '')
}

function MiniSeg({ options, value, onChange, disabled, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
      {options.map((o, i) => {
        const selected = value === o
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            aria-label={`${label}: ${o}`}
            onClick={() => onChange(o)}
            className={`px-2.5 py-1 text-xs font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${i ? 'border-l border-gray-200' : ''} ${selected ? 'bg-red-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'} ${FOCUS}`}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

function SectionHeading({ letter, title, sub, done, total }) {
  const complete = total > 0 && done >= total
  return (
    <div className="flex items-start gap-3 mb-3">
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${complete ? 'bg-emerald-500 text-white' : 'bg-gray-900 text-white'}`}>
        {complete ? <Check className="w-4 h-4" aria-hidden="true" /> : letter}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          {total > 0 && <span className="text-xs text-gray-500 tabular-nums">{done}/{total}</span>}
        </div>
        {sub && <p className="text-sm text-gray-500">{sub}</p>}
      </div>
    </div>
  )
}

function ReportCheckRow({ s, canVerify, canAct, canSplit, saving, onCheck, onSplit }) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const reached = s.check?.reached || null
  const meets = s.check?.meetsCaseDefinition || null
  const notCase = checkStatus(s) === 'Not a case'
  const save = (r, m, n = '') => onCheck(s, r, m, n)
  const strike = notCase ? 'line-through text-gray-400' : ''
  return (
    <>
      <tr className={`border-t border-gray-100 align-top ${notCase ? 'bg-gray-50' : ''} ${saving ? 'opacity-60' : ''}`}>
        <td className="px-3 py-3 whitespace-nowrap">
          <div className="text-sm font-medium text-gray-900">{s.source}</div>
          {s.source === 'Field' && s.ref ? (
            <Link to={`/reports/${encodeURIComponent(s.ref)}`} className={`font-mono text-xs text-red-700 hover:underline rounded ${FOCUS}`}>{s.ref}</Link>
          ) : (
            <div className="font-mono text-xs text-gray-500">{s.ref || '—'}</div>
          )}
          <div className="text-xs text-gray-400" title={fmtDateTime(s.date)}>{relTime(s.date)}</div>
        </td>
        <td className={`px-3 py-3 text-sm text-gray-700 min-w-[180px] ${strike}`}>
          <div>{s.area || '—'} · {countLabel(s.people, s.disease)}</div>
          <div className="text-xs text-gray-500 mt-0.5">{s.reported || '—'}</div>
          {notCase && <div className="text-xs text-gray-400 no-underline">Not counted in the totals</div>}
        </td>
        <td className="px-3 py-3 text-sm min-w-[150px]"><ReporterContact signal={s} canAct={canAct} /></td>
        <td className="px-3 py-3">
          {canVerify ? (
            <MiniSeg label={`Reporter reached, ${s.ref || s.source}`} options={['Yes', 'No']} value={reached} disabled={saving} onChange={(v) => save(v, meets)} />
          ) : <span className="text-sm text-gray-700">{reached || '—'}</span>}
        </td>
        <td className="px-3 py-3">
          {canVerify ? (
            <MiniSeg label={`Meets case definition, ${s.ref || s.source}`} options={['Yes', 'No', 'Not sure']} value={meets} disabled={saving} onChange={(v) => save(reached, v)} />
          ) : <span className="text-sm text-gray-700">{meets || '—'}</span>}
        </td>
        <td className="px-3 py-3"><CheckPill signal={s} /></td>
        <td className="px-3 py-3 whitespace-nowrap text-right">
          {canVerify && (
            <button type="button" aria-label="Add note to this check" title="Add note" onClick={() => setNoteOpen((v) => !v)} className={`rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-900 ${FOCUS}`}>
              <FileText className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {canSplit && (
            <button type="button" aria-label="Split into its own event" title="Split into its own event" onClick={() => onSplit(s)} className={`ml-1.5 rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-900 ${FOCUS}`}>
              <Scissors className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </td>
      </tr>
      {noteOpen && (
        <tr className="bg-gray-50">
          <td colSpan={7} className="px-3 py-3">
            <div className="flex gap-2 items-start">
              <input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder="Note about this check (goes to the audit timeline)" className={INPUT} />
              <button type="button" disabled={saving || !note.trim()} onClick={() => { save(reached, meets, note.trim()); setNote(''); setNoteOpen(false) }} className={`${BTN} ${PRIMARY} ${FOCUS}`}>Save</button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function KeyCheckLine({ check }) {
  if (!check || !check.total) return null
  const tone = check.met ? 'text-emerald-700' : check.failed ? 'text-red-700' : 'text-gray-600'
  return (
    <p className={`mb-3 text-sm ${tone}`}>
      <span className="font-medium">Key questions: {check.yes} of {check.total} Yes</span>
      <span className="text-gray-500"> · at least {check.needed} needed to start the field investigation</span>
    </p>
  )
}

function VerificationPanel({ event, inv, editable, busy, busyKey, signals, canVerify, canAct, canSplit, onCheck, onSplit, onAnswer, onProceed, onDecide, onDiscard }) {
  const [showAll, setShowAll] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const keyCheck = inv.gates?.keyCheck
  const keyFailed = !!keyCheck?.failed
  const [discardReason, setDiscardReason] = useState('')
  useEffect(() => {
    if (keyFailed && !discardReason) {
      setDiscardReason(`Does not meet the criteria for an event: only ${keyCheck.yes} of ${keyCheck.total} key questions answered Yes.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyFailed])
  const checkedCount = signals.filter((s) => checkStatus(s) !== 'Not checked').length
  const ordered = [
    ...signals.filter((s) => checkStatus(s) === 'Not checked'),
    ...signals.filter((s) => checkStatus(s) !== 'Not checked'),
  ]
  const visible = showAll ? ordered : ordered.slice(0, 5)
  const all = inv.questions || []
  const caseQ = all.find((q) => String(q.kind || '').toLowerCase().includes('case'))
  const qText = caseQ?.question || ''
  const definition = qText.includes('?') ? qText.slice(qText.indexOf('?') + 1).trim() : ''
  const questions = all.filter((q) => q !== caseQ)
  const answered = questions.filter((q) => q.answer).length
  const unanswered = inv.gates?.unansweredQuestions || []
  const open = event.status === 'New' || event.status === 'Verifying'
  const action = inv.suggestion?.action
  const fromTrend = signals.length === 0 && !!event.fromAlert
  const reportsDone = fromTrend ? !!caseQ?.answer : checkedCount > 0
  const questionsDone = answered === questions.length
  const next = !reportsDone ? (fromTrend ? 'Answer the case definition question in A.' : 'Check at least one report in A.')
    : !questionsDone ? `Answer the ${questions.length - answered} remaining question(s) in B (Not sure is fine).`
      : 'Ready. Read the suggestion and continue.'

  return (
    <div className={card}>
      <PanelHeader title="Guided verification" sub="A: check the reports. B: answer questions about the situation. C: decide the next step." />

      {fromTrend && (
        <section aria-label="Check the trend" className="mb-8">
          <SectionHeading letter="A" title="Check the trend" sub="This investigation was opened from Epi Trends: there are no individual reports. Call the facility or the CHA to check the cases." done={caseQ?.answer ? 1 : 0} total={1} />
          <div className="rounded-xl border border-purple-100 bg-purple-50 p-4 text-sm text-purple-900 mb-3">
            <p>{event.reason}</p>
            <Link to={`/epi-trends/${encodeURIComponent(event.fromAlert)}`} className={`inline-block mt-2 text-xs font-semibold text-purple-700 hover:underline rounded ${FOCUS}`}>
              View the trend and chart
            </Link>
          </div>
          <TrendCbsReports eventId={event.id} />
          {caseQ && (
            <div className="border border-gray-100 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">After speaking to the facility or community, do the cases meet the case definition?</p>
                {definition && <p className="text-xs text-gray-400 mt-0.5">{definition}</p>}
              </div>
              <MiniSeg
                label="Case definition"
                options={['Yes', 'No', 'Not sure']}
                value={caseQ.answer}
                disabled={!editable || busy || busyKey === `q-${caseQ.n}`}
                onChange={(v) => onAnswer(caseQ.n, v)}
              />
            </div>
          )}
        </section>
      )}

      {!fromTrend && (
      <section aria-label="Check the reports" className="mb-8">
        <SectionHeading letter="A" title="Check the reports" sub="Call each reporter and confirm the case. You need at least one checked report." done={checkedCount} total={signals.length} />
        {definition && (
          <p className="mb-3 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-800">
            <span className="font-semibold">Case definition:</span> {definition}
          </p>
        )}
        <div className="border border-gray-100 rounded-xl overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="px-3 py-2.5 font-medium">Report</th>
                <th className="px-3 py-2.5 font-medium">Where · what was reported</th>
                <th className="px-3 py-2.5 font-medium">Reporter</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Reached?</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Meets case definition?</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s, i) => (
                <ReportCheckRow
                  key={s.id || i}
                  s={s}
                  canVerify={canVerify}
                  canAct={canAct}
                  canSplit={canSplit}
                  saving={busyKey === `chk-${s.id}`}
                  onCheck={onCheck}
                  onSplit={onSplit}
                />
              ))}
            </tbody>
          </table>
        </div>
        {ordered.length > 5 && (
          <button type="button" onClick={() => setShowAll(!showAll)} className={`mt-2 text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
            {showAll ? 'Show fewer' : `Show ${ordered.length - 5} more`}
          </button>
        )}
        <p className="mt-2 text-xs text-gray-500">
          Answers save as you click. Verified = reached and meets the case definition. Not a case = does not meet it (not counted in totals).
        </p>
      </section>

      )}

      <section aria-label="Questions about the situation" className={`mb-8 ${!reportsDone ? 'opacity-50' : ''}`}>
        <SectionHeading
          letter="B"
          title="About the situation"
          sub="These are about the whole situation in this place, not one report. Ask the reporter, the facility or the team."
          done={answered}
          total={questions.length}
        />
        {!reportsDone && <p className="mb-3 text-sm text-gray-500">{fromTrend ? 'Answer A first.' : 'Check a report in A first.'}</p>}
        {questions.length === 0 ? (
          <p className="text-sm text-gray-400">No other questions for this event.</p>
        ) : (
          <ul className="border border-gray-100 rounded-xl divide-y divide-gray-100">
            {questions.map((q, i) => {
              const rowBusy = busyKey === `q-${q.n}`
              const red = q.redFlag ?? String(q.kind || '').toLowerCase().includes('red')
              const key = q.key ?? q.kind === 'Key question'
              return (
                <li key={q.n} className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${rowBusy ? 'opacity-60' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="text-gray-400 mr-1.5 tabular-nums">{i + 1}.</span>
                      {q.question}
                      {red && <span className="ml-2 align-middle rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-[11px] font-medium">Red flag</span>}
                      {key && <span className="ml-2 align-middle rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-[11px] font-medium">Key</span>}
                    </p>
                    {q.why && <p className="text-xs text-gray-400 mt-0.5">{q.why}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {q.answer && <Check className="w-4 h-4 text-emerald-500" aria-hidden="true" />}
                    <MiniSeg
                      label={`Question ${i + 1}`}
                      options={['Yes', 'No', 'Not sure']}
                      value={q.answer}
                      disabled={!editable || !reportsDone || rowBusy || busy}
                      onChange={(v) => onAnswer(q.n, v)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-label="Next step">
        <SectionHeading letter="C" title="Next step" />
        <KeyCheckLine check={inv.gates?.keyCheck} />
        <SuggestionBox suggestion={inv.suggestion} />
        {editable && open && (
          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap rounded-xl bg-gray-50 border border-gray-100 p-3">
            <p className="text-sm text-gray-600">{next}</p>
            <div className="flex gap-2 flex-wrap">
              {action === 'escalate' && (
                <button type="button" disabled={busy} onClick={() => onDecide('escalate')} className={`${BTN} ${PRIMARY} ${FOCUS}`}>Escalate now</button>
              )}
              {(action === 'discard' || keyFailed) && !discarding && (
                <button type="button" disabled={busy} onClick={() => setDiscarding(true)} className={`${BTN} ${keyFailed ? PRIMARY : SECONDARY} ${FOCUS}`}>Discard signal</button>
              )}
              {!keyFailed && (
                <button
                  type="button"
                  disabled={busy || unanswered.length > 0 || !inv.gates?.canStartInvestigation}
                  onClick={onProceed}
                  className={`${BTN} ${action === 'escalate' ? SECONDARY : PRIMARY} ${FOCUS}`}
                >
                  Proceed to field investigation
                </button>
              )}
              {action !== 'escalate' && (
                <button type="button" disabled={busy} onClick={() => onDecide('escalate')} className={`text-sm font-medium text-gray-500 hover:text-gray-900 underline underline-offset-2 rounded ${FOCUS}`}>
                  Escalate instead
                </button>
              )}
            </div>
          </div>
        )}
        {editable && open && discarding && (
          <div className="mt-3 rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-gray-900 mb-1.5">Why discard? <span className="text-red-700">*</span></span>
              <textarea rows={2} value={discardReason} onChange={(e) => setDiscardReason(e.target.value)} className={INPUT} />
            </label>
            <p className="text-xs text-gray-500">Field reporters get a thank-you note saying it was checked and closed.</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !discardReason.trim()} onClick={() => onDiscard(discardReason.trim())} className={`${BTN} ${PRIMARY} ${FOCUS}`}>Discard signal</button>
              <button type="button" disabled={busy} onClick={() => setDiscarding(false)} className={`${BTN} ${SECONDARY} ${FOCUS}`}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function OutcomeRow({ step, phase, editable, busy, onSet }) {
  const [draft, setDraft] = useState(null)
  const [reason, setReason] = useState('')
  const [override, setOverride] = useState(false)
  const done = step.outcome === 'Done'
  const handed = useStepTask(phase, step.n)
  const showButtons = editable && (!handed || override || step.outcome)

  function choose(value) {
    if (step.outcome === value) {
      setDraft(null)
      onSet(step.n, '', '')
      return
    }
    if (value === 'Done') {
      setDraft(null)
      onSet(step.n, 'Done', '')
      return
    }
    setDraft(value)
    setReason(step.reason || '')
  }

  async function save() {
    const ok = await onSet(step.n, draft, reason.trim())
    if (ok) setDraft(null)
  }

  const needsReason = draft === 'Not done'
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${done ? 'bg-emerald-500 text-white' : step.outcome ? 'bg-gray-300 text-white' : handed ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>
          {done ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : step.n}
        </span>
        <div className="min-w-0 flex-1 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{step.step}</span>
            {step.timeframe && <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">{step.timeframe}</span>}
          </div>
          {phase && !done && <StepTaskLink phase={phase} step={step} />}
          {handed && !step.outcome && (
            <p className="text-xs text-gray-500">
              {handed.status === 'In progress' ? 'In progress' : 'Handed over'}: this step completes itself when {handed.assignedToName.split(' ')[0]} marks the task done.
              {editable && !override && (
                <> <button type="button" onClick={() => setOverride(true)} className={`underline underline-offset-2 hover:text-gray-800 rounded ${FOCUS}`}>Record it yourself</button></>
              )}
            </p>
          )}
          {showButtons && (
            <Seg label={`Step ${step.n}`} options={OUTCOMES} value={step.outcome} disabled={busy} onChange={choose} />
          )}
          {!editable && step.outcome && !done && <p className="text-xs font-medium text-gray-600">{step.outcome}</p>}
          {draft && editable && (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label={`Reason for step ${step.n}${needsReason ? ' (required)' : ''}`}
                placeholder={needsReason ? 'Reason (required)' : 'Reason (optional)'}
                className={INPUT}
              />
              <div className="flex gap-2">
                <button type="button" aria-label={`Save reason for step ${step.n}`} disabled={busy || (needsReason && !reason.trim())} onClick={save} className={`${BTN} ${PRIMARY} ${FOCUS}`}>
                  Save
                </button>
                <button type="button" aria-label="Cancel" disabled={busy} onClick={() => setDraft(null)} className={`${BTN} ${SECONDARY} ${FOCUS}`}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {step.outcome && (step.by || step.reason) && (
            <p className="text-xs text-gray-400">
              {step.by && <>by {step.by}, <span title={fmtDateTime(step.on)}>{relTime(step.on)}</span></>}
              {step.reason && <>{step.by ? ' · ' : ''}{step.reason}</>}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

/** Calm progress line above the steps: "3 of 5 recorded", plus a reassuring hint. */
function StepProgress({ steps, open, handed, editable }) {
  if (!steps.length) return null
  const handedHere = steps.filter((s) => !s.outcome && (handed || []).includes(s.n)).length
  const recorded = steps.length - open.length - handedHere
  const pct = Math.round(((steps.length - open.length) / steps.length) * 100)
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-3 text-xs text-gray-500 mb-1.5">
        <span>
          <span className="font-medium text-gray-800">{recorded} of {steps.length}</span> recorded
          {handedHere > 0 && <> · {handedHere} with field workers</>}
        </span>
        {open.length === 0 && <span className="text-emerald-700 font-medium">All steps handled</span>}
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      {editable && open.length > 0 && (
        <p className="text-xs text-gray-400 mt-2">
          Tap what happened for each step. Not done and N/A are fine, just add a short reason. You can also hand a step to a field worker.
        </p>
      )}
    </div>
  )
}

function StepList({ steps, editable, busyKey, keyPrefix, onSet }) {
  return (
    <ul className="flex flex-col gap-4">
      {steps.map((s) => (
        <OutcomeRow
          key={s.n}
          step={s}
          phase={keyPrefix === 'inv' ? 'Investigation' : keyPrefix === 'resp' ? 'Response' : null}
          editable={editable}
          busy={busyKey === `${keyPrefix}-${s.n}`}
          onSet={(n, outcome, reason) => onSet(`${keyPrefix}-${n}`, n, outcome, reason)}
        />
      ))}
    </ul>
  )
}

function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo" className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/80" onClick={onClose} />
      <button type="button" aria-label="Close photo" onClick={onClose} className={`absolute top-4 right-4 rounded-full bg-white p-2 text-gray-900 ${FOCUS}`}>
        <X className="w-5 h-5" aria-hidden="true" />
      </button>
      <img src={src} alt="Evidence" className="relative max-h-full max-w-full rounded-lg" />
    </div>
  )
}

function EvidenceAdder({ busy, onUpload, onText, onError }) {
  const [pending, setPending] = useState(null)
  const [mode, setMode] = useState(null)
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const recorder = useRef(null)
  const stream = useRef(null)
  const photoRef = useRef(null)
  const fileRef = useRef(null)
  const audioRef = useRef(null)

  useEffect(() => () => {
    stream.current?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => () => {
    if (pending?.url) URL.revokeObjectURL(pending.url)
  }, [pending])

  function pick(type, file) {
    if (!file) return
    setPending({ type, file, url: URL.createObjectURL(file) })
  }

  async function startRecording() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = s
      const rec = new MediaRecorder(s)
      const chunks = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm'
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
        pick('Voice Note', new File(chunks, `voice-note.${ext}`, { type }))
        s.getTracks().forEach((t) => t.stop())
      }
      rec.start()
      recorder.current = rec
      setPending(null)
      setRecording(true)
    } catch {
      onError('Could not access the microphone. You can pick an audio file instead.')
    }
  }

  function stopRecording() {
    recorder.current?.stop()
    setRecording(false)
  }

  async function upload() {
    const ok = await onUpload(pending.type, pending.file, consentFields(pending.consent || { peopleShown: false }))
    if (ok) { setPending(null); setMode(null) }
  }

  async function addText() {
    const ok = await onText(text.trim())
    if (ok) { setText(''); setMode(null) }
  }

  const tile = `flex flex-col items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white p-4 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button type="button" aria-label="Add photo" disabled={busy} onClick={() => { setMode('photo'); photoRef.current?.click() }} className={tile}>
          <Camera className="w-5 h-5 text-red-700" aria-hidden="true" /> Photo
        </button>
        <button type="button" aria-label="Add voice note" disabled={busy} onClick={() => { setPending(null); setMode('voice') }} className={tile}>
          <Mic className="w-5 h-5 text-red-700" aria-hidden="true" /> Voice note
        </button>
        <button type="button" aria-label="Add text note" disabled={busy} onClick={() => { setPending(null); setMode('text') }} className={tile}>
          <FileText className="w-5 h-5 text-red-700" aria-hidden="true" /> Text note
        </button>
        <button type="button" aria-label="Add attachment" disabled={busy} onClick={() => { setMode('file'); fileRef.current?.click() }} className={tile}>
          <Paperclip className="w-5 h-5 text-red-700" aria-hidden="true" /> Attachment
        </button>
      </div>
      <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Choose photo" onChange={(e) => { pick('Photo', e.target.files?.[0]); e.target.value = '' }} />
      <input ref={fileRef} type="file" className="hidden" aria-label="Choose attachment" onChange={(e) => { pick('Attachment', e.target.files?.[0]); e.target.value = '' }} />
      <input ref={audioRef} type="file" accept="audio/*" className="hidden" aria-label="Choose audio file" onChange={(e) => { pick('Voice Note', e.target.files?.[0]); e.target.value = '' }} />

      {mode === 'voice' && (
        <div className="flex flex-wrap items-center gap-2">
          {!recording ? (
            <button type="button" aria-label="Record voice note" disabled={busy} onClick={startRecording} className={`${BTN} ${SECONDARY} ${FOCUS}`}>Record</button>
          ) : (
            <button type="button" aria-label="Stop recording" onClick={stopRecording} className={`${BTN} ${PRIMARY} ${FOCUS}`}>Stop</button>
          )}
          <button type="button" aria-label="Pick an audio file" disabled={busy || recording} onClick={() => audioRef.current?.click()} className={`${BTN} ${SECONDARY} ${FOCUS}`}>Pick audio file</button>
          {recording && <span className="text-sm text-red-700">Recording...</span>}
        </div>
      )}

      {mode === 'text' && (
        <div className="flex flex-col gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Text note" placeholder="Write a note..." className={INPUT} />
          <div className="flex gap-2">
            <button type="button" aria-label="Add note" disabled={busy || !text.trim()} onClick={addText} className={`${BTN} ${PRIMARY} ${FOCUS}`}>Add note</button>
            <button type="button" aria-label="Cancel" disabled={busy} onClick={() => setMode(null)} className={`${BTN} ${SECONDARY} ${FOCUS}`}>Cancel</button>
          </div>
        </div>
      )}

      {pending && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-3">
          {pending.type === 'Photo' ? (
            <img src={pending.url} alt="Preview" className="max-h-48 rounded-lg object-contain self-start" />
          ) : pending.type === 'Voice Note' ? (
            <audio src={pending.url} controls className="w-full" aria-label="Voice note preview" />
          ) : (
            <p className="text-sm text-gray-700 break-all">{pending.file.name}</p>
          )}
          {(pending.type === 'Photo' || pending.type === 'Voice Note') && (
            <ConsentQuestion value={pending.consent} onChange={(v) => setPending((p) => ({ ...p, consent: v }))} />
          )}
          <div className="flex gap-2">
            <button type="button" aria-label={pending.type === 'Voice Note' ? 'Use voice note' : 'Upload'}
              disabled={busy || ((pending.type === 'Photo' || pending.type === 'Voice Note') && !consentOk(pending.consent || { peopleShown: false }))}
              onClick={upload} className={`${BTN} ${PRIMARY} ${FOCUS}`}>
              {busy ? 'Uploading...' : pending.type === 'Voice Note' ? 'Use' : 'Upload'}
            </button>
            <button type="button" aria-label={pending.type === 'Voice Note' ? 'Discard voice note' : 'Discard'} disabled={busy} onClick={() => setPending(null)} className={`${BTN} ${SECONDARY} ${FOCUS}`}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function EvidenceGrid({ evidence, editable, busyKey, onRemove, onOpenPhoto }) {
  if (!evidence.length) return null
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {evidence.map((e) => (
        <li key={e.id} className="relative rounded-xl border border-gray-100 bg-white p-3 flex flex-col gap-2">
          {editable && (
            <button
              type="button"
              aria-label="Remove evidence"
              disabled={busyKey === `ev-${e.id}`}
              onClick={() => onRemove(e.id)}
              className={`absolute top-2 right-2 rounded-full bg-white border border-gray-200 p-1 text-gray-500 hover:text-red-700 disabled:opacity-50 ${FOCUS}`}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {e.type === 'Photo' && e.file ? (
            <button type="button" aria-label="Open photo" onClick={() => onOpenPhoto(e.file)} className={`self-start rounded-lg ${FOCUS}`}>
              <img src={e.file} alt="Evidence photo" className="h-28 w-auto max-w-full rounded-lg object-cover" />
            </button>
          ) : e.type === 'Voice Note' && e.file ? (
            <audio src={e.file} controls className="w-full" aria-label="Voice note" />
          ) : e.type === 'Text Note' ? (
            <p className="text-sm text-gray-800 whitespace-pre-wrap break-words pr-6">{e.text}</p>
          ) : e.file ? (
            <a href={e.file} target="_blank" rel="noreferrer" className={`text-sm text-red-700 hover:underline break-all rounded ${FOCUS}`}>
              {e.file.split('/').pop()}
            </a>
          ) : null}
          <p className="text-xs text-gray-400">
            {e.type} · by {e.by}, <span title={fmtDateTime(e.on)}>{relTime(e.on)}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}

function InvestigationPanel({ event, inv, editable, busy, busyKey, canManageProtocols, onSetOutcome, onSaveFindings, onUpload, onText, onRemove, onGoDecision, onError }) {
  const steps = inv.investigationSteps || []
  const open = inv.gates?.openInvestigationSteps || []
  const doneCount = steps.length - open.length
  const [findings, setFindings] = useState(inv.findings || '')
  const [saved, setSaved] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const savedTimer = useRef(null)
  useEffect(() => () => clearTimeout(savedTimer.current), [])

  async function save() {
    const ok = await onSaveFindings(findings)
    if (ok) {
      setSaved(true)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2000)
    }
  }

  const link = `text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`
  return (
    <div className={card}>
      <PanelHeader title="Field investigation" sub="Do the protocol's investigation steps, record findings and evidence" />
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {inv.protocol ? (
          <>
            <p className="text-sm font-medium text-gray-900">{inv.protocol.title} ({inv.protocol.version})</p>
            <Link to={`/response-protocols?protocol=${encodeURIComponent(inv.protocol.id)}`} className={link}>View full protocol</Link>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500">No approved protocol for this disease. Record your findings below.</p>
            {canManageProtocols && event.disease && (
              <Link to={`/response-protocols?new=${encodeURIComponent(event.disease)}`} className={link}>Create one</Link>
            )}
          </>
        )}
      </div>

      {steps.length > 0 && (
        <div className="mb-7">
          <StepProgress steps={steps} open={open} handed={inv.gates?.handedOverSteps} editable={editable} />
          <StepList steps={steps} editable={editable} busyKey={busyKey} keyPrefix="inv" onSet={onSetOutcome} />
        </div>
      )}

      <label className="block mb-7">
        <span className="block text-sm font-semibold text-gray-900 mb-1.5">Field findings</span>
        <textarea
          value={findings}
          onChange={(e) => setFindings(e.target.value)}
          readOnly={!editable}
          rows={4}
          placeholder="What did you find? Cases seen, conditions, actions taken..."
          className={INPUT}
        />
        {editable && (
          <span className="mt-2 flex items-center gap-3">
            <button type="button" aria-label="Save findings" disabled={busyKey === 'findings'} onClick={save} className={`${BTN} ${PRIMARY} ${FOCUS}`}>
              {busyKey === 'findings' ? 'Saving...' : 'Save'}
            </button>
            {saved && <span role="status" className="text-sm text-emerald-600">Saved</span>}
          </span>
        )}
      </label>

      <div className="mb-7 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-900">{editable ? 'Add supporting info' : 'Supporting info'}</h3>
        {editable && <EvidenceAdder busy={busyKey === 'evidence'} onUpload={onUpload} onText={onText} onError={onError} />}
        <EvidenceGrid evidence={inv.evidence || []} editable={editable} busyKey={busyKey} onRemove={onRemove} onOpenPhoto={setLightbox} />
        {!editable && !(inv.evidence || []).length && <p className="text-sm text-gray-400">No supporting info recorded.</p>}
      </div>

      {editable && event.status === 'Investigating' && (
        <div className="flex flex-col gap-2">
          <div>
            <button
              type="button"
              aria-label="Go to decision"
              disabled={!inv.gates?.canConfirm}
              onClick={onGoDecision}
              className={`${BTN} ${PRIMARY} ${FOCUS}`}
            >
              {inv.gates?.canConfirm ? 'Continue to decision' : `Go to decision (${doneCount}/${steps.length} handled)`}
            </button>
          </div>
          {!inv.gates?.canConfirm && open.length > 0 && (
            <p className="text-xs text-gray-500">Record step {open.join(', ')} to continue, or hand {open.length === 1 ? 'it' : 'them'} to a field worker.</p>
          )}
        </div>
      )}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}

const DECISION_OPTIONS = [
  { value: 'confirm', title: 'Confirm event', hint: 'It is a real event. Response steps open next.', icon: Check, enabled: (s, g, inv) => s === 'Investigating' && g?.canConfirm && !inv?.mustEscalate },
  { value: 'escalate', title: 'Escalate to County/MoH', hint: 'County or National MOH need to lead.', icon: ExternalLink, enabled: (s) => ['New', 'Verifying', 'Investigating', 'Confirmed'].includes(s) },
  { value: 'close_unconfirmed', title: 'Close: no event found', hint: 'The investigation found no event. Reporters are thanked.', icon: X, enabled: (s) => s === 'Investigating' },
]

function DecisionPanel({ event, inv, editable, busy, choice, onChoose, onSubmit }) {
  const [reason, setReason] = useState('')
  const [facility, setFacility] = useState(inv.nearestFacility || '')
  const [preview, setPreview] = useState(null)
  const canDecide = editable && DECISION_OPTIONS.some((o) => o.enabled(event.status, inv.gates, inv))
  const escalating = choice === 'escalate'
  const ready = !!choice && reason.trim().length > 0 && (!escalating || facility.trim().length > 0) && !busy

  useEffect(() => {
    if (!escalating || preview) return
    getEscalationPreview(event.id)
      .then((p) => {
        setPreview(p)
        if (!facility && p?.nearestFacility) setFacility(p.nearestFacility)
      })
      .catch(() => setPreview({ contacts: [], facilities: [] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escalating])
  return (
    <div className={card}>
      <PanelHeader title="Decision" sub="Confirm the event, escalate it, or close it if the investigation found no event. Your sign-off is recorded." />
      {inv.suggestion?.text && (
        <p className="text-sm text-gray-600 mb-5">
          Suggestion: {inv.suggestion.text} <span className="font-medium text-gray-900">Final decision is yours.</span>
        </p>
      )}
      {inv.decision && (
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 mb-5">
          <p className="text-sm font-semibold text-gray-900">Decision: {inv.decision.decision}</p>
          {inv.decision.reason && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">{inv.decision.reason}</p>}
          <p className="text-xs text-gray-400 mt-1">
            by {inv.decision.by}, <span title={fmtDateTime(inv.decision.on)}>{relTime(inv.decision.on)}</span>
          </p>
        </div>
      )}
      {inv.mustEscalate && event.status !== 'Escalated' && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 mb-5 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            One case of {event.diseaseName || event.disease} is an emergency: it must be escalated to County / National MOH,
            who lead the investigation. Confirming locally is not available.
          </p>
        </div>
      )}
      {canDecide && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5" role="group" aria-label="Decision">
            {DECISION_OPTIONS.map((o) => {
              const enabled = o.enabled(event.status, inv.gates, inv)
              const selected = choice === o.value
              const Icon = o.icon
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={!enabled || busy}
                  aria-pressed={selected}
                  aria-label={o.title}
                  onClick={() => onChoose(o.value)}
                  className={`rounded-xl border p-4 flex flex-col items-start gap-1.5 text-left disabled:opacity-40 disabled:cursor-not-allowed ${selected ? 'border-gray-900 ring-1 ring-gray-900 bg-white' : 'border-gray-200 bg-white hover:bg-gray-50'} ${FOCUS}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Icon className="w-4 h-4 text-gray-500" aria-hidden="true" />
                    {o.title}
                  </span>
                  <span className="text-xs text-gray-500 font-normal">{o.hint}</span>
                </button>
              )
            })}
          </div>
          <label className="block mb-5">
            <span className="block text-sm font-medium text-gray-900 mb-1.5">
              {choice === 'close_unconfirmed' ? 'What did the investigation find?' : 'Reason for decision'}<span className="text-red-700"> *</span>
            </span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={INPUT} />
          </label>
          {escalating && (
            <div className="mb-5 rounded-xl border border-gray-100 bg-gray-50 p-4 flex flex-col gap-4">
              <label className="block">
                <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900 mb-1.5">
                  <Building2 className="w-4 h-4 text-gray-500" aria-hidden="true" />
                  Nearest health facility<span className="text-red-700"> *</span>
                </span>
                <input
                  value={facility}
                  onChange={(e) => setFacility(e.target.value)}
                  list="facility-options"
                  placeholder="e.g. Dagahaley Hospital"
                  className={INPUT}
                />
                <datalist id="facility-options">
                  {(preview?.facilities || []).map((f) => <option key={f} value={f} />)}
                </datalist>
              </label>
              <div className="text-sm">
                <p className="font-medium text-gray-900 mb-1">This will notify</p>
                {!preview ? (
                  <p className="text-gray-400">Loading…</p>
                ) : preview.contacts.length === 0 ? (
                  <p className="text-amber-700">No active County / National MOH contacts. Add them under Escalation Contacts first, or nobody will be emailed.</p>
                ) : (
                  <ul className="text-gray-600 space-y-0.5">
                    {preview.contacts.map((c, i) => (
                      <li key={i}>{c.name} · {c.level}{c.county ? ` (${c.county})` : ''}{!c.hasEmail ? ' · no email' : ''}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  They receive the disease, signs and symptoms, cases, deaths, dates, location, nearest facility, reporter contacts,
                  and your name and reason.
                </p>
              </div>
            </div>
          )}
          <button type="button" aria-label="Sign off decision" disabled={!ready} onClick={() => onSubmit(choice, reason.trim(), facility.trim())} className={`${BTN} ${PRIMARY} ${FOCUS}`}>
            {escalating ? 'Sign off and escalate' : choice === 'close_unconfirmed' ? 'Sign off and close' : 'Sign off decision'}
          </button>
        </>
      )}
    </div>
  )
}

function ResponsePanel({ event, inv, editable, busy, busyKey, onSetOutcome, onAction, onDecide }) {
  const [summary, setSummary] = useState('')
  const steps = inv.responseSteps || []
  const open = inv.gates?.openResponseSteps || []
  const status = event.status
  const active = status === 'Confirmed' || status === 'Escalated'
  const canClose = inv.gates?.canClose && summary.trim().length > 0 && !busy

  return (
    <div className={card}>
      <PanelHeader title="Response & close" sub="Do the protocol's response steps, then close and send feedback" />

      {status === 'Discarded' && inv.decision && (
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 mb-5">
          <p className="text-sm font-semibold text-gray-900">Decision: {inv.decision.decision}</p>
          {inv.decision.reason && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">{inv.decision.reason}</p>}
          <p className="text-xs text-gray-400 mt-1">
            by {inv.decision.by}, <span title={fmtDateTime(inv.decision.on)}>{relTime(inv.decision.on)}</span>
          </p>
        </div>
      )}

      {status !== 'Discarded' && (
        <div className="mb-6">
          {steps.length === 0 ? (
            <p className="text-sm text-gray-500">This protocol has no response steps.</p>
          ) : (
            <>
              {active && <StepProgress steps={steps} open={open} handed={inv.gates?.handedOverSteps} editable={editable} />}
              <StepList steps={steps} editable={editable && active} busyKey={busyKey} keyPrefix="resp" onSet={onSetOutcome} />
            </>
          )}
        </div>
      )}

      {status === 'Closed' && inv.closure && (
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 mb-5">
          <p className="text-sm font-semibold text-gray-900">Closing summary</p>
          <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">{inv.closure.summary}</p>
          <p className="text-xs text-gray-400 mt-1">
            by {inv.closure.by}, <span title={fmtDateTime(inv.closure.on)}>{relTime(inv.closure.on)}</span>
          </p>
        </div>
      )}

      {editable && active && (
        <>
          {inv.gates?.canClose && <div className="mb-5"><OpenTasksNotice /></div>}
          <label className="block mb-5">
            <span className="block text-sm font-medium text-gray-900 mb-1.5">
              Closing summary (what was done, outcome)<span className="text-red-700"> *</span>
            </span>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className={INPUT} />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" aria-label="Close event and notify field reporters" disabled={!canClose} onClick={() => onAction('close', summary.trim())} className={`${BTN} ${PRIMARY} ${FOCUS}`}>
              Close event and notify field reporters
            </button>
            {status === 'Confirmed' && (
              <button type="button" aria-label="Escalate to County/MoH" disabled={busy} onClick={() => onDecide('escalate')} className={`${BTN} ${SECONDARY} ${FOCUS}`}>
                Escalate to County/MoH
              </button>
            )}
          </div>
          {!inv.gates?.canClose && open.length > 0 && (
            <p className="text-xs text-gray-500 mt-2">Record response step {open.join(', ')} to close, or hand {open.length === 1 ? 'it' : 'them'} to a field worker.</p>
          )}
          <p className="text-xs text-gray-400 mt-2">Field reporters get an in-app notification. CBS reporters cannot be contacted from here.</p>
        </>
      )}

      {editable && (status === 'Closed' || status === 'Discarded') && (
        <button type="button" aria-label="Reopen" disabled={busy} onClick={() => onAction('reopen')} className={`${BTN} ${SECONDARY} ${FOCUS}`}>
          Reopen
        </button>
      )}
    </div>
  )
}

const CHECK_STYLES = {
  Verified: { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', color: '#059669' },
  Unconfirmed: { pill: 'bg-amber-50 text-amber-700 border-amber-200', color: '#F59E0B' },
  'Not a case': { pill: 'bg-gray-100 text-gray-600 border-gray-200', color: '#9CA3AF' },
  'Not checked': { pill: 'bg-red-50 text-red-700 border-red-200', color: '#EE2435' },
}

function checkStatus(s) {
  return CHECK_STYLES[s.check?.status] ? s.check.status : 'Not checked'
}

function hasGps(s) {
  return typeof s.lat === 'number' && typeof s.lng === 'number'
}

function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

function CheckPill({ signal }) {
  const st = checkStatus(signal)
  return (
    <div className="flex flex-col gap-0.5 items-start">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${CHECK_STYLES[st].pill}`}>{st}</span>
      {signal.check?.by && (
        <span className="text-[10px] text-gray-400 whitespace-nowrap">by {signal.check.by}{signal.check.on ? `, ${relTime(signal.check.on)}` : ''}</span>
      )}
    </div>
  )
}

function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15)
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30] })
  }, [map, points])
  return null
}

function ReportsMap({ signals }) {
  const gps = useMemo(() => signals.filter(hasGps), [signals])
  const noGps = signals.filter((s) => !hasGps(s))
  const points = useMemo(() => gps.map((s) => [s.lat, s.lng]), [gps])
  const maxKm = useMemo(() => {
    let max = 0
    for (let i = 0; i < gps.length; i++) {
      for (let j = i + 1; j < gps.length; j++) max = Math.max(max, haversineKm(gps[i], gps[j]))
    }
    return max
  }, [gps])
  const noGpsLabel = noGps
    .map((s) => (s.source === 'CBS' ? [`CBS ${s.ref || ''}`.trim(), s.area].filter(Boolean).join(' · ') : s.area || s.ref || s.source))
    .join(', ')
  const link = 'text-xs font-medium !text-red-700 hover:underline'

  return (
    <div className="mt-5">
      {gps.length > 0 && (
        <>
          <div className="h-[280px] w-full rounded-xl overflow-hidden border border-gray-100 relative z-0">
            <MapContainer center={points[0]} zoom={13} scrollWheelZoom={false} className="h-full w-full">
              <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
              <FitBounds points={points} />
              {gps.map((s, i) => (
                <CircleMarker
                  key={s.id || i}
                  center={[s.lat, s.lng]}
                  radius={9}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: CHECK_STYLES[checkStatus(s)].color, fillOpacity: 1 }}
                >
                  <Popup>
                    <div className="text-xs text-gray-600 space-y-1 min-w-[170px]">
                      <p className="text-sm font-semibold text-gray-900">{s.source}{s.ref ? ` ${s.ref}` : ''}</p>
                      <p>{s.area || '—'}</p>
                      <p>{fmtDateTime(s.date)} · {countLabel(s.people, s.disease)}</p>
                      <p>{checkStatus(s)}</p>
                      <p className="flex gap-3 pt-1">
                        <a className={link} href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">Open in Google Maps</a>
                        <a className={link} href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">Directions</a>
                      </p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          {maxKm > 3 && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <p>These reports are about {maxKm.toFixed(1)} km apart. If they are separate outbreaks, split them into their own events.</p>
            </div>
          )}
        </>
      )}
      <p className="mt-3 text-sm text-gray-500">Reports without GPS: {noGpsLabel || 'none'}</p>
    </div>
  )
}

function SplitDialog({ signal, saving, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/50" onClick={saving ? undefined : onClose} />
      <div role="dialog" aria-modal="true" aria-label="Split into its own event" className="relative bg-white rounded-2xl p-6 w-full max-w-md flex flex-col gap-4">
        <h3 className="text-base font-semibold text-gray-900">Move {signal.source} {signal.ref} into its own event?</h3>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-900">
          Why?
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required
            disabled={saving}
            placeholder="e.g. Different block, 10 km from the other reports"
            className={`${INPUT} font-normal`}
          />
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" aria-label="Cancel" disabled={saving} onClick={onClose} className={`${BTN} ${SECONDARY} ${FOCUS}`}>Cancel</button>
          <button type="button" aria-label="Confirm split" disabled={saving || !reason.trim()} onClick={() => onConfirm(reason.trim())} className={`${BTN} ${PRIMARY} ${FOCUS}`}>
            {saving ? 'Moving...' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MergeDialog({ eventId, relatedId, saving, onConfirm, onClose }) {
  const [note, setNote] = useState('')
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/50" onClick={saving ? undefined : onClose} />
      <div role="dialog" aria-modal="true" aria-label="Merge events" className="relative bg-white rounded-2xl p-6 w-full max-w-md flex flex-col gap-4">
        <h3 className="text-base font-semibold text-gray-900">
          Move all reports from {eventId} into {relatedId}? This event will be closed as merged.
        </h3>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-900">
          Why are these the same outbreak?
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            required
            disabled={saving}
            className={`${INPUT} font-normal`}
          />
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" aria-label="Cancel" disabled={saving} onClick={onClose} className={`${BTN} ${SECONDARY} ${FOCUS}`}>Cancel</button>
          <button type="button" aria-label="Merge" disabled={saving || !note.trim()} onClick={() => onConfirm(note.trim())} className={`${BTN} ${PRIMARY} ${FOCUS}`}>
            {saving ? 'Merging...' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse" aria-busy="true" aria-label="Loading event">
      <div className="h-36 rounded-2xl bg-gray-200" />
      <div className="h-24 rounded-2xl bg-gray-100" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 p-7 space-y-3">
          <div className="h-5 w-1/4 bg-gray-100 rounded" />
          <div className="h-3 w-full bg-gray-100 rounded" />
          <div className="h-3 w-2/3 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}

function Field({ label, value, danger, icon: Icon }) {
  const text = (
    <div className="min-w-0">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className={`text-sm font-medium break-words ${danger ? 'text-red-700' : 'text-gray-900'}`}>{value}</dd>
    </div>
  )
  if (!Icon) return text
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="w-10 h-10 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center shrink-0" aria-hidden="true">
        <Icon className="w-4 h-4" />
      </span>
      {text}
    </div>
  )
}

// Event opened from Epi Trends: the CBS reports behind the trend, fetched live from CBS (nothing saved).
function TrendCbsReports({ eventId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  if (!data) {
    return (
      <button type="button" disabled={loading} className={`mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`}
        onClick={() => { setLoading(true); getTrendCbsReports(eventId).then(setData).catch((e) => setData({ reports: [], why: e.message })).finally(() => setLoading(false)) }}>
        <Phone className="w-4 h-4" aria-hidden="true" /> {loading ? 'Looking up CBS reports… (can take a few seconds)' : 'Show the CBS reports behind this trend'}
      </button>
    )
  }
  if (!data.reports.length) return <p className="mb-3 text-sm text-gray-500">{data.why}</p>
  return (
    <div className="mb-3 rounded-xl border border-gray-100">
      <p className="px-4 pt-3 text-xs font-medium text-gray-500">CBS reports behind this trend ({data.reports.length}){data.contacts ? '' : ' · volunteer contacts are switched off'}</p>
      <ul className="divide-y divide-gray-100">
        {data.reports.map((r) => (
          <li key={r.case} className="px-4 py-3 text-sm">
            <p className="text-gray-900">{r.case} <span className="text-gray-500">· {(parseDate(r.date) || new Date(r.date)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {r.area || '—'} · {r.cases} {r.cases === 1 ? 'case' : 'cases'}</span></p>
            {data.contacts && (r.name || r.phone) && (
              <p className="text-xs text-gray-600 mt-0.5">
                {r.name || '—'} · CBS volunteer
                {r.phone && <> · <a href={`tel:${r.phone}`} className={`font-medium text-red-700 hover:underline rounded ${FOCUS}`}>Call {r.phone}</a></>}
                {r.assignedTo?.length > 0 && <span className="text-gray-400"> · Covers: {r.assignedTo.join('; ')}</span>}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// CBS: the volunteer's contact is fetched from CBS only when asked, and never saved.
function CbsContact({ signal: s, canAct }) {
  const [c, setC] = useState(null)
  const [loading, setLoading] = useState(false)
  if (!canAct) return <span className="text-xs">CBS case {s.ref || '—'}</span>
  if (!c) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-gray-500">CBS case {s.ref || '—'}</span>
        <button type="button" disabled={loading} onClick={() => { setLoading(true); getCbsContact(s.id).then(setC).catch((e) => setC({ available: false, why: e.message })).finally(() => setLoading(false)) }}
          className={`inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
          <Phone className="w-3 h-3" aria-hidden="true" /> {loading ? 'Getting contact…' : 'Show volunteer contact'}
        </button>
      </div>
    )
  }
  if (!c.available) return <span className="text-xs text-gray-500">{c.why}</span>
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-900">{c.name || '—'} <span className="text-xs text-gray-400">· CBS volunteer</span></span>
      {c.phone && (
        <a href={`tel:${c.phone}`} className={`inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
          <Phone className="w-3 h-3" aria-hidden="true" /> Call {c.phone}
        </a>
      )}
      {c.assignedTo?.length > 0 && <span className="text-xs text-gray-500">Covers: {c.assignedTo.join('; ')}</span>}
    </div>
  )
}

function ReporterContact({ signal: s, canAct }) {
  if (s.source === 'CBS') return <CbsContact signal={s} canAct={canAct} />
  if (s.source !== 'Field') return <span className="text-xs">Contact through {s.source} (ref {s.ref || '—'})</span>
  if (!(canAct && s.reporter)) return '—'
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-900">{s.reporter.name || '—'}</span>
      {s.reporter.phone ? (
        <a href={`tel:${s.reporter.phone}`} className={`inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
          <Phone className="w-3 h-3" aria-hidden="true" /> Call {s.reporter.phone}
        </a>
      ) : (
        <span className="text-xs text-gray-400">No phone on profile</span>
      )}
    </div>
  )
}

export default function EventDetail() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { has } = useCapabilities()
  const canManageProtocols = has('manage_response_protocols')

  const [event, setEvent] = useState(null)
  const [inv, setInv] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyKey, setBusyKey] = useState(null)
  const [openStep, setOpenStep] = useState(() => Number(new URLSearchParams(window.location.search).get('step')) || null)
  const [choice, setChoice] = useState(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [toast, setToast] = useState({ show: false, message: '', error: false })
  const toastTimer = useRef(null)
  const panelRef = useRef(null)
  const scrollNext = useRef(false)
  const [splitTarget, setSplitTarget] = useState(null)
  const [splitting, setSplitting] = useState(false)
  const [mergeTarget, setMergeTarget] = useState(null)
  const [merging, setMerging] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [contextSummary, setContextSummary] = useState(null)

  const showToast = useCallback((message, isError = false, ms = 3000) => {
    setToast({ show: true, message, error: isError })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), ms)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const fail = useCallback((e, fallback) => {
    if (e.status === 403) setForbidden(true)
    else showToast(e.message || fallback, true)
  }, [showToast])

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setForbidden(false)
    Promise.all([getReviewEvent(id), getInvestigation(id)])
      .then(([ev, iv]) => {
        if (cancelled) return
        setEvent(ev)
        setInv(iv)
      })
      .catch((e) => {
        if (cancelled) return
        if (e.status === 403) setForbidden(true)
        else setError(e.message || 'We could not load this event.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    setEvent(null)
    setInv(null)
    setOpenStep(Number(new URLSearchParams(window.location.search).get('step')) || null)
    return load()
  }, [load])

  // quiet refresh after a task change, so the audit timeline shows it without reloading the page
  const refreshEvent = useCallback(() => {
    Promise.all([getReviewEvent(id), getInvestigation(id)])
      .then(([ev, iv]) => { setEvent(ev); setInv(iv) })
      .catch(() => {})
  }, [id])

  const stepInfo = useMemo(() => (event && inv ? computeSteps(event, inv) : null), [event, inv])
  const currentStep = stepInfo?.current

  const status = event?.status
  useEffect(() => {
    if (status && currentStep) setOpenStep(status === 'New' ? 2 : currentStep)
    // only re-open the current step when the status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    if (scrollNext.current) {
      scrollNext.current = false
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [openStep])

  const ctxSubCounty = event?.subCounty
  const ctxCounty = event?.county
  const ctxPeople = event?.people
  const ctxDisease = event?.disease
  const hasEvent = !!event
  useEffect(() => {
    if (!hasEvent) { setContextSummary(null); return undefined }
    let cancelled = false
    getPlaceContext({ subCounty: ctxSubCounty, county: ctxCounty, people: ctxPeople, disease: ctxDisease })
      .then((c) => { if (!cancelled) setContextSummary(c) })
      .catch(() => { if (!cancelled) setContextSummary(null) })
    return () => { cancelled = true }
  }, [hasEvent, ctxSubCounty, ctxCounty, ctxPeople, ctxDisease])

  function selectStep(n) {
    scrollNext.current = true
    setOpenStep(n)
  }

  const signals = useMemo(
    () => [...(event?.signals || [])].sort((a, b) => (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0)),
    [event]
  )
  const timeline = useMemo(
    () => [...(event?.timeline || [])].sort((a, b) => (parseDate(b.at)?.getTime() || 0) - (parseDate(a.at)?.getTime() || 0)),
    [event]
  )

  async function runInv(key, fn, fallback) {
    setBusyKey(key)
    try {
      setInv(await fn())
      return true
    } catch (e) {
      fail(e, fallback)
      return false
    } finally {
      setBusyKey(null)
    }
  }

  async function runAction(action, text, facility) {
    setBusy(true)
    try {
      const updated = await setEventStatus(event.id, action, text || '', facility || '')
      setEvent(updated)
      setInv(await getInvestigation(event.id))
      setChoice(null)
      showToast(`${ACTION_LABELS[action]} done`)
      return true
    } catch (e) {
      fail(e, 'Could not update the event')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function answer(n, value) {
    const wasNew = event.status === 'New'
    const ok = await runInv(`q-${n}`, () => answerVerification(event.id, n, value), 'Could not save the answer')
    if (ok && wasNew) {
      getReviewEvent(event.id).then(setEvent).catch(() => {})
    }
  }

  async function checkSignal(s, reached, meets, noteText) {
    const ok = await runInv(`chk-${s.id}`, () => checkReport(event.id, s.id, reached, meets, noteText), 'Could not save the check')
    if (!ok) return
    try {
      setEvent(await getReviewEvent(event.id))
    } catch (e) {
      fail(e, 'Could not refresh the reports')
    }
    showToast('Saved')
  }

  async function confirmSplit(reason) {
    setSplitting(true)
    try {
      const res = await splitReport(event.id, splitTarget.id, reason)
      const newEvent = res?.newEvent
      setSplitTarget(null)
      const [ev, iv] = await Promise.all([getReviewEvent(event.id), getInvestigation(event.id)])
      setEvent(ev)
      setInv(iv)
      showToast(
        <span>Moved to {newEvent} <Link to={`/alerts-signals/${newEvent}`} className="underline font-semibold">View</Link></span>,
        false,
        8000
      )
    } catch (e) {
      fail(e, 'Could not split the report')
    } finally {
      setSplitting(false)
    }
  }

  async function confirmMerge(mergeNote) {
    setMerging(true)
    try {
      await mergeEvents(event.id, mergeTarget.id, mergeNote)
      const target = mergeTarget.id
      setMergeTarget(null)
      showToast(`Merged into ${target}`)
      navigate(`/alerts-signals/${target}`)
    } catch (e) {
      fail(e, 'Could not merge the events')
    } finally {
      setMerging(false)
    }
  }

  function setOutcome(key, n, outcome, reason) {
    return runInv(key, () => setStepOutcome(event.id, n, outcome, reason), 'Could not update the step')
  }

  function saveFindingsText(text) {
    return runInv('findings', () => saveFindings(event.id, text), 'Could not save findings')
  }

  function uploadEvidence(type, file, consent) {
    return runInv('evidence', async () => {
      const url = await uploadFile(file, 1)
      return addEvidence(event.id, type, url, null, consent)   // consent = { people_shown, consent, consent_recorded_on }
    }, 'Could not upload the file')
  }

  function addTextEvidence(text) {
    return runInv('evidence', () => addEvidence(event.id, 'Text Note', null, text), 'Could not add the note')
  }

  function removeEvidenceItem(evidenceId) {
    return runInv(`ev-${evidenceId}`, () => removeEvidence(event.id, evidenceId), 'Could not remove the item')
  }

  function openDecision(value) {
    setChoice(value)
    selectStep(5)
  }

  async function saveNote() {
    if (!note.trim()) return
    setSavingNote(true)
    try {
      setEvent(await addEventNote(event.id, note.trim()))
      setNote('')
      setNoteOpen(false)
      showToast('Note saved')
    } catch (e) {
      fail(e, 'Could not save note')
    } finally {
      setSavingNote(false)
    }
  }

  const backTo = { pathname: '/alerts-signals', search: location.search }
  const place = event ? [event.area, event.subCounty].filter(Boolean).join(', ') || 'Location missing' : ''
  const canAct = !!inv?.canAct
  const canVerify = canAct && ['New', 'Verifying', 'Investigating'].includes(status)
  const canSplit = canAct && !['Closed', 'Discarded'].includes(status) && signals.length >= 2
  const fieldWithReporter = signals.filter((s) => s.source === 'Field' && s.reporter)
  const singleReporter = canAct && fieldWithReporter.length === 1 ? fieldWithReporter[0].reporter : null
  const shown = Math.max(openStep || currentStep || 3, 2)  // step 1 has no panel

  function renderPanel() {
    switch (shown) {
      case 2:
        return (
          <div className={card}>
            <PanelHeader title="AI analysis & risk assessment" sub="A quick check of how urgent this looks" />
            <RiskAssessment risk={event.risk} matched={event.reason ? matchedSigns(event.reason) : ''} reason={event.reason}>
              <ContextPanel subCounty={event.subCounty} county={event.county} people={event.people} disease={event.disease} />
            </RiskAssessment>
            <div className="mt-6 flex justify-end">
              <button type="button" onClick={() => selectStep(3)} className={`${BTN} ${PRIMARY} ${FOCUS}`}>
                Continue to verification →
              </button>
            </div>
          </div>
        )
      case 3:
        return (
          <VerificationPanel
            event={event}
            inv={inv}
            editable={canAct && (status === 'New' || status === 'Verifying')}
            busy={busy}
            busyKey={busyKey}
            signals={signals}
            canVerify={canVerify}
            canAct={canAct}
            canSplit={canSplit}
            onCheck={checkSignal}
            onSplit={setSplitTarget}
            onAnswer={answer}
            onProceed={() => runAction('investigate')}
            onDiscard={(reason) => runAction('discard', reason)}
            onDecide={openDecision}
          />
        )
      case 4:
        return (
          <InvestigationPanel
            key={inv.findings}
            event={event}
            inv={inv}
            editable={canAct && status === 'Investigating'}
            busy={busy}
            busyKey={busyKey}
            canManageProtocols={canManageProtocols}
            onSetOutcome={setOutcome}
            onSaveFindings={saveFindingsText}
            onUpload={uploadEvidence}
            onText={addTextEvidence}
            onRemove={removeEvidenceItem}
            onGoDecision={() => selectStep(5)}
            onError={(m) => showToast(m, true)}
          />
        )
      case 5:
        return (
          <DecisionPanel
            event={event}
            inv={inv}
            editable={canAct}
            busy={busy}
            choice={choice}
            onChoose={setChoice}
            onSubmit={runAction}
          />
        )
      case 6:
        return (
          <ResponsePanel
            event={event}
            inv={inv}
            editable={canAct}
            busy={busy}
            busyKey={busyKey}
            onSetOutcome={setOutcome}
            onAction={runAction}
            onDecide={openDecision}
          />
        )
      default:
        return null
    }
  }

  return (
    <AppShell>
      <Link
        to={backTo}
        className={`inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors mb-6 ${FOCUS}`}
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Review Queue
      </Link>

      {loading ? (
        <Skeleton />
      ) : forbidden ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <ShieldAlert className="w-8 h-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-gray-500">You don't have access to this event.</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 py-24 text-center space-y-3">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={load} className={`bg-red-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-red-700 ${FOCUS}`}>
            Retry
          </button>
        </div>
      ) : event && inv && (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-gray-500 -mb-2">One reported event from the field. Work through the steps below: check the AI triage, verify with the reporter, investigate, then record a decision.</p>
          {event.mergedInto && (
            <div className="flex items-center gap-2 rounded-xl bg-gray-100 border border-gray-200 px-4 py-3 text-sm text-gray-700">
              <Link2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>This event was merged into{' '}
                <Link to={`/alerts-signals/${event.mergedInto}`} className={`font-semibold text-red-700 hover:underline rounded ${FOCUS}`}>{event.mergedInto}</Link>
              </span>
            </div>
          )}
          <div className={`rounded-2xl p-6 sm:p-7 text-white ${BANNER[event.severity] || BANNER.standard}`}>
            <div className="flex items-center gap-3 flex-wrap mb-1.5">
              <h1 className="text-xl sm:text-2xl font-semibold leading-tight">{event.title}</h1>
              <span className="inline-flex items-center rounded-full border border-white/70 bg-white/20 px-3.5 py-1 text-xs font-medium tracking-wide">
                {SEVERITY_LABELS[event.severity] || SEVERITY_LABELS.standard}
              </span>
              <span className="inline-flex items-center rounded-full border border-white/70 bg-white/10 px-3.5 py-1 text-xs font-medium">
                {STATUS_LABELS[event.status] || event.status}
              </span>
            </div>
            <p className="text-sm font-medium text-white/90">
              Event {event.id}{(event.sources || []).length ? ` · ${event.sources.join(', ')}` : ''} · {event.reports > 1
                ? `${event.reports} reports · first ${fmtDateTime(event.firstSeen)} · latest ${fmtDateTime(event.lastSeen)}`
                : `Reported ${fmtDateTime(event.firstSeen)}`}
            </p>
            {event.linkedAlert && (
              <Link
                to={`/epi-trends/${event.linkedAlert.id}`}
                className="inline-flex items-center mt-4 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
              >
                Epi Trends alert: rise in {event.linkedAlert.place || event.subCounty}{event.linkedAlert.week ? `, ${event.linkedAlert.week}` : ''} →
              </Link>
            )}
            {event.dataWarning && (
              <div className="mt-5 flex items-start gap-3 rounded-xl bg-white border border-amber-400 p-4 text-sm text-gray-800">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                <p>{event.dataWarning}</p>
              </div>
            )}
          </div>

          {event.related?.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col gap-2">
              {event.related.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 flex-wrap text-sm">
                  <p className="text-gray-800">
                    <AlertTriangle className="inline w-4 h-4 text-amber-500 mr-1.5 -mt-0.5" aria-hidden="true" />
                    Possibly the same outbreak:{' '}
                    <Link to={`/alerts-signals/${r.id}`} className={`font-semibold text-red-700 hover:underline rounded ${FOCUS}`}>{r.id}</Link>
                    <span className="text-gray-500"> · {STATUS_LABELS[r.status] || r.status} · {r.reports} {r.reports === 1 ? 'report' : 'reports'}, last {fmtDateTime(r.lastSeen)}</span>
                  </p>
                  {canAct && (
                    <button type="button" onClick={() => setMergeTarget(r)} className={`text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`}>Merge into this event</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!canAct && <p className="text-sm text-gray-500">You can view this event but not act on it.</p>}

          <div className={card}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
              <h2 className="text-xl font-semibold text-gray-900">Case overview</h2>
              <button
                type="button"
                aria-expanded={mapOpen}
                onClick={() => setMapOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 ${FOCUS}`}
              >
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" /> {mapOpen ? 'Hide map' : 'Show on map'}
              </button>
            </div>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-5">
              <Field icon={MapPin} label="Location" value={place} />
              <Field icon={Users} label="Affected" value={
                <>
                  {countLabel(event.people, event.disease)}
                  {event.deaths > 0 && <span className="text-red-700"> · {event.deaths} {event.deaths === 1 ? 'death' : 'deaths'}</span>}
                </>
              } />
              <Field icon={Calendar} label={event.reports > 1 ? 'Latest report' : 'Reported'} value={fmtDateTime(event.reports > 1 ? event.lastSeen : event.firstSeen)} />
              {singleReporter && (
                <Field
                  icon={Phone}
                  label="Reported by"
                  value={
                    <>
                      {singleReporter.name || '—'}
                      {singleReporter.phone && (
                        <a href={`tel:${singleReporter.phone}`} className={`block text-xs font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
                          Call {singleReporter.phone}
                        </a>
                      )}
                    </>
                  }
                />
              )}
            </dl>
            {mapOpen && <ReportsMap signals={signals} />}
          </div>

          <EventTasksProvider eventId={event.id} eventStatus={event.status} onChanged={refreshEvent} onToast={showToast}>
            <Tracker event={event} states={stepInfo.states} openStep={shown} onSelect={selectStep} />

            <div ref={panelRef} className="scroll-mt-4">{renderPanel()}</div>

            <EventTasksPanel />
          </EventTasksProvider>

          <div className={card}>
            <div className={`flex items-center justify-between gap-3 flex-wrap ${timelineOpen ? 'mb-5' : ''}`}>
              <button
                type="button"
                aria-expanded={timelineOpen}
                onClick={() => setTimelineOpen((v) => !v)}
                className={`flex items-center gap-2 text-left rounded ${FOCUS}`}
              >
                <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${timelineOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                <span className="text-xl font-semibold text-gray-900">Audit timeline</span>
                <span className="text-sm text-gray-400">({timeline.length})</span>
              </button>
              {timelineOpen && canAct && !noteOpen && (
                <button type="button" aria-label="Add note" onClick={() => setNoteOpen(true)} className={`text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
                  Add note
                </button>
              )}
            </div>
            {timelineOpen && canAct && noteOpen && (
              <div className="mb-6 flex flex-col gap-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  aria-label="Note"
                  placeholder="Document findings, actions taken, or next steps..."
                  className={INPUT}
                />
                <div className="flex gap-2">
                  <button type="button" aria-label="Save note" disabled={savingNote || !note.trim()} onClick={saveNote} className={`${BTN} ${PRIMARY} ${FOCUS}`}>
                    {savingNote ? 'Saving...' : 'Save note'}
                  </button>
                  <button type="button" aria-label="Cancel" disabled={savingNote} onClick={() => { setNoteOpen(false); setNote('') }} className={`${BTN} ${SECONDARY} ${FOCUS}`}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {!timelineOpen ? null : timeline.length === 0 ? (
              <p className="text-sm text-gray-400">No activity yet.</p>
            ) : (
              <ol className="space-y-4">
                {timeline.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5" aria-hidden="true">
                      {t.action === 'Merged' || t.action === 'Merged in' ? <Link2 className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{t.action}</span>
                        <span className="text-gray-500"> · {t.user} · <span title={fmtDateTime(t.at)}>{relTime(t.at)}</span></span>
                      </p>
                      {t.note && <p className="text-sm text-gray-500 break-words whitespace-pre-wrap">{t.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {splitTarget && (
        <SplitDialog signal={splitTarget} saving={splitting} onConfirm={confirmSplit} onClose={() => setSplitTarget(null)} />
      )}

      {mergeTarget && (
        <MergeDialog eventId={event.id} relatedId={mergeTarget.id} saving={merging} onConfirm={confirmMerge} onClose={() => setMergeTarget(null)} />
      )}

      {toast.show && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[70] rounded-xl px-5 py-3 text-sm text-white shadow-lg ${toast.error ? 'bg-red-600' : 'bg-gray-900'}`}
        >
          {toast.message}
        </div>
      )}
    </AppShell>
  )
}
