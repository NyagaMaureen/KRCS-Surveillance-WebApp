import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, MoreHorizontal, MapPin, CalendarDays, User, Users,
  AlertTriangle, FileText, XCircle, CheckCircle2, Clock, Radio,
} from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getAlertSignal, updateAlertStatus, addAlertNote } from '../api/frappe'

const SEVERITY_ACCENT = {
  critical: { banner: 'bg-red-600', chip: 'text-red-600', bar: 'bg-red-600', ring: 'ring-red-600/20' },
  high: { banner: 'bg-amber-500', chip: 'text-amber-600', bar: 'bg-amber-500', ring: 'ring-amber-500/20' },
  medium: { banner: 'bg-blue-500', chip: 'text-blue-600', bar: 'bg-blue-500', ring: 'ring-blue-500/20' },
  low: { banner: 'bg-emerald-500', chip: 'text-emerald-600', bar: 'bg-emerald-500', ring: 'ring-emerald-500/20' },
}

const STATUS_STYLES = {
  Pending: 'border-amber-400 bg-amber-400/10 text-amber-500',
  Resolved: 'border-emerald-500 bg-emerald-500/10 text-emerald-600',
  Investigating: 'border-purple-400 bg-purple-400/10 text-purple-500',
  Rejected: 'border-red-500 bg-red-500/10 text-red-600',
}

function accentFor(severity) {
  return SEVERITY_ACCENT[severity] || SEVERITY_ACCENT.medium
}

function buildTimeline(alert) {
  const steps = [
    { label: 'Report Submitted', subtitle: alert.reportedBy, timestamp: `${alert.date}, 11:30:00 AM`, done: true },
    { label: 'AI Analysis Completed', subtitle: `${alert.rulesLabel} | Severity: ${alert.severity}`, timestamp: `${alert.date}, 12:15:00 PM`, done: true },
  ]

  if (alert.status === 'Rejected') {
    steps.push({ label: 'Marked as False Alarm', subtitle: 'Reviewed and dismissed', timestamp: `${alert.date}, 1:00:00 PM`, done: true })
    return steps
  }

  steps.push({ label: 'Assigned to Surveillance Officer', subtitle: 'System Auto-Assignment', timestamp: `${alert.date}, 1:00:00 PM`, done: alert.status !== 'Pending' })

  if (alert.status === 'Pending') {
    steps.push({ label: 'Verification Pending', subtitle: 'Awaiting officer assignment', timestamp: '—', done: false })
  } else if (alert.status === 'Investigating') {
    steps.push({ label: 'Verification In Progress', subtitle: 'Dr. Amina Hassan', timestamp: `${alert.date}, 1:30:00 PM`, done: false })
  } else if (alert.status === 'Resolved') {
    steps.push({ label: 'Verification Completed', subtitle: 'Dr. Amina Hassan', timestamp: `${alert.date}, 1:30:00 PM`, done: true })
    steps.push({ label: 'Case Resolved', subtitle: 'Response actions completed', timestamp: `${alert.date}, 4:00:00 PM`, done: true })
  }

  return steps
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
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getAlertSignal(id)
      .then((doc) => { if (!cancelled) setAlert(doc) })
      .catch((e) => { if (!cancelled) setLoadError(e.message || 'Could not load alert details.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  const accent = useMemo(() => accentFor(alert?.severity), [alert])
  const timeline = useMemo(() => (alert ? buildTimeline(alert) : []), [alert])

  async function handleStatusChange(status) {
    setActionPending(status)
    try {
      const updated = await updateAlertStatus(id, status)
      setAlert((prev) => ({ ...prev, ...updated }))
    } finally {
      setActionPending('')
      setMenuOpen(false)
    }
  }

  function handleGenerateReport() {
    if (!alert) return
    const lines = [
      `Case ID: ${alert.id}`,
      `Title: ${alert.title}`,
      `Location: ${alert.location}`,
      `Severity: ${alert.severity}`,
      `Status: ${alert.status}`,
      `Affected Persons: ${alert.affected}`,
      `AI Risk Score: ${alert.aiScore}%`,
      `Reported Date: ${alert.date}`,
      `Reported By: ${alert.reportedBy}`,
      '',
      'Clinical Presentation:',
      ...(alert.tags || []).map((t) => `- ${t}`),
      '',
      'Model Insights:',
      ...(alert.insights || []).map((i) => `- ${i}`),
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
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <AppShell>
      <button
        onClick={() => navigate('/alerts-signals')}
        className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 py-24 text-center text-sm text-gray-400">
          Loading alert...
        </div>
      ) : loadError ? (
        <div className="bg-white rounded-2xl border border-gray-100 py-24 text-center">
          <p className="text-sm text-red-500 mb-4">{loadError}</p>
          <Link to="/alerts-signals" className="text-sm font-semibold text-red-600 hover:underline">Return to Alerts & Signals</Link>
        </div>
      ) : alert && (
        <div className="flex flex-col gap-6">
          <div className={['relative rounded-2xl p-6 sm:p-7 text-white overflow-hidden', accent.banner].join(' ')}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <span className="shrink-0 w-14 h-14 rounded-full bg-white/15 border border-white/60 flex items-center justify-center">
                  <Radio className="w-7 h-7" />
                </span>
                <div className="min-w-0 pt-1">
                  <div className="flex items-center gap-3 flex-wrap mb-1.5">
                    <h1 className="text-xl sm:text-2xl font-semibold leading-tight">{alert.title}</h1>
                    <span className="inline-flex items-center rounded-full border border-white/70 bg-white/20 px-3.5 py-1 text-xs font-medium uppercase tracking-wide">
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white/90">Case ID: {alert.id}</p>
                </div>
              </div>

              <div className="relative shrink-0">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="w-10 h-10 rounded-lg border border-white/70 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-10 text-gray-900">
                    {['Pending', 'Investigating', 'Resolved', 'Rejected'].map((s) => (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(s)}
                        disabled={actionPending === s || alert.status === s}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed"
                      >
                        Set status: {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-7">
            <div className="mb-6">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h2 className="text-xl font-semibold text-gray-900">Case Overview</h2>
                <span className={['inline-flex items-center text-[10px] font-medium px-2.5 py-1 rounded-full border', STATUS_STYLES[alert.status] || 'border-gray-200 bg-gray-50 text-gray-500'].join(' ')}>
                  {alert.status}
                </span>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">{alert.description}</p>
            </div>

            <div className="border-t border-gray-100 pt-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Clinical Presentation</h3>
              <div className="flex flex-wrap gap-2">
                {(alert.tags || []).map((tag) => (
                  <span key={tag} className="bg-red-50 text-red-600 text-xs font-medium px-3 py-1.5 rounded">{tag}</span>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
              <div className="flex items-center gap-4">
                <span className="shrink-0 w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-gray-400" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm text-gray-500">Location</div>
                  <div className="text-sm font-medium text-gray-600">{alert.location}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="shrink-0 w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                  <CalendarDays className="w-5 h-5 text-gray-400" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm text-gray-500">Reported Date</div>
                  <div className="text-sm font-medium text-gray-600">{alert.date} 11:30:00 AM</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="shrink-0 w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-gray-400" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm text-gray-500">Reported By</div>
                  <div className="text-sm font-medium text-gray-600">{alert.reportedBy}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="shrink-0 w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                  <Users className="w-5 h-5 text-gray-400" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm text-gray-500">Affected Persons</div>
                  <div className="text-sm font-medium text-gray-600">{alert.affected} individuals</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-7">
              <h2 className="text-xl font-semibold text-gray-900 mb-5">Detection & Risk Assessment</h2>
                            <p className={['text-sm font-semibold mb-6', accent.chip].join(' ')}>{alert.rulesLabel}</p>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-900">Risk Score</span>
              <span className={['text-xl font-semibold', accent.chip].join(' ')}>{alert.aiScore}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-8">
              <div className={['h-full rounded-full', accent.bar].join(' ')} style={{ width: `${alert.aiScore}%` }} />
            </div>

            <h3 className="text-lg font-semibold text-gray-900 mb-3">Why this alert</h3>
            <ul className="space-y-2">
              {(alert.insights || []).map((insight) => (
                <li key={insight} className="text-sm text-gray-400 leading-relaxed">{insight}</li>
              ))}
            </ul>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-7">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">Case Timeline</h2>
            <div className="flex flex-col">
              {timeline.map((step, i) => (
                <div key={step.label} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span className={['shrink-0 w-14 h-14 rounded-full flex items-center justify-center', step.done ? 'bg-emerald-500/10' : 'bg-gray-100'].join(' ')}>
                      {step.done ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <Clock className="w-6 h-6 text-gray-400" />}
                    </span>
                    {i !== timeline.length - 1 && <span className="w-px flex-1 bg-gray-100 min-h-[24px]" />}
                  </div>
                  <div className={i !== timeline.length - 1 ? 'pb-8' : ''}>
                    <div className="text-sm font-medium text-gray-600">{step.label}</div>
                    {step.subtitle && <div className="text-sm text-gray-500 mt-1">{step.subtitle}</div>}
                    <div className="text-sm text-gray-500 mt-1">{step.timestamp}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-7">
            <h2 className="text-xl font-semibold text-gray-900 mb-5">Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button
                onClick={() => handleStatusChange('Investigating')}
                disabled={actionPending === 'Investigating' || alert.status === 'Investigating'}
                className="rounded-xl bg-blue-500/5 hover:bg-blue-500/10 transition-colors py-7 flex flex-col items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <AlertTriangle className="w-8 h-8 text-blue-500" />
                <span className="text-sm font-medium text-blue-500">Initiate Investigation</span>
              </button>
              <button
                onClick={handleGenerateReport}
                className="rounded-xl bg-gray-500/5 hover:bg-gray-500/10 transition-colors py-7 flex flex-col items-center gap-3"
              >
                <FileText className="w-8 h-8 text-gray-600" />
                <span className="text-sm font-medium text-gray-600">Generate Report</span>
              </button>
              <button
                onClick={() => handleStatusChange('Rejected')}
                disabled={actionPending === 'Rejected' || alert.status === 'Rejected'}
                className="rounded-xl bg-red-500/5 hover:bg-red-500/10 transition-colors py-7 flex flex-col items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <XCircle className="w-8 h-8 text-red-600" />
                <span className="text-sm font-medium text-red-600">Mark as False</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-7">
            <h2 className="text-xl font-semibold text-gray-900 mb-5">Add Investigation Note</h2>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Document findings, actions taken, or next steps..."
              className="w-full border border-gray-200 rounded-lg px-4 py-3.5 text-sm text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-red-100 mb-4"
            />
            <button
              onClick={handleSaveNote}
              disabled={savingNote || !note.trim()}
              className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl py-2.5 text-base font-semibold transition-colors"
            >
              {savingNote ? 'Saving...' : 'Save Note'}
            </button>

            {!!(alert.notes || []).length && (
              <div className="mt-5 flex flex-col gap-3">
                {alert.notes.map((n, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.text}</p>
                    <p className="text-xs text-gray-400 mt-1.5">{new Date(n.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!!(alert.relatedAlerts || []).length && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-7">
              <h2 className="text-xl font-semibold text-gray-900 mb-5">Related Alerts</h2>
              <div className="bg-gray-50 rounded-xl divide-y divide-gray-100">
                {alert.relatedAlerts.map((related) => (
                  <div key={related.title} className="px-5 py-4">
                    <div className="text-sm font-medium text-gray-600">{related.title}</div>
                    <div className="text-sm text-gray-500 mt-1">{related.subtitle}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
