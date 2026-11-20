import { useEffect, useState } from 'react'
import { getPlaceContext } from '../../api/frappe'

/*
  Context for one place and one disease, shown on the event and alert pages. One table: what the data shows,
  what it means for this disease and what to check next. The rules are fixed (surveillance/context.py), not AI.

  Props:
    subCounty  record id or name (e.g. "Dadaab")
    county     needed when subCounty is a name
    people     affected count of the event/alert, for the rate per 10,000 people (optional)
    disease    Alert Threshold Config key (e.g. "awd-cholera")
*/

export const MARKS = {
  supports: { dot: 'bg-green-600', label: 'Points towards this disease' },
  check: { dot: 'bg-yellow-500', label: 'Data old or missing: check before relying on it' },
  background: { dot: 'bg-gray-300', label: 'Background only' },
}

export function Dot({ mark }) {
  const m = MARKS[mark] || MARKS.background
  return <span className={`mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle ${m.dot}`} title={m.label} aria-label={m.label} />
}

// What the data shows: dot, bold headline, details, and where it came from
export function Shows({ row }) {
  return (
    <>
      <Dot mark={row.mark} /><b>{row.headline}</b>{row.detail ? <>. {row.detail}</> : null}
      {row.source && <div className="mt-0.5 text-xs text-gray-600">{row.source}</div>}
    </>
  )
}

export function MarksKey({ marks }) {
  const used = Object.keys(MARKS).filter((k) => !marks || marks.includes(k))
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
      {used.map((k) => <span key={k}><Dot mark={k} />{MARKS[k].label}</span>)}
    </p>
  )
}

export const TH = 'border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-900'
export const TD = 'border border-gray-200 px-3 py-2.5 align-top text-gray-900'

export default function ContextPanel({ subCounty, county, people, disease, bare = false }) {
  const [ctx, setCtx] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!subCounty) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    getPlaceContext({ subCounty, county, people, disease })
      .then((c) => { if (!cancelled) { setCtx(c); setError('') } })
      .catch((e) => { if (!cancelled) setError(e.message || 'Could not load context') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [subCounty, county, people, disease])

  const place = ctx?.subCountyName || subCounty
  const rows = ctx?.rows || []

  return (
    <div className={`@container bg-white ${bare ? '' : 'rounded-2xl border border-gray-200 p-5'}`}>
      <h3 className="text-base font-bold text-gray-900">Context for {place || 'this place'}{ctx?.diseaseName ? `: ${ctx.diseaseName}` : ''}</h3>
      <p className="mb-3 mt-0.5 text-sm text-gray-900">
        What rainfall, water and sanitation and population say about this disease here, and what to check next.
        {ctx?.notShown ? ` ${ctx.notShown}` : ''}
      </p>
      {!subCounty ? (
        <p className="text-sm text-gray-900">The location is missing, so no context can be shown.</p>
      ) : loading ? (
        <p className="text-sm text-gray-600">Loading context…</p>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : ctx?.unknownLocation ? (
        <p className="text-sm text-gray-900">{place} isn't in the sub-county list, so no context is recorded for it.</p>
      ) : !rows.length ? (
        <p className="text-sm text-gray-900">Choose a disease to see what the context means for it.</p>
      ) : (
        <>
          {/* narrow places (alert page column): one small table per factor */}
          <div className="space-y-3 @2xl:hidden">
            {rows.map((r) => (
              <table key={r.key} className="w-full border-collapse border border-gray-200 text-sm">
                <tbody>
                  <tr><th colSpan={2} className={TH}>{r.factor}</th></tr>
                  <tr><td className={`${TD} w-28 font-bold`}>Data shows</td><td className={TD}><Shows row={r} /></td></tr>
                  <tr><td className={`${TD} font-bold`}>What it means</td><td className={TD}>{r.means}</td></tr>
                  <tr><td className={`${TD} font-bold`}>Next step</td><td className={TD}>{r.next}</td></tr>
                </tbody>
              </table>
            ))}
          </div>
          <div className="hidden overflow-x-auto @2xl:block">
            <table className="w-full border-collapse border border-gray-200 text-sm">
              <thead>
                <tr>
                  <th className={`${TH} w-32`}>Factor</th>
                  <th className={TH}>What the data shows</th>
                  <th className={TH}>What it means for {ctx.diseaseShort}</th>
                  <th className={TH}>Next step</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className={`${TD} font-bold`}>{r.factor}</td>
                    <td className={TD}><Shows row={r} /></td>
                    <td className={TD}>{r.means}</td>
                    <td className={TD}>{r.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MarksKey marks={[...new Set(rows.map((r) => r.mark))]} />
          <p className="mt-1 text-xs text-gray-700">Green rows add to the "Local context" part of the risk score. The officer decides what to do.</p>
        </>
      )}
    </div>
  )
}
