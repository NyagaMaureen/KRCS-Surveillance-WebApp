import { useState } from 'react'
import { Check, HelpCircle } from 'lucide-react'

// "Which disease?" panel, used on the Review Queue event page and on the Reports page.
// Data: ai_classifier.get_report_candidates. Candidates arrive in the order officers should consider them:
//   'Case definition' (definition met)  >  'Possible' (warning sign, definition not met)  >  'Model' (AI suggestion)
//   > less likely (a possible disease whose needed sign the reporter answered No; still choosable)
const pct = (p) => `${Math.round(p * 100)}%`

// Per-disease precision in the app (ml/evaluate.py, precision_shown): of past clinic visits where the app
// would have suggested this disease, the share that really were it.
function pastRecord(why, name) {
  const r = why && why.record
  if (!r || r.right_when_shown == null) return ''
  const n = Math.round(r.right_when_shown * 10)
  const d = String(name || 'this disease').replace(/^Suspected\s+/i, '')
  return n === 0
    ? `In past clinic visits where ${d} was suggested, it was rarely correct.`
    : `In past clinic visits where ${d} was suggested, it was correct about ${n} times in 10.`
}

function ReasonRow({ label, items, question }) {
  if (!items || !items.length) return null
  if (question) {
    return (
      <div className="flex items-start gap-1.5 text-xs leading-5">
        <HelpCircle className="w-3.5 h-3.5 mt-[3px] shrink-0 text-blue-600" aria-hidden="true" />
        <span className="text-gray-800"><span className="text-gray-500">{label}</span> {items.map((x) => `${x}?`).join('  ')}</span>
      </div>
    )
  }
  return (
    <p className="text-xs leading-5 text-gray-800">
      <span className="text-gray-500">{label}</span> {items.join(', ')}
    </p>
  )
}

// The model lists the age group like a sign ("age 15+ years"). It is a pattern in past clinic visits, not a rule,
// so it gets its own plain sentence instead of sitting among the signs.
const isAge = (x) => /^age /i.test(x)
const ageOf = (x) => x.replace(/^age /i, '')

function Reasons({ why, kind }) {
  if (!why) return null
  const ageFor = (why.for || []).filter(isAge).map(ageOf)
  const ageAgainst = (why.against || []).filter(isAge).map(ageOf)
  return (
    <div className="mt-2 space-y-0.5">
      <ReasonRow label={kind === 'definition' ? 'Matches:' : kind === 'possible' ? 'Reported:' : 'Supported by:'} items={(why.for || []).filter((x) => !isAge(x))} />
      <ReasonRow label="Less likely because of:" items={(why.against || []).filter((x) => !isAge(x))} />
      {ageFor.length > 0 && <p className="text-xs leading-5 text-gray-800"><span className="text-gray-500">Age ({ageFor[0]}):</span> more common at this age in past clinic visits</p>}
      {ageAgainst.length > 0 && <p className="text-xs leading-5 text-gray-800"><span className="text-gray-500">Age ({ageAgainst[0]}):</span> less common at this age in past clinic visits, but still possible</p>}
      <ReasonRow label="Ask the reporter:" items={why.ask} question />
      <ReasonRow label="Rules it out if present:" items={why.rulesOut} />
    </div>
  )
}

const KIND = { 'Case definition': 'definition', Possible: 'possible', Model: 'model' }

function subtitle(c) {
  if (c.unlikely) return 'Less likely · the reporter said no to a sign it needs'
  if (c.source === 'Possible') return `Possible · definition not fully met${c.probability ? ` · AI model ${pct(c.probability)}` : ''}`
  if (c.source === 'Model') return `AI model suggestion · estimate ${pct(c.probability)}`
  return `Matches the case definition${c.probability ? ` · AI model also ${pct(c.probability)}` : ''}`
}

function OtherDisease({ options, saving, hasCurrent, hasCards, onChoose }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs font-medium text-red-700 hover:underline">
        {hasCards ? 'None of these? Choose another disease' : hasCurrent ? 'Change the suspected disease' : 'Choose a disease'}
      </button>
    )
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-3">
      <select
        autoFocus
        defaultValue=""
        disabled={saving}
        onChange={(e) => { onChoose(e.target.value === '__rules__' ? '' : e.target.value); setOpen(false) }}
        className="w-full sm:w-72 bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100"
      >
        <option value="" disabled>Select a disease...</option>
        <option value="__rules__">Let the case definition decide</option>
        {(options || []).map((d) => (
          <option key={d.key} value={d.key}>{d.name}</option>
        ))}
      </select>
      <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
    </div>
  )
}

export default function DiseaseChoices({ cands, current, saving, onChoose, options, canChoose = true, hasCurrent = false, title = true, oneColumn = false }) {
  const list = (cands && cands.candidates) || []
  const others = (cands && cands.modelOther) || []
  const more = (cands && cands.moreCandidates) || []
  const modelOnly = list.length > 0 && list.every((c) => c.source === 'Model')
  const best = modelOnly ? list.reduce((a, c) => ((c.probability || 0) > (a.probability || 0) ? c : a), list[0]) : null
  const lean = best && others[0] && others[0].probability > (best.probability || 0)
  return (
    <div className="mb-4">
      {title && list.length > 0 && <div className="text-xs font-medium text-gray-400 mb-2">Which is it? Choose the disease to investigate</div>}
      {(cands?.checkedNo || []).length > 0 && (
        <p className="mb-2 text-xs text-gray-600"><span className="text-gray-500">Reporter was asked and said no to:</span> {cands.checkedNo.join(', ')}</p>
      )}
      {lean && (
        <p className="mb-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The AI model finds a common illness ({others[0].disease}, {pct(others[0].probability)}) more likely than {best.name} ({pct(best.probability)}). Use the questions below before choosing.
        </p>
      )}
      {list.length > 0 && (
        <div className={oneColumn ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-2'}>
          {list.map((c) => {
            const on = current === c.key
            const kind = KIND[c.source] || 'model'
            const record = pastRecord(c.why, c.name)
            const frame = on ? 'border-red-300 bg-red-50/60' : c.unlikely ? 'border-gray-200 bg-gray-50' : kind === 'possible' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200'
            const tone = c.unlikely ? 'text-gray-500' : kind === 'possible' ? 'text-amber-700' : 'text-gray-500'
            return (
              <div key={c.key} className={['rounded-xl border p-3', frame].join(' ')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={['text-sm font-semibold', c.unlikely && !on ? 'text-gray-600' : 'text-gray-900'].join(' ')}>{c.name}</div>
                    <div className={['text-xs', tone].join(' ')}>{subtitle(c)}</div>
                  </div>
                  {canChoose && (
                    <button
                      type="button"
                      disabled={saving || on}
                      onClick={() => onChoose(c.key)}
                      className={['shrink-0 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors',
                        on ? 'border-red-200 bg-white text-red-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'].join(' ')}
                    >
                      {on && <Check className="w-3.5 h-3.5" aria-hidden="true" />}{on ? 'Chosen' : 'Choose'}
                    </button>
                  )}
                </div>
                <Reasons why={c.why} kind={kind} />
                {record && <p className="mt-2 text-[11px] text-gray-400">{record}</p>}
              </div>
            )
          })}
        </div>
      )}
      {more.length > 0 && <p className="mt-1.5 text-xs text-gray-500">Also possible: {more.join(', ')}</p>}
      {others.length > 0 && (
        <div className={list.length ? 'mt-3' : ''}>
          <div className="text-xs font-medium text-gray-400 mb-1.5">{list.length ? 'Or a common illness (not a priority disease)' : 'The AI model sees a common illness (not a priority disease)'}</div>
          <div className="space-y-2">
            {others.map((o) => (
              <div key={o.disease} className="rounded-xl bg-gray-50 px-3 py-2">
                <div className="text-sm font-medium text-gray-800">{o.disease} <span className="text-xs font-normal text-gray-500">{`· estimate ${pct(o.probability)}`}</span></div>
                <Reasons why={o.why} kind="model" />
              </div>
            ))}
          </div>
        </div>
      )}
      {canChoose && <OtherDisease options={options} saving={saving} hasCurrent={hasCurrent} hasCards={list.length > 0} onChoose={onChoose} />}
    </div>
  )
}
