import { useEffect, useState } from 'react'
import { getDiseaseContext } from '../../api/frappe'
import { Shows, MarksKey, TH, TD } from '../context/ContextPanel'
import { FOCUS } from './TrendChart'

// Epi Trends: what rainfall, water and sanitation and population mean for one disease in each sub-county,
// with the next step. Same fixed rules as the event page (surveillance/context.py).
export default function DiseaseContext({ disease, subCounty, startOpen }) {
  const [open, setOpen] = useState(!!startOpen)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !disease || disease === 'unclassified-illness') return
    let cancelled = false
    setData(null)
    getDiseaseContext(disease, subCounty)
      .then((d) => { if (!cancelled) { setData(d); setError('') } })
      .catch((e) => { if (!cancelled) setError(e.message || 'Could not load context') })
    return () => { cancelled = true }
  }, [open, disease, subCounty])

  if (!disease || disease === 'unclassified-illness') return null
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`mt-4 rounded text-sm font-semibold text-gray-900 underline underline-offset-2 ${FOCUS}`}>
        Show context (rainfall, water and sanitation, population)
      </button>
    )
  }
  const places = data?.places || []
  const marks = [...new Set(places.flatMap((p) => p.rows.map((r) => r.mark)))]
  return (
    <div className="mt-5 border-t border-gray-200 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-gray-900">Context for {data?.diseaseName || 'this disease'}</h3>
          <p className="mt-0.5 text-sm text-gray-900">What the conditions in each sub-county mean for this disease, and what to check next.{data?.notShown ? ` ${data.notShown}` : ''}</p>
        </div>
        {!startOpen && <button type="button" onClick={() => setOpen(false)} className={`shrink-0 rounded text-sm text-gray-700 underline underline-offset-2 ${FOCUS}`}>Hide</button>}
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p>
        : !data ? <p className="mt-2 text-sm text-gray-600">Loading context…</p>
        : !places.length ? <p className="mt-2 text-sm text-gray-900">No sub-counties in your area to show.</p>
        : (
          <>
            {data.why?.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm text-gray-900">
                {data.why.map((w) => <li key={w.factor}><b>{w.factor}:</b> {w.text}</li>)}
              </ul>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse border border-gray-200 text-sm">
                <thead>
                  <tr>
                    <th className={`${TH} w-32`}>Sub-county</th>
                    {data.factors.map((f) => <th key={f.key} className={TH}>{f.factor}</th>)}
                    <th className={TH}>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {places.map((p) => {
                    const steps = p.rows.filter((r) => r.mark !== 'background').map((r) => r.next)
                    return (
                      <tr key={p.subCounty}>
                        <td className={`${TD} font-bold`}>{p.subCountyName}</td>
                        {data.factors.map((f) => {
                          const r = p.rows.find((x) => x.key === f.key)
                          return <td key={f.key} className={TD}>{r ? <Shows row={r} /> : '—'}</td>
                        })}
                        <td className={TD}>
                          {steps.length ? (steps.length === 1 ? steps[0] : <ul className="list-disc space-y-1 pl-4">{steps.map((t) => <li key={t}>{t}</li>)}</ul>)
                            : 'Nothing to act on from the context.'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <MarksKey marks={marks} />
          </>
        )}
    </div>
  )
}
