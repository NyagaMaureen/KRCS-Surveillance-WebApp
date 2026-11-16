import { PAGE_SIZES } from './usePaged'

const BTN = 'border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-900 hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-white'

// Rows per page, for pages that already have their own paging buttons
export function PageSizeSelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Rows per page"
      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-900">
      {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
    </select>
  )
}

// Paging under a table, as on Signals Captured: First / Previous, page numbers, rows per page, Next / Last.
export default function Pager({ paged, noun = 'rows' }) {
  const { page, size, total, lastPage, setPage, setSize } = paged
  if (!total) return null
  const from = Math.max(0, Math.min(page - 2, lastPage - 4))
  const numbers = Array.from({ length: Math.min(lastPage, from + 4) - from + 1 }, (_, i) => from + i)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setPage(0)} disabled={page === 0} className={BTN}>First</button>
        <button type="button" onClick={() => setPage(page - 1)} disabled={page === 0} className={BTN}>Previous</button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <span className="text-xs text-gray-900">Showing {page * size + 1} to {Math.min((page + 1) * size, total)} of {total} {noun}</span>
        <div className="flex items-center gap-1">
          {numbers.map((n) => (
            <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? 'page' : undefined}
              className={['min-w-[2rem] rounded-lg px-2 py-1.5 text-xs', n === page ? 'bg-red-600 font-semibold text-white' : 'border border-gray-200 text-gray-900 hover:bg-gray-50'].join(' ')}>{n + 1}</button>
          ))}
        </div>
        <PageSizeSelect value={size} onChange={setSize} />
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setPage(page + 1)} disabled={page >= lastPage} className={BTN}>Next</button>
        <button type="button" onClick={() => setPage(lastPage)} disabled={page >= lastPage} className={BTN}>Last</button>
      </div>
    </div>
  )
}
