import { useState } from 'react'
import { FileText, Copy, Check, ChevronDown } from 'lucide-react'

const LABEL_LINE = /^(\s*)([A-Za-z][^:\n]{0,50}):(\s+\S.*)$/

function confidenceOf(passage, thresholds) {
  if (passage?.confidence) return String(passage.confidence).toLowerCase()
  const score = Number(passage?.score)
  if (thresholds && Number.isFinite(score)) {
    if (score >= thresholds.high) return 'high'
    if (score >= thresholds.medium) return 'medium'
  }
  return 'low'
}

function VerbatimText({ text }) {
  const lines = String(text ?? '').split('\n')
  return (
    <p className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
      {lines.map((line, i) => {
        const m = line.match(LABEL_LINE)
        return (
          <span key={i}>
            {m ? (
              <>
                {m[1]}
                <strong className="font-semibold text-gray-900">{m[2]}:</strong>
                {m[3]}
              </>
            ) : (
              line
            )}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        )
      })}
    </p>
  )
}

function citationText(p) {
  const parts = [p.title, p.section].filter(Boolean)
  return `Source: ${parts.join(', ')}${p.version ? `, v${p.version}` : ''}`
}

function Passage({ passage }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${passage.text}\n\n${citationText(passage)}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3">
        <VerbatimText text={passage.text} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
        <FileText className="w-3.5 h-3.5 shrink-0" />
        <span className="font-medium text-gray-700">{passage.title}</span>
        {passage.version && <span>v{passage.version}</span>}
        {passage.section && <span>{'\u2022'} {passage.section}</span>}
        {passage.page && <span>{'\u2022'} page {passage.page}</span>}
        {passage.language && (
          <span className="border border-gray-200 bg-white rounded px-1.5 py-0.5 text-[11px] text-gray-600">{passage.language}</span>
        )}
        {passage.review_date && <span>{'\u2022'} Reviewed {passage.review_date}</span>}
        <button
          type="button"
          onClick={copy}
          className="ml-auto flex items-center gap-1 text-gray-500 hover:text-gray-800"
          aria-label="Copy passage with citation"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

function CollapsiblePassage({ passage }) {
  const [open, setOpen] = useState(false)
  const pct = Number.isFinite(Number(passage.score)) ? Math.round(Number(passage.score) * 100) : null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 border border-gray-200 rounded-xl px-4 py-2.5 text-left hover:bg-gray-50"
      >
        <span className="min-w-0 text-sm text-gray-800 truncate">
          {passage.title}{passage.section ? ` \u2022 ${passage.section}` : ''}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {pct !== null && (
            <span title="How closely this passage matches your question" className="text-xs text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">
              {pct}%
            </span>
          )}
          <ChevronDown className={['w-4 h-4 text-gray-400 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
        </span>
      </button>
      {open && <div className="mt-2"><Passage passage={passage} /></div>}
    </div>
  )
}

const CHIPS = {
  high: { label: 'Strong match', cls: 'bg-green-50 text-green-700 border-green-200' },
  medium: { label: 'Partial match', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  low: { label: 'No clear match', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
}

export default function KbAnswer({ result }) {
  const [showClosest, setShowClosest] = useState(false)
  const results = result?.results || []
  const top = results[0]
  const level = top ? confidenceOf(top, result?.confidence_thresholds) : 'low'
  const chip = CHIPS[level] || CHIPS.low
  const disease = result?.detected_disease

  let header = 'I couldn\u2019t find a clear answer in the approved documents.'
  if (level === 'high') header = `From ${top.title}`
  else if (level === 'medium') header = 'Possible matches. Check which one answers your question'

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed">
        <div className="flex flex-wrap items-center gap-2">
          <span>{header}</span>
          <span className={['text-xs font-medium border rounded-full px-2 py-0.5', chip.cls].join(' ')}>{chip.label}</span>
          {disease?.name && (
            <span className="text-xs text-gray-600 border border-gray-200 bg-white rounded-full px-2 py-0.5">Topic: {disease.name}</span>
          )}
        </div>
      </div>

      {level === 'low' ? (
        <>
          {results.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowClosest((v) => !v)}
                aria-expanded={showClosest}
                className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
              >
                <ChevronDown className={['w-4 h-4 transition-transform', showClosest ? 'rotate-180' : ''].join(' ')} />
                Show closest passages
              </button>
              {showClosest && results.slice(0, 3).map((p, i) => <Passage key={p.id || i} passage={p} />)}
            </div>
          )}
          <p className="text-xs text-gray-500">Try different words, or ask a surveillance officer.</p>
        </>
      ) : (
        <>
          <Passage passage={top} />
          {results.length > 1 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-500">Other relevant passages ({results.length - 1})</div>
              {results.slice(1).map((p, i) => <CollapsiblePassage key={p.id || i} passage={p} />)}
            </div>
          )}
        </>
      )}

      <p className="text-xs text-gray-400">Quoted from approved KRCS documents. Confirm with a health worker before acting.</p>
    </div>
  )
}
