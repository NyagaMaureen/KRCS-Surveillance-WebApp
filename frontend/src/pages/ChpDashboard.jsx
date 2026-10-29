import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, FileText, CheckCircle2, ArrowRightLeft, Clock, ClipboardList, Sparkles, Building2 } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getChpDashboard } from '../api/frappe'
import { dueText } from '../components/tasks/taskUi'
import {
  FOCUS, CARD, BTN_PRIMARY, BTN_SMALL, PageTitle, StatCard, Section, IconBubble, Badge, EmptyNote,
  PRIORITY, REFERRAL_TONE, REPORT_TONE, shortWhen,
} from '../components/chp/ui'

// What each report status means for the CHP who sent it
const REPORT_STATUS = {
  Submitted: { label: 'Sent', hint: 'Waiting for the officer to check' },
  Reviewed: { label: 'Checked', hint: 'Checked by the officer' },
  Linked: { label: 'Under review', hint: 'Being reviewed with other reports' },
  Investigating: { label: 'Being investigated', hint: 'The team is following up' },
  Closed: { label: 'Closed', hint: 'No further action needed' },
}

const STAT_ICONS = { reports: FileText, followups: CheckCircle2, referrals: ArrowRightLeft, onTime: Clock }

const QUICK = [
  { label: 'Report an event', to: '/record-health-signal', icon: Plus, tone: 'bg-red-50 text-red-700' },
  { label: 'My follow-ups', to: '/follow-ups', icon: ClipboardList, tone: 'bg-emerald-50 text-emerald-700' },
  { label: 'AI Assistant', to: '/ai-data-assistant', icon: Sparkles, tone: 'bg-violet-50 text-violet-700' },
]

export default function ChpDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getChpDashboard().then(setData).catch((e) => setError(e.message || 'Could not load your dashboard'))
  }, [])

  return (
    <AppShell>
      <PageTitle
        title="Community Health Dashboard"
        subtitle="Report what you see, follow up on your tasks and stay connected with your surveillance team."
        action={<Link to="/record-health-signal" className={BTN_PRIMARY}><Plus className="w-4 h-4" aria-hidden="true" /> Report an event</Link>}
      />

      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-1">
        {(data?.stats || [{ key: 'reports' }, { key: 'followups' }, { key: 'referrals' }, { key: 'onTime' }]).map((s) => (
          <StatCard key={s.key} label={s.label || ' '} value={data ? s.value : null} unit={s.unit} change={s.change} icon={STAT_ICONS[s.key]} hint={s.hint} />
        ))}
      </div>
      <p className="text-xs text-gray-400 mb-5">{data?.period || 'This month'}</p>

      <section className={`${CARD} p-5 mb-5`}>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {QUICK.map((q) => (
            <Link key={q.to} to={q.to} className={`rounded-xl px-4 py-6 flex flex-col items-center gap-2 text-sm font-medium hover:opacity-90 ${q.tone} ${FOCUS}`}>
              <q.icon className="w-6 h-6" aria-hidden="true" />
              {q.label}
            </Link>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-5">
        <Section title="My follow-ups" viewAll="/follow-ups">
          {!data ? <EmptyNote>Loading…</EmptyNote> : !data.followups.length ? (
            <EmptyNote>Nothing to follow up right now.</EmptyNote>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.followups.map((t) => {
                const due = dueText(t)
                return (
                  <li key={t.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                    <IconBubble icon={ClipboardList} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                      <p className={`text-xs ${due.tone}`}>{due.text}</p>
                    </div>
                    {t.priority && <span className="hidden sm:inline"><Badge tone={PRIORITY[t.priority]?.tone}>{PRIORITY[t.priority]?.label}</Badge></span>}
                    <Link to={`/follow-ups?task=${t.id}`} className={BTN_SMALL}>View</Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title="My recent reports" viewAll="/reports">
          {!data ? <EmptyNote>Loading…</EmptyNote> : !data.reports.length ? (
            <EmptyNote>You haven't sent any reports yet.</EmptyNote>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.reports.map((r) => (
                <li key={r.id}>
                  <Link to={`/reports/${r.id}`} className={`flex items-start gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50/60 ${FOCUS}`}>
                    <IconBubble icon={FileText} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {r.disease ? `Suspected ${r.disease.replace(/^suspected\s+/i, '')}` : 'Not matched to a disease yet'}
                      </p>
                      {r.symptoms.length > 0 && (
                        <p className="text-xs text-gray-600 mt-0.5">
                          {r.symptoms.slice(0, 3).join(', ')}{r.symptoms.length > 3 ? ` +${r.symptoms.length - 3} more` : ''}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {[r.id, r.place, r.people ? `${r.people} ${r.people === 1 ? 'person' : 'people'}` : null,
                          r.deaths ? `${r.deaths} death${r.deaths === 1 ? '' : 's'}` : null, shortWhen(r.createdOn)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge tone={REPORT_TONE[r.status]}>{REPORT_STATUS[r.status]?.label || r.status}</Badge>
                      {REPORT_STATUS[r.status]?.hint && <p className="hidden sm:block text-[11px] text-gray-400 mt-1 max-w-[180px]">{REPORT_STATUS[r.status].hint}</p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="My referrals" viewAll="/referrals">
          {!data ? <EmptyNote>Loading…</EmptyNote> : !data.referrals.length ? (
            <EmptyNote>No referrals yet.</EmptyNote>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.referrals.map((t) => (
                <li key={t.id}>
                  <Link to={`/referrals?task=${t.id}`} className={`flex items-center gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50/60 ${FOCUS}`}>
                    <IconBubble icon={ArrowRightLeft} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{patientLabel(t)}</p>
                      <p className="text-xs text-gray-500 truncate inline-flex items-center gap-1">
                        <Building2 className="w-3 h-3" aria-hidden="true" /> {t.facility || '—'}
                      </p>
                    </div>
                    <Badge tone={REFERRAL_TONE[t.statusLabel]}>{t.statusLabel}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </AppShell>
  )
}

export function patientLabel(t) {
  const p = t.patient || {}
  const who = p.sex === 'Female' ? 'Female' : p.sex === 'Male' ? 'Male' : 'Patient'
  return p.ageGroup ? `${who}, ${p.ageGroup}` : t.title
}
