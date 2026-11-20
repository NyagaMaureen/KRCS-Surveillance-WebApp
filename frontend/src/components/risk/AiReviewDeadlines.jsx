import { useEffect, useState } from 'react'
import { getAiReviewSettings, saveAiReviewSettings } from '../../api/frappe'

// Settings > AI Risk Engine: how long officers have to review an AI output before it is escalated (AUD-08).
// L1 reviews; L2 is told when L1 misses the deadline; L3 is told at once when L2 misses its deadline.
const TH = 'border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-bold text-gray-900'
const TD = 'border border-gray-200 px-3 py-2.5 align-top text-sm text-gray-900'
const NUM = 'w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900'

export default function AiReviewDeadlines({ canEdit }) {
  const [saved, setSaved] = useState(null)
  const [v, setV] = useState(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { getAiReviewSettings().then((s) => { setSaved(s); setV(s) }).catch((e) => setMsg(e.message || 'Could not load')) }, [])

  async function save() {
    setBusy(true); setMsg('')
    try {
      const s = await saveAiReviewSettings(v)
      setSaved(s); setV(s); setEditing(false); setMsg('Saved.')
    } catch (e) { setMsg(e.message || 'Could not save') } finally { setBusy(false) }
  }
  const toggleRole = (key, role) => setV((x) => ({ ...x, [key]: x[key].includes(role) ? x[key].filter((r) => r !== role) : [...x[key], role] }))

  if (!v) return <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-700">{msg || 'Loading…'}</div>
  const roles = (list, key) => editing ? (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {(v.roles || []).map((r) => (
        <label key={r} className="inline-flex items-center gap-1.5 text-sm text-gray-900">
          <input type="checkbox" checked={list.includes(r)} onChange={() => toggleRole(key, r)} className="h-4 w-4 rounded border-gray-300" /> {r}
        </label>
      ))}
    </div>
  ) : (list.join(', ') || '—')
  const hours = (key) => editing
    ? <input type="number" min="0.5" step="0.5" value={v[key]} onChange={(e) => setV((x) => ({ ...x, [key]: e.target.value }))} className={NUM} aria-label={key} />
    : <b>{Number(v[key])} hours</b>

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-gray-900">AI review deadlines</h3>
          <p className="mt-1 text-sm text-gray-900">
            AI outputs are advice. If an officer does not review an event's AI triage in time, it is escalated to the next level by
            email and in-app notice, and written to the event's history and the Audit Log. The clock starts when the CHA confirms the
            verification (or when facility or CBS data creates the event).
          </p>
        </div>
        {canEdit && !editing && <button type="button" onClick={() => { setEditing(true); setMsg('') }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-50">Edit</button>}
      </div>
      <table className="mt-4 w-full border-collapse border border-gray-200">
        <thead><tr><th className={`${TH} w-24`}>Level</th><th className={TH}>Who</th><th className={`${TH} w-72`}>Deadline</th></tr></thead>
        <tbody>
          <tr>
            <td className={`${TD} font-bold`}>L1</td>
            <td className={TD}>Surveillance and county officers for the event's sub-county</td>
            <td className={TD}>
              <div className="flex items-center gap-2">{hours('l1_high_hours')} <span>for high or very high risk</span></div>
              <div className="mt-1.5 flex items-center gap-2">{hours('l1_standard_hours')} <span>for medium or low risk</span></div>
            </td>
          </tr>
          <tr>
            <td className={`${TD} font-bold`}>L2</td>
            <td className={TD}>{roles(v.l2_roles, 'l2_roles')}<div className="mt-1 text-xs text-gray-700">In the event's area. The L1 officers get a copy.</div></td>
            <td className={TD}><div className="flex items-center gap-2">{hours('l2_hours')} <span>after L1 misses its deadline</span></div></td>
          </tr>
          <tr>
            <td className={`${TD} font-bold`}>L3</td>
            <td className={TD}>{roles(v.l3_roles, 'l3_roles')}<div className="mt-1 text-xs text-gray-700">National.</div></td>
            <td className={TD}>Told at once when L2 misses its deadline</td>
          </tr>
          <tr>
            <td className={`${TD} font-bold`}>On</td>
            <td className={TD} colSpan={2}>
              {editing ? (
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!Number(v.enabled)} onChange={(e) => setV((x) => ({ ...x, enabled: e.target.checked ? 1 : 0 }))} className="h-4 w-4 rounded border-gray-300" /> Escalate AI outputs that are not reviewed in time</label>
              ) : Number(v.enabled) ? 'Yes, escalation is on' : <b className="text-red-700">No, escalation is off</b>}
            </td>
          </tr>
        </tbody>
      </table>
      {editing && (
        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={busy || !v.l2_roles.length || !v.l3_roles.length} onClick={save} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" disabled={busy} onClick={() => { setV(saved); setEditing(false); setMsg('') }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50">Cancel</button>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-gray-900">{msg}</p>}
    </div>
  )
}
