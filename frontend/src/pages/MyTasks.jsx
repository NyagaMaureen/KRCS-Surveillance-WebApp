import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RefreshCw, Search, Building2, MapPin } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getMyTasks } from '../api/frappe'
import TaskUpdate from '../components/tasks/TaskUpdate'
import { FOCUS, INPUT, LINK_BTN, TaskStatusPill, dueText, isOpen } from '../components/tasks/taskUi'

const card = 'bg-white rounded-xl border border-gray-100'

export default function MyTasks() {
  const [params, setParams] = useSearchParams()
  const scope = params.get('scope') === 'all' ? 'all' : 'mine'
  const status = ['done', 'all'].includes(params.get('status')) ? params.get('status') : 'open'
  const focusTask = params.get('task')
  const when = params.get('when') || ''

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(focusTask || null)
  const [q, setQ] = useState('')
  const [toast, setToast] = useState('')

  const set = (updates) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    Object.entries(updates).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    return next
  }, { replace: true })

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    return getMyTasks(scope, status)
      .then(setData)
      .catch((e) => setError(e.message || 'Could not load tasks'))
      .finally(() => setLoading(false))
  }, [scope, status])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!focusTask || !data) return
    document.getElementById(`task-${focusTask}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusTask, data])

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  const tasks = useMemo(() => {
    let list = data?.tasks || []
    if (when === 'overdue') list = list.filter((t) => t.overdue)
    if (when === 'today') list = list.filter((t) => isOpen(t) && dueText(t).text === 'Due today')
    if (when === 'upcoming') list = list.filter((t) => isOpen(t) && !t.overdue && dueText(t).text !== 'Due today')
    if (q.trim()) {
      const s = q.trim().toLowerCase()
      list = list.filter((t) => [t.title, t.disease, t.subCounty, t.area, t.assignedToName, t.event, t.facility].some((x) => (x || '').toLowerCase().includes(s)))
    }
    return list
  }, [data, when, q])

  const summary = data?.summary || { overdue: 0, today: 0, upcoming: 0 }
  const stats = [
    { key: 'overdue', label: 'Overdue', value: summary.overdue, alarm: summary.overdue > 0 },
    { key: 'today', label: 'Due today', value: summary.today },
    { key: 'upcoming', label: 'Upcoming', value: summary.upcoming },
  ]

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold text-gray-900">My Tasks</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Field visits, referrals, sample collection and follow-ups assigned to you by a surveillance officer. Update each one when you start and when it is done.
          </p>
        </div>
        <button onClick={load} disabled={loading} className={`h-9 inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium ${FOCUS}`}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {scope === 'mine' && (
          <div className="grid grid-cols-3 gap-3 max-w-xl">
            {stats.map((s) => {
              const on = when === s.key
              return (
                <button key={s.key} aria-pressed={on} onClick={() => set({ when: on ? '' : s.key, status: '' })}
                  className={`${card} text-left px-4 py-3 hover:border-gray-200 ${on ? 'ring-1 ring-gray-300' : ''} ${s.alarm ? 'bg-red-50 border-red-100' : ''} ${FOCUS}`}>
                  <span className={`block text-xs ${s.alarm ? 'text-red-700' : 'text-gray-500'}`}>{s.label}</span>
                  <span className={`block text-xl font-semibold tabular-nums mt-1 ${s.alarm ? 'text-red-700' : 'text-gray-900'}`}>{loading && !data ? '–' : s.value}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className={`${card} p-3 flex items-center gap-2 flex-wrap`}>
          {data?.canViewAll && (
            <div role="tablist" aria-label="Whose tasks" className="flex rounded-lg border border-gray-200 p-0.5">
              {[['mine', 'Assigned to me'], ['all', 'All tasks']].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={scope === k} onClick={() => set({ scope: k === 'mine' ? '' : k, when: '' })}
                  className={`h-8 px-3 rounded-md text-sm ${FOCUS} ${scope === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" placeholder="Search by disease, place or person"
              className={`${INPUT} pl-9 bg-gray-50 border-gray-100`} />
          </div>
          <select aria-label="Status" value={status} onChange={(e) => set({ status: e.target.value === 'open' ? '' : e.target.value, when: '' })} className={`${INPUT} w-auto`}>
            <option value="open">To do</option>
            <option value="done">Finished</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className={card}>
          {loading && !data ? (
            <ul className="divide-y divide-gray-100">
              {[0, 1, 2].map((i) => (
                <li key={i} className="p-4 animate-pulse"><div className="h-3 w-1/2 bg-gray-100 rounded" /><div className="h-3 w-1/3 bg-gray-100 rounded mt-2" /></li>
              ))}
            </ul>
          ) : error ? (
            <div className="py-14 text-center">
              <p className="text-sm text-gray-700">{error}</p>
              <button onClick={load} className={`mt-3 ${LINK_BTN}`}>Try again</button>
            </div>
          ) : !tasks.length ? (
            <div className="py-14 px-6 text-center">
              <p className="text-sm font-medium text-gray-900">{status === 'open' ? 'Nothing to do right now' : 'No tasks here'}</p>
              <p className="text-sm text-gray-500 mt-1">{status === 'open' ? 'When an officer assigns you a task, it will appear here and you will get a notification.' : 'Try another filter.'}</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {tasks.map((t) => {
                const due = dueText(t)
                const place = [t.area, t.subCounty].filter(Boolean).join(', ')
                const canUpdate = isOpen(t) && t.mine
                return (
                  <li key={t.id} id={`task-${t.id}`} className={`px-4 py-4 ${focusTask === t.id ? 'bg-amber-50/40' : ''}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${isOpen(t) ? 'text-gray-900' : 'text-gray-500'}`}>{t.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span>{t.type}</span>
                          <span className="text-gray-300">·</span>
                          <span>{t.disease || 'Event'}</span>
                          {place && <><span className="text-gray-300">·</span><span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden="true" />{place}</span></>}
                          <span className="text-gray-300">·</span>
                          <span className={due.tone}>{due.text}</span>
                        </p>
                        {t.facility && (
                          <p className="text-xs text-gray-600 mt-1 inline-flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" /> Refer to {t.facility}{t.urgency ? ` · ${t.urgency}` : ''}
                          </p>
                        )}
                        {t.instructions && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{t.instructions}</p>}
                        {t.outcome && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap"><span className="text-gray-400">Outcome: </span>{t.outcome}</p>}
                        <p className="text-xs text-gray-400 mt-1">
                          {scope === 'all' ? <>Assigned to <span className="text-gray-600">{t.assignedToName}</span> · </> : null}
                          by {t.assignedBy || '—'}
                          {data?.canOpenEvents && <> · <Link to={`/alerts-signals/${encodeURIComponent(t.event)}`} className={`underline underline-offset-2 hover:text-gray-700 rounded ${FOCUS}`}>{t.event}</Link></>}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <TaskStatusPill status={t.status} />
                        {canUpdate && (
                          <button type="button" onClick={() => setEditing(editing === t.id ? null : t.id)}
                            className={`h-8 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 ${FOCUS}`}>
                            {editing === t.id ? 'Close' : 'Update'}
                          </button>
                        )}
                      </div>
                    </div>
                    {editing === t.id && canUpdate && (
                      <TaskUpdate task={t} onCancel={() => setEditing(null)} onError={flash}
                        onSaved={() => { setEditing(null); flash('Task updated. The officer can see your update.'); load() }} />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {toast && <div role="status" className="fixed bottom-6 right-6 z-[70] rounded-lg px-4 py-2.5 text-sm text-white shadow-lg bg-gray-900">{toast}</div>}
    </AppShell>
  )
}
