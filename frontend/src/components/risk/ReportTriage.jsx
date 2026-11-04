import { useEffect, useState } from 'react'
import { getReportTriage } from '../../api/frappe'
import { parseReason } from './reasonParts'

// Triage of ONE report: what the case definition says, and what the model suggests for it.

export const pct = (p) => (p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`)

export function ModelBars({ top }) {
  return (
    <ul className="mt-2 flex flex-col gap-2.5">
      {top.map((t) => (
        <li key={t.disease}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-gray-800">
              {t.disease}
              {t.surveillance && <span className="ml-2 text-[11px] font-medium text-red-700">priority disease</span>}
            </span>
            <span className="font-medium text-gray-900 tabular-nums">{pct(t.probability)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-1" aria-hidden="true">
            <div className={`h-full rounded-full ${t.surveillance ? 'bg-red-400' : 'bg-gray-400'}`} style={{ width: `${Math.max(2, t.probability * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function ReportTriage({ eventId, reportId }) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    setFailed(false)
    getReportTriage(eventId, reportId).then((d) => alive && setData(d)).catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [eventId, reportId])

  if (failed) return <p className="text-sm text-gray-400">Triage could not be loaded just now.</p>
  if (!data) return <p className="text-sm text-gray-400">Checking this report…</p>

  const r = data.report
  const byOfficer = r.decidedBy === 'Officer'
  const parsed = parseReason(byOfficer ? r.rulesView || '' : r.reason || '')
  const model = data.model

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Case definition</p>
        {r.suspected ? (
          <>
            <p className="mt-1 text-base font-semibold text-gray-900 leading-snug">{r.suspected}</p>
            {parsed.signs && <p className="mt-1 text-sm text-gray-600"><span className="text-gray-400">Matched:</span> {parsed.signs}</p>}
            {byOfficer && <p className="mt-1 text-xs text-gray-500">Set by an officer.</p>}
            {r.alsoConsistentWith && <p className="mt-1 text-xs text-gray-500">Also consistent with: {r.alsoConsistentWith}</p>}
            {parsed.definition && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-900">{parsed.source || 'Official'} definition</summary>
                <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{parsed.definition}</p>
              </details>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-600">No case definition matched the signs reported.</p>
        )}
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Model suggestion</p>
        {model ? (
          <>
            <ModelBars top={model.top} />
            <p className="mt-3 text-xs text-gray-400">Learned from past clinic visits. A second opinion only.</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-500">{data.message}</p>
        )}
        {r.ageGroup ? null : <p className="mt-2 text-xs text-gray-400">Age group missing, so this is less reliable.</p>}
      </div>
    </div>
  )
}
