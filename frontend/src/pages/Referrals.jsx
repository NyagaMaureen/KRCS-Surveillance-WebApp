import { Fragment, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getMyTasks, createReferral, getMyReferableReports, updateEventTask, getReferralFacilities } from '../api/frappe'
import { isOpen } from '../components/tasks/taskUi'
import {
  FOCUS, CARD, INPUT, TEXTAREA, BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, PageTitle, Badge, Skeleton, Toast, GRID_TABLE, GRID_HEAD,
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
        // a table with grid lines and a serial number, like Signals Captured and Follow-ups (KRCS 18 Nov 2026);
        // updating opens a row under the referral
        <div className={`${CARD} overflow-x-auto`}>
          <table className={GRID_TABLE}>
            <thead>
              <tr className={GRID_HEAD}>
                <th className="px-4 py-3 w-10">#</th>
                <th className="px-4 py-3">Referral</th>
                <th className="px-4 py-3">Facility</th>
                <th className="px-4 py-3">Why</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => {
                const open = isOpen(t)
                const isUpdating = updating === t.id && open
                return (
                  <Fragment key={t.id}>
                    <tr id={`task-${t.id}`} className={`align-top hover:bg-red-50/40 ${focus === t.id ? 'bg-amber-50/60' : ''}`}>
                      <td className="px-4 py-3 text-gray-500 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-3 min-w-[180px]">
                        <p className="font-medium text-gray-900">{t.people ? `${t.people} ${t.people === 1 ? 'person' : 'people'} referred` : patientLabel(t)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{[t.ref, t.selfMade ? '' : `asked by ${t.assignedBy}`].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-900">{t.facility || '—'}</td>
                      <td className="px-4 py-3 min-w-[220px] text-gray-900">
                        <p className="whitespace-pre-wrap">{t.reason || t.instructions || '—'}</p>
                        {t.outcome && <p className="text-xs text-gray-600 mt-1">Note: {t.outcome}</p>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-900">{shortWhen(t.createdOn)}</td>
                      <td className="px-4 py-3"><Badge tone={REFERRAL_TONE[t.statusLabel]}>{t.statusLabel}</Badge></td>
                      <td className="px-4 py-3 text-right">
                        {open && (
                          <button type="button" onClick={() => setUpdating(isUpdating ? null : t.id)} className={isUpdating ? BTN_SMALL : `${BTN_PRIMARY} h-8 text-xs whitespace-nowrap`}>
                            {isUpdating ? 'Close' : 'Update status'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isUpdating && (
                      <tr>
                        <td colSpan={7} className="px-4 pb-4 bg-gray-50/60">
                          <ReferralUpdate task={t} onCancel={() => setUpdating(null)} onError={(m) => flash(m, true)}
                            onSaved={() => { setUpdating(null); flash('Referral updated'); load() }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
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
  const [form, setForm] = useState({ caseReport: '', facility: '', people: '1', reason: '' })   // no names, ages or sex (KRCS review)
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
  const ready = form.facility.trim() && form.reason.trim() && /^\d+$/.test(String(form.people).trim()) && Number(form.people) >= 1

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="New referral" onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New referral</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`text-gray-400 hover:text-gray-700 rounded ${FOCUS}`}><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <p className="text-sm text-gray-500">Record people you sent to a health facility. Don't write names.</p>
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">Which report is this about? <span className="font-normal text-gray-400">(optional)</span></span>
            <select value={form.caseReport} onChange={(e) => set({ caseReport: e.target.value })} className={INPUT}>
              <option value="">{reports === null ? 'Loading…' : 'Not linked to a report'}</option>
              {(reports || []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          {/* the picked report's details, as on View report (no suspected disease for CHPs) - KRCS 19 Nov 2026 */}
          <ReportFacts report={(reports || []).find((r) => r.id === form.caseReport)} />
          {/* labels on one line so the two boxes line up (KRCS 18 Nov 2026) */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_190px] gap-4 items-start">
            <label className="block">
              <span className="block text-sm font-medium text-gray-800 mb-1">Health facility</span>
              <FacilityPick value={form.facility} onChange={(v) => set({ facility: v })} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-800 mb-1 whitespace-nowrap">People referred</span>
              <input type="number" min="1" step="1" inputMode="numeric" value={form.people} onChange={(e) => set({ people: e.target.value })} className={INPUT} />
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

const CHANNEL = { Mobile: 'Mobile app', Web: 'Web form' }
const ANIMAL = { 'Bite or scratch': 'Bitten or scratched', 'Handled sick or dead animal': 'Handled a sick or dead animal' }
const day = (v, time) => {
  if (!v) return null
  const d = new Date(String(v).replace(' ', 'T'))
  if (isNaN(d)) return v
  return d.toLocaleString('en-GB', time ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

function ReportFacts({ report }) {
  const d = report?.details
  if (!d) return null
  const cells = [
    ['Signal ID', report.id],
    ['Date reported', day(d.reported, true)],
    ['Reporting channel', CHANNEL[d.channel] || d.channel],
    ['Number of people affected', String(d.people)],
    ['Number of deaths', String(d.deaths)],
    ['Symptoms reported', d.symptoms],
    ['Date of onset', day(d.onset)],
    ['Affected age group', d.ages],
    ['Animal exposure', d.animal && (ANIMAL[d.animal] || d.animal)],
    ['Location', d.location],
    ['Community Health Unit', d.chu],
  ].filter(([, v]) => v)
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3">
        {cells.map(([k, v]) => (
          <div key={k}><dt className="text-xs font-bold text-gray-900">{k}</dt><dd className="mt-0.5 text-sm text-gray-900">{v}</dd></div>
        ))}
      </dl>
      {d.notes && (
        <div className="mt-3">
          <div className="text-xs font-bold text-gray-900">{d.channel === 'WhatsApp' ? 'WhatsApp message from community member' : 'Additional notes'}</div>
          <p className="mt-0.5 whitespace-pre-line text-sm text-gray-900">{d.notes}</p>
        </div>
      )}
    </div>
  )
}

// the facility list only, so the facility's FHW sees the referral (no typed-in facilities for now, KRCS 18 Nov 2026);
// only the facilities in the CHP's own sub-county
function FacilityPick({ value, onChange }) {
  const [list, setList] = useState(null)
  useEffect(() => { getReferralFacilities(true).then(setList).catch(() => setList([])) }, [])
  return (
    <select value={value} className={INPUT} onChange={(e) => onChange(e.target.value)}>
      <option value="">{list === null ? 'Loading…' : list.length ? 'Select a facility' : 'No facilities in your sub-county yet'}</option>
      {(list || []).map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
    </select>
  )
}
