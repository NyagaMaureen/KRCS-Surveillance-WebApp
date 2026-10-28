import { useEffect, useState } from 'react'
import { CloudRain, Thermometer, Users, Droplets, Info, AlertTriangle, Lightbulb } from 'lucide-react'
import { getPlaceContext } from '../../api/frappe'

/*
  Context for one place, shown next to an event or alert. Context only: not used by the engine or AI.

  Props:
    subCounty  record id or name (e.g. "Dadaab")
    county     needed when subCounty is a name
    people     affected count of the event/alert, to show cases per 10,000 people (optional)
    disease    Alert Threshold Config key (e.g. "awd-cholera"); shows only relevant context and the
               "Context supports this signal" lines. Fixed rules, never changes severity.
    data       already-loaded context (skips the fetch; used by the Dashboard)
    compact    smaller layout without the header
*/

const RATING_STYLES = {
  good: 'bg-green-50 text-green-700 border-green-200',
  fair: 'bg-amber-50 text-amber-700 border-amber-200',
  poor: 'bg-red-50 text-red-700 border-red-200',
}

const RAIN_STYLES = {
  above: 'text-blue-700',
  below: 'text-amber-700',
  usual: 'text-gray-700',
  dry: 'text-gray-700',
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(String(v).slice(0, 10))
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function rainText(w) {
  if (w.level === 'dry') return 'Dry, as usual for this time of year'
  if (w.usualMm == null) return 'No earlier years to compare yet'
  if (w.ratioText && (w.level === 'above' || w.level === 'below')) return w.ratioText
  if (w.level === 'above') return `${w.changePct}% above usual`
  if (w.level === 'below') return `${Math.abs(w.changePct)}% below usual`
  return 'About usual for this time of year'
}

export function ContextSupports({ items }) {
  if (!items?.length) return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 mb-1.5">
        <Lightbulb className="w-4 h-4" /> Context supports this signal
      </div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.kind} className="text-xs text-amber-900">
            <span className="font-medium">{i.text}</span>
            {i.why && <span className="text-amber-700">: {i.why}</span>}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-amber-700 mt-2">Background only. It doesn't change the severity; the officer decides.</p>
    </div>
  )
}

function Section({ icon: Icon, title, children, aside }) {
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          <Icon className="w-4 h-4" /> {title}
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}

function Missing({ children }) {
  return <p className="text-xs text-gray-400">{children}</p>
}

export function ContextBody({ ctx, people, compact = false }) {
  const w = ctx.weather
  const p = ctx.population
  const wash = ctx.wash
  const show = ctx.show || { weather: true, wash: true, population: true }
  const count = [show.weather, show.population, show.wash].filter(Boolean).length
  const cols = count >= 3 ? 'md:grid-cols-3' : count === 2 ? 'md:grid-cols-2' : ''
  return (
    <div className={compact ? 'space-y-3' : ['grid grid-cols-1 gap-3', cols].join(' ')}>
      {show.weather && <Section icon={CloudRain} title="Rainfall & temperature">
        {w ? (
          <>
            <div className="text-lg font-bold text-gray-900">{w.rainfallMm} mm <span className="text-xs font-normal text-gray-400">last {w.windowDays / 7} weeks</span></div>
            <div className={['text-xs font-medium', RAIN_STYLES[w.level] || 'text-gray-700'].join(' ')}>{rainText(w)}</div>
            {w.usualMm != null && <div className="text-[11px] text-gray-400">Usual: {w.usualMm} mm ({w.yearsCompared} earlier year{w.yearsCompared === 1 ? '' : 's'})</div>}
            <div className="flex items-center gap-3 text-xs text-gray-600 mt-2">
              <span>This week: {w.last7RainMm} mm</span>
              {w.last7TempC != null && <span className="inline-flex items-center gap-1"><Thermometer className="w-3.5 h-3.5" />{w.last7TempC}°C avg</span>}
            </div>
          </>
        ) : <Missing>No weather data yet for this area.</Missing>}
      </Section>}

      {show.population && <Section icon={Users} title="Population"
        aside={p?.stale && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Over a year old</span>}>
        {p ? (
          <>
            <div className="text-lg font-bold text-gray-900">{p.population.toLocaleString()}</div>
            <div className="text-[11px] text-gray-400">{p.source} · as of {fmtDate(p.asOf)}{p.site ? ` · ${p.site}` : ''}</div>
                        {p.proportionText && people != null && (
              <div className="text-xs text-gray-700 mt-2">{p.proportionText}</div>
            )}
          </>
        ) : <Missing>No population figure recorded yet.</Missing>}
      </Section>}

      {show.wash && <Section icon={Droplets} title="WASH"
        aside={wash?.stale && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">{Math.round(wash.ageDays / 30)} months old</span>}>
        {wash ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {wash.items.map((i) => (
                <span key={i.key} title={i.label}
                  className={['text-[11px] border rounded-full px-2 py-0.5', RATING_STYLES[i.rating] || 'bg-gray-50 text-gray-600 border-gray-200'].join(' ')}>
                  {i.value}
                </span>
              ))}
            </div>
            <div className="text-[11px] text-gray-400 mt-2">Assessed {fmtDate(wash.date)}{wash.by ? ` by ${wash.by}` : ''}{wash.site ? ` · ${wash.site}` : ''}</div>
            {wash.notes && !compact && <p className="text-xs text-gray-600 mt-1 line-clamp-2" title={wash.notes}>{wash.notes}</p>}
          </>
        ) : <Missing>No WASH assessment recorded yet.</Missing>}
      </Section>}
    </div>
  )
}

export default function ContextPanel({ subCounty, county, people, disease, data, compact = false }) {
  const [ctx, setCtx] = useState(data || null)
  const [loading, setLoading] = useState(!data)
  const [error, setError] = useState('')

  useEffect(() => {
    if (data) { setCtx(data); return }
    if (!subCounty) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    getPlaceContext({ subCounty, county, people, disease })
      .then((c) => { if (!cancelled) { setCtx(c); setError('') } })
      .catch((e) => { if (!cancelled) setError(e.message || 'Could not load context') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [subCounty, county, people, disease, data])

  const place = ctx?.subCountyName || subCounty

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      {!compact && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Context{place ? ` for ${place}` : ''}</h3>
            <p className="text-xs text-gray-400">Background to help interpret this signal.</p>
          </div>
        </div>
      )}
      {!subCounty && !data ? (
        <p className="text-sm text-gray-400 flex items-center gap-2"><Info className="w-4 h-4" /> Location missing, so no context can be shown.</p>
      ) : loading ? (
        <p className="text-sm text-gray-400">Loading context…</p>
      ) : error ? (
        <p className="text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error}</p>
      ) : ctx?.unknownLocation ? (
        <p className="text-sm text-gray-400 flex items-center gap-2"><Info className="w-4 h-4" /> {place} isn't in our sub-county list, so no context is recorded for it.</p>
      ) : ctx ? (
        <>
          <ContextSupports items={ctx.supports} />
          <ContextBody ctx={ctx} people={people} compact={compact} />
          {ctx.show && (!ctx.show.weather || !ctx.show.wash) && (
            <p className="text-[11px] text-gray-400 mt-2">
              {!ctx.show.weather && !ctx.show.wash ? 'Rainfall and WASH are not shown because they are not linked to this disease.'
                : !ctx.show.weather ? 'Rainfall is not shown because it is not linked to this disease.'
                : 'WASH is not shown because it is not linked to this disease.'}
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}
