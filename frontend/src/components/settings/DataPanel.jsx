import { useEffect, useState } from 'react'
import { Database, Archive, HardDrive } from 'lucide-react'
import { getDataOverview, runBackup } from '../../api/frappe'

// Data and Database (KRCS 18 Nov 2026): real figures instead of the earlier placeholders. Database size, scheduler, the largest tables and the database backups on the server (an admin can start one now). Backups stay on the
// server; they hold patient data. Data: surveillance.system_admin

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'

function fmt(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T'))
  return isNaN(d) ? v : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function DataPanel({ notify }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function load() {
    getDataOverview().then(setData).catch((e) => setError(e.message || 'Could not load the database figures.'))
  }
  useEffect(load, [])

  async function backup() {
    setBusy(true)
    setError('')
    try {
      await runBackup()
      notify?.('Backup started. It appears in the list in a minute or two.')
    } catch (e) {
      setError(e.message || 'Could not start the backup.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !data) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{error}</div>
  if (!data) return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" aria-busy="true" />

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-100 bg-white p-6">
        <div className="mb-4 flex items-center gap-3">
          <Database className="h-6 w-6 text-gray-900" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-gray-900">Database</h3>
        </div>
        <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-gray-100 py-3">
            <span className="text-sm text-gray-600">Database size</span>
            <span className="text-sm font-semibold text-gray-900">{data.sizeMb == null ? '—' : `${data.sizeMb} MB`}</span>
          </div>
          <div className="flex items-center justify-between border-b border-gray-100 py-3">
            <span className="text-sm text-gray-600">Background jobs (scheduler)</span>
            <span className={`text-sm font-semibold ${data.scheduler === 'On' ? 'text-gray-900' : 'text-red-700'}`}>{data.scheduler}</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Archive className="h-6 w-6 text-gray-900" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-gray-900">Backups</h3>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={load} className={`rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>Refresh</button>
            <button type="button" onClick={backup} disabled={busy} className={`rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 ${FOCUS}`}>
              {busy ? 'Starting…' : 'Back up now'}
            </button>
          </div>
        </div>
        <p className="mb-3 text-sm text-gray-600">Database backups kept on the server (newest first). They hold patient data, so they are not downloaded here.</p>
        {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
        {!data.backups.length ? <p className="py-6 text-center text-sm text-gray-600">No backups on the server yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {data.backups.map((b) => (
              <li key={b.file} className="flex items-center justify-between gap-4 py-3">
                <span className="min-w-0 truncate text-sm text-gray-900">{fmt(b.on)}</span>
                <span className="shrink-0 text-xs text-gray-600">{b.sizeMb} MB</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.largest.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white p-6">
          <div className="mb-4 flex items-center gap-3">
            <HardDrive className="h-6 w-6 text-gray-900" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-gray-900">Largest tables</h3>
          </div>
          <ul className="divide-y divide-gray-100">
            {data.largest.map((t) => (
              <li key={t.table} className="flex items-center justify-between gap-4 py-2.5">
                <span className="text-sm text-gray-900">{t.table}</span>
                <span className="text-xs tabular-nums text-gray-600">{t.mb} MB</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
