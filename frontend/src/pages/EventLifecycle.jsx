import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Check, ArrowRight } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getLifecycle, getEventLifecycle } from '../api/frappe'
import { FOCUS, CARD, INPUT, Badge, Skeleton } from '../components/chp/ui'

const SEVERITY = { critical: { label: 'Critical', tone: 'red' }, high: { label: 'High', tone: 'amber' }, standard: { label: 'Standard', tone: 'gray' } }

function fmt(d) {
  if (!d) return ''
  const x = new Date(String(d).replace(' ', 'T'))
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function EventLifecycle() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [severity, setSeverity] = useState('')
  const [stage, setStage] = useState('')
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])
  useEffect(() => {
    getLifecycle({ search: q, severity, stage }).then((d) => {
      setData(d)
      if (d.events.length && !d.events.some((e) => e.id === selected)) setSelected(d.events[0].id)
    }).catch(() => setData({ stages: [], events: [] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, severity, stage])
  useEffect(() => {
    if (!selected) { setDetail(null); return }
    setDetail(undefined)
    getEventLifecycle(selected).then(setDetail).catch(() => setDetail(null))
  }, [selected])

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-brand-navy">Event Lifecycle</h2>
        <p className="text-sm text-gray-400">Follow each event from the first report through verification, investigation, response, monitoring and closure</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        {(data?.stages || []).map((s) => (
          <button key={s.name} type="button" aria-pressed={stage === s.name} onClick={() => setStage(stage === s.name ? '' : s.name)}
            className={`${CARD} p-4 text-left hover:border-gray-200 ${stage === s.name ? 'ring-1 ring-gray-300' : ''} ${FOCUS}`}>
            <span className="block text-2xl font-semibold text-gray-900">{s.count}</span>
            <span className="block text-sm font-medium text-gray-900 mt-1">{s.name}</span>
            <span className="block text-xs text-gray-500 mt-0.5">{s.help}</span>
          </button>
        ))}
      </div>

      <div className={`${CARD} p-3 mb-5 flex gap-2 flex-wrap`}>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search events" placeholder="Search by disease, place or event ID"
            className={`${INPUT} pl-9 bg-gray-50 border-gray-100`} />
        </div>
        <select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className={`${INPUT} w-auto`}>
          <option value="">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="standard">Standard</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-5 items-start">
        <section className={`${CARD} p-4`}>
          <h3 className="text-sm font-semibold text-gray-900 mb-3 px-1">Events</h3>
          {!data ? <Skeleton /> : !data.events.length ? <p className="text-sm text-gray-400 p-4 text-center">No events match.</p> : (
            <ul className="flex flex-col gap-2 max-h-[640px] overflow-y-auto">
              {data.events.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setSelected(e.id)} aria-pressed={selected === e.id}
                    className={`w-full text-left rounded-xl border p-3.5 ${FOCUS} ${selected === e.id ? 'border-gray-900' : 'border-gray-100 hover:bg-gray-50/60'}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400">{e.id}</span>
                      <Badge tone={SEVERITY[e.severity]?.tone}>{SEVERITY[e.severity]?.label || 'Standard'}</Badge>
                    </span>
                    <span className="block text-sm font-medium text-gray-900 mt-1">{e.title}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      {[e.place, `${e.people} affected`, e.day ? `day ${e.day}` : null].filter(Boolean).join(' · ')}
                    </span>
                    <span className="block text-xs text-gray-600 mt-1">{e.discarded ? 'Discarded at verification' : e.stage}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${CARD} p-5 sm:p-6 min-h-[300px]`}>
          {detail === undefined ? <Skeleton /> : !detail ? <p className="text-sm text-gray-400">Choose an event.</p> : (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{detail.title}{detail.place ? ` — ${detail.place}` : ''}</h3>
                  <p className="text-sm text-gray-500">{detail.id}{detail.lead ? ` · Lead: ${detail.lead}` : ''} · Opened {fmt(detail.opened)}</p>
                </div>
                <Link to={`/alerts-signals/${detail.id}`} className={`inline-flex items-center gap-1 text-sm font-medium text-red-700 hover:underline rounded ${FOCUS}`}>
                  Open event <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </div>

              <ol className="flex items-start mt-6 mb-7 overflow-x-auto" aria-label="Stages">
                {detail.steps.map((s, i) => (
                  <li key={s.name} className="flex-1 min-w-[90px] flex flex-col items-center relative">
                    {i > 0 && <span className={`absolute top-3 right-1/2 w-full h-0.5 ${s.state === 'future' || s.state === 'skipped' ? 'bg-gray-200' : 'bg-red-500'}`} aria-hidden="true" />}
                    <span className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                      s.state === 'done' ? 'bg-white border-red-500 text-red-600' : s.state === 'current' ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-300'}`}>
                      {s.state === 'done' && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                      {s.state === 'current' && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </span>
                    <span className={`text-xs mt-2 text-center ${s.state === 'future' || s.state === 'skipped' ? 'text-gray-400' : 'text-gray-800'}`}>{s.name}</span>
                  </li>
                ))}
              </ol>

              <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase mb-3">Stage history</h4>
              <ul className="flex flex-col gap-4">
                {detail.history.map((h, i) => (
                  <li key={i} className="border-l-2 border-red-500 pl-3">
                    <p className="text-sm text-gray-900"><span className="font-medium">{h.stage}</span><span className="text-gray-500"> — {fmt(h.at)}{h.by ? ` · ${h.by}` : ''}</span></p>
                    {(h.action && h.action !== h.stage) && <p className="text-xs text-gray-500">{h.action}</p>}
                    {h.note && <p className="text-sm text-gray-600 mt-0.5">{h.note}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </AppShell>
  )
}
