import { useEffect, useMemo, useState } from 'react'
import { Building2, Check, X, FileText, Loader2 } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { FOCUS, TEXTAREA, Skeleton, Toast } from '../components/chp/ui'
import { getFacilityReferrals, confirmReferral, getReferralReport } from '../api/frappe'

// Facility Health Worker: referrals CHPs made to this facility. The FHW opens the referral to see the full report
// (read-only) and says whether the people arrived; the CHP sees it.
// Data: surveillance.fhw.facility_referrals / referral_report / confirm_referral

const TABS = ['Pending', 'Arrived', 'Did not arrive', 'All']
const STATUS_CLS = { Pending: 'bg-amber-50 text-amber-800', Arrived: 'bg-green-50 text-green-800', 'Did not arrive': 'bg-red-50 text-red-800' }
const BTN = `inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`
const when = (v) => {
  const d = new Date(String(v || '').replace(' ', 'T'))
  return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const day = (v) => {
  const d = new Date(String(v || '').replace(' ', 'T'))
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const people = (n) => (n ? `${n} ${n === 1 ? 'person' : 'people'}` : '—')

function Status({ value }) {
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[value] || 'bg-gray-100 text-gray-800'}`}>{value}</span>
}

function ArriveButtons({ onPick }) {
  return (
    <>
      <button type="button" onClick={() => onPick(1)} className={BTN}><Check className="h-3.5 w-3.5 text-green-700" aria-hidden="true" />Arrived</button>
      <button type="button" onClick={() => onPick(0)} className={BTN}><X className="h-3.5 w-3.5 text-gray-600" aria-hidden="true" />Did not arrive</button>
    </>
  )
}

export default function FacilityReferrals() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('Pending')
  const [open, setOpen] = useState(null)        // { id, arrived }  arrived: null | 1 | 0
  const [toast, setToast] = useState({ text: '' })

  useEffect(() => { getFacilityReferrals().then(setData).catch((e) => setToast({ text: e.message, error: true })) }, [])

  const counts = useMemo(() => {
    const c = { All: 0 }
    ;(data?.referrals || []).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; c.All += 1 })
    return c
  }, [data])
  const rows = (data?.referrals || []).filter((r) => tab === 'All' || r.status === tab)

  function saved(updated) {
    setData((d) => ({ ...d, referrals: d.referrals.map((r) => (r.id === updated.id ? updated : r)) }))
    setOpen(null)
    setToast({ text: 'Saved. The CHP who referred them can now see it.' })
    setTimeout(() => setToast({ text: '' }), 2500)
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-brand-navy">Referrals to my facility</h2>
        <p className="flex items-center gap-1.5 text-sm text-gray-500">
          <Building2 className="h-4 w-4" aria-hidden="true" />
          {data ? (data.facility || 'No facility assigned yet. Ask your administrator to set it in User Management.') : 'Loading…'}
          {data?.facility && ' · confirm whether the people referred by CHPs arrived'}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div role="tablist" className="flex overflow-x-auto border-b border-gray-200 px-2">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={['-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm', tab === t ? 'border-red-600 font-bold text-gray-900' : 'border-transparent font-medium text-gray-600 hover:text-gray-900', FOCUS].join(' ')}>
              {t} <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{counts[t] || 0}</span>
            </button>
          ))}
        </div>

        {!data ? <div className="p-5"><Skeleton rows={4} /></div> : !rows.length ? (
          <p className="p-10 text-center text-sm text-gray-500">No {tab === 'All' ? '' : `${tab.toLowerCase()} `}referrals.</p>
        ) : (
          <>
            {/* phones: one card per referral */}
            <ul className="divide-y divide-gray-100 lg:hidden">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{[r.ref, r.condition || r.reason || 'Referral'].filter(Boolean).join(' · ')}</p>
                      <p className="text-xs text-gray-600">{people(r.people)}{r.patient ? ` · ${r.patient}` : ''} · from {r.from || '—'} · {when(r.date)}</p>
                    </div>
                    <Status value={r.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setOpen({ id: r.id, arrived: null })} className={BTN}><FileText className="h-3.5 w-3.5" aria-hidden="true" />View</button>
                    {r.status === 'Pending' && <ArriveButtons onPick={(a) => setOpen({ id: r.id, arrived: a })} />}
                  </div>
                </li>
              ))}
            </ul>
            {/* larger screens: table with grid lines, like Signals Captured */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-gray-200 [&_th]:border [&_th]:border-gray-200">
                <thead>
                  <tr className="text-left text-xs text-gray-900 [&_th]:border-b-2 [&_th]:border-b-red-600 [&_th]:font-bold">
                    <th className="px-4 py-3">Referral</th><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Suspected condition</th>
                    <th className="px-4 py-3">Reason</th><th className="px-4 py-3">From</th><th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-gray-900">{r.ref || '—'}</td>
                      <td className="px-4 py-3 text-gray-900">{people(r.people)}{r.patient && <span className="block text-xs text-gray-500">{r.patient}</span>}</td>
                      <td className="px-4 py-3 text-gray-900">{r.condition || '—'}{r.symptoms?.length > 0 && <span className="block text-xs text-gray-500">{r.symptoms.slice(0, 3).join(', ')}{r.symptoms.length > 3 ? '…' : ''}</span>}</td>
                      <td className="max-w-[16rem] px-4 py-3 text-gray-900">{r.reason || '—'}</td>
                      <td className="px-4 py-3 text-gray-900">{r.from || '—'}{r.place && <span className="block text-xs text-gray-500">{r.place}</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-900">{when(r.date)}</td>
                      <td className="px-4 py-3"><Status value={r.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" onClick={() => setOpen({ id: r.id, arrived: null })} className={BTN}><FileText className="h-3.5 w-3.5" aria-hidden="true" />View</button>
                          {r.status === 'Pending' && <ArriveButtons onPick={(a) => setOpen({ id: r.id, arrived: a })} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {open && <ReferralPanel open={open} onClose={() => setOpen(null)} onSaved={saved} onError={(t) => setToast({ text: t, error: true })} />}
      <Toast text={toast.text} error={toast.error} />
    </AppShell>
  )
}

// side panel: the referral, the full report behind it (read-only), and the Arrived / Did not arrive answer
function ReferralPanel({ open, onClose, onSaved, onError }) {
  const [data, setData] = useState(null)
  const [arrived, setArrived] = useState(open.arrived)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { getReferralReport(open.id).then(setData).catch((e) => { onError(e.message || 'Could not open the referral'); onClose() }) }, [open.id])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  async function save() {
    setSaving(true)
    try {
      onSaved(await confirmReferral(open.id, arrived, note.trim()))
    } catch (e) {
      onError(e.message || 'Could not save')
      setSaving(false)
    }
  }

  const ref = data?.referral
  const rep = data?.report
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-gray-900/30" />
      <aside role="dialog" aria-modal="true" aria-label="Referral details" className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{ref?.ref ? `Referral ${ref.ref}` : 'Referral'}</h3>
            {ref && <p className="text-xs text-gray-500">From {ref.from || '—'} · {when(ref.date)}</p>}
          </div>
          <div className="flex items-center gap-3">
            {ref && <Status value={ref.status} />}
            <button type="button" onClick={onClose} aria-label="Close" className={`rounded p-1 text-gray-600 hover:bg-gray-100 ${FOCUS}`}><X className="h-5 w-5" aria-hidden="true" /></button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {!data ? <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading…</div> : (
            <>
              <section>
                <h4 className="mb-2 border-b-2 border-red-600 pb-1 text-sm font-bold text-gray-900">Referral</h4>
                <Rows rows={[
                  ['People referred', people(ref.people)],
                  ['Patient', ref.patient],
                  ['Reason', ref.reason],
                  ['Outcome', ref.status !== 'Pending' ? ref.note : ''],
                ]} />
              </section>

              {rep ? (
                <section>
                  <h4 className="mb-2 border-b-2 border-red-600 pb-1 text-sm font-bold text-gray-900">Report {rep.id}</h4>
                  <Rows rows={[
                    ['Suspected disease', rep.disease || 'Not matched yet'],
                    ['Could also be', rep.alsoConsistentWith],
                    ['Report status', rep.status],
                    ['Symptoms', rep.symptoms.join(', ')],
                    ['Symptoms not present', rep.absentSymptoms.join(', ')],
                    ['Symptoms started', day(rep.onset)],
                    ['Reported', when(rep.reported)],
                    ['Age groups', rep.ageGroups],
                    ['People affected', rep.people || ''],
                    ['Deaths', rep.deaths || ''],
                    ['Contact with animals', rep.animalExposure],
                    ['Where', [rep.place, rep.subCounty].filter(Boolean).join(', ')],
                    ['Category', rep.category],
                    ['Reported by', `${rep.reporter || '—'}${rep.channel ? ` (${rep.channel})` : ''}`],
                    ['Additional notes', rep.notes],
                  ]} />
                  {rep.attachmentNotes.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {rep.attachmentNotes.map((n, i) => (
                        <div key={i} className="rounded-lg bg-gray-50 p-3">
                          <p className="text-xs font-semibold text-gray-600">{n.kind}</p>
                          <p className="mt-1 whitespace-pre-line text-sm text-gray-900">{n.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {rep.otherFiles > 0 && <p className="mt-2 text-xs text-gray-500">{rep.otherFiles} photo/file attachment{rep.otherFiles === 1 ? '' : 's'} on the report (officers can open them).</p>}
                  {rep.updates.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-1 text-xs font-semibold text-gray-600">Updates</p>
                      <ul className="space-y-1.5">
                        {rep.updates.map((u, i) => <li key={i} className="text-sm text-gray-900"><span className="text-xs text-gray-500">{when(u.at)}{u.by ? ` · ${u.by}` : ''}: </span>{u.note}</li>)}
                      </ul>
                    </div>
                  )}
                </section>
              ) : <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">The CHP did not link a report to this referral.</p>}
            </>
          )}
        </div>

        {ref?.status === 'Pending' && (
          <div className="border-t border-gray-200 px-5 py-4">
            <p className="mb-2 text-sm font-semibold text-gray-900">Did the {ref.people === 1 ? 'person' : 'people'} arrive?</p>
            <div className="mb-3 flex gap-2">
              {[[1, 'Arrived', Check], [0, 'Did not arrive', X]].map(([v, label, Icon]) => (
                <button key={label} type="button" aria-pressed={arrived === v} onClick={() => setArrived(v)}
                  className={['inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold', arrived === v ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50', FOCUS].join(' ')}>
                  <Icon className={`h-4 w-4 ${arrived === v ? 'text-white' : v ? 'text-green-700' : 'text-gray-600'}`} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
            {arrived !== null && (
              <>
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={TEXTAREA}
                  placeholder={arrived ? 'Note (optional), e.g. admitted, sample taken' : 'Note (optional), e.g. not seen by end of day'} />
                <button type="button" onClick={save} disabled={saving}
                  className={`mt-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 ${FOCUS}`}>{saving ? 'Saving…' : 'Save'}</button>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

function Rows({ rows }) {
  return (
    <dl className="divide-y divide-gray-100">
      {rows.filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => (
        <div key={k} className="grid grid-cols-3 gap-3 py-2 text-sm">
          <dt className="text-gray-600">{k}</dt>
          <dd className="col-span-2 text-gray-900">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
