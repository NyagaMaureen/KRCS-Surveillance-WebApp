// Small shared pieces for the Review Queue and Epi Trends list pages.
export const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'

export const BTN_SECONDARY = `inline-flex items-center gap-1.5 h-9 border border-gray-200 bg-white rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`

const SEVERITY = {
  critical: { label: 'Critical', dot: 'bg-red-600' },
  high: { label: 'High', dot: 'bg-amber-500' },
  standard: { label: 'Standard', dot: 'bg-gray-400' },
}
export const sev = (s) => SEVERITY[s] || SEVERITY.standard

export function EmptyState({ title, body, action }) {
  return (
    <div className="py-14 px-6 text-center">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {body && <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
