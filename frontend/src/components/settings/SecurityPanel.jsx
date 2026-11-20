import { useEffect, useState } from 'react'
import { Shield, KeyRound, MonitorSmartphone, History, AlertTriangle, LogOut, Pencil } from 'lucide-react'
import { getSecurity, saveSecurity, endSession } from '../../api/frappe'

// Security Settings (KRCS 18 Nov 2026): real settings instead of the earlier placeholders. Password rules, sign-in
// lockout and session length are Frappe's System Settings; people signed in now and recent sign-ins come from the
// server. Every change is kept in the Audit Log. Data: surveillance.system_admin

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const FIELD = `w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 ${FOCUS}`
const STRENGTH = [['2', 'Medium: not easy to guess'], ['3', 'Strong'], ['4', 'Very strong']]
const SESSION_LABEL = { '01:00': '1 hour', '04:00': '4 hours', '08:00': '8 hours', '12:00': '12 hours', '24:00': '1 day', '72:00': '3 days', '170:00': '7 days' }
const EXPIRY = [[0, 'Never'], [30, 'Every 30 days'], [60, 'Every 60 days'], [90, 'Every 90 days'], [180, 'Every 180 days']]
const LOCK_FOR = [[60, '1 minute'], [300, '5 minutes'], [900, '15 minutes'], [3600, '1 hour'], [86400, '1 day']]

function fmt(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T'))
  return isNaN(d) ? v : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Row({ title, text, children }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="mt-0.5 text-sm text-gray-600">{text}</p>
      </div>
      <div className="shrink-0 sm:w-64">{children}</div>
    </div>
  )
}

function Card({ icon: Icon, title, note, action, children }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6">
      <div className="mb-2 flex items-center gap-3">
        <Icon className="h-6 w-6 text-gray-900" aria-hidden="true" />
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {note && <p className="mb-2 text-sm text-gray-600">{note}</p>}
      {children}
    </section>
  )
}

const SHOW = 8

function MoreButton({ total, open, toggle }) {
  if (total <= SHOW) return null
  return (
    <button type="button" onClick={toggle} className={`mt-2 text-sm font-semibold text-red-700 hover:underline ${FOCUS}`}>
      {open ? 'Show fewer' : `Show all ${total}`}
    </button>
  )
}

export default function SecurityPanel({ notify }) {
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [ending, setEnding] = useState('')
  const [allSessions, setAllSessions] = useState(false)
  const [allEvents, setAllEvents] = useState(false)
  // read only until Edit is pressed, so a change is never left unsaved without noticing (KRCS 20 Nov 2026)
  const [editing, setEditing] = useState(false)
  const dirty = !!(data && form && Object.keys(form).some((k) => String(form[k]) !== String(data.settings[k])))
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }   // leaving the page with unsaved changes
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function load() {
    getSecurity().then((d) => { setData(d); setForm(d.settings) }).catch((e) => setError(e.message || 'Could not load the security settings.'))
  }
  useEffect(load, [])

  if (error && !data) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{error}</div>
  if (!data || !form) return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" aria-busy="true" />

  const changed = dirty
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const label = (list, v, other) => (list.find(([x]) => String(x) === String(v)) || [null, other])[1]
  const shown = {   // what each setting reads as when not editing
    enable_password_policy: form.enable_password_policy ? 'On: weak passwords are rejected' : 'Off',
    minimum_password_score: label(STRENGTH, form.minimum_password_score, form.minimum_password_score),
    force_user_to_reset_password: label(EXPIRY, Number(form.force_user_to_reset_password), `Every ${form.force_user_to_reset_password} days`),
    allow_consecutive_login_attempts: `${form.allow_consecutive_login_attempts} wrong passwords`,
    allow_login_after_fail: label(LOCK_FOR, Number(form.allow_login_after_fail), `${form.allow_login_after_fail} seconds`),
    session_expiry: SESSION_LABEL[form.session_expiry] || `${form.session_expiry} (hours:minutes)`,
    logout_on_password_reset: form.logout_on_password_reset ? 'Yes' : 'No',
  }
  const view = (k) => <p className="text-sm font-semibold text-gray-900 sm:text-right">{shown[k]}</p>
  function cancel() {
    setForm(data.settings)
    setEditing(false)
    setError('')
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const d = await saveSecurity(form)
      setData(d)
      setForm(d.settings)
      setEditing(false)
      notify?.('Security settings saved')
    } catch (e) {
      setError(e.message || 'Could not save the security settings.')
    } finally {
      setSaving(false)
    }
  }

  async function end(s) {
    if (!window.confirm(`Sign out ${s.name}? They will need to sign in again.`)) return
    setEnding(s.id)
    try {
      await endSession(s.id)
      notify?.(`${s.name} was signed out`)
      load()
    } catch (e) {
      setError(e.message || 'Could not end the session.')
    } finally {
      setEnding('')
    }
  }

  return (
    <div className="space-y-6">
      <Card icon={KeyRound} title="Passwords and sign-in" action={!editing && (
        <button type="button" onClick={() => setEditing(true)}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
          <Pencil className="h-4 w-4" aria-hidden="true" />Edit
        </button>
      )}>
        {editing && (
          <p className={`mb-1 text-sm font-semibold ${changed ? 'text-amber-700' : 'text-gray-700'}`}>
            {changed ? 'You have unsaved changes. Press Save changes to keep them.' : 'Editing. Change what you need, then press Save changes.'}
          </p>
        )}
        {!editing ? (
          <div className="divide-y divide-gray-100">
            <Row title="Password rules" text="Reject weak passwords when someone sets or changes one">{view('enable_password_policy')}</Row>
            {!!form.enable_password_policy && <Row title="Minimum strength" text="Stronger needs longer passwords with a mix of letters, numbers and symbols">{view('minimum_password_score')}</Row>}
            <Row title="Password expiry" text="Ask people to choose a new password after this long">{view('force_user_to_reset_password')}</Row>
            <Row title="Wrong password limit" text="After this many wrong passwords in a row the account is locked for a while">{view('allow_consecutive_login_attempts')}</Row>
            <Row title="Locked for" text="How long a locked account waits before it can try again">{view('allow_login_after_fail')}</Row>
            <Row title="Session length" text="People are signed out after this long without using the system">{view('session_expiry')}</Row>
            <Row title="Sign out everywhere after a password reset" text="When a password is reset, end that person's other sessions">{view('logout_on_password_reset')}</Row>
          </div>
        ) : (
        <div className="divide-y divide-gray-100">
          <Row title="Password rules" text="Reject weak passwords when someone sets or changes one">
            <label className="inline-flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={!!form.enable_password_policy} onChange={(e) => set('enable_password_policy', e.target.checked ? 1 : 0)}
                className="h-4 w-4 rounded border-gray-300 accent-red-600" />
              Check password strength
            </label>
          </Row>
          {!!form.enable_password_policy && (
            <Row title="Minimum strength" text="Stronger needs longer passwords with a mix of letters, numbers and symbols">
              <select aria-label="Minimum strength" value={form.minimum_password_score} onChange={(e) => set('minimum_password_score', e.target.value)} className={FIELD}>
                {STRENGTH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>
          )}
          <Row title="Password expiry" text="Ask people to choose a new password after this long">
            <select aria-label="Password expiry" value={form.force_user_to_reset_password} onChange={(e) => set('force_user_to_reset_password', Number(e.target.value))} className={FIELD}>
              {EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              {!EXPIRY.some(([v]) => v === Number(form.force_user_to_reset_password)) && <option value={form.force_user_to_reset_password}>Every {form.force_user_to_reset_password} days</option>}
            </select>
          </Row>
          <Row title="Wrong password limit" text="After this many wrong passwords in a row the account is locked for a while">
            <input type="number" min={1} max={20} aria-label="Wrong password limit" value={form.allow_consecutive_login_attempts}
              onChange={(e) => set('allow_consecutive_login_attempts', Number(e.target.value))} className={FIELD} />
          </Row>
          <Row title="Locked for" text="How long a locked account waits before it can try again">
            <select aria-label="Locked for" value={form.allow_login_after_fail} onChange={(e) => set('allow_login_after_fail', Number(e.target.value))} className={FIELD}>
              {LOCK_FOR.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              {!LOCK_FOR.some(([v]) => v === Number(form.allow_login_after_fail)) && <option value={form.allow_login_after_fail}>{form.allow_login_after_fail} seconds</option>}
            </select>
          </Row>
          <Row title="Session length" text="People are signed out after this long without using the system">
            <select aria-label="Session length" value={form.session_expiry} onChange={(e) => set('session_expiry', e.target.value)} className={FIELD}>
              {data.sessionOptions.map((v) => <option key={v} value={v}>{SESSION_LABEL[v] || v}</option>)}
              {!data.sessionOptions.includes(form.session_expiry) && <option value={form.session_expiry}>{form.session_expiry} (hours:minutes)</option>}
            </select>
          </Row>
          <Row title="Sign out everywhere after a password reset" text="When a password is reset, end that person's other sessions">
            <label className="inline-flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" checked={!!form.logout_on_password_reset} onChange={(e) => set('logout_on_password_reset', e.target.checked ? 1 : 0)}
                className="h-4 w-4 rounded border-gray-300 accent-red-600" />
              Sign out other sessions
            </label>
          </Row>
        </div>
        )}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        {editing && (
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={save} disabled={!changed || saving}
              className={`rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 ${FOCUS}`}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={cancel} disabled={saving} className={`rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-900 ${FOCUS}`}>Cancel</button>
          </div>
        )}
      </Card>

      <Card icon={MonitorSmartphone} title="Open sessions" note={`${data.sessions.length} session${data.sessions.length === 1 ? '' : 's'} that have not expired yet, newest first. Sign someone out if a phone or computer is lost or shared.`}>
        {!data.sessions.length ? <p className="py-6 text-center text-sm text-gray-600">Nobody is signed in.</p> : (
          <ul className="divide-y divide-gray-100">
            {(allSessions ? data.sessions : data.sessions.slice(0, SHOW)).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{s.name}{s.current && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">You, here</span>}</p>
                  <p className="truncate text-xs text-gray-600">{s.user} · {s.device}{s.ip ? ` · IP ${s.ip}` : ''} · last active {fmt(s.last)}</p>
                </div>
                {!s.current && (
                  <button type="button" onClick={() => end(s)} disabled={ending === s.id}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 ${FOCUS}`}>
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />{ending === s.id ? 'Signing out…' : 'Sign out'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <MoreButton total={data.sessions.length} open={allSessions} toggle={() => setAllSessions((v) => !v)} />
      </Card>

      <Card icon={History} title="Recent sign-ins" note={`${data.failedThisWeek} failed sign-in${data.failedThisWeek === 1 ? '' : 's'} in the last 7 days.`}>
        {!data.events.length ? <p className="py-6 text-center text-sm text-gray-600">No sign-ins recorded yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {(allEvents ? data.events : data.events.slice(0, SHOW)).map((e, i) => {
              const failed = e.status !== 'Success'
              return (
                <li key={i} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${failed ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                      {failed ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <Shield className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{failed ? 'Failed sign-in' : e.operation === 'Logout' ? 'Signed out' : 'Signed in'}</p>
                      <p className="truncate text-xs text-gray-600">{e.name}{e.ip ? ` · IP ${e.ip}` : ''}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-gray-600">{fmt(e.on)}</span>
                </li>
              )
            })}
          </ul>
        )}
        <MoreButton total={data.events.length} open={allEvents} toggle={() => setAllEvents((v) => !v)} />
      </Card>
    </div>
  )
}
