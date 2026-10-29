// Small building blocks for the CHP workspace pages (Figma "CHP" screens).
import { Link } from 'react-router-dom'
import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'

export const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
export const CARD = 'bg-white rounded-xl border border-gray-100'
export const INPUT = `w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-800 placeholder:text-gray-400 ${FOCUS}`
export const TEXTAREA = `w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 ${FOCUS}`
export const BTN_PRIMARY = `inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 ${FOCUS}`
export const BTN_SECONDARY = `inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 disabled:opacity-50 ${FOCUS}`
export const BTN_SMALL = `inline-flex items-center h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 ${FOCUS}`

export function PageTitle({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function StatCard({ label, value, unit, change, icon: Icon, hint }) {
  const shown = value == null ? '—' : `${value}${unit && value != null ? unit : ''}`
  return (
    <div className={`${CARD} p-4 flex items-center gap-3`} title={hint}>
      {Icon && (
        <span className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-gray-500" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="flex items-baseline gap-2">
          <span className="text-xl font-semibold text-gray-900 tabular-nums">{shown}</span>
          {change != null && (
            <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {change >= 0 ? <TrendingUp className="w-3 h-3" aria-hidden="true" /> : <TrendingDown className="w-3 h-3" aria-hidden="true" />}
              {Math.abs(change)}%
            </span>
          )}
        </p>
      </div>
    </div>
  )
}

export function Section({ title, viewAll, children }) {
  return (
    <section className={`${CARD} p-5`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {viewAll && (
          <Link to={viewAll} className={`inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700 rounded ${FOCUS}`}>
            View all <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

export function IconBubble({ icon: Icon }) {
  return (
    <span className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
      <Icon className="w-4 h-4 text-red-600" aria-hidden="true" />
    </span>
  )
}

const BADGE = {
  red: 'bg-red-600 text-white',
  amber: 'bg-amber-400 text-white',
  green: 'bg-green-600 text-white',
  blue: 'bg-sky-100 text-sky-800',
  gray: 'bg-gray-100 text-gray-600',
  softAmber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  softGreen: 'bg-green-50 text-green-700 ring-1 ring-green-200',
}
export function Badge({ tone = 'gray', children }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE[tone] || BADGE.gray}`}>{children}</span>
}

export const PRIORITY = {
  critical: { label: 'Critical', tone: 'red' },
  high: { label: 'High priority', tone: 'amber' },
  standard: { label: 'Standard', tone: 'gray' },
}

export const REFERRAL_TONE = { Pending: 'amber', 'On the way': 'blue', 'Reached facility': 'green', 'Not reached': 'red' }
export const REPORT_TONE = { Submitted: 'softAmber', Reviewed: 'softGreen', Linked: 'softGreen', Investigating: 'softAmber', Closed: 'gray' }

export function EmptyNote({ children }) {
  return <p className="text-sm text-gray-400 py-6 text-center">{children}</p>
}

export function Toast({ text, error }) {
  if (!text) return null
  return (
    <div role="status" className={`fixed bottom-6 right-6 z-[70] rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${error ? 'bg-red-600' : 'bg-gray-900'}`}>
      {text}
    </div>
  )
}

export function Skeleton({ rows = 3 }) {
  return (
    <div className="flex flex-col gap-3 animate-pulse" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${CARD} p-5`}>
          <div className="h-3 w-1/3 bg-gray-100 rounded" />
          <div className="h-3 w-1/2 bg-gray-100 rounded mt-3" />
        </div>
      ))}
    </div>
  )
}

/** "Today, 09:15" / "Yesterday" / "3 Nov" */
export function shortWhen(value) {
  if (!value) return ''
  const d = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return String(value)
  const today = new Date()
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000)
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (days === 0) return `Today, ${time}`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
