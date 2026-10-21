import { parseDateOnly, formatDateOnly, relativeDays } from './formOptions'

export const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1'

export const SEVERITY_STYLES = {
  critical: 'bg-red-600 text-white',
  high: 'bg-amber-400 text-white',
  standard: 'bg-blue-500 text-white',
}

export const STATUS_STYLES = {
  New: 'border-amber-400 bg-amber-400/10 text-amber-500',
  Verifying: 'border-purple-400 bg-purple-400/10 text-purple-500',
  Investigating: 'border-purple-400 bg-purple-400/10 text-purple-600',
  Confirmed: 'border-blue-500 bg-blue-500/10 text-blue-600',
  Escalated: 'border-red-500 bg-red-500/10 text-red-600',
  Discarded: 'border-gray-300 bg-gray-100 text-gray-500',
  Closed: 'border-emerald-500 bg-emerald-500/10 text-emerald-600',
}

export const STATUS_LABELS = { Investigating: 'In the field' }
export const statusLabel = (s) => STATUS_LABELS[s] || s

export function parseDate(v) {
  if (!v) return null
  const d = new Date(String(v).replace(' ', 'T'))
  return isNaN(d) ? null : d
}

export function fmtDateTime(v) {
  if (!v) return '—'
  const dateOnly = parseDateOnly(v)
  if (dateOnly) return formatDateOnly(dateOnly)
  const d = parseDate(v)
  if (!d) return String(v)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function relTime(v) {
  const dateOnly = parseDateOnly(v)
  if (dateOnly) return relativeDays(dateOnly)
  const d = parseDate(v)
  if (!d) return '—'
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
