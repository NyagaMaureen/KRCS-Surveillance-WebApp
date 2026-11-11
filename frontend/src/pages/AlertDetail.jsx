import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, Search, TrendingUp, XCircle, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import ContextPanel from '../components/context/ContextPanel'
import { getAlertSignal, getEpiTrends, addAlertNote, investigateAlert, reviewAlert, reopenAlert } from '../api/frappe'
import { useCapabilities } from '../context/CapabilitiesContext'
import { FOCUS, RISE, SEVERITY, weekLabel, weekRange, fmtNum, usualFor, combine, DiseaseChart } from '../components/epi/TrendChart'

// One flagged rise (Risk Alert). Same graph as Epi Trends, for this disease and sub-county, with the rise's weeks
// shaded; then why it was flagged, what to do (investigate in the Review Queue or mark as reviewed), and the record.

const STATUS = {
  Pending: { label: 'Needs review', cls: 'bg-amber-50 text-amber-800' },
  Investigating: { label: 'Under investigation', cls: 'bg-purple-50 text-purple-800' },
  Confirmed: { label: 'Confirmed', cls: 'bg-blue-50 text-blue-800' },
  Resolved: { label: 'Resolved', cls: 'bg-green-50 text-green-800' },
  Rejected: { label: 'Dismissed', cls: 'bg-gray-100 text-gray-700' },
}
const NEXT_STEP = {
  Pending: 'Look at the graph and the reasons. If it needs checking on the ground, investigate it in the Review Queue; if it is expected or explained, mark it as reviewed.',
  Investigating: 'An investigation is open in the Review Queue. This rise follows it.',
  Confirmed: 'Confirmed in the Review Queue; the response is under way there.',
  Resolved: 'The investigation is closed.',
  Rejected: 'Reviewed: no action needed.',
}
const REVIEW_OUTCOMES = [
  { value: 'No action needed', label: 'Reviewed – no action needed', help: 'Expected or explained (e.g. seasonal rise, known cause).' },
  { value: 'Data error', label: 'Data error', help: 'The numbers are wrong (e.g. a facility entry mistake).' },
]
const EVENT_OPEN = ['New', 'Verifying', 'Investigating', 'Confirmed', 'Escalated']
const EVENT_STATUS = { Investigating: 'In the field', Escalated: 'Escalated' }

const WHY = {
  threshold: 'Reached the alert threshold KRCS set for this disease',
  baseline: 'Well above the usual weekly level for this place',
  ears_c2: 'An unusual jump compared with recent weeks (statistical check)',
  ears_c3: 'An unusual jump compared with recent weeks (statistical check)',
}

function addWeeks(iso, n) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + 7 * n)
  return d.toISOString().slice(0, 10)
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T'))
  return isNaN(d) ? String(v) : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Section({ title, children, right }) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export default function AlertDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { has } = useCapabilities()
  const canReview = has('investigate_alerts')
  const [alert, setAlert] = useState(null)
  const [trend, setTrend] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showUnconfirmed, setShowUnconfirmed] = useState(true)   // the rise is flagged from every reported case
  const [pending, setPending] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewOutcome, setReviewOutcome] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)

  const say = useCallback((text, error = false) => {
    setNotice({ text, error })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 10000 : 6000)
  }, [])
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  useEffect(() => {
    let live = true
    setLoading(true)
    setLoadError('')
    setTrend(null)
    getAlertSignal(id)
      .then((a) => {
        if (!live) return
        setAlert(a)
        // 8 weeks before the rise show the usual level; up to 4 weeks after show what happened next
        return getEpiTrends({ subCounty: a.subCounty, disease: a.disease, start: addWeeks(a.startWeek, -8), end: addWeeks(a.lastWeek, 4) })
          .then((t) => live && setTrend(t))
          .catch(() => {})
      })
      .catch((e) => live && setLoadError(e.message || 'Could not load this rise.'))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [id])

  const item = trend?.series?.find((s) => s.disease === alert?.disease) || null
  const band = useMemo(() => (trend && alert ? trend.weeks.map((w, i) => (w >= alert.startWeek && w <= alert.lastWeek ? i : -1)).filter((i) => i >= 0) : []), [trend, alert])
  const peak = useMemo(() => {
    if (!item || !band.length) return null
    const panel = combine(item)
    const total = (i, withUnc) => Object.values(panel.bySource).reduce((n, a) => n + (a[i] || 0), 0) + (withUnc && panel.unconfirmed ? panel.unconfirmed[i] : 0)
    const i = band.reduce((best, j) => (total(j, true) > total(best, true) ? j : best), band[0])
    return { week: trend.weeks[i], reported: total(i, true), confirmed: total(i, false), usual: usualFor(panel, true)[i] }
  }, [item, band, trend])

  async function investigate() {
    setPending('investigate')
    try {
      const res = await investigateAlert(id)
      navigate(`/alerts-signals/${encodeURIComponent(res.event)}`)
    } catch (e) {
      say(e.message || 'Could not open the investigation', true)
      setPending('')
    }
  }
  async function review() {
    setPending('review')
    try {
      setAlert(await reviewAlert(id, reviewOutcome, reviewNote.trim()))
      setReviewOpen(false)
      setReviewOutcome('')
      setReviewNote('')
      say('Marked as reviewed.')
    } catch (e) {
      say(e.message || 'Could not save the review', true)
    }
    setPending('')
  }
  async function reopen() {
    setPending('reopen')
    try {
      setAlert(await reopenAlert(id))
      say('Reopened for review.')
    } catch (e) {
      say(e.message || 'Could not reopen', true)
    }
    setPending('')
  }
  async function saveNote() {
    if (!note.trim()) return
    setPending('note')
    try {
      const entry = await addAlertNote(id, note.trim())
      setAlert((a) => ({ ...a, notes: [...(a.notes || []), entry] }))
      setNote('')
    } catch (e) {
      say(e.message || 'Could not save the note', true)
    }
    setPending('')
  }

  const status = STATUS[alert?.status] || STATUS.Pending
  const sev = SEVERITY[alert?.severity] || SEVERITY.standard
  const reasons = [...new Set((alert?.tags || []).map((t) => WHY[t]).filter(Boolean))]
  const dataError = (alert?.insights || []).some((i) => /POSSIBLE DATA ENTRY ERROR/i.test(i))
  const timeline = (alert?.timeline || []).filter((s) => !/^Latest check/i.test(s.label || ''))
  const BTN = `inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${FOCUS}`

  return (
    <AppShell>
      <Link to="/epi-trends" className={`mb-4 inline-flex items-center gap-1.5 rounded text-sm text-gray-500 hover:text-gray-900 ${FOCUS}`}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Epi Trends
      </Link>

      {loading && <div className="h-96 animate-pulse rounded-xl border border-gray-100 bg-white" aria-busy="true" />}
      {!loading && loadError && (
        <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-sm text-red-700">{loadError}</div>
      )}

      {!loading && alert && (
        <div className="space-y-4">
          {/* what is rising, where, how much, and what to do */}
          <section className="rounded-xl border border-gray-100 bg-white p-5">
            <p className="text-xs text-gray-500">Unusual rise · {alert.id}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <TrendingUp className="h-5 w-5" style={{ color: RISE }} aria-hidden="true" />
              <h1 className="text-xl font-semibold text-gray-900">{alert.title} rising in {alert.subCounty || alert.location}</h1>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sev.cls}`}>{sev.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.cls}`}>{status.label}</span>
            </div>
            <p className="mt-2 text-sm text-gray-700">
              Flagged {alert.weeks > 1 ? `for ${alert.weeks} weeks, ${weekLabel(alert.startWeek)} to ${weekLabel(alert.lastWeek)}` : `in ${weekLabel(alert.lastWeek)}`}
              {' '}({weekRange(alert.startWeek).split('–')[0]} – {weekRange(alert.lastWeek).split('–')[1]}).
              {peak && (
                <> Highest week: <b className="font-semibold">{fmtNum(peak.reported)} case{peak.reported === 1 ? '' : 's'} reported</b> in {weekLabel(peak.week)}
                  {peak.reported !== peak.confirmed ? ` (${fmtNum(peak.confirmed)} confirmed so far)` : ''}, when about {fmtNum(peak.usual ?? 0)} would be usual.</>
              )}
            </p>
            {(alert.surge || dataError) && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  {alert.surge && <><b className="font-semibold">Check reporting:</b> several diseases rose here together; it may be more reporting rather than more illness. </>}
                  {dataError && <><b className="font-semibold">Possible data entry error:</b> one week is far above normal; confirm the number with the facility.</>}
                </p>
              </div>
            )}

            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="text-sm text-gray-600">{NEXT_STEP[alert.status]}</p>
              {alert.status === 'Rejected' && alert.reviewOutcome && (
                <p className="mt-1 text-xs text-gray-500">
                  {alert.reviewOutcome}{alert.reviewNote ? `: ${alert.reviewNote}` : ''}{alert.reviewedBy ? ` · ${alert.reviewedBy}, ${fmtDateTime(alert.reviewedOn)}` : ''}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {alert.openEvent ? (
                  <Link to={`/alerts-signals/${encodeURIComponent(alert.openEvent)}`} className={`${BTN} bg-red-600 text-white hover:bg-red-700`}>
                    <Search className="h-4 w-4" aria-hidden="true" /> Open the investigation
                  </Link>
                ) : alert.canInvestigate && ['Pending', 'Investigating', 'Confirmed'].includes(alert.status) ? (
                  <button type="button" onClick={investigate} disabled={!!pending} className={`${BTN} bg-red-600 text-white hover:bg-red-700 disabled:opacity-60`}>
                    <Search className="h-4 w-4" aria-hidden="true" /> {pending === 'investigate' ? 'Opening…' : 'Investigate in the Review Queue'}
                  </button>
                ) : null}
                {canReview && !alert.openEvent && alert.status === 'Pending' && (
                  <button type="button" onClick={() => setReviewOpen((v) => !v)} aria-expanded={reviewOpen} className={`${BTN} border border-gray-200 text-gray-800 hover:bg-gray-50`}>
                    <XCircle className="h-4 w-4 text-gray-500" aria-hidden="true" /> Mark as reviewed
                  </button>
                )}
                {canReview && alert.status === 'Rejected' && (
                  <button type="button" onClick={reopen} disabled={!!pending} className={`${BTN} border border-gray-200 text-gray-800 hover:bg-gray-50 disabled:opacity-60`}>
                    Reopen for review
                  </button>
                )}
              </div>
              {reviewOpen && (
                <div className="mt-3 space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div role="radiogroup" aria-label="Review outcome" className="space-y-2">
                    {REVIEW_OUTCOMES.map((o) => (
                      <label key={o.value} className="flex cursor-pointer items-start gap-2 text-sm">
                        <input type="radio" name="review-outcome" value={o.value} checked={reviewOutcome === o.value} onChange={() => setReviewOutcome(o.value)} className="mt-1 accent-red-600" />
                        <span><span className="font-medium text-gray-900">{o.label}</span><span className="block text-xs text-gray-500">{o.help}</span></span>
                      </label>
                    ))}
                  </div>
                  <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} aria-label="Reason"
                    placeholder="Why? (required, kept for audit)" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" />
                  <div className="flex gap-2">
                    <button type="button" onClick={review} disabled={!reviewOutcome || !reviewNote.trim() || !!pending} className={`${BTN} bg-red-600 text-white hover:bg-red-700 disabled:opacity-50`}>
                      {pending === 'review' ? 'Saving…' : 'Save review'}
                    </button>
                    <button type="button" onClick={() => setReviewOpen(false)} className={`${BTN} border border-gray-200 bg-white text-gray-700`}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* the same graph as Epi Trends, for this disease and place */}
          <Section
            title={`Weekly cases of ${alert.title} in ${alert.subCounty || alert.location}`}
            right={(
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={showUnconfirmed} onChange={(e) => setShowUnconfirmed(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-red-700 focus:ring-red-300" />
                Include unconfirmed
              </label>
            )}
          >
            {item ? (
              <>
                <DiseaseChart item={item} weeks={trend.weeks} labels={Object.fromEntries(trend.sources.map((x) => [x.key, x.label]))}
                  showUnconfirmed={showUnconfirmed} band={band}
                  onOpenRise={(other) => other !== id && navigate(`/epi-trends/${encodeURIComponent(other)}`)} />
                <p className="mt-3 text-xs text-gray-500">
                  The shaded weeks are this rise. Usual level: the average of the 8 weeks before each week. Rises are flagged from all
                  reported cases, so unconfirmed reports are shown by default here.
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500">{trend ? 'No weekly cases to show for these weeks.' : 'Loading the graph…'}</p>
            )}
          </Section>

          <div className="space-y-4">
            <Section title="Why it was flagged">
              {(alert.reasons || []).length ? (
                <ol className="space-y-3">
                  {alert.reasons.map((r) => (
                    <li key={r.title} className="flex gap-2.5">
                      <span className="mt-0.5 text-sm" style={{ color: RISE }} aria-hidden="true">▲</span>
                      <span>
                        <span className="block text-sm font-semibold text-gray-900">{r.title}</span>
                        {r.text && <span className="mt-0.5 block text-sm leading-relaxed text-gray-700">{r.text}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : reasons.length ? (
                <ul className="space-y-1.5 text-sm text-gray-700">
                  {reasons.map((r) => <li key={r} className="flex gap-2"><span style={{ color: RISE }} aria-hidden="true">▲</span>{r}</li>)}
                </ul>
              ) : <p className="text-sm text-gray-500">{alert.whyShort}</p>}
            </Section>

            <Section title="Investigations">
              {(alert.events || []).length ? (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {alert.events.map((e) => (
                    <li key={e.id}>
                      <Link to={`/alerts-signals/${encodeURIComponent(e.id)}`} className={`flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 ${FOCUS}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-900">{e.title}</span>
                          <span className="block text-xs text-gray-500">{e.id} · {e.reports} report{e.reports === 1 ? '' : 's'} · {e.people} people{e.deaths ? ` · ${e.deaths} deaths` : ''}</span>
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${EVENT_OPEN.includes(e.status) ? 'bg-purple-50 text-purple-800' : 'bg-gray-100 text-gray-600'}`}>{EVENT_STATUS[e.status] || e.status}</span>
                        <ArrowRight className="h-4 w-4 text-gray-300" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-500">No investigation yet for this disease and place.</p>}
            </Section>
          </div>

          <ContextPanel subCounty={alert.subCounty} county={alert.county} people={alert.affected} disease={alert.disease} />

          <Section title={`Notes${(alert.notes || []).length ? ` (${alert.notes.length})` : ''}`}>
            {(alert.notes || []).map((n, i) => (
              <div key={i} className="mb-2 rounded-lg bg-gray-50 px-3 py-2">
                <p className="whitespace-pre-wrap text-sm text-gray-700">{n.text}</p>
                <p className="mt-1 text-xs text-gray-400">{n.by || 'Unknown'} · {fmtDateTime(n.createdAt || n.at)}</p>
              </div>
            ))}
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="rise-note">Add a note</label>
              <input id="rise-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note about this rise…"
                className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" />
              <button type="button" onClick={saveNote} disabled={!note.trim() || !!pending} className={`${BTN} h-9 border border-gray-200 text-gray-800 hover:bg-gray-50 disabled:opacity-50`}>Save</button>
            </div>
          </Section>

          {timeline.length > 0 && (
            <details className="rounded-xl border border-gray-100 bg-white p-5">
              <summary className={`cursor-pointer rounded text-sm font-semibold text-gray-900 ${FOCUS}`}>History</summary>
              <ol className="mt-3 space-y-2 text-sm">
                {timeline.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-40 shrink-0 text-xs text-gray-500">{fmtDateTime(s.at)}</span>
                    <span className="text-gray-700">{s.label}{s.by ? ` · ${s.by}` : ''}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}

          {(alert.relatedAlerts || []).filter((r) => r.id).length > 0 && (
            <Section title={`Other rises in ${alert.subCounty || 'this place'}`}>
              <ul className="space-y-1">
                {alert.relatedAlerts.filter((r) => r.id).map((r) => (
                  <li key={r.id}>
                    <Link to={`/epi-trends/${encodeURIComponent(r.id)}`} className={`text-sm text-gray-700 hover:underline rounded ${FOCUS}`}>
                      {r.title}{r.subtitle ? <span className="text-gray-400"> · {r.subtitle}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {notice && (
        <div role={notice.error ? 'alert' : 'status'} className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-l-4 bg-white px-4 py-3 text-sm text-gray-800 shadow-lg ${notice.error ? 'border-red-200 border-l-red-600' : 'border-gray-200 border-l-green-600'}`}>
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Close" className={`rounded text-gray-400 hover:text-gray-700 ${FOCUS}`}><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      )}
    </AppShell>
  )
}
