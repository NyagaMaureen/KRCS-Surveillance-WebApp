import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RefreshCw, Search, Building2, MapPin } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import Pager from '../components/common/Pager'
import usePaged from '../components/common/usePaged'
import { getMyTasks } from '../api/frappe'
import TaskUpdate from '../components/tasks/TaskUpdate'
import { FOCUS, INPUT, LINK_BTN, TaskStatusPill, dueText, isOpen } from '../components/tasks/taskUi'


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

  const paged = usePaged(tasks, 10, `${scope}|${status}|${when}|${q}`)
  const summary = data?.summary || { overdue: 0, today: 0, upcoming: 0 }
  const stats = [
    { key: 'overdue', label: 'Overdue', value: summary.overdue, alarm: summary.overdue > 0 },
    { key: 'today', label: 'Due today', value: summary.today },
    { key: 'upcoming', label: 'Upcoming', value: summary.upcoming },
  ]

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-xl font-bold text-brand-navy">My Tasks</h2>
          <p className="text-sm text-gray-900">
            Field visits, referrals, sample collection and follow-ups assigned to you. Update each one when you start and when it is done.
          </p>
        </div>
        <button onClick={load} disabled={loading} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      {/* red cards like Signals Captured; click one to show only those tasks */}
      {scope === 'mine' && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stats.map((s) => {
            const on = when === s.key
            return (
              <button key={s.key} aria-pressed={on} onClick={() => set({ when: on ? '' : s.key, status: '' })}
                className={`rounded-xl p-4 text-center text-white ${on ? 'bg-red-700 ring-2 ring-red-300' : 'bg-red-600 hover:bg-red-700'} ${FOCUS}`}>
                <span className="block text-[11px] font-bold uppercase tracking-wide">{s.label}</span>
                <span className="mt-1 block text-2xl font-bold tabular-nums">{loading && !data ? '–' : s.value}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        {data?.canViewAll && (
          <div role="tablist" aria-label="Whose tasks" className="flex rounded-lg border border-gray-200 p-0.5">
            {[['mine', 'Assigned to me'], ['all', 'All tasks']].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={scope === k} onClick={() => set({ scope: k === 'mine' ? '' : k, when: '' })}
                className={`h-8 rounded-md px-3 text-sm ${FOCUS} ${scope === k ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-900" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" placeholder="Search by disease, place or person" className={`${INPUT} pl-9`} />
        </div>
        <select aria-label="Status" value={status} onChange={(e) => set({ status: e.target.value === 'open' ? '' : e.target.value, when: '' })} className={`h-10 w-44 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 ${FOCUS}`}>
          <option value="open">To do</option>
          <option value="done">Finished</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading && !data ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}</div>
        ) : error ? (
          <div className="py-14 text-center">
            <p className="text-sm text-gray-900">{error}</p>
            <button onClick={load} className={`mt-3 ${LINK_BTN}`}>Try again</button>
          </div>
        ) : !tasks.length ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-gray-900">{status === 'open' ? 'Nothing to do right now' : 'No tasks here'}</p>
            <p className="mt-1 text-sm text-gray-900">{status === 'open' ? 'When a task is assigned to you, it will appear here and you will get a notification.' : 'Try another filter.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs">
                  <th className="w-10 px-3 py-3">#</th><th className="px-3 py-3">Task</th><th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Disease</th><th className="px-3 py-3">Place</th><th className="px-3 py-3">Due</th>
                  <th className="px-3 py-3">{scope === 'all' ? 'Assigned to' : 'Assigned by'}</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.shown.map((t, i) => {
                  const due = dueText(t)
                  const place = [t.area, t.subCounty].filter(Boolean).join(', ')
                  const canUpdate = isOpen(t) && t.mine
                  return (
                    <Fragment key={t.id}>
                      <tr id={`task-${t.id}`} className={`align-top hover:bg-gray-50 ${focusTask === t.id ? 'bg-amber-50/40' : ''}`}>
                        <td className="px-3 py-3 tabular-nums text-gray-900">{paged.offset + i + 1}</td>
                        <td className="max-w-sm px-3 py-3 text-gray-900">
                          <p className="font-medium">{t.title}</p>
                          {t.facility && <p className="mt-0.5 inline-flex items-center gap-1 text-xs"><Building2 className="h-3.5 w-3.5" aria-hidden="true" />Refer to {t.facility}{t.urgency ? ` · ${t.urgency}` : ''}</p>}
                          {t.instructions && <p className="mt-1 whitespace-pre-wrap text-xs">{t.instructions}</p>}
                          {t.outcome && <p className="mt-1 whitespace-pre-wrap text-xs"><span className="font-semibold">Outcome: </span>{t.outcome}</p>}
                          {data?.canOpenEvents && t.event && <Link to={`/alerts-signals/${encodeURIComponent(t.event)}`} className={`mt-1 inline-block rounded text-xs text-red-700 hover:underline ${FOCUS}`}>Open the event</Link>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-900">{t.type}</td>
                        <td className="px-3 py-3 text-gray-900">{t.disease || '—'}</td>
                        <td className="px-3 py-3 text-gray-900">{place ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{place}</span> : '—'}</td>
                        <td className={`whitespace-nowrap px-3 py-3 ${due.tone}`}>{due.text}</td>
                        <td className="px-3 py-3 text-gray-900">{scope === 'all' ? t.assignedToName : (t.assignedBy || '—')}</td>
                        <td className="px-3 py-3"><TaskStatusPill status={t.status} /></td>
                        <td className="px-3 py-3 text-right">
                          {canUpdate && (
                            <button type="button" onClick={() => setEditing(editing === t.id ? null : t.id)}
                              className={`inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 ${FOCUS}`}>
                              {editing === t.id ? 'Close' : 'Update'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {editing === t.id && canUpdate && (
                        <tr>
                          <td colSpan={9} className="bg-gray-50 px-3 py-3">
                            <TaskUpdate task={t} onCancel={() => setEditing(null)} onError={flash}
                              onSaved={() => { setEditing(null); flash('Task updated. The officer can see your update.'); load() }} />
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
        <Pager paged={paged} noun="tasks" />
      </div>

      {toast && <div role="status" className="fixed bottom-6 right-6 z-[70] rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">{toast}</div>}
    </AppShell>
  )
}
