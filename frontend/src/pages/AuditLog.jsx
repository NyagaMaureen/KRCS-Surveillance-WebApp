import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Download, X, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppShell from '../components/layout/AppShell'
import Pager from '../components/common/Pager'
import usePaged from '../components/common/usePaged'
import { getAuditLogs, exportCsv } from '../api/frappe'

// The whole system's audit trail (SRS R57, Audit Framework V2.0, AUD-01 / AUD-08): records created, changed and deleted,
// every action on Review Queue events, AI outputs and their review, reports, and (when ticked) sign-ins and sign-outs.
// Plain grid table, black text (Elizabeth). Data: surveillance/audit_log.py.

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const TH = 'border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-bold text-gray-900'
const TD = 'border border-gray-200 px-3 py-2.5 align-top text-sm text-gray-900'
const SEL = `h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 ${FOCUS}`
const LOGINS_KEY = 'krcs.audit.showLogins'
const RANGES = [
  { key: 'all', label: 'All time', days: null },
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
]

function readPref() {
  try { return localStorage.getItem(LOGINS_KEY) === '1' } catch { return false }
}
function writePref(on) {
  try { localStorage.setItem(LOGINS_KEY, on ? '1' : '0') } catch { /* private window: not remembered */ }
}

function fmtTime(v) {
  const d = new Date(String(v).replace(' ', 'T'))
  return isNaN(d) ? String(v) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
const blank = (v) => (v === null || v === undefined || v === '' ? '—' : v)
const changesText = (c) => (c || []).map((x) => `${x.field}: ${blank(x.from)} → ${blank(x.to)}`).join('; ')
const recordText = (r) => (r || []).map((x) => `${x.label}: ${blank(x.value)}`).join('; ')

export default function AuditLog() {
  const [logs, setLogs] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [role, setRole] = useState('')
  const [user, setUser] = useState('')
  const [range, setRange] = useState('30d')
  const [showLogins, setShowLogins] = useState(readPref)
  const [open, setOpen] = useState(null)

  const days = RANGES.find((r) => r.key === range)?.days
  const load = useCallback(() => {
    setLoading(true)
    getAuditLogs({ limit: 3000, days, includeLogins: showLogins })
      .then((r) => { setLogs(r); setError('') })
      .catch((e) => setError(e.message || 'The audit log could not be loaded.'))
      .finally(() => setLoading(false))
  }, [days, showLogins])
  useEffect(() => { load() }, [load])

  const all = useMemo(() => logs || [], [logs])
  const categories = useMemo(() => [...new Set(all.map((l) => l.category))].sort(), [all])
  const roles = useMemo(() => [...new Set(all.map((l) => l.role))].sort(), [all])
  const users = useMemo(() => [...new Map(all.map((l) => [l.user, l.userName || l.user])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter((l) => {
      if (category && l.category !== category) return false
      if (role && l.role !== role) return false
      if (user && l.user !== user) return false
      if (q) {
        const text = `${l.action} ${l.user} ${l.userName} ${l.role} ${l.details} ${l.category} ${changesText(l.changes)} ${recordText(l.record)}`.toLowerCase()
        if (!text.includes(q)) return false
      }
      return true
    })
  }, [all, search, category, role, user])
  const paged = usePaged(filtered, 25, `${search}|${category}|${role}|${user}|${range}|${showLogins}`)

  function toggleLogins(on) {
    setShowLogins(on)
    writePref(on)
    if (!on && category === 'Auth') setCategory('')
  }

  function handleExport() {
    const filters = [
      { label: 'Period', value: RANGES.find((r) => r.key === range)?.label }, { label: 'Search', value: search.trim() },
      { label: 'Category', value: category === 'Auth' ? 'Sign-ins' : category }, { label: 'Role', value: role },
      { label: 'User', value: user ? users.find(([id]) => id === user)?.[1] || user : '' },
      { label: 'Sign-ins and sign-outs', value: showLogins ? 'Shown' : 'Hidden' },
    ]
    exportCsv('audit-log.csv', filtered, [
      { label: 'Time', value: (r) => fmtTime(r.timestamp) },
      { label: 'Category', value: (r) => r.category },
      { label: 'Action', value: (r) => r.action },
      { label: 'Outcome', value: (r) => r.outcome || '' },
      { label: 'User', value: (r) => r.userName || r.user },
      { label: 'User ID', value: (r) => r.user },
      { label: 'Role', value: (r) => r.role },
      { label: 'Details', value: (r) => r.details },
      { label: 'Changes', value: (r) => changesText(r.changes) },
      { label: 'AI record', value: (r) => recordText(r.record) },
    ], { page: '/audit-log', title: 'Audit Log', filters }).then(load).catch((e) => setError(e.message || 'Export failed'))
  }

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-brand-navy">Audit Log</h2>
          <p className="mt-0.5 text-sm text-gray-900">
            Who did what and when: records created, changed and deleted, every step on Review Queue events, AI outputs and
            their review, reports viewed and exported, and sign-ins.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} disabled={loading} className={`inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
          <button type="button" onClick={handleExport} disabled={!filtered.length} className={`inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 ${FOCUS}`}>
            <Download className="h-4 w-4" aria-hidden="true" /> Export
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} type="search" placeholder="Search actions, people, events, details"
            aria-label="Search the audit log" className={`h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 ${FOCUS}`} />
        </div>
        <select aria-label="Period" value={range} onChange={(e) => setRange(e.target.value)} className={SEL}>
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={SEL}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c === 'Auth' ? 'Sign-ins' : c}</option>)}
        </select>
        <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} className={SEL}>
          <option value="">All roles</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select aria-label="User" value={user} onChange={(e) => setUser(e.target.value)} className={`${SEL} max-w-[14rem]`}>
          <option value="">All users</option>
          {users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900">
          <input type="checkbox" checked={showLogins} onChange={(e) => toggleLogins(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Show sign-ins and sign-outs
        </label>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white">
        {error ? (
          <p className="p-6 text-sm text-red-700">{error} <button type="button" onClick={load} className="font-semibold underline">Try again</button></p>
        ) : logs === null ? (
          <p className="p-6 text-sm text-gray-700">Loading…</p>
        ) : (
          <>
            <div className="overflow-x-auto p-4">
              <table className="w-full min-w-[960px] border-collapse border border-gray-200">
                <thead>
                  <tr>
                    <th className={`${TH} w-44`}>Time</th>
                    <th className={`${TH} w-32`}>Category</th>
                    <th className={`${TH} w-52`}>Action</th>
                    <th className={`${TH} w-48`}>User</th>
                    <th className={TH}>Details</th>
                    <th className={`${TH} w-24`}></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.shown.map((l) => (
                    <tr key={l.name}>
                      <td className={`${TD} whitespace-nowrap`}>{fmtTime(l.timestamp)}</td>
                      <td className={TD}>{l.category === 'Auth' ? 'Sign-in' : l.category}</td>
                      <td className={`${TD} font-semibold ${l.outcome === 'Failed' ? 'text-red-700' : ''}`}>{l.action}</td>
                      <td className={TD}>{l.userName || l.user}<div className="text-xs text-gray-700">{l.role}</div></td>
                      <td className={`${TD} break-words`}>
                        {l.details}
                        {l.link && <> · <Link to={l.link} className={`rounded font-semibold text-red-700 underline-offset-2 hover:underline ${FOCUS}`}>Open</Link></>}
                      </td>
                      <td className={TD}>
                        {(l.changes?.length || l.record?.length) ? (
                          <button type="button" onClick={() => setOpen(l)} className={`rounded text-sm font-semibold text-gray-900 underline underline-offset-2 ${FOCUS}`}>
                            {l.record?.length ? 'Full record' : 'Changes'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!paged.shown.length && (
                    <tr><td colSpan={6} className={`${TD} py-10 text-center`}>No audit log entries match your filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager paged={paged} noun="entries" />
          </>
        )}
      </div>

      {open && <Details log={open} onClose={() => setOpen(null)} />}
    </AppShell>
  )
}

function Details({ log, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const rows = [
    ['Time', fmtTime(log.timestamp)], ['Category', log.category === 'Auth' ? 'Sign-in' : log.category], ['Action', log.action],
    ['User', `${log.userName || log.user}${log.user && log.userName !== log.user ? ` (${log.user})` : ''}`], ['Role', log.role],
    ['Details', log.details], ['Entry ID', log.name],
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Audit log entry"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">{log.action}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className={`rounded text-gray-700 hover:text-gray-900 ${FOCUS}`}><X className="h-5 w-5" /></button>
        </div>
        <table className="w-full border-collapse border border-gray-200">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><th scope="row" className={`${TD} w-48 text-left font-bold`}>{k}</th><td className={`${TD} whitespace-pre-wrap break-words`}>{blank(v)}</td></tr>
            ))}
          </tbody>
        </table>
        {log.link && <p className="mt-2 text-sm"><Link to={log.link} className="font-semibold text-red-700 hover:underline">Open the record</Link></p>}

        {log.record?.length > 0 && (
          <>
            <h4 className="mb-2 mt-5 text-sm font-bold text-gray-900">{log.category === 'Export' ? 'What was exported' : 'AI output and review'}</h4>
            <table className="w-full border-collapse border border-gray-200">
              <tbody>
                {log.record.map((r) => (
                  <tr key={r.label}><th scope="row" className={`${TD} w-48 text-left font-bold`}>{r.label}</th><td className={`${TD} whitespace-pre-wrap break-words`}>{blank(r.value)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {log.changes?.length > 0 && (
          <>
            <h4 className="mb-2 mt-5 text-sm font-bold text-gray-900">Changes</h4>
            <table className="w-full border-collapse border border-gray-200">
              <thead><tr><th className={TH}>Field</th><th className={TH}>From</th><th className={TH}>To</th></tr></thead>
              <tbody>
                {log.changes.map((c, i) => (
                  <tr key={i}>
                    <td className={`${TD} font-bold`}>{blank(c.field)}</td>
                    <td className={`${TD} whitespace-pre-wrap break-words`}>{blank(c.from)}</td>
                    <td className={`${TD} whitespace-pre-wrap break-words`}>{blank(c.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
