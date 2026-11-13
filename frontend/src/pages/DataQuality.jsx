import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPinOff, AlertTriangle, Clock, HelpCircle, Copy, Building2, Check, RotateCcw } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getDataQuality, dismissDataIssue } from '../api/frappe'
import { FOCUS, Toast, Skeleton } from '../components/chp/ui'

// Data Quality: problems in reports from every source (Mobile, WhatsApp, Web, CBS, MOH 505), filtered by source,
// issue type and period. Data: surveillance.officer.get_data_quality.

const KIND_ICON = { location: MapPinOff, warning: AlertTriangle, late: Clock, unclassified: HelpCircle, duplicate: Copy, completeness: Building2 }
const KIND_HELP = {
  location: 'Reports without a sub-county or GPS point cannot be mapped or counted in the right place.',
  warning: 'Numbers far above normal for one report. Confirm with the reporter.',
  late: 'Sent more than 24 hours after symptoms started.',
  unclassified: 'No disease matched the symptoms. Review and set the suspected disease.',
  duplicate: 'Same reporter, place and symptoms within 24 hours.',
  completeness: 'Facilities that missed MOH 505 weeks in the last 4 weeks.',
}
const SOURCES = ['Mobile', 'WhatsApp', 'Web', 'CBS', 'MOH 505', 'EMR']
const SELECT = `h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 ${FOCUS}`
const PAGE_SIZES = [10, 25, 50]

function shortDate(d) {
  if (!d) return '—'
  const x = new Date(String(d).replace(' ', 'T'))
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DataQuality() {
  const [days, setDays] = useState(30)
  const [kind, setKind] = useState('')
  const [source, setSource] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [data, setData] = useState(null)
  const [toast, setToast] = useState({ text: '' })

  const load = useCallback(() => getDataQuality(days).then(setData).catch((e) => setToast({ text: e.message, error: true })), [days])
  useEffect(() => { setData(null); load() }, [load])
  useEffect(() => setPage(0), [kind, source, days, pageSize])

  async function dismiss(issue) {
    try {
      await dismissDataIssue(issue.key)
      setData((d) => ({ ...d, issues: d.issues.filter((i) => i.key !== issue.key) }))
      setToast({ text: 'Marked as checked' })
      setTimeout(() => setToast({ text: '' }), 2000)
    } catch (e) {
      setToast({ text: e.message || 'Could not update', error: true })
    }
  }

  // the cards count the chosen source; the list also follows the chosen issue type
  const fromSource = useMemo(() => (data?.issues || []).filter((i) => !source || i.source === source), [data, source])
  const counts = useMemo(() => fromSource.reduce((c, i) => ({ ...c, [i.kind]: (c[i.kind] || 0) + 1 }), {}), [fromSource])
  const issues = useMemo(() => fromSource.filter((i) => !kind || i.kind === kind), [fromSource, kind])
  const kinds = data?.kinds || {}
  const filtersOn = !!(kind || source || days !== 30)
  const lastPage = Math.max(0, Math.ceil(issues.length / pageSize) - 1)
  const shown = issues.slice(page * pageSize, (page + 1) * pageSize)
  const goTo = (n) => setPage(Math.max(0, Math.min(n, lastPage)))
  const pageNumbers = (() => {
    const from = Math.max(0, Math.min(page - 2, lastPage - 4))
    return Array.from({ length: Math.min(lastPage, from + 4) - from + 1 }, (_, i) => from + i)
  })()
  const PAGER = `rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-900 disabled:text-gray-300 ${FOCUS}`

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-brand-navy">Data Quality</h2>
        <p className="text-sm text-gray-500">Problems in the data from every source: missing places, late or duplicate reports, unmatched diseases and facilities not reporting.</p>
      </div>

      {/* filters, side by side */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 sm:p-4">
        <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className={SELECT}>
          <option value="">All sources</option>
          {(data?.sources || SOURCES).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Issue type" value={kind} onChange={(e) => setKind(e.target.value)} className={SELECT}>
          <option value="">All issue types</option>
          {Object.entries(kinds).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className={SELECT}>
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
        {filtersOn && (
          <button type="button" onClick={() => { setKind(''); setSource(''); setDays(30) }}
            className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50 ${FOCUS}`}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Clear filters
          </button>
        )}
      </div>

      {/* one card per issue type; click to filter */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Object.entries(kinds).map(([k, label]) => {
          const Icon = KIND_ICON[k] || HelpCircle
          const n = counts[k] || 0
          const on = kind === k
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setKind(on ? '' : k)} title={KIND_HELP[k]}
              className={`rounded-xl border p-4 text-left transition-colors ${on ? 'border-red-600 bg-red-600 text-white' : 'border-gray-100 bg-white hover:border-red-200'} ${FOCUS}`}>
              <div className="flex items-center justify-between">
                <span className={`text-2xl font-bold ${on ? 'text-white' : 'text-gray-900'}`}>{n}</span>
                <Icon className={`h-4 w-4 ${on ? 'text-white' : n ? 'text-red-700' : 'text-gray-300'}`} aria-hidden="true" />
              </div>
              <span className={`mt-1 block text-xs font-semibold ${on ? 'text-white' : 'text-gray-900'}`}>{label}</span>
            </button>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">{kind ? kinds[kind] : 'All issues'}{data ? ` (${issues.length})` : ''}</h3>
          {kind && <p className="text-xs text-gray-500">{KIND_HELP[kind]}</p>}
        </div>
        {!data ? <div className="p-5"><Skeleton /></div> : !issues.length ? (
          <div className="border-t border-gray-100 p-12 text-center">
            <Check className="mx-auto h-6 w-6 text-emerald-600" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-gray-900">No issues found</p>
            <p className="text-sm text-gray-500">Data for this period looks clean{filtersOn ? ' for these filters' : ''}.</p>
          </div>
        ) : (
          <>
            {/* phones: one card per issue */}
            <ul className="divide-y divide-gray-100 border-t border-gray-100 lg:hidden">
              {shown.map((i) => (
                <li key={i.key} className="px-4 py-3">
                  <p className="text-sm font-medium text-gray-900">{i.title}</p>
                  <p className="mt-0.5 text-xs text-gray-600">{i.kindLabel} · {i.source || '—'} · {shortDate(i.at)}</p>
                  <p className="mt-1 text-xs text-gray-500">{i.detail}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <Link to={i.link} className={`text-xs font-semibold text-red-700 hover:underline ${FOCUS}`}>Open</Link>
                    {data.canDismiss && <button type="button" onClick={() => dismiss(i)} className={`text-xs text-gray-600 underline underline-offset-2 ${FOCUS}`}>Mark checked</button>}
                  </div>
                </li>
              ))}
            </ul>
            {/* larger screens: table with grid lines, like Signals Captured */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-gray-200 [&_th]:border [&_th]:border-gray-200">
                <thead>
                  <tr className="text-left text-xs text-gray-900 [&_th]:border-b-2 [&_th]:border-b-red-600 [&_th]:font-bold">
                    <th className="w-10 px-4 py-3">#</th>
                    <th className="px-4 py-3">Issue</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i, n) => {
                    const Icon = KIND_ICON[i.kind] || HelpCircle
                    return (
                      <tr key={i.key} className="align-top hover:bg-red-50/40">
                        <td className="px-4 py-3 tabular-nums text-gray-500">{page * pageSize + n + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{i.title}</p>
                          <p className="mt-0.5 text-xs text-gray-500">{i.detail}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                          <span className="inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />{i.kindLabel}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-900">{i.source || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-900">{shortDate(i.at)}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center justify-end gap-3">
                            <Link to={i.link} className={`inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 ${FOCUS}`}>Open</Link>
                            {data.canDismiss && <button type="button" onClick={() => dismiss(i)} className={`text-xs font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900 ${FOCUS}`}>Mark checked</button>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {/* pagination, same as Signals Captured */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => goTo(0)} disabled={page === 0} className={PAGER}>First</button>
                <button type="button" onClick={() => goTo(page - 1)} disabled={page === 0} className={PAGER}>Previous</button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <span className="text-xs text-gray-600">Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, issues.length)} of {issues.length}</span>
                <div className="flex items-center gap-1">
                  {pageNumbers.map((n) => (
                    <button key={n} type="button" onClick={() => goTo(n)} aria-current={n === page ? 'page' : undefined}
                      className={`min-w-[2rem] rounded-lg px-2 py-1.5 text-xs ${n === page ? 'bg-red-600 font-semibold text-white' : 'border border-gray-200 text-gray-900 hover:bg-gray-50'} ${FOCUS}`}>{n + 1}</button>
                  ))}
                </div>
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page" className={`rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-900 ${FOCUS}`}>
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => goTo(page + 1)} disabled={page >= lastPage} className={PAGER}>Next</button>
                <button type="button" onClick={() => goTo(lastPage)} disabled={page >= lastPage} className={PAGER}>Last</button>
              </div>
            </div>
          </>
        )}
      </div>
      <Toast text={toast.text} error={toast.error} />
    </AppShell>
  )
}
