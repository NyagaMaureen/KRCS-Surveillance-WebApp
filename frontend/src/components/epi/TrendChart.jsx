import { Bar } from 'react-chartjs-2'
import '../../charts/chartSetup'

// Shared by Epi Trends and the rise page, so both show the same graphs. Each disease has two panels with their own
// scale, usual level and flagged rises, because facility totals (hundreds a week) would flatten single reports:
//   community: Mobile, WhatsApp, Web, CBS (+ unconfirmed reports, optional)
//   facility:  MOH 505 and EMR (weeks with no facility report are gaps, not zeros)

export const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'

// fixed source order = fixed colour (validated categorical palette); colour follows the source, never rank
export const SOURCE_COLOR = {
  Mobile: '#2a78d6', WhatsApp: '#eb6834', Web: '#1baf7a', CBS: '#eda100', IDSR: '#e87ba4', EMR: '#008300',
}
export const UNCONFIRMED = '#c9c7bf'
export const USUAL = '#52514e'
export const RISE = '#d03b3b'
const INK = '#0b0b0b'
const INK_2 = '#52514e'
const INK_MUTED = '#898781'
const GRID = '#e1e0d9'
export const COMMUNITY = ['Mobile', 'WhatsApp', 'Web', 'CBS']
export const FACILITY = ['IDSR', 'EMR']

export const PERIODS = [
  { key: '8w', label: '8 weeks' },
  { key: '12w', label: '12 weeks' },
  { key: '6m', label: '6 months' },
  { key: '12m', label: '12 months' },
]
export const SEVERITY = {
  critical: { label: 'Critical', cls: 'bg-red-50 text-red-800' },
  high: { label: 'High', cls: 'bg-amber-50 text-amber-800' },
  standard: { label: 'Normal', cls: 'bg-gray-100 text-gray-700' },
}

export function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t - y0) / 86400000 + 1) / 7)
}
export function weekRange(dateStr) {
  const a = new Date(`${dateStr}T00:00:00`)
  const b = new Date(a.getTime() + 6 * 86400000)
  const f = (x, withMonth) => x.toLocaleDateString('en-GB', withMonth ? { day: 'numeric', month: 'short' } : { day: 'numeric' })
  return `${a.getMonth() === b.getMonth() ? f(a, false) : f(a, true)}–${f(b, true)}`
}
export const weekLabel = (w) => `W${isoWeek(w)}`
export const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('en-GB'))

const pageFont = () => (typeof document !== 'undefined' && getComputedStyle(document.body).fontFamily) || 'Inter, system-ui, sans-serif'

export function Legend({ keys, labels, showUnconfirmed, withUnconfirmed }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-gray-600">
      {keys.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SOURCE_COLOR[k] }} aria-hidden="true" />{labels[k] || k}
        </span>
      ))}
      {withUnconfirmed && showUnconfirmed && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: UNCONFIRMED }} aria-hidden="true" />Unconfirmed reports
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="w-4 border-t-2 border-dashed" style={{ borderColor: USUAL }} aria-hidden="true" />Usual level
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span style={{ color: RISE }} aria-hidden="true">▲</span>Unusual rise
      </span>
    </div>
  )
}

// soft band behind the weeks of the rise being looked at (rise page)
const bandPlugin = {
  id: 'riseBand',
  beforeDatasetsDraw(chart, _args, opts) {
    const idx = opts?.weeks || []
    if (!idx.length) return
    const { ctx, chartArea, scales } = chart
    const step = scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0) || chartArea.width
    ctx.save()
    ctx.fillStyle = 'rgba(208, 59, 59, 0.07)'
    idx.forEach((i) => {
      const x = scales.x.getPixelForValue(i)
      ctx.fillRect(x - step / 2, chartArea.top, step, chartArea.bottom - chartArea.top)
    })
    ctx.restore()
  },
}

// usual line to show: with unconfirmed reports included, compare against the usual level of all reports
export const usualFor = (panel, showUnconfirmed) => (showUnconfirmed && panel.usualAll ? panel.usualAll : panel.usual)

// a small value next to big ones (4 reports beside ~1,000 facility cases) is drawn as a labelled pill above its week
const smallBarPlugin = {
  id: 'smallBars',
  afterDatasetsDraw(chart, _args, opts) {
    const totals = opts?.totals || []
    const max = opts?.max || 0
    if (!max) return
    const { ctx, scales } = chart
    ctx.save()
    ctx.font = `600 12px ${opts.font}`
    totals.forEach((t, i) => {
      if (!t || t / max > 0.04) return
      const text = `${t} case${t === 1 ? '' : 's'}`
      const x = scales.x.getPixelForValue(i)
      const y = scales.y.getPixelForValue(t) - 18
      const w = ctx.measureText(text).width + 14
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#c3c2b7'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(x - w / 2, y - 10, w, 20, 10)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#0b0b0b'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, x, y)
    })
    ctx.restore()
  },
}

export function TrendChart({ panel, keys, labels, weeks, showUnconfirmed, withUnconfirmed, height = 'h-56', onOpenRise, band = [], ariaLabel }) {
  const unc = withUnconfirmed && showUnconfirmed ? panel.unconfirmed || [] : []
  const used = keys.filter((k) => panel.bySource[k])
  const totals = weeks.map((_, i) => used.reduce((n, k) => n + (panel.bySource[k][i] || 0), 0) + (unc[i] || 0))
  const usual = usualFor(panel, withUnconfirmed && showUnconfirmed)
  const max = Math.max(1, ...totals, ...usual.filter((u) => u != null))
  // a rise covers several weeks; mark only the weeks that had reports (confirmed or not), not the empty ones in between
  const reportedAll = weeks.map((_, i) => used.reduce((n, k) => n + (panel.bySource[k][i] || 0), 0) + ((panel.unconfirmed || [])[i] || 0))
  const flags = panel.flags.map((f, i) => (reportedAll[i] ? f : []))
  const font = pageFont()
  const data = {
    labels: weeks.map(weekLabel),
    datasets: [
      ...used.map((k) => ({
        type: 'bar', label: labels[k] || k, data: panel.bySource[k].map((v) => v || null), backgroundColor: SOURCE_COLOR[k], stack: 'cases',
        maxBarThickness: 24, minBarLength: 4, borderRadius: 2, borderSkipped: false, borderColor: '#ffffff', borderWidth: { top: 1 }, order: 3,
      })),
      ...(unc.some(Boolean) ? [{
        type: 'bar', label: 'Unconfirmed reports', data: unc.map((v) => v || null), backgroundColor: UNCONFIRMED, stack: 'cases',
        maxBarThickness: 24, minBarLength: 4, borderRadius: 2, borderSkipped: false, borderColor: '#ffffff', borderWidth: { top: 1 }, order: 3,
      }] : []),
      {
        type: 'line', label: 'Usual level', data: usual, borderColor: USUAL, borderWidth: 1.5, borderDash: [4, 3],
        pointRadius: 0, pointHoverRadius: 0, tension: 0, spanGaps: false, stack: 'usual', order: 2,
      },
      {
        type: 'line', label: 'Unusual rise', data: flags.map((f, i) => (f.length ? totals[i] + max * (totals[i] && totals[i] / max <= 0.04 ? 0.2 : 0.08) : null)),
        showLine: false, pointStyle: 'triangle', pointRadius: 6, pointHoverRadius: 8, pointBackgroundColor: RISE,
        pointBorderColor: RISE, stack: 'flags', order: 1,
      },
    ],
  }
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    font: { family: font },
    interaction: { mode: 'index', intersect: false },
    onHover: (e, els) => {
      const i = els[0]?.index
      e.native.target.style.cursor = onOpenRise && i != null && flags[i]?.length ? 'pointer' : 'default'
    },
    onClick: (_e, els) => {
      const i = els[0]?.index
      if (onOpenRise && i != null && flags[i]?.length) onOpenRise(flags[i][0].alert)
    },
    scales: {
      x: { stacked: true, grid: { display: false }, border: { color: '#c3c2b7' },
        ticks: { color: INK_MUTED, font: { family: font, size: 11.5 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
      y: { stacked: true, beginAtZero: true, suggestedMax: max * 1.15, grid: { color: GRID }, border: { display: false },
        ticks: { color: INK_MUTED, font: { family: font, size: 11.5 }, precision: 0, maxTicksLimit: 5, callback: (v) => fmtNum(v) } },
    },
    plugins: {
      riseBand: { weeks: band },
      smallBars: { totals, max, font },
      legend: { display: false },
      tooltip: {
        backgroundColor: '#ffffff', borderColor: GRID, borderWidth: 1, cornerRadius: 8, padding: 12, caretPadding: 6,
        titleColor: INK, bodyColor: INK_2, footerColor: RISE,
        titleFont: { family: font, size: 13.5, weight: '600' }, bodyFont: { family: font, size: 12.5 }, footerFont: { family: font, size: 12.5, weight: '600' },
        titleMarginBottom: 8, bodySpacing: 4, footerMarginTop: 8, boxWidth: 8, boxHeight: 8, boxPadding: 6,
        filter: (ctx) => ctx.dataset.label !== 'Unusual rise' && (ctx.raw || ctx.dataset.label === 'Usual level') && ctx.raw != null,
        itemSort: (a, b) => (a.dataset.label === 'Usual level') - (b.dataset.label === 'Usual level') || a.datasetIndex - b.datasetIndex,
        callbacks: {
          title: (ctx) => { const w = weeks[ctx[0].dataIndex]; return `${weekLabel(w)} · ${weekRange(w)}` },
          // the usual level is a number of cases a week (the average of the 8 weeks before), not a multiplier
          label: (ctx) => (ctx.dataset.label === 'Usual level'
            ? ` Usual: about ${fmtNum(ctx.raw >= 1 ? Math.round(ctx.raw) : Math.round(ctx.raw * 10) / 10)} case${ctx.raw >= 0.5 && ctx.raw < 1.5 ? '' : 's'} a week`
            : ` ${ctx.dataset.label}: ${fmtNum(ctx.raw)}`),
          labelColor: (ctx) => ({ borderColor: 'transparent', backgroundColor: ctx.dataset.label === 'Usual level' ? USUAL : ctx.dataset.backgroundColor, borderRadius: 2 }),
          afterBody: (ctx) => {
            const i = ctx[0].dataIndex
            const u = usual[i]
            const times = u > 0 && totals[i] > u ? Math.round(totals[i] / u) : 0
            const lines = [`Total: ${fmtNum(totals[i])} case${totals[i] === 1 ? '' : 's'}`
              + (times >= 2 ? `, about ${times}× the usual level` : u === 0 && totals[i] ? ', when usually there are none' : '')]
            // where the cases came from (sub-county), so nobody has to look it up in Data Explorer
            const where = (panel.places?.[i] || []).map((p) => ({ ...p, n: p.confirmed + (unc.length ? p.unconfirmed : 0) })).filter((p) => p.n)
            if (where.length) {
              lines.push('', 'Where:')
              where.slice(0, 6).forEach((p) => lines.push(`  ${p.name}: ${fmtNum(p.n)}${unc.length && p.unconfirmed ? ` (${fmtNum(p.unconfirmed)} unconfirmed)` : ''}`))
              if (where.length > 6) lines.push(`  and ${where.length - 6} more`)
            }
            if (panel.facilityMissing?.[i]) lines.push('No health facility report received for this week')
            if (panel.reported && !panel.reported[i]) return ['No facility report received for this week']
            return lines
          },
          footer: (ctx) => {
            const f = flags[ctx[0].dataIndex] || []
            return f.length ? [`▲ Unusual rise in ${[...new Set(f.map((x) => x.subCounty))].join(', ')}`, onOpenRise ? 'Click to see why and investigate' : ''].filter(Boolean) : []
          },
        },
      },
    },
  }
  return (
    <div className={height}>
      <Bar data={data} options={options} plugins={[bandPlugin, smallBarPlugin]} aria-label={ariaLabel} role="img" />
    </div>
  )
}

export function NumbersTable({ panel, keys, labels, weeks, showUnconfirmed, withUnconfirmed }) {
  const used = keys.filter((k) => panel.bySource[k])
  const usual = usualFor(panel, withUnconfirmed && showUnconfirmed)
  return (
    <details className="mt-2 text-[13px]">
      <summary className={`cursor-pointer rounded text-gray-500 hover:text-gray-800 ${FOCUS}`}>Show the numbers</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-gray-500">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Week</th>
              {used.map((k) => <th key={k} scope="col" className="py-1 pr-3 font-medium">{labels[k] || k}</th>)}
              {withUnconfirmed && showUnconfirmed && <th scope="col" className="py-1 pr-3 font-medium">Unconfirmed</th>}
              <th scope="col" className="py-1 pr-3 font-medium">Usual level</th>
              <th scope="col" className="py-1 font-medium">Rise flagged in</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {weeks.map((w, i) => (
              <tr key={w}>
                <td className="whitespace-nowrap py-1 pr-3">{weekLabel(w)} · {weekRange(w)}</td>
                {used.map((k) => <td key={k} className="py-1 pr-3 tabular-nums">{panel.bySource[k][i] == null ? 'Not reported' : fmtNum(panel.bySource[k][i])}</td>)}
                {withUnconfirmed && showUnconfirmed && <td className="py-1 pr-3 tabular-nums">{fmtNum(panel.unconfirmed[i])}</td>}
                <td className="py-1 pr-3 tabular-nums">{fmtNum(usual[i])}</td>
                <td className="py-1">{[...new Set(panel.flags[i].map((f) => f.subCounty))].join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// One disease: the community panel and the facility panel, each only when it has something to show.
export function DiseasePanels({ item, weeks, labels, showUnconfirmed, onOpenRise, band, first }) {
  const c = item.community
  const f = item.facility
  const hasCommunity = Object.keys(c.bySource).length || (showUnconfirmed && c.unconfirmed.some(Boolean)) || c.flags.some((x) => x.length)
  const hasFacility = Object.keys(f.bySource).length || f.flags.some((x) => x.length)
  const lastReported = [...weeks].reverse().find((_, j) => f.reported[weeks.length - 1 - j])
  const panels = [
    hasCommunity && {
      key: 'community',
      el: (
        <div key="community">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold text-gray-900">Community and field reports</h3>
            <Legend keys={COMMUNITY.filter((k) => c.bySource[k])} labels={labels} showUnconfirmed={showUnconfirmed} withUnconfirmed />
          </div>
          <TrendChart panel={c} keys={COMMUNITY} labels={labels} weeks={weeks} showUnconfirmed={showUnconfirmed} withUnconfirmed
            height="h-60" onOpenRise={onOpenRise} band={band} ariaLabel={`${item.name}: community and field reports per week`} />
        </div>
      ),
    },
    hasFacility && {
      key: 'facility',
      el: (
        <div key="facility">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold text-gray-900">
              Health facilities
              {lastReported && lastReported !== weeks[weeks.length - 1] && (
                <span className="ml-2 font-normal text-gray-500">· facility data received up to {weekLabel(lastReported)}</span>
              )}
            </h3>
            <Legend keys={FACILITY.filter((k) => f.bySource[k])} labels={labels} showUnconfirmed={false} />
          </div>
          <TrendChart panel={f} keys={FACILITY} labels={labels} weeks={weeks} showUnconfirmed={false}
            height="h-52" onOpenRise={onOpenRise} band={band} ariaLabel={`${item.name}: health facility cases per week`} />
        </div>
      ),
    },
  ].filter(Boolean)
  if (first === 'facility') panels.reverse()
  return <div className="space-y-6">{panels.map((p, i) => <div key={p.key} className={i ? 'border-t border-gray-100 pt-5' : ''}>{p.el}</div>)}</div>
}

// One chart per disease: community reports and facility counts stacked together. The usual level adds the facility
// usual only for weeks a facility report came in, so a week with no facility data is compared like with like.
export function combine(item) {
  const c = item.community
  const f = item.facility
  const n = c.flags.length
  const fac = f.bySource   // null = no facility report that week (shown as "Not reported" in the numbers)
  const anyFacility = Object.keys(f.bySource).length > 0
  // weeks with no facility report: no usual line (it would fall to the community level and look like a drop)
  const add = (cu) => cu.map((u, i) => {
    if (anyFacility && !f.reported[i]) return null
    return u == null && f.usual[i] == null ? null : (u || 0) + (f.usual[i] || 0)
  })
  return {
    bySource: { ...c.bySource, ...fac },
    unconfirmed: c.unconfirmed,
    usual: add(c.usual),
    usualAll: add(c.usualAll),
    flags: item.flags || Array.from({ length: n }, (_, i) => [...c.flags[i], ...f.flags[i]]),
    facilityMissing: anyFacility ? f.reported.map((r) => !r) : null,
    places: item.places || null,   // per week: which sub-counties the cases came from
  }
}

export function DiseaseChart({ item, weeks, labels, showUnconfirmed, onOpenRise, band }) {
  const panel = combine(item)
  const keys = [...COMMUNITY, ...FACILITY]
  const f = item.facility
  const lastReported = Object.keys(f.bySource).length ? [...weeks].reverse().find((_, j) => f.reported[weeks.length - 1 - j]) : null
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Legend keys={keys.filter((k) => panel.bySource[k])} labels={labels} showUnconfirmed={showUnconfirmed} withUnconfirmed />
        {lastReported && lastReported !== weeks[weeks.length - 1] && (
          <span className="text-[13px] text-gray-500">Facility data received up to {weekLabel(lastReported)}</span>
        )}
      </div>
      <TrendChart panel={panel} keys={keys} labels={labels} weeks={weeks} showUnconfirmed={showUnconfirmed} withUnconfirmed
        height="h-80" onOpenRise={onOpenRise} band={band} ariaLabel={`${item.name}: cases per week by source`} />
    </div>
  )
}
