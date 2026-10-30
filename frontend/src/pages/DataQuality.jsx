import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPinOff, AlertTriangle, Clock, HelpCircle, Copy, Building2, Check } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getDataQuality, dismissDataIssue } from '../api/frappe'
import { FOCUS, CARD, INPUT, BTN_SMALL, Toast, Skeleton } from '../components/chp/ui'

const KIND_ICON = { location: MapPinOff, warning: AlertTriangle, late: Clock, unclassified: HelpCircle, duplicate: Copy, completeness: Building2 }
const KIND_HELP = {
  location: 'Reports without a sub-county or GPS point cannot be mapped or counted in the right place.',
  warning: 'Numbers far above normal for one report. Confirm with the reporter.',
  late: 'Sent more than 24 hours after symptoms started.',
  unclassified: 'No disease matched the symptoms. Review and set the suspected disease.',
  duplicate: 'Same reporter, place and symptoms within 24 hours.',
  completeness: 'Facilities that missed MOH 505 weeks in the last 4 weeks.',
}

function shortDate(d) {
  if (!d) return ''
  const x = new Date(String(d).replace(' ', 'T'))
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function DataQuality() {
  const [days, setDays] = useState(30)
  const [kind, setKind] = useState('')
  const [data, setData] = useState(null)
  const [toast, setToast] = useState({ text: '' })

  const load = useCallback(() => getDataQuality(days).then(setData).catch((e) => setToast({ text: e.message, error: true })), [days])
  useEffect(() => { setData(null); load() }, [load])

  async function dismiss(issue) {
    try {
      await dismissDataIssue(issue.key)
      setData((d) => ({ ...d, issues: d.issues.filter((i) => i.key !== issue.key), counts: { ...d.counts, [issue.kind]: d.counts[issue.kind] - 1 } }))
      setToast({ text: 'Marked as checked' })
      setTimeout(() => setToast({ text: '' }), 2000)
    } catch (e) {
      setToast({ text: e.message || 'Could not update', error: true })
    }
  }

  const issues = (data?.issues || []).filter((i) => !kind || i.kind === kind)
  const total = data ? data.issues.length : null

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h2 className="text-xl font-bold text-brand-navy">Data Quality Monitoring</h2>
          <p className="text-sm text-gray-400">Find and fix problems in surveillance data from your region: missing places, late or duplicate reports and facility reporting gaps</p>
        </div>
        <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${INPUT} w-auto`}>
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {Object.entries(data?.kinds || {}).map(([k, label]) => {
          const Icon = KIND_ICON[k]
          const n = data.counts[k] || 0
          return (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? '' : k)} title={KIND_HELP[k]}
              className={`${CARD} p-4 text-left hover:border-gray-200 ${kind === k ? 'ring-1 ring-gray-300' : ''} ${FOCUS}`}>
              <Icon className={`w-4 h-4 ${n ? 'text-amber-600' : 'text-gray-300'}`} aria-hidden="true" />
              <span className="block text-xl font-semibold text-gray-900 mt-2">{n}</span>
              <span className="block text-xs text-gray-500">{label}</span>
            </button>
          )
        })}
      </div>

      <section className={`${CARD}`}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900">{kind ? data?.kinds?.[kind] : 'All issues'}{total != null ? ` (${issues.length})` : ''}</h3>
          {data && <p className="text-xs text-gray-400">{data.reportsChecked} reports checked{kind ? ` · ${KIND_HELP[kind]}` : ''}</p>}
        </div>
        {!data ? <div className="p-5"><Skeleton /></div> : !issues.length ? (
          <div className="p-12 text-center">
            <Check className="w-6 h-6 text-emerald-500 mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-gray-900 mt-2">No issues found</p>
            <p className="text-sm text-gray-500">Data for this period looks clean.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {issues.map((i) => {
              const Icon = KIND_ICON[i.kind]
              return (
                <li key={i.key} className="px-5 py-4 flex items-start gap-4">
                  <span className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-amber-600" aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900">{i.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{i.kindLabel}{i.at ? ` · ${shortDate(i.at)}` : ''} · {i.detail}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link to={i.link} className={BTN_SMALL}>Open</Link>
                    {data.canDismiss && <button type="button" onClick={() => dismiss(i)} className={`text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2 rounded ${FOCUS}`}>Mark checked</button>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <Toast text={toast.text} error={toast.error} />
    </AppShell>
  )
}
