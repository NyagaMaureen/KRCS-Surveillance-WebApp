import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'

function swahiliName(symptom) {
  const entry = Object.entries(symptom).find(([k, v]) => /swahili|(^|_)sw($|_)/i.test(k) && typeof v === 'string' && v)
  return entry ? entry[1] : ''
}

export default function SymptomPicker({ symptoms, selected, onToggle, invalid, onBlur }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!q) return symptoms
    return symptoms.filter((s) => s.symptom_name.toLowerCase().includes(q) || swahiliName(s).toLowerCase().includes(q))
  }, [symptoms, q])

  const categories = useMemo(() => [...new Set(filtered.map((s) => s.category))], [filtered])
  const selectedItems = selected.map((id) => symptoms.find((s) => s.name === id)).filter(Boolean)

  return (
    <div id="field-symptoms" className={invalid ? 'rounded-lg border border-red-300 bg-red-50/40 p-3' : ''}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500">{selected.length} selected</span>
      </div>

      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {selectedItems.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1 bg-red-50 text-red-700 text-xs font-medium pl-2.5 pr-1.5 py-1 rounded-full">
              {s.symptom_name}
              <button type="button" onClick={() => onToggle(s.name)} aria-label={`Remove ${s.symptom_name}`} className="hover:bg-red-100 rounded-full p-0.5">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative mb-2">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={onBlur}
          type="text"
          placeholder="Search signs and symptoms…"
          className="w-full bg-gray-50 rounded-lg pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No symptoms match "{query.trim()}"</p>
      ) : (
        categories.map((cat) => (
          <div key={cat}>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mt-4 mb-2">{cat}</p>
            <div className="grid grid-cols-2 gap-2">
              {filtered.filter((s) => s.category === cat).map((s) => {
                const sw = swahiliName(s)
                return (
                  <label
                    key={s.name}
                    className={['flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors', selected.includes(s.name) ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 hover:bg-gray-50'].join(' ')}
                  >
                    <input type="checkbox" checked={selected.includes(s.name)} onChange={() => onToggle(s.name)} className="accent-red-600" />
                    <span>{s.symptom_name}{sw && <span className="block text-[11px] text-gray-400">{sw}</span>}</span>
                  </label>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
