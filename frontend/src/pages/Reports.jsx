import { useState, useMemo, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Clock, CheckCircle, Link as LinkIcon, Search, Upload, Plus, Eye } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getList, getCount, exportExcel, getReferenceLabels } from '../api/frappe'
import { formatDateTime, STATUSES } from '../data/formOptions'

const PAGE_SIZE = 6

const STATUS_COLORS = { Submitted: 'bg-amber-50 text-amber-600', Reviewed: 'bg-green-50 text-green-600', Linked: 'bg-red-50 text-red-600', Investigating: 'bg-blue-50 text-blue-600', Closed: 'bg-gray-100 text-gray-500' }
const CHANNEL_COLORS = { Mobile: 'bg-red-50 text-red-600', SMS: 'bg-green-50 text-green-600', USSD: 'bg-amber-50 text-amber-600', WhatsApp: 'bg-gray-100 text-gray-600', Web: 'bg-yellow-50 text-yellow-600' }
const statusColor = (s) => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'
const channelColor = (c) => CHANNEL_COLORS[c] || 'bg-gray-100 text-gray-600'
const symptomTags = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3)

export default function Reports() {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [reports, setReports] = useState([])
  const [counts, setCounts] = useState({ total: 0, submitted: 0, reviewed: 0, linked: 0 })
  const [statusFilter, setStatusFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [regions, setRegions] = useState({})

  const statCards = useMemo(() => [
    { label: 'Total Reports', value: counts.total, icon: FileText },
    { label: 'Pending Approval', value: counts.submitted, icon: Clock },
    { label: 'Reviewed', value: counts.reviewed, icon: CheckCircle },
    { label: 'Linked', value: counts.linked, icon: LinkIcon },
  ], [counts])

  const lastPage = Math.max(0, Math.floor((totalCount - 1) / PAGE_SIZE))
  const paginationLabel = (() => {
    const start = page * PAGE_SIZE + 1
    const end = Math.min(start + PAGE_SIZE - 1, totalCount)
    return `Showing ${start} to ${end} of ${totalCount}`
  })()

  async function loadCounts() {
    const [total, submitted, reviewed, linked] = await Promise.all([
      getCount('Case Report'), getCount('Case Report', { status: 'Submitted' }),
      getCount('Case Report', { status: 'Reviewed' }), getCount('Case Report', { status: 'Linked' }),
    ])
    setCounts({ total, submitted, reviewed, linked })
    setTotalCount(total)
  }

  async function loadReports(p = page) {
    const filters = {}
    if (statusFilter) filters.status = statusFilter
    if (regionFilter) filters.region = regionFilter
    const list = await getList(
      'Case Report',
      ['name', 'reporter_name', 'symptom_tags', 'location_name', 'channel', 'status', 'report_date', 'creation'],
      { limit: PAGE_SIZE, start: p * PAGE_SIZE, orderBy: 'creation desc', filters }
    )
    setReports(list)
  }

  function goToPage(n) {
    const next = Math.max(0, Math.min(n, lastPage))
    setPage(next)
    loadReports(next)
  }

  function handleExport() {
    exportExcel('Case Report', ['name', 'reporter_name', 'symptom_tags', 'location_name', 'channel', 'status', 'report_date'])
  }

  function openView(r) {
    navigate(`/reports/${r.name}`)
  }

  useEffect(() => {
    loadCounts()
    loadReports(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    getReferenceLabels().then((labels) => setRegions(labels.regions || {}))
  }, [])

  useEffect(() => {
    setPage(0)
    loadReports(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, regionFilter])

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Reports Management</h2>
          <p className="text-sm text-gray-400">Generate, import, export, and manage surveillance reports</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExport} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50">
            <Upload className="w-4 h-4" /> Export Report
          </button>
          <Link to="/record-health-signal" className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4" /> Create Report
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {statCards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-400">{c.label}</div>
              <div className="text-2xl font-bold text-gray-900">{c.value}</div>
            </div>
            <div className="bg-gray-100 rounded-full p-2"><c.icon className="w-4 h-4 text-gray-500" /></div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-4 flex gap-3 mb-4 border border-gray-100">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="text" placeholder="Search" className="w-full bg-gray-50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 text-sm text-gray-600">
          <option value="">All Status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 text-sm text-gray-600">
          <option value="">All Locations</option>
          {Object.entries(regions).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 font-semibold text-gray-900 text-sm">Reports List</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs border-t border-b border-gray-100">
                <th className="px-5 py-3 font-medium">Report ID</th>
                <th className="px-5 py-3 font-medium">Reporter</th>
                <th className="px-5 py-3 font-medium">Symptoms</th>
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Channel</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.name} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-5 py-3 text-gray-700">{r.reporter_name}</td>
                  <td className="px-5 py-3">
                    {symptomTags(r.symptom_tags).map((s) => (
                      <span key={s} className="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full mr-1">{s}</span>
                    ))}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{r.location_name}</td>
                  <td className="px-5 py-3"><span className={['text-xs font-medium px-2 py-1 rounded-full', channelColor(r.channel)].join(' ')}>{(r.channel || '').toUpperCase()}</span></td>
                  <td className="px-5 py-3"><span className={['text-xs font-medium px-2 py-1 rounded-full', statusColor(r.status)].join(' ')}>{r.status}</span></td>
                  <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(r.creation)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => openView(r)}
                        title="View report"
                        className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-blue-100 hover:border-blue-200 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!reports.length && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-gray-400">No reports found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={() => goToPage(0)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">First</button>
          <button onClick={() => goToPage(page - 1)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Previous</button>
          <span className="text-xs text-gray-500">{paginationLabel}</span>
          <button onClick={() => goToPage(page + 1)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Next</button>
          <button onClick={() => goToPage(lastPage)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Last</button>
        </div>
      </div>
    </AppShell>
  )
}
