import { useState, useMemo, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Clock, Search as SearchIcon, CheckCircle, Search, Upload, Plus, Eye, Camera } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { useCapabilities } from '../context/CapabilitiesContext'
import { getList, getCount, exportSignals, getReferenceLabels, getDiseaseOptions, getDoc, getSubCounties, getUnitOptions, getMyArea } from '../api/frappe'
import { STATUSES, CHANNELS } from '../data/formOptions'

const PAGE_SIZES = [10, 25, 50]

const STATUS_COLORS = { Submitted: 'bg-amber-50 text-amber-700', Linked: 'bg-amber-50 text-amber-700', Verified: 'bg-emerald-50 text-emerald-700', Reviewed: 'bg-gray-100 text-gray-700', Investigating: 'bg-blue-50 text-blue-700', Confirmed: 'bg-sky-50 text-sky-800', Escalated: 'bg-red-50 text-red-700', Closed: 'bg-gray-100 text-gray-700', Recorded: 'bg-gray-100 text-gray-700' }
// a report shows its event's status (KRCS 20 Nov 2026): Submitted reads New
const STATUS_LABEL = { Submitted: 'New', Reviewed: 'Recorded', 'Not for review': 'Recorded', Linked: 'New', Investigating: 'In the field' }
const statusLabel = (s) => STATUS_LABEL[s] || s   // stored values stay as they are; this is what people see
const CHANNEL_COLORS = { Mobile: 'bg-red-50 text-red-700', SMS: 'bg-green-50 text-green-600', USSD: 'bg-amber-50 text-amber-600', WhatsApp: 'bg-gray-100 text-gray-600', Web: 'bg-yellow-50 text-yellow-600' }
const statusColor = (s) => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'
const channelColor = (c) => CHANNEL_COLORS[c] || 'bg-gray-100 text-gray-600'
const EXPOSURE_TAGS = { 'Bite or scratch': 'Animal bite or scratch', 'Handled sick or dead animal': 'Handled sick or dead animal' }
const timeText = (v) => {
  const d = new Date(String(v || '').replace(' ', 'T'))
  return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { timeStyle: 'short' })
}
const EXPORT_FIELDS = [
  'name', 'creation', 'report_date', 'status', 'channel', 'signal_type', 'category',
  'reporter_name', 'phone_number', 'reported_by',
  'region', 'sub_county', 'community_health_unit', 'location_name', 'latitude', 'longitude',
  'onset_date', 'affected_count', 'deaths_count', 'age_group', 'animal_exposure',
  'symptom_tags', 'severity', 'additional_notes',
  'suspected_disease', 'classified_by', 'classification_reason', 'also_consistent_with',
  'review_outcome', 'reviewed_by', 'reviewed_on',
]
const dateText = (v) => {
  const d = new Date(String(v || '').replace(' ', 'T'))
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { dateStyle: 'medium' })
}
const symptomTags = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3)

export default function Reports() {
  const navigate = useNavigate()
  const { has, workspace } = useCapabilities()
  const isChp = workspace === 'chp'          // CHPs only ever receive their own reports (enforced on the server)
  const canExport = has('export_reports')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [channelFilter, setChannelFilter] = useState('')
  const [subCountyFilter, setSubCountyFilter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [units, setUnits] = useState({ units: [], options: [] })   // Community Health Units: names and the filter list
  const unitName = (id) => (units.units.find((u) => u.id === id) || {}).name || id || ''
  const [reporterText, setReporterText] = useState('')
  const [reporterFilter, setReporterFilter] = useState('')
  const [subCounties, setSubCounties] = useState([])
  const [area, setArea] = useState({ locked: false, subCounties: [], regions: [] })   // officers, FHWs, CHAs: their places only
  const mySubs = area.locked ? subCounties.filter((sc) => area.subCounties.some((x) => x.id === sc.name)) : subCounties
  // "Turkana West · Kalobeyei" on the first line, the block / village the reporter typed below it
  const subCountyName = (id) => (subCounties.find((sc) => sc.name === id) || {}).sub_county_name || String(id || '').replace(/^[^-]+-/, '')
  const placeLine = (r) => [subCountyName(r.sub_county), regions[r.region] || ''].filter(Boolean).join(' · ')
  const [totalCount, setTotalCount] = useState(0)
  const [reports, setReports] = useState([])
  const [counts, setCounts] = useState({ total: 0, pending: 0, investigating: 0, closed: 0 })
  const [statusFilter, setStatusFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [diseaseFilter, setDiseaseFilter] = useState('')
  const [regions, setRegions] = useState({})
  const [diseaseOptions, setDiseaseOptions] = useState([])
  const [search, setSearch] = useState('')
  const [mediaByReport, setMediaByReport] = useState({})

  const diseaseMap = useMemo(() => Object.fromEntries(diseaseOptions.map((d) => [d.key, d.name])), [diseaseOptions])
  const diseaseName = (key) => (key ? diseaseMap[key] || key : 'Unclassified illness')   // same wording as alerts and the reporter's screen
  // KRCS 17 Nov 2026: the disease shows once an officer chose it in AI triage; clear-cut common illnesses show the case
  // definition's disease; reports still in the Review Queue say "Being reviewed". Only for those who can see the disease.
  const canSeeDisease = isChp || has('verify_suspected_disease') || has('see_suspected_disease')
  const diseaseShown = (r) => {
    if (r.classified_by === 'Officer' && r.suspected_disease) return { text: diseaseName(r.suspected_disease) }
    if (r.status === 'Recorded' && r.suspected_disease) return { text: diseaseName(r.suspected_disease), note: 'by case definition' }
    if (r.status === 'Closed') return { text: 'Not confirmed', muted: true }
    return { text: 'Being reviewed', muted: true }
  }
  const DiseaseCell = ({ r }) => {
    const d = diseaseShown(r)
    return <span className={d.muted ? 'text-gray-400' : ''}>{d.text}{d.note && <span className="block text-xs text-gray-400">{d.note}</span>}</span>
  }

  const visibleReports = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return reports
    return reports.filter((r) => [r.reporter_name, r.location_name, r.symptom_tags, canSeeDisease ? diseaseShown(r).text : '']
      .some((v) => (v || '').toLowerCase().includes(q)))
  }, [reports, search, diseaseMap])

  const statCards = useMemo(() => [
    { label: 'Total Signals Captured', value: counts.total, icon: FileText },
    { label: 'Awaiting Review', value: counts.pending, icon: Clock },
    { label: 'Investigating', value: counts.investigating, icon: SearchIcon },
    { label: 'Closed', value: counts.closed, icon: CheckCircle },
  ], [counts])

  const lastPage = Math.max(0, Math.ceil(totalCount / pageSize) - 1)
  const paginationLabel = totalCount === 0 ? 'No signals' : `Showing ${page * pageSize + 1} to ${Math.min((page + 1) * pageSize, totalCount)} of ${totalCount}`
  const pageNumbers = (() => {
    const from = Math.max(0, Math.min(page - 2, lastPage - 4))
    const to = Math.min(lastPage, from + 4)
    return Array.from({ length: to - from + 1 }, (_, i) => from + i)
  })()

  async function loadCounts() {
    // report status follows its event: Submitted until an officer starts verifying, Investigating, then Closed
    const [total, pending, investigating, closed] = await Promise.all([
      getCount('Case Report'), getCount('Case Report', { status: 'Submitted' }),
      getCount('Case Report', { status: 'Investigating' }), getCount('Case Report', { status: 'Closed' }),
    ])
    setCounts({ total, pending, investigating, closed })
  }

  async function loadReports(p = page) {
    const filters = {}
    if (statusFilter) filters.status = statusFilter
    if (regionFilter) filters.region = regionFilter
    if (diseaseFilter) filters.suspected_disease = diseaseFilter
    if (channelFilter) filters.channel = channelFilter
    if (subCountyFilter) filters.sub_county = subCountyFilter
    if (unitFilter) filters.community_health_unit = unitFilter
    if (reporterFilter) filters.reporter_name = ['like', `%${reporterFilter}%`]
    getCount('Case Report', filters).then(setTotalCount)
    const list = await getList(
      'Case Report',
      ['name', 'reporter_name', 'symptom_tags', 'location_name', 'sub_county', 'region', 'channel', 'status', 'report_date', 'creation', 'age_group', 'animal_exposure', 'deaths_count', 'suspected_disease', 'classified_by', 'classification_reason', 'also_consistent_with', 'community_health_unit'],
      { limit: pageSize, start: p * pageSize, orderBy: 'creation desc', filters }
    )
    setReports(list)
    Promise.all(list.map((r) => getDoc('Case Report', r.name).then((doc) => {
      const types = (doc.attachments || []).map((a) => a.attachment_type)
      return [r.name, { photo: types.includes('Photo'), voice: types.includes('Voice Note') }]
    }).catch(() => [r.name, {}]))).then((pairs) => setMediaByReport((prev) => ({ ...prev, ...Object.fromEntries(pairs) })))
  }

  function goToPage(n) {
    const next = Math.max(0, Math.min(n, lastPage))
    setPage(next)
    loadReports(next)
  }

  function handleExport() {
    // everything on the report, for the reports matching the filters on screen
    const filters = []
    if (statusFilter) filters.push(['Case Report', 'status', '=', statusFilter])
    if (regionFilter) filters.push(['Case Report', 'region', '=', regionFilter])
    if (diseaseFilter) filters.push(['Case Report', 'suspected_disease', '=', diseaseFilter])
    if (channelFilter) filters.push(['Case Report', 'channel', '=', channelFilter])
    if (subCountyFilter) filters.push(['Case Report', 'sub_county', '=', subCountyFilter])
    if (unitFilter) filters.push(['Case Report', 'community_health_unit', '=', unitFilter])
    if (reporterFilter) filters.push(['Case Report', 'reporter_name', 'like', `%${reporterFilter}%`])
    const shown = [
      { label: 'Status', value: statusFilter }, { label: 'Region', value: regionFilter ? regions[regionFilter] || regionFilter : '' },
      { label: 'Disease', value: diseaseFilter ? diseaseName(diseaseFilter) : '' }, { label: 'Channel', value: channelFilter },
      { label: 'Sub-county', value: subCountyFilter ? subCountyName(subCountyFilter) : '' },
      { label: 'Health unit', value: unitFilter ? unitName(unitFilter) : '' }, { label: 'Reporter', value: reporterFilter },
    ]
    exportSignals(EXPORT_FIELDS, filters, shown).catch((e) => window.alert(e.message || 'Export failed'))
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
    getDiseaseOptions().then(setDiseaseOptions)
    getSubCounties('').then(setSubCounties).catch(() => {})
    getMyArea().then(setArea).catch(() => {})
    getUnitOptions().then(setUnits).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setReporterFilter(reporterText.trim()), 400)
    return () => clearTimeout(t)
  }, [reporterText])

  useEffect(() => {
    setPage(0)
    loadReports(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, regionFilter, diseaseFilter, channelFilter, subCountyFilter, unitFilter, reporterFilter, pageSize])

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-brand-navy">{isChp ? 'My Signals Captured' : 'Signals Captured'}</h2>
          <p className="text-sm text-gray-400">{isChp ? 'Everything you have reported. Tell us what you see in your community; you can finish a report even without network.' : 'Every signal captured from the field: review, filter and export'}</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {canExport && (
            <button onClick={handleExport} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50">
              <Upload className="w-4 h-4" /> Export
            </button>
          )}
          <Link to="/record-health-signal" className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4" /> Create Report
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {statCards.map((c) => (
          <div key={c.label} className="relative bg-red-600 rounded-xl p-4 text-center">
            <div className="px-6">
              <div className="text-xs font-semibold text-white">{c.label}</div>
              <div className="text-2xl font-bold text-white">{c.value}</div>
            </div>
            <div className="absolute right-3 top-3 bg-white/20 rounded-full p-1.5"><c.icon className="w-3.5 h-3.5 text-white" /></div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-3 sm:p-4 flex flex-wrap gap-3 mb-4 border border-gray-100">
        <div className="relative flex-1 min-w-[200px] basis-full sm:basis-auto">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search" className="w-full bg-gray-50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 min-w-0 max-w-full">
          <option value="">All Status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <select value={diseaseFilter} onChange={(e) => setDiseaseFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 min-w-0 max-w-full">
          <option value="">All Suspected Diseases</option>
          {diseaseOptions.filter((d) => d.active).map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
        </select>
        <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 min-w-0 max-w-full">
          <option value="">All Locations</option>
          {Object.entries(regions).filter(([id]) => !area.locked || area.regions.includes(id)).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label="Channel" className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 min-w-0 max-w-full">
          <option value="">All Channels</option>
          {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={subCountyFilter} onChange={(e) => setSubCountyFilter(e.target.value)} aria-label="Sub-county" className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 min-w-0 max-w-full">
          <option value="">{area.locked ? (mySubs.length > 1 ? 'All my sub-counties' : mySubs[0]?.sub_county_name || 'My sub-county') : 'All Sub-counties'}</option>
          {(area.locked && mySubs.length <= 1 ? [] : mySubs).map((sc) => <option key={sc.name} value={sc.name}>{sc.sub_county_name || sc.name}</option>)}
        </select>
        {!isChp && units.options.length > 0 && (
          <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} aria-label="Health unit" className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 min-w-0 max-w-full">
            <option value="">All Health Units</option>
            {units.units.filter((u) => units.options.includes(u.id) && (!subCountyFilter || u.subCounty === subCountyFilter)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {!isChp && (
          <input value={reporterText} onChange={(e) => setReporterText(e.target.value)} type="text" aria-label="Reporter" placeholder="Reporter name"
            className="w-full sm:w-40 bg-gray-50 rounded-lg px-3 py-2 text-sm focus:outline-none" />
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 font-semibold text-gray-900 text-sm">{isChp ? 'My Signals' : 'Signals List'}</div>
        <div className="lg:hidden divide-y divide-gray-100 border-t border-gray-100">
          {reports.map((r, i) => (
            <button key={r.name} onClick={() => openView(r)} className="w-full text-left px-4 py-3 hover:bg-gray-50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
                  <span className="text-gray-400 font-normal tabular-nums">{page * pageSize + i + 1}.</span> {r.name}
                  {mediaByReport[r.name]?.photo && <Camera className="w-3.5 h-3.5 text-gray-400" aria-label="Has photo" />}
                </span>
                <span className={['text-xs font-medium px-2 py-1 rounded-full shrink-0', statusColor(r.status)].join(' ')}>{statusLabel(r.status)}</span>
              </div>
              {canSeeDisease && <div className="mt-1 text-sm text-gray-700"><DiseaseCell r={r} /></div>}
              <div className="mt-0.5 text-xs text-gray-500">{[placeLine(r), r.location_name].filter(Boolean).join(' · ') || '—'}</div>
              {r.community_health_unit && <div className="mt-0.5 text-xs text-gray-500">Health unit: {unitName(r.community_health_unit)}</div>}
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <span className={['text-xs font-medium px-2 py-0.5 rounded-full', channelColor(r.channel)].join(' ')}>{(r.channel || '').toUpperCase()}</span>
                {!isChp && r.reporter_name && <span className="text-xs text-gray-500">{r.reporter_name}</span>}
                <span className="text-xs text-gray-400">{[dateText(r.creation), timeText(r.creation)].filter(Boolean).join(' · ')}</span>
              </div>
            </button>
          ))}
          {!reports.length && <p className="px-5 py-10 text-center text-sm text-gray-400">No signals found</p>}
        </div>
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm border-collapse [&_th]:border [&_td]:border [&_th]:border-gray-200 [&_td]:border-gray-200">
            <thead>
              <tr className="text-left text-gray-900 text-xs [&_th]:font-bold [&_th]:border-b-2 [&_th]:border-b-red-600">
                <th className="px-5 py-3 font-medium w-10">#</th>
                <th className="px-5 py-3 font-medium">Report ID</th>
                {!isChp && <th className="px-5 py-3 font-medium">Reporter</th>}
                <th className="px-5 py-3 font-medium">Symptoms</th>
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Health Unit</th>
                {canSeeDisease && <th className="px-5 py-3 font-medium">Suspected Disease</th>}
                <th className="px-5 py-3 font-medium">Channel</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium text-right sticky right-0 bg-white">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r, i) => (
                <tr key={r.name} className="hover:bg-red-50/40">
                  <td className="px-5 py-3 text-gray-400 tabular-nums">{page * pageSize + i + 1}</td>
                  <td className="px-5 py-3 font-medium text-gray-900">
                    <span className="inline-flex items-center gap-1.5">
                      {r.name}
                      {mediaByReport[r.name]?.photo && <Camera className="w-3.5 h-3.5 text-gray-400" aria-label="Has photo" />}
                    </span>
                  </td>
                  {!isChp && <td className="px-5 py-3 text-gray-700">{r.reporter_name}</td>}
                  <td className="px-5 py-3">
                    {symptomTags(r.symptom_tags).map((s) => (
                      <span key={s} className="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full mr-1">{s}</span>
                    ))}
                    {EXPOSURE_TAGS[r.animal_exposure] && (
                      <span className="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full mr-1">{EXPOSURE_TAGS[r.animal_exposure]}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-700">
                    <span className="block">{placeLine(r) || r.location_name || '—'}</span>
                    {placeLine(r) && r.location_name && <span className="block text-xs text-gray-400">{r.location_name}</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{r.community_health_unit ? unitName(r.community_health_unit) : <span className="text-gray-400">—</span>}</td>
                  {canSeeDisease && <td className="px-5 py-3 text-gray-700"><DiseaseCell r={r} /></td>}
                  <td className="px-5 py-3"><span className={['text-xs font-medium px-2 py-1 rounded-full', channelColor(r.channel)].join(' ')}>{(r.channel || '').toUpperCase()}</span></td>
                  <td className="px-5 py-3"><span className={['text-xs font-medium px-2 py-1 rounded-full', statusColor(r.status)].join(' ')}>{statusLabel(r.status)}</span></td>
                  <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                    {dateText(r.creation) || '—'}
                    {timeText(r.creation) && <span className="block text-xs text-gray-400">{timeText(r.creation)}</span>}
                  </td>
                  <td className="px-5 py-3 sticky right-0 bg-white">
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
                  <td colSpan={11} className="px-5 py-10 text-center text-gray-400">No signals found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <button onClick={() => goToPage(0)} disabled={page === 0} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 disabled:text-gray-300">First</button>
            <button onClick={() => goToPage(page - 1)} disabled={page === 0} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 disabled:text-gray-300">Previous</button>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <span className="text-xs text-gray-500">{paginationLabel}</span>
            <div className="flex items-center gap-1">
              {pageNumbers.map((n) => (
                <button key={n} onClick={() => goToPage(n)} aria-current={n === page ? 'page' : undefined}
                  className={['min-w-[2rem] rounded-lg px-2 py-1.5 text-xs', n === page ? 'bg-red-600 text-white font-semibold' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'].join(' ')}>{n + 1}</button>
              ))}
            </div>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page" className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => goToPage(page + 1)} disabled={page >= lastPage} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 disabled:text-gray-300">Next</button>
            <button onClick={() => goToPage(lastPage)} disabled={page >= lastPage} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600 disabled:text-gray-300">Last</button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
