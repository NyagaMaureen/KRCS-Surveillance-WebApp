import { useCallback, useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { ClipboardList, MapPin, CalendarDays } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getMyTasks } from '../api/frappe'
import TaskUpdate from '../components/tasks/TaskUpdate'
import { dueText, isOpen } from '../components/tasks/taskUi'
import { FOCUS, CARD, BTN_SMALL, PageTitle, IconBubble, Badge, Skeleton, Toast, PRIORITY } from '../components/chp/ui'

const TABS = [
  { key: 'open', label: 'To do' },
  { key: 'done', label: 'Done' },
]

export default function FollowUps() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') === 'done' ? 'done' : 'open'
  const focus = params.get('task')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(focus)
  const [toast, setToast] = useState('')
  const [goReferrals, setGoReferrals] = useState(false)

  const load = useCallback(() => {
    setError('')
    return getMyTasks('mine', status, 'followups').then(setData).catch((e) => setError(e.message || 'Could not load follow-ups'))
  }, [status])
  useEffect(() => { load() }, [load])

  // a notification for a referral may land here: send it to the Referrals page
  useEffect(() => {
    if (!focus || !data) return
    if (!data.tasks.some((t) => t.id === focus)) {
      if (status === 'open') getMyTasks('mine', 'all', 'referrals').then((r) => r.tasks.some((t) => t.id === focus) && setGoReferrals(true)).catch(() => {})
      return
    }
    document.getElementById(`task-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focus, data, status])

  if (goReferrals) return <Navigate to={`/referrals?task=${focus}`} replace />

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000) }
  const tasks = data?.tasks || []
  const s = data?.summary

  return (
    <AppShell>
      <PageTitle title="Community Follow-ups" subtitle="Visits and checks your surveillance officer has asked you to do. Record what you found when you finish." />

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div role="tablist" aria-label="Follow-up status" className="flex rounded-lg border border-gray-200 p-0.5 bg-white">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={status === t.key}
              onClick={() => setParams(t.key === 'open' ? {} : { status: t.key }, { replace: true })}
              className={`h-8 px-4 rounded-md text-sm ${FOCUS} ${status === t.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {s && status === 'open' && (
          <p className="text-sm text-gray-500">
            {s.overdue > 0 && <span className="text-red-600 font-medium">{s.overdue} overdue · </span>}
            {s.today} due today · {s.upcoming} upcoming
          </p>
        )}
      </div>

      {error ? (
        <div className={`${CARD} p-10 text-center text-sm text-gray-600`}>{error} <button onClick={load} className="ml-2 text-red-600 underline">Try again</button></div>
      ) : !data ? <Skeleton /> : !tasks.length ? (
        <div className={`${CARD} p-12 text-center`}>
          <p className="text-sm font-medium text-gray-900">{status === 'open' ? 'No follow-ups right now' : 'No finished follow-ups yet'}</p>
          <p className="text-sm text-gray-500 mt-1">{status === 'open' ? 'When an officer asks you to visit or check on someone, it appears here and you get a notification.' : ''}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((t) => {
            const due = dueText(t)
            const place = [t.area, t.subCounty].filter(Boolean).join(' · ')
            const pr = PRIORITY[t.priority]
            return (
              <li key={t.id} id={`task-${t.id}`} className={`${CARD} p-5 ${focus === t.id ? 'ring-1 ring-amber-300' : ''}`}>
                <div className="flex items-start gap-4">
                  <IconBubble icon={ClipboardList} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <p className={`text-sm font-medium ${isOpen(t) ? 'text-gray-900' : 'text-gray-500'}`}>{t.title}</p>
                      {isOpen(t) ? pr && <Badge tone={pr.tone}>{pr.label}</Badge> : <Badge tone={t.status === 'Done' ? 'green' : 'gray'}>{t.status}</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-5 gap-y-1">
                      {place && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" aria-hidden="true" />{place}</span>}
                      <span className={`inline-flex items-center gap-1 ${due.tone}`}><CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />{due.text}</span>
                      {t.disease && <span>{t.disease}</span>}
                    </p>
                  </div>
                </div>
                {t.instructions && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-gray-900">Instructions</p>
                    <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{t.instructions}</p>
                  </div>
                )}
                {t.outcome && <p className="text-sm text-gray-700 mt-3"><span className="text-gray-400">What you found: </span>{t.outcome}</p>}
                {isOpen(t) && (
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => setEditing(editing === t.id ? null : t.id)} className={BTN_SMALL}>
                      {editing === t.id ? 'Close' : 'Record outcome'}
                    </button>
                  </div>
                )}
                {editing === t.id && isOpen(t) && (
                  <TaskUpdate task={t} onCancel={() => setEditing(null)} onError={flash}
                    onSaved={() => { setEditing(null); flash('Saved. Your officer can see it.'); load() }} />
                )}
              </li>
            )
          })}
        </ul>
      )}
      <Toast text={toast} />
    </AppShell>
  )
}
