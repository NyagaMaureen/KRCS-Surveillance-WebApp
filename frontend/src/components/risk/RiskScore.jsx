import { useState } from 'react'
// Risk score (0-100): which event to look at first. Rule-based; the breakdown says why.
const TONE = {
  'Very high': 'bg-red-600 text-white',
  High: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  Medium: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  Low: 'bg-gray-100 text-gray-600',
}

/** Small "Risk 78" pill for lists. */
export function RiskPill({ risk }) {
  if (!risk) return null
  return (
    <span title={risk.top?.length ? `Mostly: ${risk.top.join(', ')}` : `${risk.level} risk`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums whitespace-nowrap ${TONE[risk.level] || TONE.Low}`}>
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

/** Compact triage card: score, reasons with their points (fixed order), recommended action. */
export function RiskAssessment({ risk, matched, reason, children }) {
  const [open, setOpen] = useState('')
  const toggle = (k) => setOpen((o) => (o === k ? '' : k))
  const bar = !risk ? 'bg-gray-300' : risk.level === 'Very high' || risk.level === 'High' ? 'bg-red-500' : risk.level === 'Medium' ? 'bg-amber-400' : 'bg-gray-400'
  const parts = [...(risk?.parts || [])].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
  const link = 'text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2'

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-gray-700">Risk score</span>
        {risk ? (
          <span className="text-sm text-gray-900"><span className="text-2xl font-semibold tabular-nums">{risk.score}</span><span className="text-gray-400"> / 100</span>
            <span className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[risk.level] || TONE.Low}`}>{risk.level}</span></span>
        ) : <span className="text-sm text-gray-400">Not calculated yet</span>}
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden mt-2" aria-hidden="true">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${risk?.score || 0}%` }} />
      </div>

      {(parts.length > 0 || matched) && (
        <>
          <h4 className="text-sm font-medium text-gray-700 mt-6 mb-1">Why</h4>
          <div className="divide-y divide-gray-100">
            {parts.map((p) => (
              <div key={p.key} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900">{p.label}</span>
                  {/* <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{pts(p.points)} / {p.max}</span> */}
                </div>
                <ul className="mt-1 flex flex-col gap-1">
                  {reasons(p.why).map((t, i) => <li key={i} className="text-sm text-gray-700 leading-snug">{t}</li>)}
                </ul>
              </div>
            ))}
            {matched && (
              <div className="py-3">
                <span className="text-sm font-medium text-gray-900">Case definition</span>
                <p className="mt-1 text-sm text-gray-700">{matched}</p>
              </div>
            )}
          </div>
          {risk?.skipped?.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">Not counted (no data): {risk.skipped.map((s) => s.label).join(', ')}</p>
          )}
        </>
      )}

      {risk?.action && (
        <div className="mt-5 rounded-lg bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">Recommended action</p>
          <p className="text-sm font-medium text-gray-900">{risk.action}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
        {reason && <button type="button" className={link} aria-expanded={open === 'case'} onClick={() => toggle('case')}>Full case definition</button>}
        {children && <button type="button" className={link} aria-expanded={open === 'context'} onClick={() => toggle('context')}>Local context</button>}
      </div>
      {open === 'case' && <p className="mt-3 text-xs text-gray-600 leading-relaxed">{reason}</p>}
      {open === 'context' && <div className="mt-3">{children}</div>}
      <p className="mt-4 text-xs text-gray-400">The system suggests; the officer decides.</p>
    </div>
  )
}
