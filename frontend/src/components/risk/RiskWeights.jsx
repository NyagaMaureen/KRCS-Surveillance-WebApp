import { useEffect, useState } from 'react'
import { getRiskWeights, saveRiskWeights } from '../../api/frappe'

const ORDER = ['priority', 'redflags', 'people', 'unusual', 'context']
const HELP = {
  priority: 'Critical, High or Normal priority of the suspected disease',
  redflags: 'Deaths, red-flag answers ("Yes means escalate now") and red-flag symptoms such as bleeding',
  people: 'How many people are affected',
  unusual: 'This disease in this sub-county this week compared with its usual weekly level, and Epi Trends alerts',
  context: 'WASH, rainfall and population, only for diseases they relate to; skipped when not recorded',
}

/** Settings → Risk score: maximum points per factor. */
export default function RiskWeights() {
  const [data, setData] = useState(null)
  const [form, setForm] = useState({})
  const [pform, setPform] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getRiskWeights().then((d) => { setData(d); setForm(d.weights); setPform(toDisplay(d.params, d.groups)) }).catch((e) => setMsg(e.message))
  }, [])

  // shares are stored as fractions (0.6) but edited as percentages (60)
  function toDisplay(values, groups) {
    const out = {}
    groups.forEach((g) => g.items.forEach((it) => { out[it.key] = it.kind === 'share' ? Math.round((values[it.key] ?? it.default) * 100) : (values[it.key] ?? it.default) }))
    return out
  }
  function toStored(display, groups) {
    const out = {}
    groups.forEach((g) => g.items.forEach((it) => { out[it.key] = it.kind === 'share' ? Number(display[it.key]) / 100 : Number(display[it.key]) }))
    return out
  }

  async function save(values, paramValues) {
    setSaving(true)
    setMsg('')
    try {
      const d = await saveRiskWeights(values, paramValues)
      setData(d)
      setForm(d.weights)
      setPform(toDisplay(d.params, d.groups))
      setMsg('Saved. Open events are being re-scored.')
    } catch (e) {
      setMsg(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!data) return <p className="text-sm text-gray-400">{msg || 'Loading…'}</p>
  const total = ORDER.reduce((s, k) => s + (Number(form[k]) || 0), 0)

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <h3 className="text-base font-semibold text-gray-900">Risk score weights</h3>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Maximum points for each factor in an event's risk score (0–100). The score is rescaled when a factor has no data, so
        the total doesn't need to be exactly 100. Agreed with KRCS; adjust after testing.
      </p>
      <ul className="flex flex-col divide-y divide-gray-100">
        {ORDER.map((k) => (
          <li key={k} className="py-3 grid grid-cols-[1fr_96px] gap-x-4 gap-y-2 items-center">
            <span>
              <span className="block text-sm font-medium text-gray-900">{data.labels[k]}</span>
              <span className="block text-xs text-gray-500">{HELP[k]}</span>
            </span>
            <input type="number" min="0" max="100" value={form[k] ?? ''} aria-label={`${data.labels[k]} points`}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="h-9 border border-gray-200 rounded-lg px-3 text-sm text-right tabular-nums" />
            {(data.groups || []).filter((g) => g.key === k).map((g) => (
              <details key={g.key} className="col-span-2 -mt-1">
                <summary className="cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-900 select-none">Shares and thresholds for this factor</summary>
                <ul className="mt-2 flex flex-col gap-2 rounded-lg bg-gray-50 p-3">
                  {g.items.map((it) => (
                    <li key={it.key} className="grid grid-cols-[1fr_96px] gap-3 items-center">
                      <span className="text-xs text-gray-700">{it.label}</span>
                      <span className="flex items-center gap-1 justify-end">
                        <input type="number" min="0" max={it.kind === 'share' || it.kind === 'score' ? 100 : undefined} step={it.kind === 'times' ? '0.1' : '1'}
                          value={pform[it.key] ?? ''} aria-label={it.label}
                          onChange={(e) => setPform({ ...pform, [it.key]: e.target.value })}
                          className="h-8 w-20 border border-gray-200 rounded-lg px-2 text-sm text-right tabular-nums bg-white" />
                        <span className="text-xs text-gray-400 w-4">{it.kind === 'share' ? '%' : it.kind === 'times' ? '×' : ''}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-gray-400">A share is the part of this factor's maximum points an event earns ({k === 'redflags' ? 'these add up, up to 100%' : 'for example 60% of the maximum'}).</p>
              </details>
            ))}
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-500 mt-3">Total: <span className="font-medium text-gray-900">{total}</span> points</p>
      <div className="flex flex-wrap items-center gap-3 mt-5">
        <button type="button" disabled={saving} onClick={() => save(form, toStored(pform, data.groups))}
          className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" disabled={saving} onClick={() => save(data.defaults, toStored(toDisplay({}, data.groups), data.groups))}
          className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Reset to agreed defaults
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  )
}
