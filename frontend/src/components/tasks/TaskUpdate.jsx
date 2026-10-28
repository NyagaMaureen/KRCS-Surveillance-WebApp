import { useState } from 'react'
import { updateEventTask } from '../../api/frappe'
import { BTN_PRIMARY, BTN_SECONDARY, TEXTAREA, FOCUS } from './taskUi'

const CHOICES = [
  { key: 'In progress', label: 'Started' },
  { key: 'Done', label: 'Done' },
  { key: 'Could not complete', label: "Couldn't complete" },
]

/** Inline form for the person doing the task (or the officer) to record progress. */
export default function TaskUpdate({ task, onSaved, onCancel, onError }) {
  const [status, setStatus] = useState(task.status === 'Assigned' ? 'Done' : task.status)
  const [outcome, setOutcome] = useState(task.outcome || '')
  const [saving, setSaving] = useState(false)
  const needsReason = status === 'Could not complete'

  async function save() {
    setSaving(true)
    try {
      const updated = await updateEventTask(task.id, { status, outcome })
      onSaved?.(updated)
    } catch (e) {
      onError?.(e.message || 'Could not save the update')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3 flex flex-col gap-3">
      <div role="radiogroup" aria-label="Task status" className="flex flex-wrap gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={status === c.key}
            onClick={() => setStatus(c.key)}
            className={`h-8 px-3 rounded-lg border text-sm ${FOCUS} ${status === c.key ? 'border-gray-900 bg-white text-gray-900 font-medium' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        aria-label="What happened"
        placeholder={needsReason ? 'Why could it not be completed? (required)' : 'What happened? (e.g. patient reached the facility, no new cases)'}
        className={TEXTAREA}
      />
      <p className="text-xs text-gray-400">Do not write names or phone numbers.</p>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving || (needsReason && !outcome.trim())} className={BTN_PRIMARY}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={BTN_SECONDARY}>Cancel</button>
      </div>
    </div>
  )
}
