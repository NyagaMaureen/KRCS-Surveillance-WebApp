import { useEffect, useState } from 'react'
import { getRiskWeights, saveRiskWeights } from '../../api/frappe'

const ORDER = ['priority', 'redflags', 'people', 'unusual', 'context']
const HELP = {
  priority: 'Critical, High or Standard priority of the suspected disease',
  redflags: 'Deaths, red-flag answers ("Yes means escalate now") and red-flag symptoms such as bleeding',
  people: 'How many people are affected',
  unusual: 'This disease in this sub-county this week compared with its usual weekly level, and Epi Trends alerts',
  context: 'WASH, rainfall and population, only for diseases they relate to; skipped when not recorded',
}

/** Settings → Risk score: maximum points per factor. */
export default function RiskWeights() {
  const [data, setData] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getRiskWeights().then((d) => { setData(d); setForm(d.weights) }).catch((e) => setMsg(e.message))
  }, [])

  async function save(values) {
    setSaving(true)
    setMsg('')
    try {
      const d = await saveRiskWeights(values)
      setData(d)
      setForm(d.weights)
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
          <li key={k} className="py-3 grid grid-cols-[1fr_96px] gap-4 items-center">
            <span>
              <span className="block text-sm font-medium text-gray-900">{data.labels[k]}</span>
              <span className="block text-xs text-gray-500">{HELP[k]}</span>
            </span>
            <input type="number" min="0" max="100" value={form[k] ?? ''} aria-label={`${data.labels[k]} points`}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="h-9 border border-gray-200 rounded-lg px-3 text-sm text-right tabular-nums" />
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-500 mt-3">Total: <span className="font-medium text-gray-900">{total}</span> points</p>
      <div className="flex flex-wrap items-center gap-3 mt-5">
        <button type="button" disabled={saving} onClick={() => save(form)}
          className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
          {saving ? 'Saving…' : 'Save weights'}
        </button>
        <button type="button" disabled={saving} onClick={() => save(data.defaults)}
          className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Reset to agreed defaults
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  )
}
