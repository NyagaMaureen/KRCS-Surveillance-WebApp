// The server writes one sentence per classification, for example:
//   Suspected X. Matched: Fever (hot body) + Unexplained Bleeding. MOH IDSR definition: "Any person with..."
// Screens show the pieces once each instead of repeating the whole sentence.
export function parseReason(text) {
  const t = String(text || '').trim()
  const out = { head: t, signs: '', source: '', definition: '', note: '' }
  const at = t.indexOf('. Matched:')
  if (at < 0) return out
  out.head = t.slice(0, at)
  let rest = t.slice(at + '. Matched:'.length).trim()
  const note = rest.match(/\s*\(([^()]*outbreak definition[^()]*)\)\s*\.?\s*$/)
  if (note) { out.note = note[1]; rest = rest.slice(0, note.index) }
  const def = rest.match(/\.\s+([^"]*?)\s+definition:\s*"([\s\S]*?)"\s*\.?\s*$/)
  if (def) { out.source = def[1]; out.definition = def[2]; rest = rest.slice(0, def.index) }
  out.signs = rest.replace(/\.\s*$/, '').trim()
  return out
}
