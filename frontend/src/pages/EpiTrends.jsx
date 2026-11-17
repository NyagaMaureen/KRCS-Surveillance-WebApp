import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { RefreshCw, TrendingUp } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getEpiTrends } from '../api/frappe'
import { FOCUS, PERIODS, RISE, fmtNum, DiseaseChart } from '../components/epi/TrendChart'

// Epi Trends: one disease at a time. Confirmed cases each week, stacked by where they were reported (small numbers next
// to big facility counts are labelled so they stay visible), with the usual level and the weeks the alert engine
// flagged as an unusual rise. Data and counting rules: surveillance/epi_trends.py.


// A-Z ignoring 'Suspected', so 'Suspected Measles' sits under M
const alphaName = (n) => (n || '').toLowerCase().replace(/^suspected\s+/, '')

function DiseaseCard({ item, weeks, labels, showUnconfirmed, onOpenRise, others }) {
  const flaggedWeeks = item.flags.filter((f) => f.length).length
  const parts = [
    item.communityTotal ? `${fmtNum(item.communityTotal)} from community and field reports` : '',
    item.facilityTotal ? `${fmtNum(item.facilityTotal)} from health facilities` : '',
  ].filter(Boolean)
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5" aria-label={item.name}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-gray-900">{item.name}</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {fmtNum(item.confirmedTotal)} confirmed case{item.confirmedTotal === 1 ? '' : 's'} in this period{parts.length ? ` (${parts.join(', ')})` : ''}
            {showUnconfirmed && item.unconfirmedTotal ? ` · ${fmtNum(item.unconfirmedTotal)} unconfirmed` : ''}
            {flaggedWeeks ? ` · rise flagged in ${flaggedWeeks} week${flaggedWeeks === 1 ? '' : 's'}` : ''}
          </p>
          {others > 0 && <p className="mt-0.5 text-[13px] text-gray-400">{others} other disease{others === 1 ? '' : 's'} with cases: choose from the disease list above.</p>}
        </div>
        {item.risingNow && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-semibold text-red-800">
            <TrendingUp className="h-3 w-3" aria-hidden="true" /> Rising now
          </span>
        )}
      </div>
      <DiseaseChart item={item} weeks={weeks} labels={labels} showUnconfirmed={showUnconfirmed} onOpenRise={onOpenRise} />
    </section>
  )
}

export default function EpiTrends() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const period = PERIODS.some((p) => p.key === params.get('period')) ? params.get('period') : '12w'
  const subCounty = params.get('place') || ''
  const disease = params.get('disease') || ''
  const showUnconfirmed = params.get('unconfirmed') === '1'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const setParam = useCallback((updates) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      Object.entries(updates).forEach(([k, v]) => { if (v === '' || v == null || v === false) next.delete(k); else next.set(k, v === true ? '1' : v) })
      return next
    }, { replace: true })
  }, [setParams])

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    getEpiTrends({ period, subCounty })   // every disease with cases; the page shows one at a time
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [period, subCounty])
  useEffect(load, [load])

  const openRise = useCallback((id) => navigate(`/epi-trends/${encodeURIComponent(id)}`), [navigate])
  // only diseases that have something to show, rising ones first (the server sorts them)
  const series = useMemo(() => (data?.series || []).filter((s) => s.confirmedTotal || (showUnconfirmed && s.unconfirmedTotal) || s.flags.some((f) => f.length)), [data, showUnconfirmed])
  const showAll = !disease || disease === 'all'   // opens on 'All diseases': one chart per active disease, rising first
  const current = series.find((s) => s.disease === disease) || series[0] || null
  const SEL = `h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 ${FOCUS}`

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-brand-navy">Epi Trends</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Confirmed cases each week, by disease and where they were reported. <span style={{ color: RISE }}>▲</span> marks a week
          the system flagged as an unusual rise; click it to see why and to investigate.
        </p>
        <Link to="/alerts-signals" className={`mt-1 inline-block rounded text-[13px] text-gray-500 underline underline-offset-2 hover:text-gray-900 ${FOCUS}`}>
          Looking for individual reports to verify? See the Review Queue
        </Link>
      </div>

      {/* filters, scoping everything below: period, sub-county, disease (the unconfirmed switch just below it) */}
      <div className="mb-5 flex flex-wrap items-start gap-2">
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setParam({ period: p.key === '12w' ? '' : p.key })}
              className={`h-8 rounded-md px-3 text-sm ${period === p.key ? 'bg-gray-900 font-medium text-white' : 'text-gray-600 hover:bg-gray-50'} ${FOCUS}`}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="epi-place">Sub-county</label>
        <select id="epi-place" value={subCounty} onChange={(e) => setParam({ place: e.target.value })} className={SEL}>
          <option value="">All sub-counties</option>
          {(data?.subCounties || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex flex-col items-start gap-2">
        <label className="sr-only" htmlFor="epi-disease">Disease</label>
        <select id="epi-disease" value={showAll && series.length ? 'all' : current?.disease || ''} onChange={(e) => setParam({ disease: e.target.value })} className={`${SEL} min-w-[16rem] max-w-full`} disabled={!series.length}>
          {!series.length && <option value="">No diseases with cases</option>}
          {series.length > 1 && <option value="all">All diseases ({series.length})</option>}
          {[...series].sort((a, b) => alphaName(a.name).localeCompare(alphaName(b.name))).map((d) => (
            <option key={d.disease} value={d.disease}>
              {d.name}{d.risingNow ? ' · rising now' : ''} · {fmtNum(d.confirmedTotal + (showUnconfirmed ? d.unconfirmedTotal : 0))} cases
            </option>
          ))}
        </select>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus-within:ring-2 focus-within:ring-gray-400">
          <input type="checkbox" checked={showUnconfirmed} onChange={(e) => setParam({ unconfirmed: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-red-700 focus:ring-0" />
          Include unconfirmed
        </label>
        </div>
        <button type="button" onClick={load} disabled={loading}
          className={`ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">
          Epi Trends could not be loaded just now. <button type="button" onClick={load} className={`font-semibold underline rounded ${FOCUS}`}>Try again</button>
        </div>
      )}

      {!error && !data && loading && (
        <div>
          <div className="h-96 animate-pulse rounded-xl border border-gray-100 bg-white" />
        </div>
      )}

      {!error && data && (
        <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {!current ? (
            <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
              No cases in this period{subCounty ? ` in ${subCounty}` : ''}{showUnconfirmed ? '' : '. Try “Include unconfirmed” or a longer period'}.
            </div>
          ) : showAll ? (
            series.map((s) => (
              <DiseaseCard key={s.disease} item={s} weeks={data.weeks} labels={Object.fromEntries(data.sources.map((x) => [x.key, x.label]))}
                showUnconfirmed={showUnconfirmed} onOpenRise={openRise} others={0} />
            ))
          ) : (
            <DiseaseCard item={current} weeks={data.weeks} labels={Object.fromEntries(data.sources.map((x) => [x.key, x.label]))}
              showUnconfirmed={showUnconfirmed} onOpenRise={openRise} others={series.length - 1} />
          )}
        </div>
      )}
    </AppShell>
  )
}
