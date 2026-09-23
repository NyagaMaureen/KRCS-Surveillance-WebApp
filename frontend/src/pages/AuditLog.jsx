import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, Download, MoreHorizontal, Eye, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getAuditLogs, exportCsv } from '../api/frappe'

const PAGE_SIZE = 7

const CATEGORY_COLORS = {
  Auth: 'bg-[#DB2424]/10 text-[#DB2424]',
  Alert: 'bg-[#F2C94C]/10 text-[#F2C94C]',
  Report: 'bg-[#27AE60]/10 text-[#27AE60]',
  Case: 'bg-[#1447E6]/10 text-[#1447E6]',
  Config: 'bg-gray-100 text-gray-500',
  User: 'bg-gray-50 text-gray-900',
  AI: 'bg-[#DB2424]/10 text-[#DB2424]',
}
const categoryColor = (c) => CATEGORY_COLORS[c] || 'bg-gray-100 text-gray-600'

const DATE_RANGE_MS = { today: 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 }

function formatTimestamp(v) {
  return new Date(v).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'medium' })
}

function useClickOutside(ref, handler) {
  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) handler()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [ref, handler])
}

export default function AuditLog() {
  const [logs, setLogs] = useState([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [dateRange, setDateRange] = useState('all')
  const [page, setPage] = useState(0)
  const [openMenu, setOpenMenu] = useState(null)
  const [detailsLog, setDetailsLog] = useState(null)
  const menuRef = useRef(null)

  useClickOutside(menuRef, () => setOpenMenu(null))

  useEffect(() => {
    getAuditLogs({ limit: 500 }).then(setLogs)
  }, [])

  const categories = useMemo(() => [...new Set(logs.map((l) => l.category))].sort(), [logs])
  const roles = useMemo(() => [...new Set(logs.map((l) => l.role))].sort(), [logs])
  const users = useMemo(() => [...new Set(logs.map((l) => l.user))].sort(), [logs])

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase()
    const cutoff = DATE_RANGE_MS[dateRange] ? Date.now() - DATE_RANGE_MS[dateRange] : null

    return logs.filter((l) => {
      if (q) {
        const haystack = `${l.action} ${l.user} ${l.role} ${l.details} ${l.category}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (categoryFilter && l.category !== categoryFilter) return false
      if (roleFilter && l.role !== roleFilter) return false
      if (userFilter && l.user !== userFilter) return false
      if (cutoff && new Date(l.timestamp).getTime() < cutoff) return false
      return true
    })
  }, [logs, search, categoryFilter, roleFilter, userFilter, dateRange])

  const lastPage = Math.max(0, Math.ceil(filteredLogs.length / PAGE_SIZE) - 1)
  const pagedLogs = filteredLogs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const paginationLabel = (() => {
    if (!filteredLogs.length) return 'Showing 0 of 0'
    const start = page * PAGE_SIZE + 1
    const end = Math.min(start + PAGE_SIZE - 1, filteredLogs.length)
    return `Showing ${start} to ${end} of ${filteredLogs.length}`
  })()

  function toggleMenu(name) {
    setOpenMenu((prev) => (prev === name ? null : name))
  }

  function viewDetails(log) {
    setDetailsLog(log)
    setOpenMenu(null)
  }

  function handleExport() {
    exportCsv('audit-log.csv', filteredLogs, [
      { label: 'Timestamp', value: (r) => formatTimestamp(r.timestamp) },
      { label: 'Category', value: (r) => r.category },
      { label: 'Action', value: (r) => r.action },
      { label: 'User', value: (r) => r.user },
      { label: 'Role', value: (r) => r.role },
      { label: 'Details', value: (r) => r.details },
    ])
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Audit Log</h2>
          <p className="text-sm text-gray-400">Access activity, User Logs, Alert Created, Data Export and System Backup</p>
        </div>
        <div className="flex gap-3">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 bg-white focus:outline-none"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
          <button onClick={handleExport} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search"
            className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100"
          />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border border-gray-100 bg-gray-50 rounded-lg px-3.5 py-2.5 text-sm text-gray-700 min-w-[170px]">
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="border border-gray-100 bg-gray-50 rounded-lg px-3.5 py-2.5 text-sm text-gray-700 min-w-[170px]">
          <option value="">All Roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="border border-gray-100 bg-gray-50 rounded-lg px-3.5 py-2.5 text-sm text-gray-700 min-w-[170px]">
          <option value="">All Users</option>
          {users.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-900 text-xs font-medium bg-gray-50 border-b border-gray-100">
              <th className="px-5 py-3.5 font-medium">Timestamp</th>
              <th className="px-5 py-3.5 font-medium">Category</th>
              <th className="px-5 py-3.5 font-medium">Action</th>
              <th className="px-5 py-3.5 font-medium">User</th>
              <th className="px-5 py-3.5 font-medium">Role</th>
              <th className="px-5 py-3.5 font-medium">Details</th>
              <th className="px-5 py-3.5 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {pagedLogs.map((log) => (
              <tr key={log.name} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-4 text-gray-500 whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
                <td className="px-5 py-4">
                  <span className={['inline-block text-xs font-medium px-4 py-1.5 rounded-full', categoryColor(log.category)].join(' ')}>{log.category}</span>
                </td>
                <td className="px-5 py-4 font-medium text-gray-900 whitespace-nowrap">{log.action}</td>
                <td className="px-5 py-4 text-gray-900 whitespace-nowrap">{log.user}</td>
                <td className="px-5 py-4 text-gray-500 whitespace-nowrap">{log.role}</td>
                <td className="px-5 py-4 text-gray-500 max-w-xs">{log.details}</td>
                <td className="px-5 py-4 text-right relative">
                  <button onClick={() => toggleMenu(log.name)} className="text-gray-400 hover:text-gray-700">
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                  {openMenu === log.name && (
                    <div ref={menuRef} className="absolute right-5 top-10 z-10 bg-white border border-gray-100 rounded-lg shadow-lg py-1 w-40">
                      <button onClick={() => viewDetails(log)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                        <Eye className="w-3.5 h-3.5" /> View Details
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!pagedLogs.length && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-gray-400">No audit log entries match your filters</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 flex-wrap gap-3">
          <div className="flex gap-2">
            <button onClick={() => setPage(0)} disabled={page === 0} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">First</button>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Previous</button>
          </div>
          <span className="text-sm text-gray-500">{paginationLabel}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Next</button>
            <button onClick={() => setPage(lastPage)} disabled={page >= lastPage} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Last</button>
          </div>
        </div>
      </div>

      {detailsLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setDetailsLog(null) }}>
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Log Details</h3>
              <button onClick={() => setDetailsLog(null)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-gray-400">Entry ID</dt><dd className="text-gray-900 font-medium">{detailsLog.name}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-400">Timestamp</dt><dd className="text-gray-900 font-medium">{formatTimestamp(detailsLog.timestamp)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-400">Category</dt><dd><span className={['text-xs font-medium px-3 py-1 rounded-full', categoryColor(detailsLog.category)].join(' ')}>{detailsLog.category}</span></dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-400">Action</dt><dd className="text-gray-900 font-medium">{detailsLog.action}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-400">User</dt><dd className="text-gray-900 font-medium">{detailsLog.user}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-400">Role</dt><dd className="text-gray-900 font-medium">{detailsLog.role}</dd></div>
              <div><dt className="text-gray-400 mb-1">Details</dt><dd className="text-gray-700">{detailsLog.details}</dd></div>
            </dl>
          </div>
        </div>
      )}
    </AppShell>
  )
}
