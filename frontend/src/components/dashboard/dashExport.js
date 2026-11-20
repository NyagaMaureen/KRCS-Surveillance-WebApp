import { createContext } from 'react'
import { Chart } from 'chart.js'
import { downloadDashboardExcel, logExport } from '../../api/frappe'

// Dashboard downloads (KRCS, 17 Nov 2026): each chart or table as a PNG, and the whole tab as PNG, PDF or Excel.
// Every download carries who downloaded it, when, and with which filters. Anyone who can see the dashboard can
// download; every download is recorded in the Audit Log with its filters (KRCS 20 Nov 2026).
//
// Panels register themselves in DashExportContext (title, note, the DOM node, wide or not); the cards of the tab too.
// What a panel holds is read when it is downloaded: a chart from its Chart.js canvas, a table or list from the page.

export const DashExportContext = createContext(null)

const RED = '#EE2435'
const INK = '#111827'
const MUTED = '#4B5563'
const LINE = '#E5E7EB'
const FONT = 'Inter, Arial, sans-serif'
const PAD = 28
const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`

export function whenNow() {
  return new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function footerLines(meta, when) {
  return [
    `Filters: ${meta.filters}`,
    `Downloaded ${when} by ${meta.user}${meta.role ? ` (${meta.role})` : ''}`,
    'Kenya Red Cross Society',
  ]
}

// ---------- what a panel holds ----------

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

/** {columns, rows} of a panel: the chart's numbers, or the table / list shown in it. */
export function panelData(node) {
  if (!node) return { columns: [], rows: [] }
  const canvas = node.querySelector('canvas')
  const chart = canvas && Chart.getChart(canvas)
  if (chart) {
    const labels = (chart.data.labels || []).map((l) => (Array.isArray(l) ? l.join(' ') : clean(l)))
    const sets = chart.data.datasets || []
    return {
      columns: ['', ...sets.map((d, i) => d.label || (sets.length === 1 ? 'Value' : `Series ${i + 1}`))],
      rows: labels.map((l, i) => [l, ...sets.map((d) => (d.data?.[i] ?? ''))]),
    }
  }
  const table = node.querySelector('table')
  if (table) {
    const heads = [...table.querySelectorAll('thead th')].map((th) => clean(th.textContent))
    const keep = heads.map((h, i) => (h ? i : -1)).filter((i) => i >= 0)   // columns without a heading are buttons
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => {
      const cells = [...tr.children].map((td) => clean(td.textContent))
      return keep.map((i) => cells[i] ?? '')
    })
    return { columns: keep.map((i) => heads[i]), rows }
  }
  const items = [...node.querySelectorAll('li')]
  if (items.length) {
    return { columns: ['Item', 'Value'], rows: items.map((li) => {
      const parts = [...li.querySelectorAll('p, span')].map((x) => clean(x.textContent)).filter(Boolean)
      return [parts.slice(0, -1).join(' · ') || parts[0] || '', parts.length > 1 ? parts[parts.length - 1] : '']
    }) }
  }
  return { columns: [], rows: [] }
}

// ---------- drawing ----------

function wrapText(g, text, maxW) {
  const words = String(text || '').split(/\s+/)
  const lines = []
  let line = ''
  words.forEach((w) => {
    const next = line ? `${line} ${w}` : w
    if (g.measureText(next).width > maxW && line) { lines.push(line); line = w } else line = next
  })
  if (line) lines.push(line)
  return lines
}

function fit(g, text, maxW) {
  let t = String(text ?? '')
  if (g.measureText(t).width <= maxW) return t
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t}…`
}

/** A panel drawn on its own canvas, width w: title, note, then the chart, table or message. */
function panelCanvas(entry, w) {
  const node = entry.node.current
  const scratch = document.createElement('canvas').getContext('2d')
  scratch.font = font(13)
  const noteLines = entry.note ? wrapText(scratch, entry.note, w - 2 * PAD) : []
  const head = PAD + 24 + noteLines.length * 18 + 14
  const chartCanvas = node?.querySelector('canvas')
  const data = panelData(node)
  let bodyH
  const MAX_ROWS = 25
  if (chartCanvas && chartCanvas.width) bodyH = Math.round((chartCanvas.height / chartCanvas.width) * (w - 2 * PAD))
  else if (data.rows.length) bodyH = 30 + Math.min(data.rows.length, MAX_ROWS) * 26 + (data.rows.length > MAX_ROWS ? 26 : 0)
  else bodyH = 40
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = head + bodyH + PAD
  const g = cv.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, cv.width, cv.height)
  g.fillStyle = INK
  g.font = font(18, 700)
  g.fillText(fit(g, entry.title, w - 2 * PAD), PAD, PAD + 16)
  g.font = font(13)
  g.fillStyle = MUTED
  noteLines.forEach((l, i) => g.fillText(l, PAD, PAD + 40 + i * 18))
  const top = head
  if (chartCanvas && chartCanvas.width) {
    g.drawImage(chartCanvas, PAD, top, w - 2 * PAD, bodyH)
  } else if (data.rows.length) {
    const colW = (w - 2 * PAD) / Math.max(data.columns.length, 1)
    g.font = font(12, 700)
    g.fillStyle = INK
    data.columns.forEach((c, i) => g.fillText(fit(g, c, colW - 8), PAD + i * colW, top + 18))
    g.fillStyle = RED
    g.fillRect(PAD, top + 26, w - 2 * PAD, 2)
    g.font = font(12)
    data.rows.slice(0, MAX_ROWS).forEach((r, ri) => {
      const y = top + 30 + ri * 26
      g.fillStyle = LINE
      g.fillRect(PAD, y + 25, w - 2 * PAD, 1)
      g.fillStyle = INK
      r.forEach((cell, ci) => g.fillText(fit(g, cell, colW - 8), PAD + ci * colW, y + 18))
    })
    if (data.rows.length > MAX_ROWS) {
      g.fillStyle = MUTED
      g.fillText(`… and ${data.rows.length - MAX_ROWS} more rows (all of them are in the Excel download)`, PAD, top + 30 + MAX_ROWS * 26 + 18)
    }
  } else {
    g.font = font(13)
    g.fillStyle = MUTED
    g.fillText(fit(g, clean(node?.textContent?.replace(entry.title, '')) || 'No data for these filters.', w - 2 * PAD), PAD, top + 20)
  }
  return cv
}

function cardsCanvas(cards, w) {
  const perRow = Math.max(1, cards.length <= 5 ? cards.length : 4)   // five cards fit on one row
  const gap = 14
  const cw = (w - 2 * PAD - gap * (perRow - 1)) / perRow
  const rows = Math.ceil(cards.length / perRow)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = rows ? rows * (96 + gap) + gap : 0
  if (!rows) return cv
  const g = cv.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, cv.width, cv.height)
  g.textAlign = 'center'
  cards.forEach((c, i) => {
    const x = PAD + (i % perRow) * (cw + gap)
    const y = gap + Math.floor(i / perRow) * (96 + gap)
    g.fillStyle = RED
    g.beginPath()
    if (g.roundRect) g.roundRect(x, y, cw, 96, 10)
    else g.rect(x, y, cw, 96)
    g.fill()
    g.fillStyle = '#fff'
    g.font = font(11, 700)
    g.fillText(fit(g, String(c.label).toUpperCase(), cw - 16), x + cw / 2, y + 24)
    g.font = font(26, 700)
    g.fillText(fit(g, typeof c.value === 'number' ? c.value.toLocaleString() : (c.value ?? '—'), cw - 16), x + cw / 2, y + 58)
    g.font = font(11)
    g.fillText(fit(g, c.note || '', cw - 16), x + cw / 2, y + 80)
  })
  g.textAlign = 'left'
  return cv
}

/** Stack canvases with a heading on top and the footer under them. */
function compose(w, heading, blocks, meta, when) {
  const scratch = document.createElement('canvas').getContext('2d')
  scratch.font = font(12)
  const foot = footerLines(meta, when).flatMap((l) => wrapText(scratch, l, w - 2 * PAD))
  const headH = heading ? 78 : 0
  const bodyH = blocks.reduce((s, b) => s + b.height, 0)
  const footH = 24 + foot.length * 18 + PAD
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = headH + bodyH + footH
  const g = cv.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, cv.width, cv.height)
  if (heading) {
    g.fillStyle = INK
    g.font = font(22, 700)
    g.fillText(fit(g, heading.title, w - 2 * PAD), PAD, PAD + 18)
    g.font = font(14)
    g.fillStyle = MUTED
    g.fillText(fit(g, heading.sub, w - 2 * PAD), PAD, PAD + 42)
  }
  let y = headH
  blocks.forEach((b) => {
    if (b.canvas) g.drawImage(b.canvas, b.x || 0, y)
    else if (b.pair) b.pair.forEach((c, i) => c && g.drawImage(c, i * (w / 2), y))
    y += b.height
  })
  g.fillStyle = LINE
  g.fillRect(PAD, y + 8, w - 2 * PAD, 1)
  g.font = font(12)
  g.fillStyle = MUTED
  foot.forEach((l, i) => g.fillText(l, PAD, y + 30 + i * 18))
  return cv
}

function save(canvas, name) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      resolve()
    }, 'image/png')
  })
}

const fileName = (...parts) => parts.filter(Boolean).join('_').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 120)
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')

// ---------- downloads ----------

const record = (meta, format, title, rows = 0) => logExport({ page: window.location.pathname, title: `${meta.dashboard} · ${meta.tab}${title ? ` · ${title}` : ''}`,
  format, rows, filters: meta.filters || 'None: everything shown' })

/** One chart or table as a PNG, with the footer. */
export async function downloadPanel(entry, meta) {
  await record(meta, 'PNG', entry.title)
  const w = 1000
  const body = panelCanvas(entry, w)
  const canvas = compose(w, null, [{ canvas: body, height: body.height }], meta, whenNow())
  await save(canvas, `${fileName(entry.title, stamp())}.png`)
}

function tabCanvases(panels, cards, w) {
  const half = w / 2
  const blocks = []
  const cardsCv = cardsCanvas(cards, w)
  if (cardsCv.height) blocks.push({ canvas: cardsCv, height: cardsCv.height })
  let row = []
  const flush = () => {
    if (!row.length) return
    const cvs = row.map((e) => panelCanvas(e, half))
    blocks.push({ pair: cvs, height: Math.max(...cvs.map((c) => c.height)) })
    row = []
  }
  panels.forEach((e) => {
    if (e.wide) {
      flush()
      const cv = panelCanvas(e, w)
      blocks.push({ canvas: cv, height: cv.height })
    } else {
      row.push(e)
      if (row.length === 2) flush()
    }
  })
  flush()
  return blocks
}

/** The whole tab as one PNG: cards, every chart and table, the footer. */
export async function downloadTabPng(panels, cards, meta) {
  await record(meta, 'PNG')
  const w = 1400
  const canvas = compose(w, { title: `${meta.dashboard} · ${meta.tab}`, sub: meta.filters }, tabCanvases(panels, cards, w), meta, whenNow())
  await save(canvas, `${fileName(meta.dashboard, meta.tab, stamp())}.png`)
}

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** The whole tab in a print window: save it as PDF from there. win: opened by the click (pop-up rules). */
export function printTab(win, panels, cards, meta) {
  record(meta, 'PDF').catch(() => {})
  const when = whenNow()
  const cardHtml = cards.map((c) => `<div class="card"><b>${esc(c.label)}</b><span>${esc(typeof c.value === 'number' ? c.value.toLocaleString() : c.value)}</span><i>${esc(c.note || '')}</i></div>`).join('')
  const imgs = panels.map((e) => `<figure class="${e.wide ? 'wide' : ''}"><img src="${panelCanvas(e, e.wide ? 1400 : 700).toDataURL('image/png')}" /></figure>`).join('')
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(meta.dashboard)} · ${esc(meta.tab)}</title><style>
    body{font-family:Inter,Arial,sans-serif;color:#111827;margin:24px;font-size:11px}
    h1{font-size:18px;margin:0}.sub{margin:4px 0 14px;color:#4B5563}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
    .card{background:#EE2435;color:#fff;border-radius:8px;padding:10px;text-align:center;display:flex;flex-direction:column;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .card b{font-size:9px;text-transform:uppercase}.card span{font-size:20px;font-weight:700}.card i{font-style:normal;font-size:9px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}figure{margin:0;break-inside:avoid;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden}
    figure.wide{grid-column:span 2}img{width:100%;display:block}
    .foot{margin-top:14px;border-top:1px solid #E5E7EB;padding-top:8px;color:#4B5563;line-height:1.6}
  </style></head><body><h1>${esc(meta.dashboard)} · ${esc(meta.tab)}</h1><p class="sub">${esc(meta.filters)}</p>
  <div class="cards">${cardHtml}</div><div class="grid">${imgs}</div>
  <div class="foot">${footerLines(meta, when).map(esc).join('<br/>')}</div></body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}

/** The numbers behind the tab as Excel (made on the server): a Summary sheet, then a sheet per chart or table. */
export async function downloadTabExcel(panels, cards, meta) {
  const when = whenNow()
  const sheets = [{
    name: 'Summary',
    columns: ['Measure', 'Value', 'Note'],
    rows: cards.map((c) => [c.label, typeof c.value === 'number' ? c.value : String(c.value ?? ''), c.note || '']),
  }, ...panels.map((e) => ({ name: e.title, ...panelData(e.node.current) }))]
  await record(meta, 'Excel', null, sheets.reduce((n, s) => n + (s.rows?.length || 0), 0))
  await downloadDashboardExcel({
    title: `${meta.dashboard} · ${meta.tab}`,
    meta: footerLines(meta, when),
    sheets,
    filename: `${fileName(meta.dashboard, meta.tab, stamp())}.xlsx`,
  })
}
