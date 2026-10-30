import { useEffect, useMemo, useState } from 'react'
import { X, Plus, Search } from 'lucide-react'
import { getRedFlags, saveRedFlags } from '../../api/frappe'

/** Settings → AI Config: which symptoms count as red flags in the risk score. Chosen from the Symptom list CHPs use. */
export default function RedFlagSymptoms() {
  const [data, setData] = useState(null)
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { getRedFlags().then(setData).catch((e) => setMsg(e.message)) }, [])

  async function save(ids) {
    setSaving(true); setMsg('')
    try {
      setData(await saveRedFlags(ids))
      setMsg('Saved. Open events are being re-scored.')
    } catch (e) {
      setMsg(e.message || 'Could not save')
    } finally { setSaving(false) }
  }

  const chosenIds = useMemo(() => new Set((data?.chosen || []).map((c) => c.id)), [data])
  const groups = useMemo(() => {
    const out = {}
    for (const s of data?.symptoms || []) {
      if (chosenIds.has(s.id) || (q && !s.name.toLowerCase().includes(q.toLowerCase()))) continue
      ;(out[s.category] = out[s.category] || []).push(s)
    }
    return out
  }, [data, chosenIds, q])

  if (!data) return <div className="bg-white rounded-2xl border border-gray-100 p-6 text-sm text-gray-400">{msg || 'Loading…'}</div>
  const ids = data.chosen.map((c) => c.id)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Red-flag symptoms</h3>
          <p className="text-sm text-gray-500 mt-1">
            Symptoms that suggest a severe case. A report with any of these gets red-flag points in the risk score.
            CHPs pick symptoms as usual; nothing changes for them.
          </p>
        </div>
        <button type="button" disabled={saving} onClick={() => setPicking((v) => !v)}
          className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Plus className="w-4 h-4" aria-hidden="true" /> Add from symptom list
        </button>
      </div>

      <p className="text-xs font-medium text-gray-500 mt-5 mb-2">In use now ({ids.length})</p>
      {ids.length ? (
        <ul className="flex flex-wrap gap-2">
          {data.chosen.map((c) => (
            <li key={c.id} className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-800 ring-1 ring-red-100 pl-3 pr-1 py-1 text-sm">
              {c.name}
              <button type="button" disabled={saving} aria-label={`Remove ${c.name}`} onClick={() => save(ids.filter((i) => i !== c.id))}
                className="rounded-full p-0.5 hover:bg-red-100"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-gray-400">None chosen. Red-flag points then come only from deaths and "Yes means escalate now" answers.</p>}

      {picking && (
        <div className="mt-5 border border-gray-100 rounded-xl p-4">
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symptoms" aria-label="Search symptoms"
              className="w-full h-9 border border-gray-200 rounded-lg pl-9 pr-3 text-sm" />
          </div>
          <div className="max-h-72 overflow-y-auto flex flex-col gap-4">
            {Object.keys(groups).length ? Object.entries(groups).map(([cat, list]) => (
              <div key={cat}>
                <p className="text-xs text-gray-400 mb-1.5">{cat}</p>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => (
                    <button key={s.id} type="button" disabled={saving} onClick={() => save([...ids, s.id])}
                      className="rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:border-gray-400">+ {s.name}</button>
                  ))}
                </div>
              </div>
            )) : <p className="text-sm text-gray-400">No more symptoms match.</p>}
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-gray-600 mt-3">{msg}</p>}
    </div>
  )
}
