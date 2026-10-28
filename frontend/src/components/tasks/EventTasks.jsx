import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Plus, X, CalendarClock, UserRound, Building2, Trash2 } from 'lucide-react'
import { getEventTasks, getTaskAssignees, createEventTask, createFollowups, deleteEventTask } from '../../api/frappe'
import TaskUpdate from './TaskUpdate'
import {
  FOCUS, INPUT, TEXTAREA, BTN_PRIMARY, BTN_SECONDARY, LINK_BTN, TASK_TYPES,
  TaskStatusPill, dueText, isOpen, todayISO,
} from './taskUi'

const TaskContext = createContext(null)
export const useEventTasks = () => useContext(TaskContext)

/**
 * Wrap the event page with this. It loads the event's tasks once and lets any step
 * (StepTaskLink) or the Tasks panel open the assign dialog.
 */
export function EventTasksProvider({ eventId, eventStatus, onChanged, onToast, children }) {
  const [data, setData] = useState({ tasks: [], canAssign: false, followupDays: [7, 14, 21] })
  const [assignees, setAssignees] = useState(null)
  const [dialog, setDialog] = useState(null)        // prefill for AssignDialog
  const [followupOpen, setFollowupOpen] = useState(false)

  const reload = useCallback(() => {
    return getEventTasks(eventId).then((d) => d && setData(d)).catch(() => {})
  }, [eventId])

  useEffect(() => { reload() }, [reload, eventStatus])

  const loadAssignees = useCallback(() => {
    if (assignees) return Promise.resolve(assignees)
    return getTaskAssignees(eventId).then((a) => { setAssignees(a || []); return a || [] }).catch(() => { setAssignees([]); return [] })
  }, [eventId, assignees])

  const changed = useCallback((res, message) => {
    if (res?.tasks) setData(res)
    else reload()
    onChanged?.()
    if (message) onToast?.(message)
  }, [reload, onChanged, onToast])

  const value = useMemo(() => ({
    ...data,
    eventId,
    eventStatus,
    openAssign: (prefill = {}) => { loadAssignees(); setDialog(prefill) },
    openFollowups: () => { loadAssignees(); setFollowupOpen(true) },
    reload,
    changed,
    toast: onToast,
  }), [data, eventId, eventStatus, loadAssignees, reload, changed, onToast])

  return (
    <TaskContext.Provider value={value}>
      {children}
      {dialog && (
        <AssignDialog
          eventId={eventId}
          prefill={dialog}
          assignees={assignees}
          onClose={() => setDialog(null)}
          onSaved={(res, msg) => { setDialog(null); changed(res, msg) }}
          onError={(m) => onToast?.(m, true)}
        />
      )}
      {followupOpen && (
        <FollowupDialog
          eventId={eventId}
          days={data.followupDays}
          assignees={assignees}
          onClose={() => setFollowupOpen(false)}
          onSaved={(res, msg) => { setFollowupOpen(false); changed(res, msg) }}
          onError={(m) => onToast?.(m, true)}
        />
      )}
    </TaskContext.Provider>
  )
}

/** The open task handed over for a protocol step, if any. */
export function useStepTask(phase, n) {
  const ctx = useContext(TaskContext)
  if (!ctx || !phase) return null
  return ctx.tasks.find((t) => t.stepPhase === phase && t.stepNo === n && isOpen(t)) || null
}

/** Open tasks that will carry on after the event closes. */
export function OpenTasksNotice() {
  const ctx = useContext(TaskContext)
  const open = (ctx?.tasks || []).filter(isOpen)
  if (!open.length) return null
  return (
    <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
      <p>
        <span className="font-medium">{open.length} task{open.length === 1 ? ' is' : 's are'} still with field workers.</span>{' '}
        You can close now; {open.length === 1 ? 'it carries' : 'they carry'} on and stay in their My Tasks.
      </p>
      <ul className="mt-1.5 text-xs text-gray-500 space-y-0.5">
        {open.map((t) => <li key={t.id}>{t.title} · {t.assignedToName} · {dueText(t).text.toLowerCase()}</li>)}
      </ul>
    </div>
  )
}

/** Small "Assign" link (or the assigned task) shown on a protocol step. */
export function StepTaskLink({ phase, step }) {
  const ctx = useEventTasks()
  if (!ctx) return null
  const linked = ctx.tasks.filter((t) => t.stepPhase === phase && t.stepNo === step.n)
  if (linked.length) {
    return (
      <p className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
        {linked.map((t) => {
          const due = dueText(t)
          return (
            <span key={t.id} className="inline-flex items-center gap-1.5">
              <UserRound className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
              {t.assignedToName} · <span className={due.tone}>{isOpen(t) ? due.text : t.status}</span>
            </span>
          )
        })}
      </p>
    )
  }
  if (!ctx.canAssign || !step.assignable) return null
  const guessType = /sample|specimen/i.test(step.step) ? 'Sample collection' : /refer/i.test(step.step) ? 'Referral' : /follow|observe|monitor/i.test(step.step) ? 'Follow-up' : 'Field visit'
  return (
    <button
      type="button"
      onClick={() => ctx.openAssign({ type: guessType, title: step.step, stepPhase: phase, stepNo: step.n })}
      className={`self-start text-xs font-medium text-gray-500 hover:text-red-600 inline-flex items-center gap-1 rounded ${FOCUS}`}
    >
      <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Assign someone to this step
    </button>
  )
}

/** The Tasks card on the event page. */
export function EventTasksPanel() {
  const ctx = useEventTasks()
  const [editing, setEditing] = useState(null)
  const [showDone, setShowDone] = useState(false)
  if (!ctx) return null
  const { tasks, canAssign, eventStatus } = ctx
  const open = tasks.filter(isOpen)
  const done = tasks.filter((t) => !isOpen(t))
  const hasFollowups = tasks.some((t) => t.type === 'Follow-up')
  const closed = eventStatus === 'Closed'

  async function remove(t) {
    try {
      const res = await deleteEventTask(t.id)
      ctx.changed(res, 'Task removed')
    } catch (e) {
      ctx.toast?.(e.message || 'Could not remove the task', true)
    }
  }

  if (!tasks.length && !canAssign) return null

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-7">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Tasks</h2>
          <p className="text-sm text-gray-500 mt-0.5">Field visits, referrals, sample collection and follow-ups assigned to people for this event.</p>
        </div>
        {canAssign && (
          <button type="button" onClick={() => ctx.openAssign({})} className={BTN_SECONDARY}>
            <Plus className="w-4 h-4" aria-hidden="true" /> Assign task
          </button>
        )}
      </div>

      {closed && canAssign && !hasFollowups && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-700">
            <span className="font-medium">Follow-up after closing.</span> Check on the patient and look for new cases for 7 to 21 days.
          </p>
          <button type="button" onClick={ctx.openFollowups} className={BTN_PRIMARY}>
            <CalendarClock className="w-4 h-4" aria-hidden="true" /> Schedule follow-ups
          </button>
        </div>
      )}

      {!tasks.length ? (
        <p className="text-sm text-gray-400 mt-4">No tasks yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {open.map((t) => (
            <TaskItem key={t.id} task={t} canAssign={canAssign} editing={editing === t.id}
              onEdit={() => setEditing(editing === t.id ? null : t.id)}
              onSaved={() => { setEditing(null); ctx.changed(null, 'Task updated') }}
              onRemove={() => remove(t)} onError={(m) => ctx.toast?.(m, true)} />
          ))}
          {done.length > 0 && (
            <li className="py-3">
              <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className={`text-sm text-gray-500 hover:text-gray-900 rounded ${FOCUS}`}>
                {showDone ? 'Hide' : 'Show'} {done.length} finished task{done.length === 1 ? '' : 's'}
              </button>
            </li>
          )}
          {showDone && done.map((t) => <TaskItem key={t.id} task={t} canAssign={false} />)}
        </ul>
      )}
    </section>
  )
}

function TaskItem({ task: t, canAssign, editing, onEdit, onSaved, onRemove, onError }) {
  const due = dueText(t)
  const canUpdate = isOpen(t) && (t.mine || canAssign)
  return (
    <li className="py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${isOpen(t) ? 'text-gray-900' : 'text-gray-500'}`}>{t.title}</p>
          <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{t.type}</span>
            <span className="text-gray-300">·</span>
            <span>{t.assignedToName}</span>
            <span className="text-gray-300">·</span>
            <span className={due.tone}>{due.text}</span>
            {t.stepNo && <><span className="text-gray-300">·</span><span>{t.stepPhase} step {t.stepNo}</span></>}
          </p>
          {t.facility && (
            <p className="text-xs text-gray-500 mt-1 inline-flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" /> {t.facility}{t.urgency ? ` · ${t.urgency}` : ''}
            </p>
          )}
          {t.instructions && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{t.instructions}</p>}
          {t.outcome && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap"><span className="text-gray-400">Outcome: </span>{t.outcome}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <TaskStatusPill status={t.status} />
          {canUpdate && (
            <button type="button" onClick={onEdit} className={LINK_BTN}>{editing ? 'Close' : 'Update'}</button>
          )}
          {canAssign && t.status === 'Assigned' && (
            <button type="button" onClick={onRemove} aria-label={`Remove task ${t.title}`} title="Remove task" className={`text-gray-300 hover:text-gray-600 rounded ${FOCUS}`}>
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {editing && <TaskUpdate task={t} onSaved={onSaved} onCancel={onEdit} onError={onError} />}
    </li>
  )
}

// ---------- dialogs ----------

function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`text-gray-400 hover:text-gray-700 rounded ${FOCUS}`}><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function Label({ children, htmlFor, hint }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-800 mb-1">
      {children}
      {hint && <span className="block text-xs font-normal text-gray-400">{hint}</span>}
    </label>
  )
}

function AssigneeSelect({ id, assignees, value, onChange }) {
  const groups = useMemo(() => {
    const g = {}
    ;(assignees || []).forEach((a) => { (g[a.group] = g[a.group] || []).push(a) })
    return Object.entries(g)
  }, [assignees])
  if (assignees === null) return <div className={`${INPUT} flex items-center text-gray-400`}>Loading people…</div>
  if (!assignees.length) return <p className="text-sm text-amber-700">No users are linked to this sub-county or region yet. Assign a sub-county to users in User Management.</p>
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      <option value="">Choose a person</option>
      {groups.map(([group, people]) => (
        <optgroup key={group} label={group}>
          {people.map((p) => <option key={p.user} value={p.user}>{p.name}{p.role ? ` (${p.role})` : ''}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

function AssignDialog({ eventId, prefill, assignees, onClose, onSaved, onError }) {
  const startType = prefill.type || 'Field visit'
  const [type, setType] = useState(startType)
  const [title, setTitle] = useState(prefill.title || TASK_TYPES.find((t) => t.key === startType)?.defaultTitle || '')
  const [titleTouched, setTitleTouched] = useState(!!prefill.title)
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState(todayISO(startType === 'Referral' ? 0 : 1))
  const [instructions, setInstructions] = useState('')
  const [facility, setFacility] = useState('')
  const [urgency, setUrgency] = useState('Routine')
  const [saving, setSaving] = useState(false)

  // pre-select the CHP who reported the signal (not for sample collection: CHPs don't collect samples)
  useEffect(() => {
    if (assignedTo || !assignees?.length || type === 'Sample collection') return
    const reporter = assignees.find((a) => a.group === 'Reported this signal')
    if (reporter) setAssignedTo(reporter.user)
  }, [assignees, type, assignedTo])

  function pickType(k) {
    setType(k)
    if (!titleTouched) setTitle(TASK_TYPES.find((t) => t.key === k)?.defaultTitle || '')
    if (k === 'Referral') setDueDate(todayISO(0))
    if (k === 'Sample collection') {
      const a = assignees?.find((x) => x.user === assignedTo)
      if (a?.group === 'Reported this signal') setAssignedTo('')
    }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await createEventTask(eventId, {
        type, title, assignedTo, dueDate, instructions,
        facility: type === 'Referral' ? facility : '',
        urgency: type === 'Referral' ? urgency : '',
        stepPhase: prefill.stepPhase, stepNo: prefill.stepNo,
      })
      const who = assignees?.find((a) => a.user === assignedTo)?.name || 'them'
      onSaved(res, `Task assigned. ${who} has been notified.`)
    } catch (e) {
      onError(e.message || 'Could not assign the task')
    } finally {
      setSaving(false)
    }
  }

  const ready = title.trim() && assignedTo && dueDate && (type !== 'Referral' || facility.trim())
  const typeInfo = TASK_TYPES.find((t) => t.key === type)

  return (
    <Dialog title={prefill.stepNo ? `Assign step ${prefill.stepNo}` : 'Assign a task'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <Label>Type</Label>
          <div role="radiogroup" aria-label="Task type" className="flex flex-wrap gap-2">
            {TASK_TYPES.map((t) => (
              <button key={t.key} type="button" role="radio" aria-checked={type === t.key} onClick={() => pickType(t.key)}
                className={`h-8 px-3 rounded-lg border text-sm ${FOCUS} ${type === t.key ? 'border-gray-900 text-gray-900 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {t.key}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">{typeInfo?.hint}</p>
          {type === 'Sample collection' && (
            <p className="text-xs text-amber-700 mt-1">CHPs don't collect samples. Assign a surveillance officer or health worker, or give the CHP a Referral instead.</p>
          )}
        </div>

        <div>
          <Label htmlFor="task-title">What needs to be done</Label>
          <input id="task-title" value={title} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }} className={INPUT} />
        </div>

        {type === 'Referral' && (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
            <div>
              <Label htmlFor="task-facility">Refer to facility</Label>
              <input id="task-facility" value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="e.g. Hagadera Hospital" className={INPUT} />
            </div>
            <div>
              <Label htmlFor="task-urgency">Urgency</Label>
              <select id="task-urgency" value={urgency} onChange={(e) => setUrgency(e.target.value)} className={INPUT}>
                <option>Routine</option><option>Urgent</option><option>Emergency</option>
              </select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
          <div>
            <Label htmlFor="task-assignee">Assign to</Label>
            <AssigneeSelect id="task-assignee" assignees={assignees} value={assignedTo} onChange={setAssignedTo} />
          </div>
          <div>
            <Label htmlFor="task-due">Due</Label>
            <input id="task-due" type="date" min={todayISO()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={INPUT} />
          </div>
        </div>

        <div>
          <Label htmlFor="task-notes" hint="Optional. Do not write patient names or phone numbers.">Instructions</Label>
          <textarea id="task-notes" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} className={TEXTAREA} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button type="button" onClick={save} disabled={!ready || saving} className={BTN_PRIMARY}>{saving ? 'Assigning…' : 'Assign and notify'}</button>
        </div>
      </div>
    </Dialog>
  )
}

function FollowupDialog({ eventId, days: defaultDays, assignees, onClose, onSaved, onError }) {
  const [days, setDays] = useState(defaultDays || [7, 14, 21])
  const [assignedTo, setAssignedTo] = useState('')
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (assignedTo || !assignees?.length) return
    const reporter = assignees.find((a) => a.group === 'Reported this signal')
    if (reporter) setAssignedTo(reporter.user)
  }, [assignees, assignedTo])

  const toggle = (d) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)))

  async function save() {
    setSaving(true)
    try {
      const res = await createFollowups(eventId, assignedTo, days, instructions)
      onSaved(res, `${days.length} follow-up${days.length === 1 ? '' : 's'} scheduled`)
    } catch (e) {
      onError(e.message || 'Could not schedule follow-ups')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title="Schedule follow-ups" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">One check-in on each chosen day after today: check on the patient and look for new cases.</p>
        <div>
          <Label>Check-in days</Label>
          <div className="flex flex-wrap gap-2">
            {[3, 7, 14, 21].map((d) => (
              <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle(d)}
                className={`h-8 px-3 rounded-lg border text-sm ${FOCUS} ${days.includes(d) ? 'border-gray-900 text-gray-900 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Day {d}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="fu-assignee">Assign to</Label>
          <AssigneeSelect id="fu-assignee" assignees={assignees} value={assignedTo} onChange={setAssignedTo} />
        </div>
        <div>
          <Label htmlFor="fu-notes" hint="Optional. Do not write patient names or phone numbers.">Instructions</Label>
          <textarea id="fu-notes" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} className={TEXTAREA} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button type="button" onClick={save} disabled={!assignedTo || !days.length || saving} className={BTN_PRIMARY}>
            {saving ? 'Scheduling…' : 'Schedule and notify'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
