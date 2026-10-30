import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, User, MapPin, Clock, Link2, X, ClipboardList, PlayCircle, Ban, CheckCheck } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getResponseActions, getEventsForResponse, createResponseAction, getTaskAssignees, updateEventTask } from '../api/frappe'
import { dueText, isOpen, todayISO } from '../components/tasks/taskUi'
import { FOCUS, CARD, INPUT, TEXTAREA, BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, Badge, Toast, Skeleton } from '../components/chp/ui'

const TONE = { Planned: 'gray', 'In progress': 'softAmber', Blocked: 'red', Completed: 'softGreen', 'Not completed': 'gray' }
const STATS = [
  { key: 'planned', label: 'Planned', status: 'Assigned', icon: ClipboardList },
  { key: 'inProgress', label: 'In progress', status: 'In progress', icon: PlayCircle },
  { key: 'blocked', label: 'Blocked', status: 'Blocked', icon: Ban },
  { key: 'completed', label: 'Completed', status: 'Done', icon: CheckCheck },
]

export default function Response() {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [adding, setAdding] = useState(false)
  const [updating, setUpdating] = useState(null)
  const [toast, setToast] = useState({ text: '' })

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])
  const load = useCallback(() => getResponseActions(status, q).then(setData).catch((e) => flash(e.message, true)), [status, q])
  useEffect(() => { load() }, [load])
  function flash(text, error = false) { setToast({ text, error }); setTimeout(() => setToast({ text: '' }), 3000) }

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h2 className="text-xl font-bold text-brand-navy">Response Coordination</h2>
          <p className="text-sm text-gray-400">Coordinate response actions, teams, deadlines and progress for confirmed and escalated events</p>
        </div>
        {data?.canCreate && (
          <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}><Plus className="w-4 h-4" aria-hidden="true" /> New response action</button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {STATS.map((s) => (
          <button key={s.key} type="button" aria-pressed={status === s.status} onClick={() => setStatus(status === s.status ? '' : s.status)}
            className={`bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between text-left hover:border-gray-200 ${status === s.status ? 'ring-1 ring-gray-300' : ''} ${FOCUS}`}>
            <span>
              <span className="block text-xs font-medium text-gray-400">{s.label}</span>
              <span className={`block text-2xl font-semibold ${s.key === 'blocked' && data?.counts?.blocked ? 'text-red-600' : 'text-gray-900'}`}>{data?.counts?.[s.key] ?? '–'}</span>
            </span>
            <span className="bg-gray-100 rounded-full p-3"><s.icon className="w-5 h-5 text-gray-500" aria-hidden="true" /></span>
          </button>
        ))}
      </div>

      <div className={`${CARD} p-3 mb-5`}>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search response actions"
            placeholder="Search by action, team, place or event" className={`${INPUT} pl-9 bg-gray-50 border-gray-100`} />
        </div>
      </div>

      {!data ? <Skeleton /> : !data.actions.length ? (
        <div className={`${CARD} p-12 text-center`}>
          <p className="text-sm font-medium text-gray-900">No response actions{status ? ' with this status' : ' yet'}</p>
          <p className="text-sm text-gray-500 mt-1">Plan actions like water chlorination, health education or referral support for confirmed or escalated events.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.actions.map((a) => {
            const due = dueText(a)
            return (
              <article key={a.id} className={`${CARD} p-5 flex flex-col`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900">{a.title}</h3>
                    <p className="text-xs text-gray-400">{a.id}</p>
                  </div>
                  <Badge tone={TONE[a.statusLabel]}>{a.statusLabel}</Badge>
                </div>
                <ul className="mt-3 flex flex-col gap-1.5 text-sm text-gray-600">
                  <li className="flex items-center gap-2"><User className="w-4 h-4 text-gray-400" aria-hidden="true" />{a.assignedToName}{a.team ? ` · ${a.team}` : ''}</li>
                  <li className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" aria-hidden="true" />{[a.area, a.subCounty].filter(Boolean).join(', ') || '—'}</li>
                  <li className="flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400" aria-hidden="true" /><span className={due.tone}>{due.text}</span></li>
                  {a.event && <li className="flex items-center gap-2"><Link2 className="w-4 h-4 text-gray-400" aria-hidden="true" />
                    <Link to={`/alerts-signals/${a.event}`} className={`hover:underline rounded ${FOCUS}`}>{a.event}{a.disease ? ` · ${a.disease}` : ''}</Link></li>}
                </ul>
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Progress</span><span className="font-medium text-gray-900">{a.progress}%</span></div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-sky-500 rounded-full" style={{ width: `${a.progress}%` }} /></div>
                </div>
                {a.outcome && <p className="text-xs text-gray-500 mt-2">{a.outcome}</p>}
                {isOpen(a) && (updating === a.id ? (
                  <ActionUpdate action={a} onCancel={() => setUpdating(null)} onError={(m) => flash(m, true)}
                    onSaved={() => { setUpdating(null); flash('Action updated'); load() }} />
                ) : (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                    <button type="button" onClick={() => setUpdating(a.id)} className={BTN_SMALL}>Update progress</button>
                  </div>
                ))}
              </article>
            )
          })}
        </div>
      )}

      {adding && <NewAction onClose={() => setAdding(false)} onError={(m) => flash(m, true)}
        onSaved={() => { setAdding(false); flash('Response action planned. The person was notified.'); load() }} />}
      <Toast text={toast.text} error={toast.error} />
    </AppShell>
  )
}

const UPDATE_STATUSES = [
  { value: 'In progress', label: 'In progress' },
  { value: 'Blocked', label: 'Blocked' },
  { value: 'Done', label: 'Completed' },
]

function ActionUpdate({ action, onCancel, onSaved, onError }) {
  const [status, setStatus] = useState(action.status === 'Assigned' ? 'In progress' : action.status)
  const [progress, setProgress] = useState(action.progress || 0)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      await updateEventTask(action.id, { status, outcome: note || undefined, progress: status === 'Done' ? 100 : progress })
      onSaved()
    } catch (e) {
      onError(e.message || 'Could not update')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-3">
      <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-2">
        {UPDATE_STATUSES.map((s) => (
          <button key={s.value} type="button" role="radio" aria-checked={status === s.value} onClick={() => setStatus(s.value)}
            className={`h-8 px-3 rounded-lg border text-xs ${FOCUS} ${status === s.value ? 'border-gray-900 text-gray-900 font-medium' : 'border-gray-200 text-gray-600'}`}>{s.label}</button>
        ))}
      </div>
      {status !== 'Done' && (
        <label className="text-xs text-gray-600">Progress: <span className="font-medium text-gray-900">{progress}%</span>
          <input type="range" min="0" max="100" step="5" value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-sky-500" />
        </label>
      )}
      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={TEXTAREA}
        placeholder={status === 'Blocked' ? 'What is blocking it? (required)' : 'Short update (optional)'} />
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving || (status === 'Blocked' && !note.trim())} className={`${BTN_PRIMARY} h-9`}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} className={`${BTN_SECONDARY} h-9`}>Cancel</button>
      </div>
    </div>
  )
}

function NewAction({ onClose, onSaved, onError }) {
  const [events, setEvents] = useState(null)
  const [people, setPeople] = useState(null)
  const [form, setForm] = useState({ event: '', title: '', assignedTo: '', team: '', dueDate: todayISO(3), instructions: '' })
  const [saving, setSaving] = useState(false)
  const set = (p) => setForm((f) => ({ ...f, ...p }))
  useEffect(() => { getEventsForResponse().then(setEvents).catch(() => setEvents([])) }, [])
  useEffect(() => {
    if (!form.event) { setPeople(null); return }
    setPeople(undefined)
    getTaskAssignees(form.event).then(setPeople).catch(() => setPeople([]))
  }, [form.event])
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  async function save() {
    setSaving(true)
    try {
      await createResponseAction(form)
      onSaved()
    } catch (e) {
      onError(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }
  const ready = form.event && form.title.trim() && form.assignedTo && form.dueDate

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="New response action" onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New response action</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`text-gray-400 hover:text-gray-700 rounded ${FOCUS}`}><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">Event</span>
            <select value={form.event} onChange={(e) => set({ event: e.target.value, assignedTo: '' })} className={INPUT}>
              <option value="">{events === null ? 'Loading…' : events.length ? 'Choose an event' : 'No events in investigation or response'}</option>
              {(events || []).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">Action</span>
            <input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Chlorinate water point B4" className={INPUT} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-gray-800 mb-1">Owner</span>
              <select value={form.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })} disabled={!form.event} className={INPUT}>
                <option value="">{!form.event ? 'Choose the event first' : people === undefined ? 'Loading…' : 'Choose a person'}</option>
                {(people || []).map((p) => <option key={p.user} value={p.user}>{p.name}{p.role ? ` (${p.role})` : ''}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-800 mb-1">Team <span className="font-normal text-gray-400">(optional)</span></span>
              <input value={form.team} onChange={(e) => set({ team: e.target.value })} placeholder="e.g. WASH team" className={INPUT} />
            </label>
          </div>
          <label className="block sm:max-w-[200px]">
            <span className="block text-sm font-medium text-gray-800 mb-1">Due</span>
            <input type="date" min={todayISO()} value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={INPUT} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">Details <span className="font-normal text-gray-400">(optional)</span></span>
            <textarea rows={2} value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} className={TEXTAREA} />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
            <button type="button" onClick={save} disabled={!ready || saving} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Plan and notify'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
