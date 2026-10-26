import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import {
  ArrowLeft, MapPin, CalendarDays, Users, Layers, ExternalLink,
  AlertTriangle, FileText, CheckCircle2, Clock, Radio, Check, Search, ArrowRight, XCircle, ChevronDown,
} from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import ContextPanel from '../components/context/ContextPanel'
import { CHART_FONT } from '../charts/chartSetup'
import { getAlertSignal, addAlertNote, investigateAlert, reviewAlert, reopenAlert } from '../api/frappe'
import { useCapabilities } from '../context/CapabilitiesContext'

const SEVERITY_ACCENT = {
  critical: { banner: 'bg-red-600', dot: 'bg-red-600' },
  high: { banner: 'bg-amber-500', dot: 'bg-amber-400' },
  standard: { banner: 'bg-blue-500', dot: 'bg-blue-500' },
}

const SEVERITY_LABELS = { critical: 'Critical', high: 'High', standard: 'Standard' }

const STATUS_STYLES = {
  Pending: 'border-amber-400 bg-amber-400/10 text-amber-500',
  Resolved: 'border-emerald-500 bg-emerald-500/10 text-emerald-600',
  Investigating: 'border-purple-400 bg-purple-400/10 text-purple-500',
  Confirmed: 'border-blue-500 bg-blue-500/10 text-blue-600',
  Rejected: 'border-red-500 bg-red-500/10 text-red-600',
}

const STATUS_LABELS = { Pending: 'New', Investigating: 'Under investigation', Confirmed: 'Confirmed', Resolved: 'Resolved', Rejected: 'Dismissed' }
const EVENT_STATUS_LABELS = { Investigating: 'In the field' }
const EVENT_OPEN = ['New', 'Verifying', 'Investigating', 'Confirmed', 'Escalated']
const REVIEW_OUTCOMES = [
  { value: 'No action needed', label: 'Reviewed – no action needed', help: 'Expected or explained (e.g. seasonal rise, known cause).' },
  { value: 'Data error', label: 'Data error', help: 'The numbers are wrong (e.g. a facility entry mistake).' },
]

const SOURCE_LABELS = {
  CBS: 'Community (CBS)',
  'Case Report': 'Field reports',
  IDSR: 'Health facilities (MOH 505)',
}
const SOURCE_COLORS = {
  CBS: '#3b82f6',
  'Case Report': '#f59e0b',
  IDSR: '#10b981',
}
const SOURCE_KEYS = ['CBS', 'Case Report', 'IDSR']

const NEXT_STEP = {
  Pending: 'Review the trend. Investigate it in Review Queue, or mark it as reviewed if no action is needed.',
  Investigating: 'An investigation is open in Review Queue. This trend updates automatically.',
  Confirmed: 'Confirmed in Review Queue. The response is under way there.',
}

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2'

function accentFor(severity) {
  return SEVERITY_ACCENT[severity] || SEVERITY_ACCENT.standard
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T'))
  if (isNaN(d)) return String(v)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T'))
  if (isNaN(d)) return String(v)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function periodText(a) {
  const weeks = a.weeks || 1
  const end = a.epiWeek || a.date
  if (weeks <= 1) return end
  return `${a.startEpiWeek || a.startDate} → ${end} · ${weeks} weeks`
}

const INSIGHT_LABEL = /^(What happened:|Why [^:]*?severity:|Watch out:|What to do:)\s*/i
const SURGE_INSIGHT = /possible reporting surge/i

function InsightsList({ insights }) {
  const [techOpen, setTechOpen] = useState(false)
  const main = []
  const technical = []
  insights.forEach((text) => {
    if (SURGE_INSIGHT.test(text)) main.push({ text, surge: true })
    else if (INSIGHT_LABEL.test(text)) main.push({ text, label: text.match(INSIGHT_LABEL)[1], body: text.replace(INSIGHT_LABEL, '') })
    else technical.push(text)
  })

  return (
    <div className="space-y-3">
      {main.map((item) => (
        <div key={item.text} className="flex items-start gap-2.5 text-sm leading-relaxed text-gray-700">
          {item.surge ? (
            <>
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
              <p>{item.text}</p>
            </>
          ) : (
            <p>
              <span className="font-bold text-gray-900">{item.label}</span> {item.body}
            </p>
          )}
        </div>
      ))}
      {technical.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setTechOpen((o) => !o)}
            aria-expanded={techOpen}
            className={`inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 rounded ${FOCUS}`}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${techOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            Technical details
          </button>
          {techOpen && (
            <ul className="list-disc pl-5 mt-2 space-y-2">
              {technical.map((t) => (
                <li key={t} className="text-sm leading-relaxed text-gray-500">{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function reasonsFor(tags, detailed) {
  const t = tags || []
  const out = []
  if (t.includes('threshold')) out.push(detailed ? 'Reached the alert threshold set by KRCS' : 'Reached alert threshold')
  if (t.includes('baseline')) out.push(detailed ? 'Well above the usual level for this place' : 'Well above the usual level')
  if (t.includes('ears_c2') || t.includes('ears_c3')) {
    out.push(detailed ? 'Statistical methods: an unusual rise compared with recent weeks' : 'Statistical methods: unusual rise')
  }
  return out
}

const isSystemAuthor = (by) => /system|engine/i.test(by || '')

function Skeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse" aria-busy="true" aria-label="Loading alert">
      <div className="h-36 rounded-2xl bg-gray-200" />
      {[40, 72, 56, 48].map((h) => (
        <div key={h} className="bg-white rounded-2xl border border-gray-100 p-7 space-y-3">
          <div className="h-5 w-1/4 bg-gray-100 rounded" />
          <div className="h-3 w-full bg-gray-100 rounded" />
          <div className="h-3 w-2/3 bg-gray-100 rounded" />
          <div className="bg-gray-50 rounded-xl" style={{ height: h * 2 }} />
        </div>
      ))}
    </div>
  )
}

function isCommunityAlert(alert) {
  return !!alert.sources?.length && alert.sources.every((s) => s === 'CBS' || s === 'Case Report')
}

function CasesChart({ alert }) {
  const unit = isCommunityAlert(alert) ? 'reports' : 'cases'
  const trend = alert.trend || []
  const startKey = String(alert.startWeek || '').slice(0, 10)
  const endKey = String(alert.lastWeek || '').slice(0, 10)

  const data = {
    labels: trend.map((t) => [
      t.epiWeek,
      new Date(t.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    ]),
    datasets: SOURCE_KEYS.map((k) => ({
      label: SOURCE_LABELS[k],
      data: trend.map((t) => t[k] || 0),
      backgroundColor: SOURCE_COLORS[k],
      stack: 'cases',
    })),
  }

  const bandPlugin = useMemo(
    () => ({
      id: 'outbreakBand',
      beforeDatasetsDraw(chart) {
        const idx = trend
          .map((t, i) => ({ k: String(t.week).slice(0, 10), i }))
          .filter(({ k }) => k >= startKey && k <= endKey)
          .map(({ i }) => i)
        if (!idx.length) return
        const { ctx, chartArea, scales } = chart
        const step = chartArea.width / trend.length
        const left = scales.x.getPixelForValue(idx[0]) - step / 2
        const right = scales.x.getPixelForValue(idx[idx.length - 1]) + step / 2
        ctx.save()
        ctx.fillStyle = 'rgba(220, 38, 38, 0.08)'
        ctx.fillRect(left, chartArea.top, right - left, chartArea.height)
        ctx.restore()
      },
    }),
    [trend, startKey, endKey]
  )

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { font: CHART_FONT, usePointStyle: true } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const t = trend[items[0].dataIndex]
            return t?.label || `Week of ${[].concat(items[0].label).join(' ')}`
          },
          afterBody: (items) => {
            const i = items[0].dataIndex
            const total = SOURCE_KEYS.reduce((s, k) => s + (trend[i]?.[k] || 0), 0)
            return `Total ${unit}: ${trend[i]?.total ?? total}`
          },
        },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { font: CHART_FONT, autoSkip: true } },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: CHART_FONT } },
    },
  }

  return (
    <div className="h-72">
      <Bar data={data} options={options} plugins={[bandPlugin]} />
    </div>
  )
}

export default function AlertDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [alert, setAlert] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [actionPending, setActionPending] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewOutcome, setReviewOutcome] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const { has } = useCapabilities()
  const canReview = has('investigate_alerts')
  const [toast, setToast] = useState({ show: false, message: '', error: false })
  const toastTimer = useRef(null)

  const showToast = useCallback((message, error = false) => {
    setToast({ show: true, message, error })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000)
  }, [])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    getAlertSignal(id)
      .then((doc) => { if (!cancelled) setAlert(doc) })
      .catch((e) => { if (!cancelled) setLoadError(e.message || 'Could not load alert details.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  const accent = accentFor(alert?.severity)
  const reasons = useMemo(() => reasonsFor(alert?.tags, true), [alert])

  async function handleInvestigate() {
    setActionPending('investigate')
    try {
      const res = await investigateAlert(id)
      navigate(`/alerts-signals/${encodeURIComponent(res.event)}`)
    } catch (e) {
      showToast(e.message || 'Could not open the investigation', true)
      setActionPending('')
    }
  }

  async function handleReview() {
    setActionPending('review')
    try {
      const fresh = await reviewAlert(id, reviewOutcome, reviewNote.trim())
      setAlert(fresh)
      setReviewOpen(false)
      setReviewOutcome('')
      setReviewNote('')
      showToast('Marked as reviewed')
    } catch (e) {
      showToast(e.message || 'Could not save the review', true)
    } finally {
      setActionPending('')
    }
  }

  async function handleReopen() {
    setActionPending('reopen')
    try {
      setAlert(await reopenAlert(id))
      showToast('Reopened for review')
    } catch (e) {
      showToast(e.message || 'Could not reopen', true)
    } finally {
      setActionPending('')
    }
  }

  function handleGenerateReport() {
    if (!alert) return
    const lines = [
      `ID: ${alert.id}`,
      `Title: ${alert.title}`,
      `Severity: ${alert.severity}`,
      `Status: ${STATUS_LABELS[alert.status] || alert.status}`,
      `Location: ${alert.location}`,
      `Period: ${periodText(alert)}`,
      `Weeks: ${alert.weeks}`,
      `Total cases: ${alert.affected}`,
      `Peak cases per week: ${alert.peak}`,
      `Sources: ${(alert.sources || []).map((s) => SOURCE_LABELS[s] || s).join(', ')}`,
      '',
      'Why flagged:',
      ...reasonsFor(alert.tags, true).map((r) => `- ${r}`),
      '',
      'Insights:',
      ...(alert.insights || []).map((i) => `- ${i}`),
      '',
      'Notes:',
      ...((alert.notes || []).length
        ? alert.notes.map((n) => `- ${n.by || 'Unknown'}, ${fmtDateTime(n.createdAt || n.at)}: ${n.text}`)
        : ['- None']),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${alert.id}-report.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function handleSaveNote() {
    if (!note.trim()) return
    setSavingNote(true)
    try {
      const entry = await addAlertNote(id, note.trim())
      setAlert((prev) => ({ ...prev, notes: [...(prev.notes || []), entry] }))
      setNote('')
    } catch (e) {
      showToast(e.message || 'Could not save note', true)
    } finally {
      setSavingNote(false)
    }
  }

  const timeline = alert?.timeline || []
  const nextStep = alert ? NEXT_STEP[alert.status] : null
  const card = 'bg-white rounded-2xl border border-gray-100 p-6 sm:p-7'

  return (
    <AppShell>
      <button
        onClick={() => navigate('/epi-trends')}
        className={`inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors mb-6 ${FOCUS}`}
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {loading ? (
        <Skeleton />
      ) : loadError ? (
        <div className="bg-white rounded-2xl border border-gray-100 py-24 text-center">
          <p className="text-sm text-red-500 mb-4">{loadError}</p>
          <Link to="/epi-trends" className="text-sm font-semibold text-red-600 hover:underline">Return to Epi Trends</Link>
        </div>
      ) : alert && (
        <div className="flex flex-col gap-6">
          <div className={`relative rounded-2xl p-6 sm:p-7 text-white ${accent.banner}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <span className="shrink-0 w-14 h-14 rounded-full bg-white/15 border border-white/60 flex items-center justify-center">
                  <Radio className="w-7 h-7" aria-hidden="true" />
                </span>
                <div className="min-w-0 pt-1">
                  <div className="flex items-center gap-3 flex-wrap mb-1.5">
                    <h1 className="text-xl sm:text-2xl font-semibold leading-tight">{alert.title}</h1>
                    <span className="inline-flex items-center rounded-full border border-white/70 bg-white/20 px-3.5 py-1 text-xs font-medium tracking-wide">
                      {SEVERITY_LABELS[alert.severity] || SEVERITY_LABELS.standard}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/10 px-3.5 py-1 text-xs font-medium">
                      {alert.ongoing && <span className="w-2 h-2 rounded-full bg-white animate-pulse" aria-hidden="true" />}
                      {alert.ongoing ? 'Ongoing' : 'Ended'}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white/90">
                    Alert ID: {alert.id} · First detected {fmtDateTime(alert.firstDetected)} · Last checked {fmtDateTime(alert.lastDetected)}
                  </p>
                </div>
              </div>

            </div>

            {alert.surge && (
              <div className="mt-5 flex items-start gap-3 rounded-xl bg-white border border-amber-400 p-4 text-sm text-gray-800">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                <p>
                  <span className="font-semibold">Check reporting:</span> several diseases rose together at this location. This may be more reporting rather than more disease. Verify before acting.
                </p>
              </div>
            )}

            {(alert.insights || []).some((i) => /POSSIBLE DATA ENTRY ERROR/i.test(i)) && (
              <div className="mt-5 flex items-start gap-3 rounded-xl bg-white border border-amber-400 p-4 text-sm text-gray-800">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                <p>
                  <span className="font-semibold">Possible data entry error:</span> one week is far above the usual level. Confirm the number with the facility before acting.
                </p>
              </div>
            )}
          </div>

          <div className={card}>
            <div className="mb-6">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h2 className="text-xl font-semibold text-gray-900">What's happening</h2>
                <span className={`inline-flex items-center text-[10px] font-medium px-2.5 py-1 rounded-full border ${STATUS_STYLES[alert.status] || 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                  {STATUS_LABELS[alert.status] || alert.status}
                </span>
              </div>
              {alert.insights?.[0] && <p className="text-sm text-gray-500 leading-relaxed">{alert.insights[0]}</p>}
            </div>

            <div className="border-t border-gray-100 pt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
              <Tile Icon={MapPin} label="Location">
                <div className="text-sm font-medium text-gray-600">{alert.location}</div>
                <a
                  href={`https://www.google.com/maps?q=${encodeURIComponent(alert.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline mt-0.5 rounded ${FOCUS}`}
                >
                  Open in Maps <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              </Tile>
              <Tile Icon={CalendarDays} label="Period">
                <div className="text-sm font-medium text-gray-600">{periodText(alert)}</div>
              </Tile>
              <Tile Icon={Users} label={isCommunityAlert(alert) ? 'Reports' : 'Cases'}>
                <div className="text-sm font-medium text-gray-600">
                  {isCommunityAlert(alert)
                    ? `${alert.signals} reports · ${alert.affected} people affected · peak ${alert.peak} reports/week`
                    : `${alert.signals} cases · peak ${alert.peak}/week`}
                </div>
              </Tile>
              <Tile Icon={Layers} label="Data sources">
                <div className="flex flex-wrap gap-1.5 mt-0.5">
                  {(alert.sources || []).map((s) => (
                    <span key={s} className="text-xs text-gray-600 bg-gray-100 rounded-full px-2.5 py-0.5">{SOURCE_LABELS[s] || s}</span>
                  ))}
                </div>
              </Tile>
            </div>
          </div>

          {!!(alert.trend || []).length && (
            <div className={card}>
              <h2 className="text-xl font-semibold text-gray-900 mb-5">{isCommunityAlert(alert) ? 'Reports per week' : 'Cases per week'}</h2>
              <CasesChart alert={alert} />
              <p className="text-xs text-gray-400 mt-3">The 8 weeks before the outbreak show the usual level.</p>
            </div>
          )}

          <div className={card}>
            <ContextPanel subCounty={alert.subCounty} county={alert.county} people={alert.affected} disease={alert.disease} />
          </div>

          <div className={card}>
            <h2 className="text-xl font-semibold text-gray-900 mb-5">Why this alert</h2>
            {!!reasons.length && (
              <ul className="space-y-2 mb-6">
                {reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2.5 text-sm text-gray-700">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            )}
            {(alert.insights || []).length > 0 && <InsightsList insights={alert.insights} />}
          </div>

          <div className={card}>
            <h2 className="text-xl font-semibold text-gray-900 mb-6">Timeline</h2>
            <div className="flex flex-col">
              {timeline.map((step, i) => {
                const last = i === timeline.length - 1 && !nextStep
                return (
                  <div key={`${step.label}-${i}`} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <span className="shrink-0 w-14 h-14 rounded-full flex items-center justify-center bg-emerald-500/10">
                        <CheckCircle2 className="w-6 h-6 text-emerald-500" aria-hidden="true" />
                      </span>
                      {!last && <span className="w-px flex-1 bg-gray-100 min-h-[24px]" />}
                    </div>
                    <div className={last ? '' : 'pb-8'}>
                      <div className="text-sm font-medium text-gray-600">{step.label}</div>
                      {step.by && <div className="text-sm text-gray-500 mt-1">by {step.by}</div>}
                      <div className="text-sm text-gray-500 mt-1">{fmtDateTime(step.at)}</div>
                    </div>
                  </div>
                )
              })}
              {nextStep && (
                <div className="flex gap-4">
                  <span className="shrink-0 w-14 h-14 rounded-full flex items-center justify-center bg-gray-100">
                    <Clock className="w-6 h-6 text-gray-400" aria-hidden="true" />
                  </span>
                  <div className="pt-2">
                    <div className="text-xs uppercase tracking-wide text-gray-400">Next step</div>
                    <div className="text-sm font-medium text-gray-500 mt-1">{nextStep}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={card}>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <h2 className="text-xl font-semibold text-gray-900">Investigation</h2>
              <button
                onClick={handleGenerateReport}
                className={`inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 ${FOCUS}`}
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Generate report
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              Investigations happen in Review Queue. This trend's status follows them.
            </p>

            {(alert.events || []).length > 0 ? (
              <ul className="border border-gray-100 rounded-xl divide-y divide-gray-100 mb-5">
                {alert.events.map((e) => (
                  <li key={e.id}>
                    <Link
                      to={`/alerts-signals/${encodeURIComponent(e.id)}`}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 ${FOCUS}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900 truncate">{e.title}</span>
                        <span className="block text-xs text-gray-500">
                          {e.id} · {e.reports} report(s) · {e.people} people{e.deaths ? ` · ${e.deaths} deaths` : ''}
                          {e.fromTrend ? ' · opened from this trend' : ''}
                        </span>
                      </span>
                      <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${EVENT_OPEN.includes(e.status) ? 'border-purple-300 bg-purple-50 text-purple-600' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                        {EVENT_STATUS_LABELS[e.status] || e.status}
                      </span>
                      <ArrowRight className="w-4 h-4 text-gray-400" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 mb-5">No investigation yet for this disease and place.</p>
            )}

            {alert.status === 'Rejected' && alert.reviewOutcome ? (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
                <p className="text-sm font-semibold text-gray-900">Dismissed: {alert.reviewOutcome}</p>
                {alert.reviewNote && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{alert.reviewNote}</p>}
                {alert.reviewedBy && (
                  <p className="text-xs text-gray-400 mt-1">by {alert.reviewedBy}, {fmtDateTime(alert.reviewedOn)}</p>
                )}
                {canReview && (
                  <button
                    onClick={handleReopen}
                    disabled={!!actionPending}
                    className={`mt-3 border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-900 hover:bg-white disabled:opacity-50 ${FOCUS}`}
                  >
                    Reopen for review
                  </button>
                )}
              </div>
            ) : (
              <div className="flex gap-3 flex-wrap">
                {alert.openEvent ? (
                  <Link
                    to={`/alerts-signals/${encodeURIComponent(alert.openEvent)}`}
                    className={`inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium ${FOCUS}`}
                  >
                    <Search className="w-4 h-4" aria-hidden="true" /> Open the investigation
                  </Link>
                ) : alert.canInvestigate && ['Pending', 'Investigating', 'Confirmed'].includes(alert.status) ? (
                  <button
                    onClick={handleInvestigate}
                    disabled={!!actionPending}
                    className={`inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-5 py-2.5 text-sm font-medium ${FOCUS}`}
                  >
                    <Search className="w-4 h-4" aria-hidden="true" />
                    {actionPending === 'investigate' ? 'Opening…' : 'Investigate in Review Queue'}
                  </button>
                ) : null}
                {canReview && !alert.openEvent && alert.status === 'Pending' && (
                  <button
                    onClick={() => setReviewOpen((v) => !v)}
                    aria-expanded={reviewOpen}
                    className={`inline-flex items-center gap-2 border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-50 ${FOCUS}`}
                  >
                    <XCircle className="w-4 h-4 text-gray-500" aria-hidden="true" /> Mark as reviewed
                  </button>
                )}
              </div>
            )}

            {reviewOpen && (
              <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4 flex flex-col gap-3">
                <div className="flex flex-col gap-2" role="radiogroup" aria-label="Review outcome">
                  {REVIEW_OUTCOMES.map((o) => (
                    <label key={o.value} className="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="review-outcome"
                        value={o.value}
                        checked={reviewOutcome === o.value}
                        onChange={() => setReviewOutcome(o.value)}
                        className="mt-1 accent-red-600"
                      />
                      <span>
                        <span className="font-medium text-gray-900">{o.label}</span>
                        <span className="block text-xs text-gray-500">{o.help}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  rows={3}
                  aria-label="Reason"
                  placeholder="Why? (required, kept for audit)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-100"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleReview}
                    disabled={!reviewOutcome || !reviewNote.trim() || !!actionPending}
                    className={`bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg px-5 py-2 text-sm font-medium ${FOCUS}`}
                  >
                    {actionPending === 'review' ? 'Saving…' : 'Save review'}
                  </button>
                  <button
                    onClick={() => setReviewOpen(false)}
                    className={`border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white ${FOCUS}`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className={card}>
            <h2 className="text-xl font-semibold text-gray-900 mb-5">Notes</h2>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              aria-label="Investigation note"
              placeholder="Add a note about this trend..."
              className="w-full border border-gray-200 rounded-lg px-4 py-3.5 text-sm text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-100 mb-4"
            />
            <button
              onClick={handleSaveNote}
              disabled={savingNote || !note.trim()}
              className={`w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl py-2.5 text-base font-semibold transition-colors ${FOCUS}`}
            >
              {savingNote ? 'Saving...' : 'Save Note'}
            </button>

            {!!(alert.notes || []).length && (
              <div className="mt-5 flex flex-col gap-3">
                {alert.notes.map((n, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.text}</p>
                    <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-2">
                      <span>{n.by || 'Unknown'} · {fmtDateTime(n.createdAt || n.at)}</span>
                      {isSystemAuthor(n.by) && (
                        <span className="text-[10px] font-medium uppercase tracking-wide bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">System</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!!(alert.relatedAlerts || []).length && (
            <div className={card}>
              <h2 className="text-xl font-semibold text-gray-900 mb-5">Other Alerts</h2>
              <div className="bg-gray-50 rounded-xl divide-y divide-gray-100">
                {alert.relatedAlerts.map((related, i) => {
                  const body = (
                    <>
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                        {related.severity && (
                          <>
                            <span className={`w-2.5 h-2.5 rounded-full ${accentFor(related.severity).dot}`} aria-hidden="true" />
                            <span className="sr-only">{related.severity} severity:</span>
                          </>
                        )}
                        {related.title}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">{related.subtitle}</div>
                    </>
                  )
                  return related.id ? (
                    <Link
                      key={related.id}
                      to={`/epi-trends/${related.id}`}
                      className={`block px-5 py-4 hover:bg-gray-100 first:rounded-t-xl last:rounded-b-xl ${FOCUS}`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div key={`${related.title}-${i}`} className="px-5 py-4">{body}</div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {toast.show && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-sm text-white shadow-lg ${toast.error ? 'bg-red-600' : 'bg-gray-900'}`}
        >
          {toast.message}
        </div>
      )}
    </AppShell>
  )
}

function Tile({ Icon, label, children }) {
  return (
    <div className="flex items-center gap-4">
      <span className="shrink-0 w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-gray-400" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-sm text-gray-500">{label}</div>
        {children}
      </div>
    </div>
  )
}
