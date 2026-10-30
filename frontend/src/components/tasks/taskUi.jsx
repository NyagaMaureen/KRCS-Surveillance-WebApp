// Small shared pieces for tasks (event page, My Tasks page, dashboard card).
export const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
export const INPUT = `w-full h-9 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-800 placeholder:text-gray-400 ${FOCUS}`
export const TEXTAREA = `w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 ${FOCUS}`
export const BTN_PRIMARY = `inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 ${FOCUS}`
export const BTN_SECONDARY = `inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 disabled:opacity-50 ${FOCUS}`
export const LINK_BTN = `text-sm font-medium text-red-600 hover:text-red-700 hover:underline rounded ${FOCUS}`

export const TASK_TYPES = [
  { key: 'Field visit', hint: 'Visit the household, confirm the case, find contacts', defaultTitle: 'Visit the household and confirm the case' },
  { key: 'Referral', hint: 'Send the patient to a health facility for care or a sample', defaultTitle: 'Refer the patient to a health facility' },
  { key: 'Sample collection', hint: 'Done at a facility by a surveillance officer or health worker', defaultTitle: 'Collect a sample at the facility' },
  { key: 'Follow-up', hint: 'Check on the patient and look for new cases', defaultTitle: 'Follow up on the patient' },
  { key: 'Other', hint: 'Anything else', defaultTitle: '' },
]

export const STATUSES = ['Assigned', 'In progress', 'Done', 'Could not complete']
const STATUS_STYLE = {
  Assigned: 'bg-gray-100 text-gray-700',
  'In progress': 'bg-sky-100 text-sky-800',
  Done: 'bg-green-600 text-white',
  'Could not complete': 'bg-gray-100 text-gray-400',
}
export function TaskStatusPill({ status }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLE[status] || STATUS_STYLE.Assigned}`}>{status}</span>
}

export const isOpen = (t) => t.status === 'Assigned' || t.status === 'In progress' || t.status === 'Blocked'

function parse(d) {
  if (!d) return null
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day)
}
export function todayISO(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Due today", "Due tomorrow", "Due Mon 3 Nov", "2 days overdue" */
export function dueText(task) {
  const due = parse(task.dueDate)
  if (!due) return { text: 'No due date', tone: 'text-gray-400' }
  const today = parse(todayISO())
  const diff = Math.round((due - today) / 86400000)
  if (!isOpen(task)) return { text: due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), tone: 'text-gray-400' }
  if (diff < 0) return { text: `${-diff} day${diff === -1 ? '' : 's'} overdue`, tone: 'text-red-600 font-medium' }
  if (diff === 0) return { text: 'Due today', tone: 'text-amber-700 font-medium' }
  if (diff === 1) return { text: 'Due tomorrow', tone: 'text-gray-700' }
  return { text: `Due ${due.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`, tone: 'text-gray-500' }
}
