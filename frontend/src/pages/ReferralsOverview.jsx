import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Search, X, ArrowRightLeft, Users, MapPin, FileText, UserRound, UserCheck, CalendarDays, Clock, CheckCheck, ClipboardList } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import { getReferralsOverview, getReferralState, closeReferralCase, getReferralCase } from '../api/frappe'
import { PageSizeSelect } from '../components/common/Pager'

// Referrals page for officers, CHAs and HQ (KRCS 17 Nov 2026): every referral in the user's area (officers: their
// sub-county, CHAs: their health unit(s), HQ and admins: everything), from the Review Queue's referral pathway and
// those CHPs record themselves. Cases whose referral and follow-up are done can be closed here.
// Data: surveillance.triage.get_referrals.
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'ready', label: 'Ready to close' },
  { key: 'closed', label: 'Closed' },
]
const TONE = {
  Pending: 'bg-blue-50 text-blue-700', 'On the way': 'bg-blue-50 text-blue-700', Blocked: 'bg-amber-50 text-amber-800',
  'Reached facility': 'bg-emerald-50 text-emerald-700', 'Not reached': 'bg-gray-100 text-gray-600', Overdue: 'bg-red-50 text-red-700',
}
const SELECT = 'border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-white min-w-0 max-w-full'
const fmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—')

function FollowUp({ f }) {
  if (!f) return <span className="text-gray-400">—</span>
  if (f.state === 'done') return <span className="text-emerald-700">Done</span>
  return <span className={f.state === 'overdue' ? 'text-red-700' : 'text-gray-600'}>{f.state === 'overdue' ? 'Overdue' : 'Due'} {fmt(f.due)}</span>
}

// everything about one referral, in a window (KRCS 18 Nov 2026): grouped tiles with icons, not a list of text
function Tile({ icon: Icon, label, children, tone = '' }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-red-600 shadow-sm"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-gray-900">{label}</p>
        <div className={`mt-0.5 text-sm ${tone || 'text-gray-900'}`}>{children}</div>
      </div>
    </div>
  )
}

const longDate = (v) => (v ? new Date(String(v).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

// The case behind a referral, laid out like Signal captured (KRCS 20 Nov 2026)
const fmtWhen = (v) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

function CaseSection({ task }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    getReferralCase(task).then((d) => live && setData(d)).catch((e) => live && setError(e.message || 'Could not load the case.'))
    return () => { live = false }
  }, [task])
  if (error) return <p className="text-sm text-gray-700">{error}</p>
  if (!data) return <div className="h-24 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />
  const ev = data.event
  if (!ev && !data.reports.length) return <p className="text-sm text-gray-700">Not linked to a case or a report.</p>
  return (
    <div>
      {ev && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-gray-900">
            <b>{ev.id}</b>{ev.disease ? ` · ${/^suspected/i.test(ev.disease) ? ev.disease : `Suspected ${ev.disease}`}` : ''} · {ev.status}{ev.place ? ` · ${ev.place}` : ''}
            <span className="block text-gray-700">{ev.people} {ev.people === 1 ? 'person' : 'people'}{ev.deaths ? ` · ${ev.deaths} ${ev.deaths === 1 ? 'death' : 'deaths'}` : ''} · {ev.reports} {ev.reports === 1 ? 'report' : 'reports'} · first reported {fmtWhen(ev.firstReported)}</span>
          </p>
          <Link to={`/alerts-signals/${encodeURIComponent(ev.id)}`} className="text-sm font-semibold text-red-700 hover:underline">Open the case →</Link>
        </div>
      )}
      {data.reports.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-gray-200 text-gray-900">
              <th className="px-3 py-2 font-bold">Report</th><th className="px-3 py-2 font-bold">What was reported</th>
              <th className="px-3 py-2 font-bold">Where</th><th className="px-3 py-2 font-bold">Reporter</th>
            </tr></thead>
            <tbody>
              {data.reports.map((x) => (
                <tr key={x.ref} className="border-t border-gray-200 align-top">
                  <td className="px-3 py-3 whitespace-nowrap text-gray-900">
                    <Link to={`/reports/${encodeURIComponent(x.ref)}`} className="font-semibold text-red-700 hover:underline">{x.ref}</Link>
                    <span className="block">{x.channel || '—'}</span>
                    {x.kind && <span className="block">{x.kind}</span>}
                    <span className="block">{fmtWhen(x.date)}</span>
                  </td>
                  <td className="px-3 py-3 text-gray-900 min-w-[220px]">
                    <span className="block font-semibold">{x.people} {x.people === 1 ? 'person' : 'people'}{x.deaths > 0 && <span className="text-red-700"> · {x.deaths} {x.deaths === 1 ? 'death' : 'deaths'}</span>}</span>
                    <span className="block">{x.symptoms || '—'}</span>
                    {x.notPresent && <span className="block text-gray-700">Not present: {x.notPresent}</span>}
                    {x.onset && <span className="block"><b>Date of onset</b> {longDate(x.onset)}</span>}
                    {x.ages && <span className="block"><b>Age group</b> {x.ages}</span>}
                    {x.animal && <span className="block"><b>Animal exposure</b> {x.animal}</span>}
                    {x.notes && <span className="mt-1 block whitespace-pre-wrap"><b>Notes</b> {x.notes}</span>}
                  </td>
                  <td className="px-3 py-3 text-gray-900 min-w-[130px]">
                    <span className="block">{x.location || '—'}</span>
                    {x.gps ? <a href={`https://www.google.com/maps?q=${x.gps[0]},${x.gps[1]}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-red-700 hover:underline">View on map</a>
                      : <span className="block text-gray-700">No GPS recorded</span>}
                  </td>
                  <td className="px-3 py-3 text-gray-900 min-w-[130px]">
                    <span className="block">{x.reporter || '—'}</span>
                    {x.phone && <a href={`tel:${x.phone}`} className="font-semibold text-red-700 hover:underline">Call {x.phone}</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.others?.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-gray-900">
          {data.others.map((o, i) => <li key={i}><b>{o.source}{o.ref ? ` ${o.ref}` : ''}</b> · {o.people} {o.people === 1 ? 'person' : 'people'} · {o.reported || '—'}{o.place ? ` · ${o.place}` : ''}</li>)}
        </ul>
      )}
    </div>
  )
}

function ReferralDetails({ row: r, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const label = r.overdue ? 'Overdue' : r.statusLabel
  const patients = [r.people ? `${r.people} ${r.people === 1 ? 'person' : 'people'}` : null, r.patient?.ageGroup, r.patient?.sex].filter(Boolean).join(' · ')
  const fu = r.followup
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={`Referral ${r.ref}`} className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600"><ArrowRightLeft className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-gray-900">Referral {r.ref}</h3>
                <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[label] || 'bg-gray-100 text-gray-600'}`}>{label}</span>
              </div>
              <p className="text-sm text-gray-600">{r.disease || 'Disease not set'}{r.event ? ` · case ${r.event}` : ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Patient and place</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Tile icon={Users} label="Patients">{patients || '—'}</Tile>
              <Tile icon={Building2} label="Health facility">{r.facility || '—'}</Tile>
              <Tile icon={MapPin} label="Place">{[r.area, r.subCountyName].filter(Boolean).join(', ') || '—'}</Tile>
              <Tile icon={FileText} label="Case">{r.event || (r.caseReport ? `Report ${r.caseReport}` : 'Not linked to a case')}</Tile>
            </div>
            <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3.5">
              <p className="text-xs font-bold text-gray-900">Why referred</p>
              <p className="mt-0.5 text-sm text-gray-900 whitespace-pre-wrap">{r.reason || r.instructions || '—'}</p>
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">The case</h4>
            <CaseSection task={r.id} />
          </section>

          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">People and dates</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Tile icon={UserRound} label="Assigned to">{r.assignedToName || '—'}{r.unit && <span className="block text-xs text-gray-600">{r.unit}</span>}</Tile>
              <Tile icon={UserCheck} label="Assigned by">{r.selfMade ? 'No one. The CHP referred the patient on their own' : (r.assignedBy || '—')}</Tile>
              <Tile icon={CalendarDays} label="Referred on">{longDate(r.createdOn)}</Tile>
              <Tile icon={Clock} label="Due" tone={r.overdue ? 'text-red-700 font-semibold' : ''}>{longDate(r.dueDate)}</Tile>
            </div>
          </section>

          {/* outcome and follow-up at the bottom, in the same tiles (KRCS 18 Nov 2026) */}
          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Outcome and follow-up</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Tile icon={CheckCheck} label="Referral outcome">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[label] || 'bg-gray-100 text-gray-600'}`}>{label}</span>
                <span className="mt-1 block whitespace-pre-wrap">{r.outcome || (r.state === 'ongoing' ? 'Waiting to hear if the patient reached the facility' : 'No note recorded')}</span>
                {r.completedOn && <span className="mt-0.5 block text-xs text-gray-600">Updated {longDate(r.completedOn)}</span>}
              </Tile>
              <Tile icon={ClipboardList} label="Follow-up">
                {!fu ? 'None planned'
                  : fu.state === 'done' ? <span className="text-emerald-700 font-semibold">Done</span>
                    : <span className={fu.state === 'overdue' ? 'text-red-700 font-semibold' : ''}>{fu.state === 'overdue' ? 'Overdue, was due' : 'Due'} {longDate(fu.due)}</span>}
              </Tile>
            </div>
          </section>
        </div>

        <div className="flex justify-end px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-2xl">
          <button onClick={onClose} className="border border-gray-200 bg-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  )
}

function CloseBox({ row, onDone, onCancel }) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    getReferralState(row.event).then((s) => live && setNote((n) => n || s.summary || '')).catch(() => {})
    return () => { live = false }
  }, [row.event])
  async function close() {
    if (!note.trim()) { setError('Add a closing summary.'); return }
    setSaving(true)
    try {
      await closeReferralCase(row.event, note.trim())
      onDone()
    } catch (e) { setError(e.message || 'Could not close the case'); setSaving(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Close case {row.event}</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-gray-600 mb-3">{row.disease} · {row.ref} to {row.facility}</p>
          <label className="block text-sm font-medium text-gray-700 mb-1.5" htmlFor="close-summary">Closing summary</label>
          <textarea id="close-summary" rows={4} value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700" />
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-xl">
          <button onClick={onCancel} className="border border-gray-200 bg-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
          <button onClick={close} disabled={saving} className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">
            {saving ? 'Closing…' : 'Close case'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReferralsOverview() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [sub, setSub] = useState('')
  const [unit, setUnit] = useState('')
  const [facility, setFacility] = useState('')
  const [mine, setMine] = useState(false)
  const [closing, setClosing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [pageWanted, setPage] = useState(0)
  const [size, setSize] = useState(10)

  const load = useCallback(() => getReferralsOverview().then(setData).catch((e) => setError(e.message || 'Could not load referrals')), [])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => data?.referrals || [], [data])
  const opts = (key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort()
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => (tab === 'all' || r.state === tab)
      && (!sub || r.subCountyName === sub) && (!unit || r.unit === unit) && (!facility || r.facility === facility)
      && (!mine || r.mine)
      && (!q || [r.ref, r.event, r.disease, r.facility, r.assignedToName, r.area, r.subCountyName].some((v) => (v || '').toLowerCase().includes(q))))
  }, [rows, tab, sub, unit, facility, mine, search])
  const last = Math.max(0, Math.ceil(shown.length / size) - 1)
  const page = Math.min(pageWanted, last)   // a narrower filter never leaves an empty page
  const paged = shown.slice(page * size, page * size + size)
  const c = data?.counts || {}
  const tabCount = (k) => (k === 'all' ? rows.length : rows.filter((r) => r.state === k).length)

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-brand-navy">Referrals</h2>
        <p className="text-sm text-gray-400">Every referral in your area: follow progress, and close the cases whose referral and follow-up are done.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {[['Ongoing', c.ongoing], ['Overdue', c.overdue], ['Ready to close', c.ready], ['Closed this month', c.closedMonth]].map(([label, value]) => (
          <div key={label} className="bg-red-600 rounded-xl p-4 text-center">
            <div className="text-xs font-semibold text-white">{label}</div>
            <div className="text-2xl font-bold text-white">{data ? value ?? 0 : '—'}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-3 sm:p-4 flex flex-wrap items-center gap-3 mb-4 border border-gray-100">
        <div role="tablist" aria-label="Referral status" className="flex flex-wrap gap-1 rounded-lg bg-gray-50 p-1">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === t.key ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}>
              {t.label} <span className="text-gray-400 tabular-nums">{tabCount(t.key)}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search referral, case, facility or person" aria-label="Search"
            className="w-full bg-gray-50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none" />
        </div>
        {opts('subCountyName').length > 1 && (
          <select value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Sub-county" className={SELECT}>
            <option value="">All sub-counties</option>{opts('subCountyName').map((x) => <option key={x}>{x}</option>)}
          </select>
        )}
        {opts('unit').length > 0 && (
          <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Health unit" className={SELECT}>
            <option value="">All health units</option>{opts('unit').map((x) => <option key={x}>{x}</option>)}
          </select>
        )}
        {opts('facility').length > 0 && (
          <select value={facility} onChange={(e) => setFacility(e.target.value)} aria-label="Facility" className={SELECT}>
            <option value="">All facilities</option>{opts('facility').map((x) => <option key={x}>{x}</option>)}
          </select>
        )}
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 rounded border-gray-300" /> Assigned to me
        </label>
      </div>

      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse [&_th]:border [&_td]:border [&_th]:border-gray-200 [&_td]:border-gray-200">
            <thead>
              <tr className="text-left text-gray-900 text-xs [&_th]:font-bold [&_th]:border-b-2 [&_th]:border-b-red-600">
                <th className="px-4 py-3">Referral</th>
                <th className="px-4 py-3">Disease</th>
                <th className="px-4 py-3">Patients</th>
                <th className="px-4 py-3">Facility</th>
                <th className="px-4 py-3">Assigned to</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Referral</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : !paged.length ? (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-gray-400">No referrals here</td></tr>
              ) : paged.map((r) => {
                const label = r.overdue ? 'Overdue' : r.statusLabel
                const patients = [r.people ? `${r.people}` : null, r.patient?.ageGroup, r.patient?.sex].filter(Boolean).join(' · ')
                return (
                  <tr key={r.id} className="hover:bg-red-50/40 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium text-gray-900">{r.ref}</span>
                      <span className="block text-xs text-gray-500">{r.event || 'Not linked to a case'}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.disease || '—'}<span className="block text-xs text-gray-400">{[r.area, r.subCountyName].filter(Boolean).join(', ')}</span></td>
                    <td className="px-4 py-3 text-gray-700">{patients || '—'}</td>
                    <td className="px-4 py-3 text-gray-700"><span className="inline-flex items-start gap-1"><Building2 className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" aria-hidden="true" />{r.facility || '—'}</span></td>
                    <td className="px-4 py-3 text-gray-700">{r.assignedToName || '—'}{r.unit && <span className="block text-xs text-gray-400">{r.unit}</span>}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(r.dueDate)}</td>
                    <td className="px-4 py-3"><span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${TONE[label] || 'bg-gray-100 text-gray-600'}`}>{label}</span>
                      {r.outcome && <span className="block mt-1 text-xs text-gray-500">{r.outcome}</span>}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap"><FollowUp f={r.followup} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {/* the referral's details here instead of the Review Queue (KRCS 18 Nov 2026) */}
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setViewing(r)} className="inline-block border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">View</button>
                        {r.state !== 'closed' && r.canClose && (
                          <button onClick={() => setClosing(r)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold">Close case</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-t border-gray-100">
          <div className="flex gap-2">
            <button onClick={() => setPage(0)} disabled={page === 0} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 disabled:text-gray-300">First</button>
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 disabled:text-gray-300">Previous</button>
          </div>
          <span className="text-xs text-gray-500">{shown.length ? `Showing ${page * size + 1} to ${Math.min((page + 1) * size, shown.length)} of ${shown.length}` : 'No referrals'}</span>
          <PageSizeSelect value={size} onChange={(n) => setSize(n)} />
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.min(last, page + 1))} disabled={page >= last} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 disabled:text-gray-300">Next</button>
            <button onClick={() => setPage(last)} disabled={page >= last} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 disabled:text-gray-300">Last</button>
          </div>
        </div>
      </div>
      {closing && <CloseBox row={closing} onCancel={() => setClosing(null)} onDone={() => { setClosing(null); load() }} />}
      {viewing && <ReferralDetails row={viewing} onClose={() => setViewing(null)} />}
    </AppShell>
  )
}
