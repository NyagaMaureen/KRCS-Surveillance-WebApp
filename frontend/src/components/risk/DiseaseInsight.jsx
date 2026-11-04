import { useEffect, useState } from 'react'
import { getTriageInsight } from '../../api/frappe'
import { parseReason } from './reasonParts'
import { ModelBars, pct } from './ReportTriage'

// Disease check for the AI triage tab: the case definition (decides) and the model (second opinion).
// Each fact is shown once: the disease name, the signs that matched, then the long official text on request.

const WHO = {
  Rules: 'Case definition',
  Officer: 'Officer',
  Model: 'AI model',
}

export default function DiseaseInsight({ eventId, diseaseName, eventReason, onOpenCapture }) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    setFailed(false)
    getTriageInsight(eventId).then((d) => alive && setData(d)).catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [eventId])

  const first = data?.caseDefinition?.reports?.find((r) => r.suspected) || null
  const parsed = parseReason(first?.reason || eventReason || '')
  const rules = first?.rulesView ? parseReason(first.rulesView) : null
  const byOfficer = first?.decidedBy === 'Officer'
  const name = first?.suspected || (parsed.head && parsed.signs ? parsed.head : '') || diseaseName || ''
  const signs = byOfficer ? (rules?.signs || '') : parsed.signs
  const definition = byOfficer ? rules?.definition : parsed.definition
  const source = (byOfficer ? rules?.source : parsed.source) || 'Official'
  const model = data?.model
  const reports = data?.caseDefinition?.reports || []
  const perReport = !!model?.perReport

  return (
    <section aria-label="Disease check" className="rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Disease check</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {name ? 'The case definition decides. The model is a second opinion.' : 'No case definition matched, so the model suggests what this could be.'}
          </p>
        </div>
        {first?.decidedBy && first.decidedBy !== 'Rules' && WHO[first.decidedBy] && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 whitespace-nowrap">Set by {WHO[first.decidedBy].toLowerCase()}</span>
        )}
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Case definition</p>
        {name ? (
          <>
            <p className="mt-1 text-base font-semibold text-gray-900 leading-snug">{name}</p>
            {signs && <p className="mt-1 text-sm text-gray-600"><span className="text-gray-400">Matched:</span> {signs}</p>}
            {byOfficer && rules && <p className="mt-1 text-xs text-gray-500">Set by an officer. The case definition suggested: {rules.head.replace(/^Suspected\s+/i, '')}</p>}
            {first?.alsoConsistentWith && <p className="mt-1 text-xs text-gray-500">Also consistent with: {first.alsoConsistentWith}</p>}
            {definition && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-900">{source} definition</summary>
                <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{definition}</p>
              </details>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-600">{data && reports.length ? 'No case definition matched the signs reported.' : data?.message || 'Checking…'}</p>
        )}
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Model estimate</p>
        {failed ? (
          <p className="mt-1 text-sm text-gray-400">Could not be loaded just now.</p>
        ) : !data ? (
          <p className="mt-1 text-sm text-gray-400">Checking…</p>
        ) : model && perReport ? (
          <>
            <p className="mt-1 text-xs text-gray-400">Each report is a different case, so each has its own suggestion.</p>
            <ul className="mt-2 divide-y divide-gray-100">
              {reports.map((r) => {
                const t = r.model?.[0]
                return (
                  <li key={r.report} className="py-2.5 flex items-baseline justify-between gap-4 text-sm">
                    <span className="min-w-0 truncate text-gray-700">
                      <span className="font-mono text-xs text-gray-500 mr-2">{r.report}</span>
                      {r.symptoms.length ? r.symptoms.join(', ') : 'No signs recorded'}
                    </span>
                    <span className="whitespace-nowrap text-gray-900">
                      {t ? <>{t.disease} <span className="tabular-nums font-medium">{pct(t.probability)}</span></> : <span className="text-gray-400">no estimate</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
            {onOpenCapture && (
              <button type="button" onClick={onOpenCapture} className="mt-3 text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2">
                Open a report in Signal captured for its full triage
              </button>
            )}
          </>
        ) : model ? (
          <>
            <ModelBars top={model.top} />
            <p className="mt-3 text-xs text-gray-400">
              Learned from past clinic visits, using {model.basedOn} {model.basedOn === 1 ? 'report' : 'reports'}.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-500">{data.message}</p>
        )}
      </div>

      {reports.length > 1 && !perReport && (
        <details className="mt-4 text-sm border-t border-gray-100 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-900">
            Each report ({data.caseDefinition.total > reports.length ? `latest ${reports.length} of ${data.caseDefinition.total}` : reports.length})
          </summary>
          <ul className="mt-2 flex flex-col divide-y divide-gray-100">
            {reports.map((r) => (
              <li key={r.report} className="py-2.5">
                <p className="text-gray-800">{r.symptoms.length ? r.symptoms.join(', ') : 'No signs recorded'}{r.ageGroup ? ` · ${r.ageGroup}` : ''}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {r.suspected || 'No case definition match'}
                  {r.model ? ` · Model: ${r.model.map((m) => `${m.disease} ${pct(m.probability)}`).join(', ')}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
