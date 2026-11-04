import { useState } from 'react'
// Risk score (0-100): which event to look at first. Rule-based; the breakdown says why.
const TONE = {
  'Very high': 'bg-red-600 text-white',
  High: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  Medium: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  Low: 'bg-gray-100 text-gray-600',
}

/** Small "Risk 78" pill for lists. */
const PRIORITY_PILL = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-amber-100 text-amber-700',
  standard: 'bg-gray-100 text-gray-600',
}

export function RiskPill({ risk, severity }) {
  if (!risk) return null
  const tone = (severity && PRIORITY_PILL[severity]) || TONE[risk.level] || TONE.Low
  const priority = severity === 'standard' ? 'Normal' : severity ? severity[0].toUpperCase() + severity.slice(1) : ''
  return (
    <span title={[priority && `${priority} priority`, risk.top?.length ? `Mostly: ${risk.top.join(', ')}` : `${risk.level} risk`].filter(Boolean).join(' · ')}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums whitespace-nowrap ${tone}`}>
      Risk {risk.score}
    </span>
  )
}

/** Full breakdown for the AI triage tab. */
export function RiskBreakdown({ risk }) {
  if (!risk) {
    return <p className="text-sm text-gray-400 mb-6">Risk score not calculated yet. It appears after the next update to this event.</p>
  }
  const bar = risk.level === 'Very high' || risk.level === 'High' ? 'bg-red-500' : risk.level === 'Medium' ? 'bg-amber-400' : 'bg-gray-400'
  return (
    <div className="mb-6 rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-gray-900 tabular-nums">{risk.score}</span>
          <span className="text-sm text-gray-500">/ 100</span>
          <span className={`ml-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[risk.level] || TONE.Low}`}>{risk.level} risk</span>
        </div>
        <p className="text-xs text-gray-400">Helps decide what to look at first. The officer decides.</p>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-3" aria-hidden="true">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${risk.score}%` }} />
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {(risk.parts || []).map((p) => (
          <li key={p.key} className="grid grid-cols-[1fr_auto] gap-x-3 text-sm">
            <span className="text-gray-800">{p.label}</span>
            <span className="text-gray-900 font-medium tabular-nums">{p.points % 1 ? p.points.toFixed(1) : p.points} / {p.max}</span>
            <span className="col-span-2 text-xs text-gray-500">{p.why}</span>
          </li>
        ))}
        {(risk.skipped || []).map((p) => (
          <li key={p.key} className="grid grid-cols-[1fr_auto] gap-x-3 text-sm text-gray-400">
            <span>{p.label}</span>
            <span>skipped</span>
            <span className="col-span-2 text-xs">{p.why}: left out, and the score is rescaled so it doesn't lower the score.</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t)
const pts = (n) => (n % 1 ? n.toFixed(1) : n)
const ORDER = ['priority', 'redflags', 'people', 'unusual', 'context']

// The server joins reasons with "; " - show each on its own line
const reasons = (why) => String(why || '').split(/;\s+/).map((s) => s.trim()).filter(Boolean).map(cap)

/** AI triage: the disease check first (so it is not missed), then the risk score with every weight shown. */
export function RiskAssessment({ risk, disease, children }) {
  const [ctxOpen, setCtxOpen] = useState(false)
  const bar = !risk ? 'bg-gray-300' : risk.level === 'Very high' || risk.level === 'High' ? 'bg-red-500' : risk.level === 'Medium' ? 'bg-amber-400' : 'bg-gray-400'
  const parts = [...(risk?.parts || [])].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
  const link = 'text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2'

  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {disease}

        <section aria-label="Risk score" className="rounded-xl border border-gray-200 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Risk score</h3>
              <p className="text-xs text-gray-400 mt-0.5">How urgent this looks. Each line adds points.</p>
            </div>
            {risk ? (
              <span className="text-right">
                <span className="text-3xl font-semibold tabular-nums text-gray-900">{risk.score}</span>
                <span className="text-sm text-gray-400"> / 100</span>
                <span className={`block mt-1 rounded-full px-2.5 py-0.5 text-xs font-semibold text-center ${TONE[risk.level] || TONE.Low}`}>{risk.level}</span>
              </span>
            ) : <span className="text-sm text-gray-400">Not calculated yet</span>}
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden mt-3" aria-hidden="true">
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${risk?.score || 0}%` }} />
          </div>

          {parts.length > 0 && (
            <ul className="mt-4 flex flex-col gap-3.5">
              {parts.map((p) => {
                return (
                  <li key={p.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-gray-900">{p.label}</span>
                      <span className="text-sm tabular-nums text-gray-900 whitespace-nowrap">
                        <span className="font-semibold">{pts(p.points)}</span><span className="text-gray-400"> / {p.max}</span>
                      </span>
                    </div>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {reasons(p.why).map((t, i) => <li key={i} className="text-xs text-gray-500 leading-snug">{t}</li>)}
                    </ul>
                  </li>
                )
              })}
            </ul>
          )}
          {risk?.floorNote && <p className="text-xs text-gray-600 mt-3">{risk.floorNote}</p>}
          {risk?.skipped?.length > 0 && (
            <p className="text-xs text-gray-400 mt-3">Not counted (no data): {risk.skipped.map((s) => s.label).join(', ')}</p>
          )}
        </section>
      </div>

      {risk?.action && (
        <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Recommended action</p>
          <p className="text-sm font-medium text-gray-900">{risk.action}</p>
        </div>
      )}

      {children && (
        <div className="mt-4">
          <button type="button" className={link} aria-expanded={ctxOpen} onClick={() => setCtxOpen((v) => !v)}>Local context</button>
          {ctxOpen && <div className="mt-3">{children}</div>}
        </div>
      )}
      <p className="mt-4 text-xs text-gray-400">The system suggests; the officer decides.</p>
    </div>
  )
}