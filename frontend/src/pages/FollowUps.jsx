import { Fragment, useCallback, useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import { getMyTasks } from '../api/frappe'
import TaskUpdate from '../components/tasks/TaskUpdate'
import { dueText, isOpen } from '../components/tasks/taskUi'
import { FOCUS, CARD, BTN_PRIMARY, BTN_SMALL, PageTitle, Badge, Skeleton, Toast, PRIORITY, GRID_TABLE, GRID_HEAD } from '../components/chp/ui'

// two clearly different tabs (KRCS 18 Nov 2026): what is still to do, and what is finished, each with its count
const TABS = [
  { key: 'open', label: 'To do', hint: 'Still to visit or check' },
  { key: 'done', label: 'Done', hint: 'Finished, with what you found' },
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
  const [counts, setCounts] = useState({})

  const load = useCallback(() => {
    setError('')
    return Promise.all([getMyTasks('mine', 'open', 'followups'), getMyTasks('mine', 'done', 'followups')])
      .then(([open, done]) => {
        setCounts({ open: open.tasks.length, done: done.tasks.length })
        setData(status === 'open' ? open : done)
      })
      .catch((e) => setError(e.message || 'Could not load follow-ups'))
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

      {/* plain tabs with their counts (KRCS 19 Nov 2026: the coloured boxes looked generic) */}
      <div role="tablist" aria-label="Follow-up status" className="mb-4 flex gap-6 border-b border-gray-200">
        {TABS.map((t) => {
          const on = status === t.key
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} title={t.hint}
              onClick={() => { setData(null); setParams(t.key === 'open' ? {} : { status: t.key }, { replace: true }) }}
              className={`-mb-px border-b-2 px-1 pb-2.5 text-sm font-semibold ${FOCUS} ${on ? 'border-red-600 text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
              {t.label} ({counts[t.key] ?? '…'})
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-end gap-3 flex-wrap mb-3">
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
        // a table with grid lines and a serial number, like Signals Captured and Referrals (KRCS 18 Nov 2026);
        // recording an outcome opens a row under the follow-up
        <div className={`${CARD} overflow-x-auto`}>
          <table className={GRID_TABLE}>
            <thead>
              <tr className={GRID_HEAD}>
                <th className="px-4 py-3 w-10">#</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Place</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">{status === 'open' ? 'Priority' : 'Status'}</th>
                {status === 'open' ? <th className="px-4 py-3 text-right">Action</th> : <th className="px-4 py-3">What you found</th>}
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, i) => {
                const due = dueText(t)
                const place = [t.area, t.subCounty].filter(Boolean).join(' · ')
                const pr = PRIORITY[t.priority]
                const open = isOpen(t)
                const isEditing = editing === t.id && open
                return (
                  <Fragment key={t.id}>
                    <tr id={`task-${t.id}`} className={`align-top hover:bg-red-50/40 ${focus === t.id ? 'bg-amber-50/60' : ''}`}>
                      <td className="px-4 py-3 text-gray-500 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-3 min-w-[260px]">
                        <p className="font-medium text-gray-900">{t.title}</p>
                        {t.disease && <p className="text-xs text-gray-500 mt-0.5">{t.disease}</p>}
                        {t.instructions && <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{t.instructions}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{place || '—'}</td>
                      <td className={`px-4 py-3 whitespace-nowrap ${open ? due.tone : 'text-gray-900'}`}>{due.text}</td>
                      <td className="px-4 py-3">
                        {open ? (pr ? <Badge tone={pr.tone}>{pr.label}</Badge> : '—') : <Badge tone={t.status === 'Done' ? 'green' : 'gray'}>{t.status}</Badge>}
                      </td>
                      {status === 'open' ? (
                        <td className="px-4 py-3 text-right">
                          {open && (
                            <button type="button" onClick={() => setEditing(isEditing ? null : t.id)} className={isEditing ? BTN_SMALL : `${BTN_PRIMARY} h-8 text-xs whitespace-nowrap`}>
                              {isEditing ? 'Close' : 'Record outcome'}
                            </button>
                          )}
                        </td>
                      ) : <td className="px-4 py-3 text-gray-900 whitespace-pre-wrap">{t.outcome || '—'}</td>}
                    </tr>
                    {isEditing && (
                      <tr>
                        <td colSpan={6} className="px-4 pb-4 bg-gray-50/60">
                          <TaskUpdate task={t} onCancel={() => setEditing(null)} onError={flash}
                            onSaved={() => { setEditing(null); flash('Saved. Your officer can see it.'); load() }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Toast text={toast} />
    </AppShell>
  )
}
