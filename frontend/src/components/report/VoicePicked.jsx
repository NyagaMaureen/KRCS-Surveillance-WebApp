import { useState } from 'react'
import { Mic, Check, MapPin } from 'lucide-react'
import { addVoicePicked } from '../../api/frappe'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300'

// What was picked from a voice note (surveillance/voice_extract.py), split by what the officer has to do:
//   New in the voice note: missing from the report or different, each with the report's value; tick and add.
//   Already on the report: matching details as quiet chips. Places are shown next to the report's location.
// Adding re-runs the case definitions, Review Queue routing, AI triage and the risk score.
function rowsFor(p) {
  const r = p.report || {}
  const todo = []   // { key, what, voice, report }
  const same = []   // chip labels
  for (const s of p.symptoms || []) {
    if (s.onReport) same.push(s.name)
    else todo.push({ key: `s:${s.name}`, what: 'Symptom', voice: s.name, report: 'Not on report' })
  }
  if (p.ageGroup) {
    if (r.ageGroup === p.ageGroup) same.push(`Age ${p.ageGroup}`)
    else todo.push({ key: 'age', what: 'Age', voice: `${p.ageYears != null ? `${p.ageYears} years · ` : ''}${p.ageGroup}`, report: r.ageGroup ? `Report says ${r.ageGroup}` : 'Not on report' })
  }
  if (p.people) {
    if (r.people === p.people) same.push(`${p.people} ${p.people === 1 ? 'person' : 'people'} sick`)
    else todo.push({ key: 'people', what: 'People sick', voice: String(p.people), report: r.people ? `Report says ${r.people}` : 'Not on report' })
  }
  if (p.animal) {
    if (r.animal === p.animal) same.push(`Animal contact: ${p.animal.toLowerCase()}`)
    else todo.push({ key: 'animal', what: 'Animal contact', voice: p.animal, report: r.animal ? `Report says ${r.animal.toLowerCase()}` : 'Not on report' })
  }
  if (p.death && r.deaths) same.push('Death recorded')
  return { todo, same, deathCheck: p.death && !r.deaths, places: p.places || [], location: r.location }
}

export default function VoicePicked({ picked, report, canAdd, onAdded }) {
  const [chosen, setChosen] = useState({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  if (!picked) return null
  if (picked.empty) {
    return <p className="mt-2 text-xs text-gray-500">Nothing to pick out of this voice note (no symptoms, age, places or numbers heard).</p>
  }
  const { todo, same, deathCheck, places, location } = rowsFor(picked)
  const canTick = !!(canAdd && report)
  const isOn = (k) => chosen[k] !== false   // everything new is ticked to start with
  const selected = canTick ? todo.filter((x) => isOn(x.key)) : []

  async function add() {
    setBusy(true)
    setResult(null)
    try {
      const r = await addVoicePicked(report, {
        symptoms: selected.filter((x) => x.key.startsWith('s:')).map((x) => x.key.slice(2)),
        ageGroup: selected.some((x) => x.key === 'age') ? picked.ageGroup : null,
        animalExposure: selected.some((x) => x.key === 'animal') ? picked.animal : null,
        people: selected.some((x) => x.key === 'people') ? picked.people : null,
      })
      const done = [...(r.added || []), ...(r.changes || [])]
      setResult({ ok: true, text: done.length ? `Updated the report: ${done.join(', ')}. Classification, AI triage and the risk score were worked out again.` : 'Nothing changed: the report already has these.' })
      if (done.length && onAdded) onAdded()
    } catch (e) {
      setResult({ ok: false, text: e.message || 'Could not update the report.' })
    }
    setBusy(false)
  }

  return (
    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-3 sm:px-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-900">
        <Mic className="w-3.5 h-3.5" aria-hidden="true" />
        Picked from the voice note
      </div>

      {todo.length > 0 ? (
        <>
          <p className="mt-3 text-xs font-semibold text-gray-900">
            New in the voice note{canTick && <span className="font-normal text-gray-500"> · tick what you heard, then add</span>}
          </p>
          <div className="mt-1.5 space-y-1.5">
            {todo.map((x) => {
              const row = (
                <>
                  <span className="w-24 shrink-0 text-xs text-gray-500">{x.what}</span>
                  <span className="min-w-0 flex-1 font-semibold text-gray-900">{x.voice}</span>
                  <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{x.report}</span>
                </>
              )
              return canTick ? (
                <label key={x.key} className="flex cursor-pointer items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-red-300">
                  <input type="checkbox" checked={isOn(x.key)} onChange={(e) => setChosen((c) => ({ ...c, [x.key]: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-red-700 focus:ring-red-300" />
                  {row}
                </label>
              ) : (
                <div key={x.key} className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">{row}</div>
              )
            })}
          </div>
          {canTick && (
            <button type="button" disabled={busy || !selected.length} onClick={add}
              className={`mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50 ${FOCUS}`}>
              {busy ? 'Updating…' : `Add ${selected.length} to report`}
            </button>
          )}
        </>
      ) : (
        deathCheck ? (
          <p className="mt-2 text-xs font-medium text-gray-800">Nothing new to add to the report.</p>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-green-800">
            <Check className="w-3.5 h-3.5" aria-hidden="true" /> Everything in the voice note is already on the report.
          </p>
        )
      )}
      {result && <p role="status" className={`mt-2 text-xs ${result.ok ? 'text-green-800' : 'text-red-700'}`}>{result.text}</p>}

      {(same.length > 0 || deathCheck || places.length > 0) && (
        <div className={`${todo.length > 0 ? 'mt-3 border-t border-blue-100 pt-2.5' : 'mt-2'}`}>
          {same.length > 0 && (
            <>
              {todo.length > 0 && (
                <p className="text-xs text-gray-500"><Check className="inline w-3.5 h-3.5 -mt-0.5 text-green-700" aria-hidden="true" /> Also in the voice note, already on the report</p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {same.map((s) => <span key={s} className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs text-gray-700">{s}</span>)}
              </div>
            </>
          )}
          {deathCheck && (
            <p className="mt-2 text-xs text-gray-800"><b className="font-semibold">A death is mentioned</b> <span className="text-gray-500">· none recorded on the report; check with the reporter.</span></p>
          )}
          {places.length > 0 && (
            <p className="mt-2 text-xs text-gray-600">
              <MapPin className="inline w-3.5 h-3.5 -mt-0.5 text-gray-400" aria-hidden="true" /> Places said: <b className="font-semibold text-gray-800">{places.join(', ')}</b>
              {location && <span className="text-gray-400"> · report: {location}</span>}
            </p>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-500">Picked automatically from the transcript. Listen to the recording before adding.</p>
    </div>
  )
}
