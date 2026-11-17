import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AlertTriangle, Check, Link2, ShieldAlert, Sparkles, X, ExternalLink,
  Camera, Mic, FileText, Paperclip, Phone, Scissors, MapPin, Calendar, Users, Building2, ChevronDown, CheckCircle2, Info } from 'lucide-react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { EventTasksProvider, EventTasksPanel, StepTaskLink, useStepTask, OpenTasksNotice, useEventTasks } from '../components/tasks/EventTasks'
import AppShell from '../components/layout/AppShell'
import ContextPanel from '../components/context/ContextPanel'
import { RiskAssessment } from '../components/risk/RiskScore'
import DiseaseInsight from '../components/risk/DiseaseInsight'
import DiseaseChoices from '../components/risk/DiseaseChoices'
import VoicePicked from '../components/report/VoicePicked'
import { TILE_URL, TILE_ATTRIBUTION } from '../components/map/MapView'
import {
  getReviewEvent, setEventStatus, addEventNote, getInvestigation, answerVerification, getEscalationPreview,
  setStepOutcome, saveFindings, addEvidence, removeEvidence, uploadFile, checkReport, splitReport, getPlaceContext, mergeEvents, getCbsContact, getTrendCbsReports,
  getReportCandidates, getDiseaseOptions, setSuspectedDisease, retryTranscription,
  getTriage, logTriageCall, answerByPhone, confirmTriageDisease, getReferralPeople, referPatient, getReferralState,
  closeReferralCase, getReferralFacilities,
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
  const field = (event.signals || []).filter((s) => s.source === 'Field')
  const triaged = !field.length || field.some((s) => s.check?.status === 'Verified')   // disease confirmed by phone

  if (event.pathway === 'Referral') {   // non-priority disease confirmed in AI triage: refer, follow up, close
    mark(2)
    states[2] = states[3] = states[4] = 'skipped'
    states[5] = status === 'Closed' ? 'done' : 'current'
    current = 6
  } else if ((status === 'New' || status === 'Verifying') && !triaged) {
    mark(1)
    states[1] = 'current'
    current = 2
  } else if (status === 'New' || status === 'Verifying') {
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
  const sources = (event.channels?.length ? event.channels : (event.sources || [])).join(', ')
  return (
    <nav aria-label="Investigation progress" className="bg-white rounded-2xl border border-gray-100 px-4 sm:px-6 py-4 overflow-x-auto">
      <ol className="flex items-start min-w-[560px]">
        {STEPS.map((s, i) => {
          const state = states[i]
          const isOpen = openStep === s.n
          const info = false
          const clickable = !info && (state === 'done' || state === 'current' || state === 'discarded')
          // Red = the step on screen. Green tick = finished. Everything else grey.
          const circle =
            isOpen ? 'bg-red-600 text-white'
              : state === 'done' ? 'bg-emerald-500 text-white'
                : state === 'current' ? 'bg-white text-gray-700 ring-1 ring-gray-300'
                  : 'bg-gray-100 text-gray-400'
          const text = isOpen ? 'text-red-700 font-semibold' : state === 'done' || state === 'current' ? 'text-gray-800' : 'text-gray-400'
          const sub = state === 'discarded' ? 'Discarded' : state === 'skipped' ? 'Not needed' : s.n === 1 ? sources || 'Reports'
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
          <div className="text-sm font-medium text-gray-900">{s.channel || s.source}</div>
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

const DISCARD_REASONS = ['Known false alarm', 'Duplicate of another report', 'Does not meet the case definition']

function DiscardBox({ busy, initial = '', onDiscard, onCancel }) {
  const [reason, setReason] = useState(initial)
  return (
    <div className="mt-3 rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
      <label className="block">
        <span className="block text-sm font-medium text-gray-900 mb-1.5">Why discard? <span className="text-red-700">*</span></span>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {DISCARD_REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} className={`rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 ${FOCUS}`}>{r}</button>
        ))}
      </div>
      <p className="text-xs text-gray-500">Field reporters get a thank-you note saying it was checked and closed. The event stays in the history as Discarded.</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !reason.trim()} onClick={() => onDiscard(reason.trim())} className={`${BTN} ${PRIMARY} ${FOCUS}`}>Discard signal</button>
        <button type="button" disabled={busy} onClick={onCancel} className={`${BTN} ${SECONDARY} ${FOCUS}`}>Cancel</button>
      </div>
    </div>
  )
}

// One field report's disease decision, inside the event (Review Queue). Same panel as the Reports page.
function ReportDiseaseChoice({ reportId, onDecided, onError }) {
  const [cands, setCands] = useState(null)
  const [options, setOptions] = useState([])
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    getReportCandidates(reportId).then((c) => live && setCands(c)).catch(() => live && setFailed(true))
    getDiseaseOptions().then((o) => live && setOptions(o || [])).catch(() => {})
    return () => { live = false }
  }, [reportId])
  async function choose(key) {
    setSaving(true)
    try {
      const r = await setSuspectedDisease(reportId, key)
      // show the new choice on the cards straight away (they were still marking the previous one as Chosen)
      setCands((c) => (c ? { ...c, current: r.suspected_disease || key || null, decidedBy: key ? 'Officer' : 'Rules' } : c))
      getReportCandidates(reportId).then(setCands).catch(() => {})
      onDecided(r)
    } catch (e) {
      onError(e.message || 'Could not save the disease')
    } finally {
      setSaving(false)
    }
  }
  if (failed) return <p className="text-sm text-gray-500">Suggestions could not be loaded just now.</p>
  if (!cands) return <p className="text-sm text-gray-400">Loading suggestions...</p>
  return (
    <DiseaseChoices
      cands={cands}
      current={cands.decidedBy === 'Officer' ? cands.current : null}
      saving={saving}
      onChoose={choose}
      options={options}
      hasCurrent={!!cands.current}
      title={false}
      oneColumn
    />
  )
}

// AI triage step: "Which disease is it?" for the event's field reports (replaces the read-only disease check).
function EventDiseaseDecision({ reports, onDecided, onError }) {
  const [open, setOpen] = useState(reports[0] || null)
  return (
    <section aria-label="Which disease is it" className="rounded-xl border border-gray-200 p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-gray-900">Which disease is it?</h3>
      <p className="text-xs text-gray-500 mt-0.5 mb-4">Case definitions come first, then priority diseases to check, then the AI model's suggestions. Your choice is saved on the report.</p>
      {reports.length === 1 ? (
        <ReportDiseaseChoice reportId={reports[0]} onDecided={(r) => onDecided(r, reports[0])} onError={onError} />
      ) : (
        <div className="divide-y divide-gray-100">
          {reports.map((ref) => (
            <div key={ref} className="py-3 first:pt-0">
              <button type="button" aria-expanded={open === ref} onClick={() => setOpen(open === ref ? null : ref)}
                className={`flex w-full items-center justify-between text-left text-sm font-medium text-gray-900 rounded ${FOCUS}`}>
                <span>Report <span className="font-mono">{ref}</span></span>
                <span className="text-xs font-medium text-red-700">{open === ref ? 'Hide' : 'Choose disease'}</span>
              </button>
              {open === ref && <div className="mt-3"><ReportDiseaseChoice reportId={ref} onDecided={(r) => onDecided(r, ref)} onError={onError} /></div>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Photos and voice notes sent with a field report. Voice notes are transcribed on the AI server in the background as
// soon as the report arrives; if the page opens before that finishes, it checks again every 20 seconds (up to 5 minutes).
const LANG = { en: 'English', sw: 'Kiswahili' }

function VoiceTranscript({ m, canAct, retrying, onRetry, report, onAdded }) {
  const [open, setOpen] = useState(false)
  if (m.transcriptStatus === 'Done' && m.transcript) {
    return (
      <div className="mt-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
          {open ? 'Hide transcript' : 'View transcript'}
        </button>
        {open && (
          <div className="mt-2 rounded-lg bg-white px-3 py-2 text-sm leading-6 text-gray-800">
            <p className="whitespace-pre-wrap">{m.transcript}</p>
            <p className="mt-1 text-xs text-gray-400">Transcribed automatically{LANG[m.language] ? ` from ${LANG[m.language]}` : ''}. Check names and numbers against the recording.</p>
          </div>
        )}
        <VoicePicked picked={m.picked} report={report} canAdd={canAct} onAdded={onAdded} />
      </div>
    )
  }
  if (m.transcriptStatus === 'No speech') return <p className="mt-2 text-xs text-gray-500">No speech was heard in this recording.</p>
  if (m.transcriptStatus === 'Failed') {
    return (
      <p className="mt-2 text-xs text-gray-500">
        Transcript unavailable.
        {canAct && (
          <button type="button" disabled={retrying} onClick={onRetry} className={`ml-2 font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
            {retrying ? 'Trying…' : 'Try again'}
          </button>
        )}
      </p>
    )
  }
  return null   // still being transcribed: the link appears by itself when the text is ready
}

function SignalMedia({ eventId, signalId, media, canAct, report, onChanged }) {
  const [items, setItems] = useState(media || [])
  const [viewing, setViewing] = useState(null)
  const [retrying, setRetrying] = useState('')
  useEffect(() => { setItems(media || []) }, [media])
  const waiting = items.some((m) => m.type === 'Voice Note' && m.transcriptStatus === 'Queued')
  useEffect(() => {
    if (!waiting) return undefined
    let tries = 0
    const t = setInterval(async () => {
      tries += 1
      try {
        const ev = await getReviewEvent(eventId)
        const sig = (ev.signals || []).find((x) => x.id === signalId)
        if (sig?.media) setItems(sig.media)
      } catch { /* try again next time */ }
      if (tries >= 15) clearInterval(t)
    }, 20000)
    return () => clearInterval(t)
  }, [waiting, eventId, signalId])

  async function retry(m) {
    setRetrying(m.id)
    try {
      await retryTranscription(m.id)
      setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, transcriptStatus: 'Queued' } : x)))
    } catch { /* the button stays */ }
    setRetrying('')
  }

  const photos = items.filter((m) => m.type === 'Photo')
  const voices = items.filter((m) => m.type === 'Voice Note')
  if (!photos.length && !voices.length) return null
  return (
    <div className="space-y-3">
      {voices.map((m, i) => (
        <div key={m.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
          <div className="mb-2 text-xs font-medium text-gray-500">Voice note{voices.length > 1 ? ` ${i + 1}` : ''}</div>
          <audio controls preload="metadata" src={m.url} className="w-full max-w-md" aria-label="Voice note" />
          <VoiceTranscript m={m} canAct={canAct} retrying={retrying === m.id} onRetry={() => retry(m)} report={report} onAdded={onChanged} />
        </div>
      ))}
      {photos.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-gray-500">{photos.length === 1 ? 'Photo' : `${photos.length} photos`}</div>
          <div className="flex flex-wrap gap-2">
            {photos.map((m) => (
              <button key={m.id} type="button" onClick={() => setViewing(m)} className={`overflow-hidden rounded-lg border border-gray-100 ${FOCUS}`} aria-label="Open photo">
                <img src={m.url} alt="Photo sent with the report" loading="lazy" className="h-24 w-24 object-cover sm:h-28 sm:w-28" />
              </button>
            ))}
          </div>
        </div>
      )}
      {viewing && (
        <div role="dialog" aria-modal="true" aria-label="Photo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setViewing(null)}>
          <img src={viewing.url} alt="Photo sent with the report" className="max-h-[85vh] max-w-full rounded-lg bg-white object-contain" />
          <button type="button" onClick={() => setViewing(null)} className={`absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-gray-800 ${FOCUS}`}>Close</button>
        </div>
      )}
    </div>
  )
}

// ---------- AI triage by phone (KRCS 17 Nov 2026, flow agreed with Allan; layout reviewed with Maureen) ----------
// Left: the possible diseases for the whole event (every report combined), short rows with "Why / why not".
// Right: one reporter at a time: call them (Reached / No answer), then their questions.
// The disease is chosen once for the event; the call is the verification of the report. When the reports point to
// different diseases the officer splits one off: the priority / higher-risk one is investigated first.
const ANSWER_OPTIONS = ['Yes', 'No', "Didn't know"]
const DOT = ['bg-emerald-500', 'bg-amber-400', 'bg-amber-400', 'bg-gray-300']
const RISK_TONE = { 'Very high': 'bg-red-50 text-red-700', High: 'bg-red-50 text-red-700', Medium: 'bg-amber-50 text-amber-800', Low: 'bg-gray-100 text-gray-600' }

function TriageDisease({ d, open, onToggle, chosen, canChoose, onChoose }) {
  const details = d.against.length || d.ask.length || d.unknown?.length || d.rulesOut.length || d.record != null || d.ageFor || d.ageAgainst
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[d.rank] || DOT[3]}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-sm font-semibold ${d.rank === 3 ? 'text-gray-600' : 'text-gray-900'}`}>{d.name}</span>
            {d.priority && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Priority</span>}
          </div>
          <p className="text-xs text-gray-500">{d.level}</p>
          {d.support.length > 0 && (
            <p className="mt-1 text-xs text-gray-700">{d.support.map((s) => `${s.who}: ${s.signs.join(', ').toLowerCase()}`).join(' · ')}</p>
          )}
          {details ? (
            <button type="button" aria-expanded={open} onClick={onToggle} className={`mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-gray-500 hover:text-gray-900 rounded ${FOCUS}`}>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" /> Why / why not
            </button>
          ) : null}
          {open && (
            <div className="mt-1.5 space-y-0.5 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
              {d.against.length > 0 && <p><span className="text-gray-500">Less likely because of:</span> {d.against.join(', ')}</p>}
              {d.ageFor && <p><span className="text-gray-500">Age ({d.ageFor}):</span> more common at this age in past clinic visits</p>}
              {d.ageAgainst && <p><span className="text-gray-500">Age ({d.ageAgainst}):</span> less common at this age in past clinic visits, but still possible</p>}
              {d.ask.length > 0 && <p><span className="text-gray-500">Still to ask:</span> {d.ask.join(', ')}</p>}
              {d.unknown?.length > 0 && <p><span className="text-gray-500">Not known:</span> {d.unknown.join(', ')}</p>}
              {d.rulesOut.length > 0 && <p><span className="text-gray-500">Rules it out if present:</span> {d.rulesOut.join(', ')}</p>}
              {d.record != null && <p className="text-gray-500">In past clinic visits where it was suggested, it was correct about {d.record} times in 10.</p>}
            </div>
          )}
        </div>
        {chosen ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"><Check className="w-3.5 h-3.5" aria-hidden="true" />Chosen</span>
        ) : canChoose ? (
          <button type="button" onClick={onChoose} className={`shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 ${FOCUS}`}>Choose</button>
        ) : null}
      </div>
    </li>
  )
}

function TriageReporter({ r, eventId, canAct, open, busy, busyKey, canAnswer, onCall, onAnswer, onChanged }) {
  const rep = r.reporter || {}
  const [mediaOpen, setMediaOpen] = useState(false)
  const media = r.media || []
  const photos = media.filter((m) => m.type === 'Photo').length
  const voices = media.filter((m) => m.type === 'Voice Note').length
  const lastReach = r.attempts.filter((a) => a.outcome === 'Reached').slice(-1)[0]
  const misses = r.attempts.filter((a) => a.outcome === 'No answer')
  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-gray-100 p-4">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-sm font-semibold text-gray-900">
            {rep.name}{rep.role && <span className="font-normal text-gray-500"> · {rep.role}</span>}{r.unit && <span className="font-normal text-gray-500"> · {r.unit}</span>}
          </p>
          <p className="mt-0.5 text-sm text-gray-700">
            {[r.symptoms.join(', ') || null, r.people ? countLabel(r.people) : null, r.deaths ? `${r.deaths} ${r.deaths === 1 ? 'death' : 'deaths'}` : null, r.ages, r.place].filter(Boolean).join(' · ') || '—'}
          </p>
          {r.channel === 'WhatsApp' && r.notes && <p className="mt-1 text-sm text-gray-600 italic">“{r.notes}”</p>}
          <p className="mt-0.5 text-xs text-gray-400">
            <Link to={`/reports/${encodeURIComponent(r.ref)}`} className={`font-mono text-red-700 hover:underline rounded ${FOCUS}`}>{r.ref}</Link> · {r.channel || 'Field report'} · {relTime(r.date)}
            {media.length > 0 && (
              <button type="button" onClick={() => setMediaOpen((v) => !v)} className={`ml-2 inline-flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900 rounded ${FOCUS}`}>
                {voices > 0 && <><Mic className="w-3 h-3" aria-hidden="true" />{voices} voice note{voices > 1 ? 's' : ''}</>}
                {voices > 0 && photos > 0 && ' · '}
                {photos > 0 && <><Camera className="w-3 h-3" aria-hidden="true" />{photos} photo{photos > 1 ? 's' : ''}</>}
              </button>
            )}
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          {rep.phone ? (
            <p className="inline-flex items-center gap-1.5 text-base font-semibold text-gray-900 tabular-nums select-all"><Phone className="w-4 h-4 text-red-600" aria-hidden="true" />{rep.phone}</p>
          ) : <p className="text-sm text-gray-500">No phone number on the report</p>}
          {r.reached ? (
            <p className="text-xs text-emerald-700">Reached{lastReach ? ` ${relTime(lastReach.at)}${lastReach.by ? ` by ${lastReach.by}` : ''}` : ''}</p>
          ) : misses.length ? (
            <p className="text-xs text-amber-700">No answer · {misses.length} {misses.length === 1 ? 'attempt' : 'attempts'} recorded</p>
          ) : <p className="text-xs text-gray-400">Not called yet</p>}
          {canAct && open && !r.reached && (
            <div className="mt-2 flex gap-2 sm:justify-end">
              <button type="button" disabled={busy} onClick={() => onCall(r, 'reached')} className={`${BTN} ${PRIMARY} ${FOCUS} px-3 py-1.5`}>Reached</button>
              <button type="button" disabled={busy} onClick={() => onCall(r, 'no_answer')} className={`${BTN} ${SECONDARY} ${FOCUS} px-3 py-1.5`}>No answer</button>
            </div>
          )}
        </div>
      </div>
      {mediaOpen && (
        <div className="border-b border-gray-100 p-4">
          <SignalMedia eventId={eventId} signalId={r.signal} media={media} canAct={canAct} report={r.ref} onChanged={onChanged} />
        </div>
      )}
      {r.tryCha?.length > 0 && (
        <div className="m-4 mb-0 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Still not reached. Try the CHA of {r.unit}: {r.tryCha.map((c) => `${c.name}${c.phone ? `, ${c.phone}` : ''}`).join('; ')}. The case waits until someone is reached.</span>
        </div>
      )}
      {r.reached ? (
        r.questions.length === 0 ? (
          <p className="p-4 text-sm text-gray-600">No questions to ask {_firstName(rep.name)}: the reported signs are enough for the suggestions.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {r.questions.map((q) => (
              <li key={q.symptom} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{q.name}?</p>
                  <p className="text-xs text-gray-400">
                    {[q.diseases.length ? `For: ${q.diseases.join(', ')}` : null, q.source === 'report' ? 'from the report' : null].filter(Boolean).join(' · ') || 'Answered by phone'}
                  </p>
                </div>
                {canAnswer ? (
                  <MiniSeg label={q.name} options={ANSWER_OPTIONS} value={q.source === 'phone' ? q.answer : null} disabled={busyKey === `${r.ref}:${q.symptom}`}
                    onChange={(v) => onAnswer(r, q, v === q.answer && q.source === 'phone' ? '' : v)} />
                ) : <span className="text-sm text-gray-700">{q.answer || '—'}</span>}
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="p-4 text-sm text-gray-500">Call {_firstName(rep.name)}. Once reached, the questions to ask appear here.</p>
      )}
    </div>
  )
}
const _firstName = (n) => String(n || 'the reporter').split(' ')[0]

function TriageRisk({ risk, event }) {
  const [open, setOpen] = useState(false)
  if (!risk) return null
  return (
    <div className="shrink-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 ${FOCUS}`}>
        <span className="text-gray-500">Risk</span><span className="font-semibold tabular-nums text-gray-900">{risk.score}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RISK_TONE[risk.level] || RISK_TONE.Low}`}>{risk.level}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-6 sm:right-7 z-20 mt-2 w-[min(92vw,560px)] rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
          <ul className="grid gap-3 sm:grid-cols-2">
            {(risk.parts || []).map((p) => (
              <li key={p.key} className="text-sm">
                <div className="flex justify-between gap-3"><span className="font-medium text-gray-900">{p.label}</span><span className="tabular-nums"><b>{p.points % 1 ? p.points.toFixed(1) : p.points}</b><span className="text-gray-400"> / {p.max}</span></span></div>
                <p className="text-xs text-gray-500">{String(p.why || '').split(/;\s+/).filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
          {risk.action && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm"><span className="text-xs text-gray-500">Recommended action: </span>{risk.action}</p>}
          <div className="mt-3"><ContextPanel subCounty={event.subCounty} county={event.county} people={event.people} disease={event.disease} /></div>
        </div>
      )}
    </div>
  )
}

function TriagePanel({ event, canAct, onConfirmed, onNext, onError, onChanged, onDiscard, onSplit, busy: pageBusy }) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [pick, setPick] = useState(null)
  const [pending, setPending] = useState(null)   // {key, name}: waiting for the officer's confirmation
  const [openRow, setOpenRow] = useState(null)
  const [options, setOptions] = useState([])
  const [other, setOther] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  const load = useCallback(() => getTriage(event.id).then(setData).catch((e) => setFailed(e.message || 'AI triage could not be loaded.')), [event.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { getDiseaseOptions().then((o) => setOptions(o || [])).catch(() => {}) }, [])

  const reports = data?.reports || []
  const current = reports.find((r) => r.ref === pick) || reports.find((r) => !r.reached) || reports[0] || null
  const open = ['New', 'Verifying'].includes(event.status)
  const queue = new Set(data?.queueDiseases || [])

  async function call(r, outcome) {
    setBusy(true)
    try {
      setData(await logTriageCall(event.id, r.signal, outcome))
      setPick(r.ref)
      onChanged()
    } catch (e) { onError(e.message || 'Could not save the call') } finally { setBusy(false) }
  }
  async function answer(r, q, value) {
    setBusyKey(`${r.ref}:${q.symptom}`)
    try {
      setData(await answerByPhone(event.id, r.ref, q.symptom, value))
    } catch (e) { onError(e.message || 'Could not save the answer') } finally { setBusyKey('') }
  }
  async function confirm() {
    setBusy(true)
    try {
      const res = await confirmTriageDisease(event.id, pending.key)
      setPending(null)
      await load()
      onConfirmed(res)
    } catch (e) { onError(e.message || 'Could not save the disease') } finally { setBusy(false) }
  }

  if (failed) return <div className={card}><PanelHeader title="AI triage" /><p className="text-sm text-red-700">{failed}</p></div>
  if (!data) return <div className={card}><PanelHeader title="AI triage" /><p className="text-sm text-gray-400">Loading the reports and suggestions...</p></div>

  const reached = reports.filter((r) => r.reached)
  const canChoose = data.canChoose && open && reached.length > 0
  const conflict = data.conflict

  return (
    <div className={`${card} relative`}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">AI triage</h2>
          <p className="text-sm text-gray-500 mt-0.5">Call each reporter and ask their questions, then choose one disease for the event. The call is the verification of the report.</p>
        </div>
        <TriageRisk risk={event.risk} event={event} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-label="Possible diseases" className="self-start lg:sticky lg:top-4 rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900">Possible diseases</h3>
          <p className="text-xs text-gray-500">
            For the whole event{reports.length > 1 ? `, from all ${reports.length} reports` : ''}. Updates as you answer.
            {!canChoose && open && ' Reach a reporter before choosing.'}
          </p>
          {conflict && open && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p>The reports point to different diseases: {conflict.reports.map((x) => `${_firstName(x.name)}'s to ${x.disease}`).join(', ')}.
                  Split {_firstName(conflict.split.name)}'s report into its own event: this one is investigated first, then come back to it.</p>
                {canAct && (
                  <button type="button" disabled={pageBusy} onClick={() => onSplit(conflict.split)} className={`mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2 rounded ${FOCUS}`}>
                    <Scissors className="w-3 h-3" aria-hidden="true" /> Split {conflict.split.ref} ({_firstName(conflict.split.name)}) into its own event
                  </button>
                )}
              </div>
            </div>
          )}
          {data.diseases.length ? (
            <ul className="mt-1 divide-y divide-gray-100">
              {data.diseases.map((d) => (
                <TriageDisease key={d.key} d={d} open={openRow === d.key} onToggle={() => setOpenRow(openRow === d.key ? null : d.key)}
                  chosen={data.current === d.key && data.confirmed} canChoose={canChoose} onChoose={() => setPending({ key: d.key, name: d.name })} />
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-gray-500">No suggestions yet. Ask the reporter what they see, or choose from all diseases.</p>}
          {canChoose && (other ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select autoFocus defaultValue="" aria-label="Choose another disease" onChange={(e) => { const o = options.find((x) => x.key === e.target.value); if (o) setPending({ key: o.key, name: o.name }); setOther(false) }}
                className="w-full sm:w-72 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <option value="" disabled>Select a disease...</option>
                {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
              </select>
              <button type="button" onClick={() => setOther(false)} className="text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setOther(true)} className="mt-2 text-xs font-medium text-red-700 hover:underline">None of these? Choose another disease</button>
          ))}
          {pending && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50/50 p-3">
              <p className="text-sm text-gray-900"><b>{pending.name}</b> for this event?</p>
              <p className="text-xs text-gray-600 mt-1">
                {queue.has(pending.key) ? 'A priority disease: the case continues to verification and investigation.'
                  : 'Not a priority disease: refer the patient, follow up, then close. It is still counted in Epi Trends.'}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={confirm} className={`${BTN} ${PRIMARY} ${FOCUS} px-4 py-2`}>{busy ? 'Saving...' : 'Confirm'}</button>
                <button type="button" disabled={busy} onClick={() => setPending(null)} className={`${BTN} ${SECONDARY} ${FOCUS} px-4 py-2`}>Cancel</button>
              </div>
            </div>
          )}
        </section>

        <section aria-label="Reporters" className="min-w-0">
          {reports.length > 1 && (
            <div role="tablist" aria-label="Reporter" className="mb-3 flex flex-wrap gap-2">
              {reports.map((r) => (
                <button key={r.ref} type="button" role="tab" aria-selected={current?.ref === r.ref} onClick={() => setPick(r.ref)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${current?.ref === r.ref ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'} ${FOCUS}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full ${r.reached ? 'bg-emerald-500 text-white' : r.noAnswer ? 'bg-amber-400 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {r.reached ? <Check className="h-3 w-3" aria-hidden="true" /> : <Phone className="h-2.5 w-2.5" aria-hidden="true" />}
                  </span>
                  {r.reporter?.name} <span className={current?.ref === r.ref ? 'text-white/60' : 'text-gray-400'}>{r.ref}</span>
                </button>
              ))}
            </div>
          )}
          {current && (
            <TriageReporter key={current.ref} r={current} eventId={event.id} canAct={canAct} open={open} busy={busy} busyKey={busyKey}
              canAnswer={canAct && open && data.canChoose} onCall={call} onAnswer={answer} onChanged={() => { load(); onChanged() }} />
          )}
        </section>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap border-t border-gray-100 pt-4">
        {canAct && open && !discarding ? (
          <button type="button" disabled={pageBusy} onClick={() => setDiscarding(true)} className={`text-sm font-medium text-gray-500 hover:text-gray-900 underline underline-offset-2 rounded ${FOCUS}`}>
            Duplicate, wrong number or not a real case? Discard with a reason
          </button>
        ) : <span />}
        {data.pathway === 'Referral' ? (
          <button type="button" onClick={() => onNext(6)} className={`${BTN} ${PRIMARY} ${FOCUS}`}>Refer the patient →</button>
        ) : data.confirmed ? (
          <button type="button" onClick={() => onNext(3)} className={`${BTN} ${PRIMARY} ${FOCUS}`}>Continue to verification →</button>
        ) : <span className="text-sm text-gray-400">{reached.length ? 'Choose a disease to continue' : 'Call a reporter to begin'}</span>}
      </div>
      {canAct && open && discarding && <DiscardBox busy={pageBusy} onDiscard={onDiscard} onCancel={() => setDiscarding(false)} />}
    </div>
  )
}

// ---------- referral pathway (step 6 when a non-priority disease was confirmed in AI triage) ----------
const URGENCY = ['Routine', 'Urgent', 'Emergency']
const AGE_GROUPS = ['Under 1', '1-4 years', '5-14 years', '15+ years']
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

function ReferralForm({ event, onSent, onError }) {
  const [people, setPeople] = useState(null)
  const [facilities, setFacilities] = useState(null)
  const [f, setF] = useState({ assigned_to: '', facility: '', urgency: 'Routine', due_date: plusDays(1), people: event.people || 1,
    age_group: '', sex: '', instructions: '', followup: true, followup_days: 14 })
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    getReferralPeople(event.id).then((p) => { setPeople(p); setF((x) => (x.assigned_to || !p.length ? x : { ...x, assigned_to: p[0].user })) }).catch(() => setPeople([]))
    getReferralFacilities().then(setFacilities).catch(() => setFacilities([]))
  }, [event.id])
  const groups = useMemo(() => {
    const out = []
    for (const p of people || []) {
      let g = out.find((x) => x.name === p.group)
      if (!g) { g = { name: p.group, list: [] }; out.push(g) }
      g.list.push(p)
    }
    return out
  }, [people])
  async function send() {
    if (!f.assigned_to) { onError('Choose who refers the patient.'); return }
    if (!f.facility.trim()) { onError('Choose the health facility.'); return }
    setSaving(true)
    try {
      await referPatient(event.id, { assigned_to: f.assigned_to, facility: f.facility.trim(), urgency: f.urgency, due_date: f.due_date,
        people: f.people, age_group: f.age_group, sex: f.sex, instructions: f.instructions,
        followup_days: f.followup ? f.followup_days : 0 })
      onSent()
    } catch (e) { onError(e.message || 'Could not send the referral') } finally { setSaving(false) }
  }
  const L = 'block text-sm font-medium text-gray-700 mb-1.5'
  return (
    <div className="grid gap-4 md:grid-cols-2 max-w-3xl">
      <div className="md:col-span-2">
        <label className={L} htmlFor="ref-who">Who refers the patient</label>
        <select id="ref-who" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })} className={INPUT} disabled={!people}>
          {!people && <option>Loading...</option>}
          {people && !people.length && <option value="">No CHP or CHA found for this area</option>}
          {groups.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.list.map((p) => <option key={p.user} value={p.user}>{p.name}{p.role ? ` · ${p.role}` : ''}{p.unit ? ` · ${p.unit}` : ''}{p.phone ? ` · ${p.phone}` : ''}</option>)}
            </optgroup>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-gray-500">They get the referral on their Referrals page, with a notification.</p>
      </div>
      <div>
        <label className={L} htmlFor="ref-fac">Health facility</label>
        {facilities && facilities.length > 0 ? (
          <select id="ref-fac" value={f.facility} onChange={(e) => setF({ ...f, facility: e.target.value })} className={INPUT}>
            <option value="">Choose a facility</option>
            {facilities.map((x) => <option key={x.name} value={x.name}>{x.name}{x.subCounty ? ` · ${x.subCounty}` : ''}</option>)}
          </select>
        ) : (
          <input id="ref-fac" value={f.facility} onChange={(e) => setF({ ...f, facility: e.target.value })} placeholder="Facility name" className={INPUT} />
        )}
      </div>
      <div>
        <span className={L}>Urgency</span>
        <Seg label="Urgency" options={URGENCY.map((u) => ({ value: u, label: u }))} value={f.urgency} onChange={(v) => setF({ ...f, urgency: v })} />
      </div>
      <div>
        <label className={L} htmlFor="ref-people">Patients</label>
        <input id="ref-people" type="number" min={1} value={f.people} onChange={(e) => setF({ ...f, people: e.target.value })} className={INPUT} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={L} htmlFor="ref-age">Age group</label>
          <select id="ref-age" value={f.age_group} onChange={(e) => setF({ ...f, age_group: e.target.value })} className={INPUT}>
            <option value="">—</option>{AGE_GROUPS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className={L} htmlFor="ref-sex">Sex</label>
          <select id="ref-sex" value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })} className={INPUT}>
            <option value="">—</option><option>Female</option><option>Male</option>
          </select>
        </div>
      </div>
      <div>
        <label className={L} htmlFor="ref-due">Refer by</label>
        <input id="ref-due" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} className={INPUT} />
      </div>
      <div className="md:col-span-2">
        <label className={L} htmlFor="ref-note">Instructions</label>
        <textarea id="ref-note" rows={2} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="e.g. take the children to the facility today; give ORS on the way" className={INPUT} />
      </div>
      <div className="md:col-span-2 rounded-xl border border-gray-200 p-3">
        <label className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={f.followup} onChange={(e) => setF({ ...f, followup: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
          Follow up after
          <input type="number" min={1} max={30} value={f.followup_days} disabled={!f.followup} onChange={(e) => setF({ ...f, followup_days: e.target.value })}
            aria-label="Follow-up after days" className="w-16 rounded-md border border-gray-300 px-2 py-0.5 text-sm disabled:opacity-50" /> days
        </label>
        <p className="ml-6 mt-1 text-xs text-gray-500">The same person checks on the patient: did they reach the facility, are they better, any new cases nearby?</p>
      </div>
      <div className="md:col-span-2">
        <button type="button" disabled={saving} onClick={send} className={`${BTN} ${PRIMARY} ${FOCUS}`}>{saving ? 'Sending...' : 'Send referral'}</button>
      </div>
    </div>
  )
}

function ReferralPanel({ event, canAct, onToast, onClosed }) {
  const tasksCtx = useEventTasks()
  const [state, setState] = useState(null)
  const [note, setNote] = useState('')
  const [closing, setClosing] = useState(false)
  const load = useCallback(() => getReferralState(event.id).then((s) => { setState(s); setNote((n) => n || s.summary || '') }).catch(() => setState({ ready: false, hasReferral: false })), [event.id])
  const taskCount = tasksCtx?.tasks?.length
  useEffect(() => { load() }, [load, taskCount])
  const closed = event.status === 'Closed'
  async function close() {
    if (!note.trim()) { onToast('Add a closing summary.', true); return }
    setClosing(true)
    try {
      await closeReferralCase(event.id, note.trim())
      onToast('Case closed')
      onClosed()
    } catch (e) { onToast(e.message || 'Could not close the case', true) } finally { setClosing(false) }
  }
  return (
    <div className={card}>
      <PanelHeader title={closed ? 'Referral & close' : state?.hasReferral ? 'Referral & close' : 'Refer the patient'}
        sub={`${event.diseaseName || 'This disease'} is not a priority disease: the patient is referred to a health facility, followed up, then the case is closed. Verification, investigation and the decision are not needed.`} />
      {!state ? <p className="text-sm text-gray-400">Loading...</p> : closed ? (
        <p className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-900">The case is closed. The referral and follow-up are listed under Tasks below.</p>
      ) : !state.hasReferral ? (
        canAct ? <ReferralForm event={event} onSent={() => { onToast('Referral sent'); tasksCtx?.reload(); load() }} onError={(m) => onToast(m, true)} />
          : <p className="text-sm text-gray-600">An officer will refer the patient.</p>
      ) : state.ready ? (
        <div className="max-w-3xl">
          <p className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-900">The referral{(tasksCtx?.tasks || []).some((t) => t.type === 'Follow-up') ? ' and follow-up are' : ' is'} done. Ready to close.</p>
          {canAct && (
            <>
              <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="close-note">Closing summary</label>
              <textarea id="close-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
              <button type="button" disabled={closing} onClick={close} className={`mt-3 ${BTN} ${PRIMARY} ${FOCUS}`}>{closing ? 'Closing...' : 'Close case'}</button>
            </>
          )}
        </div>
      ) : (
        <p className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
          Referral sent. The case is ready to close once the referral{(tasksCtx?.tasks || []).some((t) => t.type === 'Follow-up') ? ' and follow-up are' : ' is'} marked done. Progress is under Tasks below and on the Referrals page.
        </p>
      )}
    </div>
  )
}

function SignalCapturePanel({ event, signals, canAct, editable, busy, onNext, onDiscard, onChanged }) {
  const [showAll, setShowAll] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const rows = showAll ? signals : signals.slice(0, 8)
  return (
    <div className={card}>
      <PanelHeader title="Signal captured" sub="The reports behind this event, as they came in. Nothing to answer here." />
      {signals.length === 0 ? (
        <p className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">{event.reason || 'No individual reports are linked to this event.'}</p>
      ) : (
        <>
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2.5 font-medium">Report</th>
                  <th className="px-3 py-2.5 font-medium">Where · what was reported</th>
                  <th className="px-3 py-2.5 font-medium">Reporter</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <Fragment key={s.id || i}>
                  <tr className={`border-t border-gray-100 align-top ${checkStatus(s) === 'Not a case' ? 'bg-gray-50' : ''}`}>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{s.channel || s.source}</div>
                      {s.source === 'Field' && s.ref ? (
                        <Link to={`/reports/${encodeURIComponent(s.ref)}`} className={`font-mono text-xs text-red-700 hover:underline rounded ${FOCUS}`}>{s.ref}</Link>
                      ) : (
                        <div className="font-mono text-xs text-gray-500">{s.ref || '—'}</div>
                      )}
                      <div className="text-xs text-gray-400" title={fmtDateTime(s.date)}>{relTime(s.date)}</div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-700 min-w-[200px]">
                      <div>{s.area || '—'} · {countLabel(s.people, s.disease)}{s.deaths > 0 && <span className="text-red-700"> · {s.deaths} {s.deaths === 1 ? 'death' : 'deaths'}</span>}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{s.reported || '—'}</div>
                    </td>
                    <td className="px-3 py-3 text-sm min-w-[150px]">
                      <ReporterContact signal={s} canAct={canAct} />
                    </td>
                  </tr>
                  {(s.media || []).length > 0 && (
                    <tr className="align-top">
                      <td colSpan={3} className="px-3 pb-4">
                        <SignalMedia eventId={event.id} signalId={s.id} media={s.media} canAct={canAct}
                          report={s.source === 'Field' ? s.ref : null} onChanged={onChanged} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {signals.length > 8 && (
            <button type="button" onClick={() => setShowAll(!showAll)} className={`mt-2 text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
              {showAll ? 'Show fewer' : `Show ${signals.length - 8} more`}
            </button>
          )}
        </>
      )}
      <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
        {editable && !discarding ? (
          <button type="button" disabled={busy} onClick={() => setDiscarding(true)} className={`text-sm font-medium text-gray-500 hover:text-gray-900 underline underline-offset-2 rounded ${FOCUS}`}>
            Already a known false alarm? Discard signal
          </button>
        ) : <span />}
        <button type="button" onClick={onNext} className={`${BTN} ${PRIMARY} ${FOCUS}`}>Continue to AI triage →</button>
      </div>
      {editable && discarding && <DiscardBox busy={busy} onDiscard={onDiscard} onCancel={() => setDiscarding(false)} />}
    </div>
  )
}

function VerificationPanel({ event, inv, editable, busy, busyKey, signals, canVerify, canAct, canSplit, onCheck, onSplit, onAnswer, onProceed, onDecide, onDiscard }) {
  const [showAll, setShowAll] = useState(false)
  // field reports are checked by phone in AI triage (the call is their verification), so only the situation is left
  const triaged = signals.some((s) => s.source === 'Field')
  const [tab, setTab] = useState(triaged ? 'B' : 'A')
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
  const reportsDone = triaged || (fromTrend ? !!caseQ?.answer : checkedCount > 0)
  const questionsDone = answered === questions.length
  const next = !reportsDone ? (fromTrend ? 'Answer the case definition question in A.' : 'Check at least one report in A.')
    : !questionsDone ? `Answer the ${questions.length - answered} remaining question(s) in B (Not sure is fine).`
      : 'Ready. Read the suggestion and continue.'

  return (
    <div className={card}>
      <PanelHeader title="Verification" sub={triaged ? "The reports were checked by phone in AI triage. Answer the questions about the situation, then decide the next step." : "Check the reports, then answer questions about the situation. Then decide the next step."} />

      <div role="tablist" aria-label="Verification steps" className="mb-6 flex gap-1 border-b border-gray-200 overflow-x-auto">
        {[
          { k: 'A', t: fromTrend ? 'Check the trend' : 'Check the reports', d: fromTrend ? (caseQ?.answer ? 1 : 0) : checkedCount, n: fromTrend ? 1 : signals.length },
          { k: 'B', t: 'About the situation', d: answered, n: questions.length },
        ].filter((x) => !(triaged && x.k === 'A')).map((x) => {
          const on = tab === x.k
          const done = x.n > 0 && x.d >= x.n
          return (
            <button
              key={x.k}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(x.k)}
              className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${on ? 'border-red-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'} ${FOCUS}`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${done ? 'bg-emerald-500 text-white' : on ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {done ? <Check className="w-3 h-3" aria-hidden="true" /> : x.k}
              </span>
              {x.t}
              <span className="text-xs text-gray-400 tabular-nums">{x.d}/{x.n}</span>
            </button>
          )
        })}
      </div>

      {tab === 'A' && fromTrend && (
        <section aria-label="Check the trend" className="mb-8">
          <p className="mb-3 text-sm text-gray-500">This investigation was opened from Epi Trends: there are no individual reports. Call the facility or the CHA to check the cases.</p>
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

      {tab === 'A' && !fromTrend && (
      <section aria-label="Check the reports" className="mb-8">
        <p className="mb-3 text-sm text-gray-500">Call each reporter and confirm the case. You need at least one checked report.</p>
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

      {tab === 'A' && reportsDone && (
        <div className="mb-8 flex justify-end">
          <button type="button" onClick={() => setTab('B')} className={`${BTN} ${SECONDARY} ${FOCUS}`}>Next: about the situation →</button>
        </div>
      )}

      {tab === 'B' && (
      <section aria-label="Questions about the situation" className={`mb-8 ${!reportsDone ? 'opacity-50' : ''}`}>
        <p className="mb-3 text-sm text-gray-500">These are about the whole situation in this place, not one report. Ask the reporter, the facility or the team.</p>
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
      )}

      <section aria-label="Next step" className="border-t border-gray-100 pt-6">
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
              {!discarding && !(action === 'discard' || keyFailed) && (
                <button type="button" disabled={busy} onClick={() => setDiscarding(true)} className={`text-sm font-medium text-gray-500 hover:text-gray-900 underline underline-offset-2 rounded ${FOCUS}`}>
                  Discard signal
                </button>
              )}
            </div>
          </div>
        )}
        {editable && open && discarding && <DiscardBox busy={busy} initial={discardReason} onDiscard={onDiscard} onCancel={() => setDiscarding(false)} />}
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
  { value: 'confirm', title: 'Confirm event', hint: 'It is a real event. RCCE steps open next.', icon: Check, enabled: (s, g, inv) => s === 'Investigating' && g?.canConfirm && !inv?.mustEscalate },
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
      <PanelHeader title="Response & close" sub="Do the protocol's RCCE steps, then close and send feedback" />

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
            <p className="text-sm text-gray-500">This protocol has no RCCE steps.</p>
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
                      <p className="text-sm font-semibold text-gray-900">{s.channel || s.source}{s.ref ? ` ${s.ref}` : ''}</p>
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
  const unit = s.unit && <span className="text-xs text-gray-500">Health unit: {s.unit}</span>   // the CHP's CHU
  if (!(canAct && s.reporter)) return unit || '—'
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-900">{s.reporter.name || '—'}</span>
      {unit}
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

// The result of an officer's disease decision, kept on the page until closed (a toast disappears too quickly to read).
// When the report leaves the Review Queue it is resolved without an investigation, so the officer is offered a
// follow-up task (e.g. a CHP checks on the patient) right here.
const NOTICE_TONE = {
  resolved: 'border-green-200 bg-green-50 text-green-900',
  info: 'border-blue-200 bg-blue-50 text-blue-900',
}

function DecisionNotice({ notice, onClose }) {
  const tasks = useEventTasks()
  const ref = useRef(null)
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [notice])
  if (!notice) return null
  const Icon = notice.tone === 'resolved' ? CheckCircle2 : Info
  return (
    <div ref={ref} role="status" className={`mb-4 rounded-xl border px-4 py-3 ${NOTICE_TONE[notice.tone] || NOTICE_TONE.info}`}>
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{notice.title}</p>
          {notice.body && <p className="mt-0.5 text-sm opacity-90">{notice.body}</p>}
          {notice.tone === 'resolved' && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {tasks?.canAssign && (
                <button
                  type="button"
                  onClick={() => tasks.openAssign({ type: 'Follow-up', title: `Follow up ${notice.ref}: ${notice.name}` })}
                  className={`${BTN} ${PRIMARY} ${FOCUS} !px-4 !py-2`}
                >
                  Assign a follow-up task
                </button>
              )}
              <Link to="/epi-trends" className={`text-sm font-semibold underline-offset-2 hover:underline rounded ${FOCUS}`}>Open Epi Trends</Link>
              <Link to="/alerts-signals" className={`text-sm font-semibold underline-offset-2 hover:underline rounded ${FOCUS}`}>Back to the Review Queue</Link>
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={`shrink-0 rounded p-1 opacity-70 hover:opacity-100 ${FOCUS}`}>
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
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
  const [notice, setNotice] = useState(null)
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

  const showToast = useCallback((message, isError = false, ms = isError ? 10000 : 6000) => {
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
    setNotice(null)
    setOpenStep(Number(new URLSearchParams(window.location.search).get('step')) || null)
    return load()
  }, [load])

  // quiet refresh after a task change, so the audit timeline shows it without reloading the page
  // bumped when the report itself changes on this page (signs added from a voice note), so AI triage reloads
  const [reportVersion, setReportVersion] = useState(0)
  const refreshEvent = useCallback(() => {
    Promise.all([getReviewEvent(id), getInvestigation(id)])
      .then(([ev, iv]) => { setEvent(ev); setInv(iv) })
      .catch(() => {})
  }, [id])

  // An officer chose a report's disease here: it stays (same disease), moves to that disease's event,
  // or leaves the Review Queue (diseases followed in Epi Trends, e.g. malaria).
  const handleDiseaseDecided = useCallback((r, ref) => {
    const name = r.suspected_disease_name || 'the case definition'
    if (r.event && r.event !== id) {
      showToast(`${ref}: ${name}. Moved to ${r.event}.`, false, 8000)
      navigate(`/alerts-signals/${encodeURIComponent(r.event)}`)
      return
    }
    if (!r.event) {
      const last = (event?.signals || []).length <= 1
      setNotice({ tone: 'resolved', ref, name, title: `Resolved: ${ref} is ${name}`,
        body: `${name} is not investigated case by case, so ${last ? 'this event is closed' : 'this report left the event'} without verification or investigation. It is followed in Epi Trends, where a rise in cases raises an alert. The sub-county team was emailed. If someone should check on the patient, assign a follow-up task.` })
    } else if (r.suspected_disease && event && r.suspected_disease !== event.disease) {
      setNotice({ tone: 'info', title: `${ref}: ${name}`, body: `This event now continues as ${name}. The risk score was updated, and questions that differ were reset.` })
    } else {
      setNotice({ tone: 'info', title: `${ref}: ${name} confirmed`, body: 'The risk score was updated.' })
    }
    refreshEvent()
  }, [id, event, navigate, refreshEvent, showToast])

  const stepInfo = useMemo(() => (event && inv ? computeSteps(event, inv) : null), [event, inv])
  const currentStep = stepInfo?.current

  const status = event?.status
  useEffect(() => {
    if (status && currentStep) setOpenStep(currentStep)
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
  // field reports on this event, oldest first, for "Which disease is it?" (CBS reports carry no symptoms here)
  const fieldReports = useMemo(
    () => [...new Set([...signals].reverse().filter((s) => s.source === 'Field' && s.ref).map((s) => s.ref))],
    [signals]
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
  const shown = openStep || currentStep || 3

  function renderPanel() {
    switch (shown) {
      case 1:
        return (
          <SignalCapturePanel
            onChanged={() => { setReportVersion((v) => v + 1); refreshEvent() }}
            event={event}
            signals={signals}
            canAct={canAct}
            editable={canAct && (status === 'New' || status === 'Verifying')}
            busy={busy}
            onNext={() => selectStep(2)}
            onDiscard={(reason) => runAction('discard', reason)}
          />
        )
      case 2:
        if (fieldReports.length > 0) {
          return (
            <TriagePanel
              key={`${event.id}-${reportVersion}`}
              event={event}
              canAct={canAct}
              busy={busy}
              onChanged={refreshEvent}
              onError={(m) => showToast(m, true)}
              onNext={selectStep}
              onDiscard={(reason) => runAction('discard', reason)}
              onSplit={async (sp) => {
                try {
                  const res = await splitReport(event.id, sp.signal, `The reports point to different diseases: ${sp.ref} (${sp.disease}) is followed up on its own, after this one.`)
                  showToast(`${sp.ref} moved to ${res.newEvent}. Come back to it after this one.`, false, 8000)
                  setReportVersion((v) => v + 1)
                  refreshEvent()
                } catch (err) { showToast(err.message || 'Could not split the report', true) }
              }}
              onConfirmed={(r) => {
                showToast(r.pathway === 'Referral' ? `${r.diseaseName} confirmed. Refer the patient next.` : `${r.diseaseName} confirmed. Continue to verification.`)
                refreshEvent()
                selectStep(r.pathway === 'Referral' ? 6 : 3)
              }}
            />
          )
        }
        return (
          <div className={card}>
            <PanelHeader title="AI analysis & risk assessment" sub="A quick check of how urgent this looks" />
            <RiskAssessment risk={event.risk} disease={fieldReports.length > 0 && has('verify_suspected_disease') ? (
              <EventDiseaseDecision key={`${event.id}-${reportVersion}`} reports={fieldReports} onDecided={handleDiseaseDecided} onError={(m) => showToast(m, true)} />
            ) : (
              <DiseaseInsight eventId={event.id} diseaseName={event.disease === 'unclassified-illness' ? '' : event.diseaseName} eventReason={event.disease === 'unclassified-illness' ? '' : event.reason} onOpenCapture={() => selectStep(1)} />
            )}>
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
        if (event.pathway === 'Referral') {
          return <ReferralPanel event={event} canAct={canAct} onToast={showToast} onClosed={refreshEvent} />
        }
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
          <p className="text-sm text-gray-500 -mb-2">One reported event from the field. Work through the steps below: call the reporter in AI triage and choose the disease, then verify and investigate (priority diseases) or refer the patient (other diseases).</p>
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
              Event {event.id}{(event.channels?.length ? event.channels : (event.sources || [])).length ? ` · ${(event.channels?.length ? event.channels : event.sources).join(', ')}` : ''} · {event.reports > 1
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
              {event.units?.length > 0 && (
                <Field icon={Building2} label={event.units.length > 1 ? 'Health units' : 'Health unit'} value={event.units.join(', ')} />
              )}
            </dl>
            {mapOpen && <ReportsMap signals={signals} />}
          </div>

          <EventTasksProvider eventId={event.id} eventStatus={event.status} onChanged={refreshEvent} onToast={showToast}>
            <Tracker event={event} states={stepInfo.states} openStep={shown} onSelect={selectStep} />

            <DecisionNotice notice={notice} onClose={() => setNotice(null)} />

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
          role={toast.error ? 'alert' : 'status'}
          className={`fixed bottom-6 right-6 z-[70] max-w-sm flex items-start gap-3 rounded-xl border border-l-4 bg-white px-4 py-3 text-sm text-gray-800 shadow-lg ${toast.error ? 'border-red-200 border-l-red-600' : 'border-gray-200 border-l-green-600'}`}
        >
          {toast.error
            ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
            : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-600" aria-hidden="true" />}
          <span className="flex-1">{toast.message}</span>
          <button type="button" onClick={() => setToast((t) => ({ ...t, show: false }))} aria-label="Close" className={`shrink-0 rounded text-gray-400 hover:text-gray-700 ${FOCUS}`}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </AppShell>
  )
}