import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, ArrowRight } from 'lucide-react'
import { getMyTasks } from '../../api/frappe'
import { FOCUS, dueText } from './taskUi'

/** Dashboard card: the user's open tasks. Shows nothing if they have none. */
export default function MyTasksCard() {
  const [data, setData] = useState(null)

  useEffect(() => {
    getMyTasks('mine', 'open').then(setData).catch(() => {})
  }, [])

  const tasks = data?.tasks || []
  if (!tasks.length) return null
  const { overdue = 0, today = 0, upcoming = 0 } = data.summary || {}

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
            <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-gray-900">My tasks</h2>
            <p className="text-xs text-gray-500">
              {overdue > 0 && <span className="text-red-600 font-medium">{overdue} overdue · </span>}
              {today} due today · {upcoming} upcoming
            </p>
          </div>
        </div>
        <Link to="/my-tasks" className={`inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700 rounded ${FOCUS}`}>
          Open My Tasks <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {tasks.slice(0, 3).map((t) => {
          const due = dueText(t)
          return (
            <li key={t.id}>
              <Link to={`/my-tasks?task=${t.id}`} className={`flex items-center justify-between gap-3 py-2.5 hover:bg-gray-50/60 rounded ${FOCUS}`}>
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900 truncate">{t.title}</span>
                  <span className="block text-xs text-gray-500">{t.type} · {t.disease || 'Event'}{t.subCounty ? `, ${t.subCounty}` : ''}</span>
                </span>
                <span className={`text-xs whitespace-nowrap ${due.tone}`}>{due.text}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
