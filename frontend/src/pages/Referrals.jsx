import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRightLeft, Building2, CalendarDays, Plus, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getMyTasks, createReferral, getMyReferableReports, updateEventTask } from '../api/frappe'
import { isOpen } from '../components/tasks/taskUi'
import {
  FOCUS, CARD, INPUT, TEXTAREA, BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, PageTitle, IconBubble, Badge, Skeleton, Toast,
  REFERRAL_TONE, shortWhen,
} from '../components/chp/ui'
import { patientLabel } from './ChpDashboard'

const AGE_GROUPS = ['Under 1', '1-4 years', '5-14 years', '15+ years']

export default function Referrals() {
  const [params] = useSearchParams()
  const focus = params.get('task')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [updating, setUpdating] = useState(focus)
  const [toast, setToast] = useState({ text: '', error: false })

  const load = useCallback(() => {
    setError('')
    return getMyTasks('mine', 'all', 'referrals').then(setData).catch((e) => setError(e.message || 'Could not load referrals'))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (focus && data) document.getElementById(`task-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focus, data])

  const flash = (text, error = false) => { setToast({ text, error }); setTimeout(() => setToast({ text: '' }), 3000) }
  const tasks = [...(data?.tasks || [])].sort((a, b) => (isOpen(b) - isOpen(a)) || String(b.createdOn).localeCompare(String(a.createdOn)))

  return (
    <AppShell>
      <PageTitle
        title="Referral Management"
        subtitle="Patients you referred to a health facility, for care or to have a sample collected. Update each one when you know if they reached the facility."
        action={<button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}><Plus className="w-4 h-4" aria-hidden="true" /> New referral</button>}
      />

      {error ? (
        <div className={`${CARD} p-10 text-center text-sm text-gray-600`}>{error} <button onClick={load} className="ml-2 text-red-600 underline">Try again</button></div>
      ) : !data ? <Skeleton /> : !tasks.length ? (
        <div className={`${CARD} p-12 text-center`}>
          <p className="text-sm font-medium text-gray-900">No referrals yet</p>
          <p className="text-sm text-gray-500 mt-1">When you send a patient to a facility, record it here. Referrals your officer asks you to make also appear here.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((t) => (
            <li key={t.id} id={`task-${t.id}`} className={`${CARD} p-5 ${focus === t.id ? 'ring-1 ring-amber-300' : ''}`}>
              <div className="flex items-start gap-4">
                <IconBubble icon={ArrowRightLeft} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{patientLabel(t)}</p>
                      <p className="text-xs text-gray-400">{t.id}{t.selfMade ? '' : ` · asked by ${t.assignedBy}`}</p>
                    </div>
                    <Badge tone={REFERRAL_TONE[t.statusLabel]}>{t.statusLabel}</Badge>
                  </div>
                  {(t.reason || t.instructions) && <p className="text-sm text-gray-600 mt-2">{t.reason || t.instructions}</p>}
                  <p className="text-xs text-gray-500 mt-2 flex flex-wrap gap-x-5 gap-y-1">
                    <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" aria-hidden="true" />{t.facility || '—'}{t.urgency && t.urgency !== 'Routine' ? ` · ${t.urgency}` : ''}</span>
                    <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />{shortWhen(t.createdOn)}</span>
                  </p>
                  {t.outcome && <p className="text-sm text-gray-700 mt-2"><span className="text-gray-400">Note: </span>{t.outcome}</p>}
                </div>
              </div>
              {isOpen(t) && (
                updating === t.id ? (
                  <ReferralUpdate task={t} onCancel={() => setUpdating(null)} onError={(m) => flash(m, true)}
                    onSaved={() => { setUpdating(null); flash('Referral updated'); load() }} />
                ) : (
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => setUpdating(t.id)} className={BTN_SMALL}>Update status</button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && <NewReferral onClose={() => setAdding(false)} onSaved={() => { setAdding(false); flash('Referral recorded'); load() }} onError={(m) => flash(m, true)} />}
      <Toast text={toast.text} error={toast.error} />
    </AppShell>
  )
}

const UPDATE_CHOICES = [
  { status: 'In progress', label: 'On the way' },
  { status: 'Done', label: 'Reached facility' },
  { status: 'Could not complete', label: 'Not reached' },
]

function ReferralUpdate({ task, onCancel, onSaved, onError }) {
  const [status, setStatus] = useState('Done')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const needsNote = status === 'Could not complete'
  async function save() {
    setSaving(true)
    try {
      await updateEventTask(task.id, { status, outcome: note })
      onSaved()
    } catch (e) {
      onError(e.message || 'Could not update')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="mt-4 rounded-lg bg-gray-50 p-4 flex flex-col gap-3">
      <div role="radiogroup" aria-label="Referral status" className="flex flex-wrap gap-2">
        {UPDATE_CHOICES.map((c) => (
          <button key={c.status} type="button" role="radio" aria-checked={status === c.status} onClick={() => setStatus(c.status)}
            className={`h-9 px-3 rounded-lg border text-sm bg-white ${FOCUS} ${status === c.status ? 'border-gray-900 text-gray-900 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {c.label}
          </button>
        ))}
      </div>
      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={TEXTAREA}
        placeholder={needsNote ? 'Why did the patient not reach the facility? (required)' : 'Note (optional), e.g. seen by a clinician, sample taken'} />
      <p className="text-xs text-gray-400">Do not write names or phone numbers.</p>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving || (needsNote && !note.trim())} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>Cancel</button>
      </div>
    </div>
  )
}

function NewReferral({ onClose, onSaved, onError }) {
  const [reports, setReports] = useState(null)
  const [form, setForm] = useState({ caseReport: '', ageGroup: '', sex: '', facility: '', reason: '', urgency: 'Routine' })
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  useEffect(() => { getMyReferableReports().then(setReports).catch(() => setReports([])) }, [])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setSaving(true)
    try {
      await createReferral(form)
      onSaved()
    } catch (e) {
      onError(e.message || 'Could not record the referral')
    } finally {
      setSaving(false)
    }
  }
  const ready = form.facility.trim() && form.reason.trim()

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="New referral" onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New referral</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`text-gray-400 hover:text-gray-700 rounded ${FOCUS}`}><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <p className="text-sm text-gray-500">Record a patient you sent to a health facility. Don't write the patient's name.</p>
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">Which report is this about? <span className="font-normal text-gray-400">(optional)</span></span>
            <select value={form.caseReport} onChange={(e) => set({ caseReport: e.target.value })} className={INPUT}>
              <option value="">{reports === null ? 'Loading…' : 'Not linked to a report'}</option>
              {(reports || []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-gray-800 mb-1">Age group</span>
              <select value={form.ageGroup} onChange={(e) => set({ ageGroup: e.target.value })} className={INPUT}>
                <option value="">Not given</option>
                {AGE_GROUPS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-800 mb-1">Sex</span>
              <select value={form.sex} onChange={(e) => set({ sex: e.target.value })} className={INPUT}>
                <option value="">Not given</option><option>Female</option><option>Male</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-gray-800 mb-1">Health facility</span>
              <input value={form.facility} onChange={(e) => set({ facility: e.target.value })} placeholder="e.g. Kalobeyei Clinic 2" className={INPUT} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-800 mb-1">Urgency</span>
              <select value={form.urgency} onChange={(e) => set({ urgency: e.target.value })} className={INPUT}>
                <option>Routine</option><option>Urgent</option><option>Emergency</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">Why was the patient referred?</span>
            <textarea rows={2} value={form.reason} onChange={(e) => set({ reason: e.target.value })} className={TEXTAREA}
              placeholder="e.g. Severe dehydration from watery diarrhoea; sample collection" />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
            <button type="button" onClick={save} disabled={!ready || saving} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Save referral'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
