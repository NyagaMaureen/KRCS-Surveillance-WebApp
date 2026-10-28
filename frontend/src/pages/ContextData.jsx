import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import { Droplets, Users, CloudRain, Plus, X, Loader2, Trash2, RefreshCw, XCircle, Info } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { CHART_FONT } from '../charts/chartSetup'
import {
  getSubCounties, getContextOptions, getWashAssessments, saveWashAssessment, getPopulationFigures,
  savePopulationFigure, deleteContextRecord, getWeatherStatus, getWeatherSeries, refreshWeather,
} from '../api/frappe'

const TABS = [
  { key: 'wash', label: 'WASH assessments', icon: Droplets },
  { key: 'population', label: 'Population', icon: Users },
  { key: 'weather', label: 'Weather', icon: CloudRain },
]
const RATING_STYLES = {
  good: 'bg-green-50 text-green-700 border-green-200',
  fair: 'bg-amber-50 text-amber-700 border-amber-200',
  poor: 'bg-red-50 text-red-700 border-red-200',
}
const field = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500'
const label = 'block text-sm font-medium text-gray-700 mb-1.5'
const todayIso = () => new Date().toISOString().slice(0, 10)

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(String(v).slice(0, 10))
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ContextData() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'wash'
  const [subCounties, setSubCounties] = useState([])
  const [options, setOptions] = useState(null)

  useEffect(() => {
    getSubCounties('').then(setSubCounties).catch(() => setSubCounties([]))
    getContextOptions().then(setOptions).catch(() => setOptions(null))
  }, [])

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-brand-navy">Context Data</h2>
        <p className="text-sm text-gray-400">Weather, population and WASH conditions per sub-county. Shown to officers as background on alerts; never used by the alert engine.</p>
      </div>

      <div className="flex w-full gap-1 bg-white border border-gray-100 rounded-2xl p-1.5 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <div key={t.key} className="flex flex-1 justify-center">
            <button onClick={() => setParams({ tab: t.key })}
              className={['flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                tab === t.key ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50'].join(' ')}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          </div>
        ))}
      </div>

      {tab === 'wash' && <WashTab subCounties={subCounties} options={options} />}
      {tab === 'population' && <PopulationTab subCounties={subCounties} options={options} />}
      {tab === 'weather' && <WeatherTab canManage={!!options?.canManage} />}
    </AppShell>
  )
}

function SubCountyFilter({ subCounties, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-gray-50">
      <option value="">All sub-counties</option>
      {subCounties.map((s) => <option key={s.name} value={s.name}>{s.sub_county_name} · {s.county}</option>)}
    </select>
  )
}

function Modal({ title, subtitle, icon: Icon, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center"><Icon className="w-5 h-5 text-red-700" /></div>
            <div><h3 className="font-bold text-gray-900">{title}</h3><p className="text-xs text-gray-400">{subtitle}</p></div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">{footer}</div>
      </div>
    </div>
  )
}

function ErrorNote({ children }) {
  return <div className="flex items-start gap-2 border rounded-lg px-3 py-2 text-xs bg-red-50 border-red-200 text-red-700 mt-4"><XCircle className="w-4 h-4 shrink-0 mt-0.5" /><div>{children}</div></div>
}

/* ---------------- WASH ---------------- */

function WashTab({ subCounties, options }) {
  const [filter, setFilter] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const canManage = !!options?.canManage

  const load = useCallback(() => {
    setLoading(true)
    getWashAssessments(filter).then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  }, [filter])
  useEffect(load, [load])

  async function remove(r) {
    if (!confirm(`Delete the ${fmtDate(r.assessment_date)} assessment for ${r.sub_county_name}? Use this only for mistakes.`)) return
    await deleteContextRecord('Camp WASH Assessment', r.name)
    load()
  }

  const keys = options ? Object.keys(options.wash) : []

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-100 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900">WASH assessments</h3>
          <p className="text-xs text-gray-400">Each assessment is kept as history. Officers see the latest one for the area.</p>
        </div>
        <div className="flex items-center gap-2">
          <SubCountyFilter subCounties={subCounties} value={filter} onChange={setFilter} />
          {canManage && (
            <button onClick={() => setAdding(true)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4" /> New assessment
            </button>
          )}
        </div>
      </div>
      <div className="divide-y divide-gray-50">
        {loading ? <p className="px-5 py-10 text-center text-sm text-gray-400">Loading…</p>
          : !rows.length ? <p className="px-5 py-10 text-center text-sm text-gray-400">No assessments yet.</p>
          : rows.map((r) => (
            <div key={r.name} className="px-5 py-4 flex items-start gap-4">
              <div className="w-40 shrink-0">
                <div className="text-sm font-semibold text-gray-900">{r.sub_county_name}</div>
                <div className="text-xs text-gray-400">{fmtDate(r.assessment_date)}{r.site_name ? ` · ${r.site_name}` : ''}</div>
                <div className="text-[11px] text-gray-400">{r.assessed_by || ''}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-1.5">
                  {keys.filter((k) => r[k]).map((k) => (
                    <span key={k} title={options.washLabels[k]}
                      className={['text-[11px] border rounded-full px-2 py-0.5', RATING_STYLES[r.ratings[k]] || 'bg-gray-50 text-gray-600 border-gray-200'].join(' ')}>
                      <span className="text-gray-400">{options.washLabels[k]}:</span> {r[k]}
                    </span>
                  ))}
                </div>
                {r.narrative_notes && <p className="text-xs text-gray-600 mt-2">{r.narrative_notes}</p>}
              </div>
              {canManage && <button onClick={() => remove(r)} className="text-gray-300 hover:text-red-700" title="Delete (mistakes only)"><Trash2 className="w-4 h-4" /></button>}
            </div>
          ))}
      </div>
      {adding && <WashModal subCounties={subCounties} options={options} defaultSubCounty={filter}
        onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}
    </div>
  )
}

function WashModal({ subCounties, options, defaultSubCounty, onClose, onSaved }) {
  const [form, setForm] = useState({ sub_county: defaultSubCounty || '', assessment_date: todayIso(), site_name: '', narrative_notes: '',
    ...Object.fromEntries(Object.keys(options.wash).map((k) => [k, ''])) })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setError('')
    if (!form.sub_county || !form.assessment_date) { setError('Sub-county and assessment date are required.'); return }
    if (!Object.keys(options.wash).some((k) => form[k])) { setError('Fill in at least one indicator.'); return }
    setSaving(true)
    try { await saveWashAssessment(form); onSaved() } catch (e) { setError(e.message || 'Could not save.') } finally { setSaving(false) }
  }

  return (
    <Modal title="New WASH assessment" subtitle="Saved as a new dated record; earlier assessments stay as history" icon={Droplets} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="border border-gray-200 bg-white rounded-lg px-5 py-2.5 text-sm font-semibold">Cancel</button>
        <button onClick={save} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-60">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save assessment
        </button>
      </>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={label}>Sub-county <span className="text-red-700">*</span></label>
          <select value={form.sub_county} onChange={(e) => setForm({ ...form, sub_county: e.target.value })} className={field}>
            <option value="">Select a sub-county</option>
            {subCounties.map((s) => <option key={s.name} value={s.name}>{s.sub_county_name} · {s.county}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Assessment date <span className="text-red-700">*</span></label>
          <input type="date" max={todayIso()} value={form.assessment_date} onChange={(e) => setForm({ ...form, assessment_date: e.target.value })} className={field} />
        </div>
        <div className="md:col-span-2">
          <label className={label}>Camp / site <span className="font-normal text-gray-400">(optional)</span></label>
          <input value={form.site_name} onChange={(e) => setForm({ ...form, site_name: e.target.value })} className={field} placeholder="e.g. Ifo, Kalobeyei Village 2" />
        </div>
        {Object.entries(options.wash).map(([k, opts]) => (
          <div key={k}>
            <label className={label}>{options.washLabels[k]}</label>
            <select value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={field}>
              <option value="">Not assessed</option>
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        ))}
        <div className="md:col-span-2">
          <label className={label}>Notes <span className="font-normal text-gray-400">(optional)</span></label>
          <textarea rows={3} value={form.narrative_notes} onChange={(e) => setForm({ ...form, narrative_notes: e.target.value })} className={field}
            placeholder="Observations only. No names or personal details." />
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  )
}

/* ---------------- Population ---------------- */

function PopulationTab({ subCounties, options }) {
  const [filter, setFilter] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const canManage = !!options?.canManage

  const load = useCallback(() => {
    setLoading(true)
    getPopulationFigures(filter).then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  }, [filter])
  useEffect(load, [load])

  async function remove(r) {
    if (!confirm(`Delete the ${fmtDate(r.reporting_period)} figure for ${r.sub_county_name}? Use this only for mistakes.`)) return
    await deleteContextRecord('Population Bulletin Import', r.name)
    load()
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-100 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Population figures</h3>
          <p className="text-xs text-gray-400">From published bulletins (UNHCR, IOM, KNBS). The latest figure is used for cases per 10,000 people.</p>
        </div>
        <div className="flex items-center gap-2">
          <SubCountyFilter subCounties={subCounties} value={filter} onChange={setFilter} />
          {canManage && (
            <button onClick={() => setAdding(true)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add figure
            </button>
          )}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 text-xs bg-gray-50 border-b border-gray-100">
            <th className="px-5 py-3 font-medium">Sub-county</th>
            <th className="px-5 py-3 font-medium">As of</th>
            <th className="px-5 py-3 font-medium text-right">Population</th>
            <th className="px-5 py-3 font-medium">Source</th>
            <th className="px-5 py-3 font-medium">Entered</th>
            <th className="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">Loading…</td></tr>
            : !rows.length ? <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">No population figures yet.</td></tr>
            : rows.map((r) => (
              <tr key={r.name} className="border-b border-gray-50">
                <td className="px-5 py-3 text-gray-900">{r.sub_county_name}{r.site_name && <div className="text-xs text-gray-400">{r.site_name}</div>}</td>
                <td className="px-5 py-3 text-gray-700">{fmtDate(r.reporting_period)}</td>
                <td className="px-5 py-3 text-right font-semibold text-gray-900">{Number(r.population_count).toLocaleString()}</td>
                <td className="px-5 py-3 text-gray-700">{r.source}{r.bulletin_reference && <div className="text-xs text-gray-400 truncate max-w-[220px]" title={r.bulletin_reference}>{r.bulletin_reference}</div>}</td>
                <td className="px-5 py-3 text-gray-500 text-xs">{fmtDate(r.import_date)}<div>{r.entered_by || ''}</div></td>
                <td className="px-5 py-3 text-right">{canManage && <button onClick={() => remove(r)} className="text-gray-300 hover:text-red-700" title="Delete (mistakes only)"><Trash2 className="w-4 h-4" /></button>}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {adding && <PopulationModal subCounties={subCounties} sources={options.populationSources} defaultSubCounty={filter}
        onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}
    </div>
  )
}

function PopulationModal({ subCounties, sources, defaultSubCounty, onClose, onSaved }) {
  const [form, setForm] = useState({ sub_county: defaultSubCounty || '', reporting_period: todayIso(), population_count: '',
    source: sources[0] || '', bulletin_reference: '', site_name: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setError('')
    if (!form.sub_county || !form.reporting_period || !form.population_count || !form.source) { setError('Sub-county, date, population and source are required.'); return }
    if (!(Number(form.population_count) > 0)) { setError('Population must be a positive number.'); return }
    setSaving(true)
    try { await savePopulationFigure(form); onSaved() } catch (e) { setError(e.message || 'Could not save.') } finally { setSaving(false) }
  }

  return (
    <Modal title="Add population figure" subtitle="From a published bulletin; saved as a new record" icon={Users} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="border border-gray-200 bg-white rounded-lg px-5 py-2.5 text-sm font-semibold">Cancel</button>
        <button onClick={save} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-60">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save figure
        </button>
      </>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={label}>Sub-county <span className="text-red-700">*</span></label>
          <select value={form.sub_county} onChange={(e) => setForm({ ...form, sub_county: e.target.value })} className={field}>
            <option value="">Select a sub-county</option>
            {subCounties.map((s) => <option key={s.name} value={s.name}>{s.sub_county_name} · {s.county}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Figures as of <span className="text-red-700">*</span></label>
          <input type="date" value={form.reporting_period} onChange={(e) => setForm({ ...form, reporting_period: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label}>Population <span className="text-red-700">*</span></label>
          <input type="number" min="1" value={form.population_count} onChange={(e) => setForm({ ...form, population_count: e.target.value })} className={field} placeholder="e.g. 382000" />
        </div>
        <div>
          <label className={label}>Source <span className="text-red-700">*</span></label>
          <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={field}>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Camp / site <span className="font-normal text-gray-400">(optional)</span></label>
          <input value={form.site_name} onChange={(e) => setForm({ ...form, site_name: e.target.value })} className={field} placeholder="Leave empty for the whole sub-county" />
        </div>
        <div>
          <label className={label}>Bulletin reference / link</label>
          <input value={form.bulletin_reference} onChange={(e) => setForm({ ...form, bulletin_reference: e.target.value })} className={field} placeholder="e.g. UNHCR Kenya stats, 30 Sep 2026" />
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  )
}

/* ---------------- Weather ---------------- */

function WeatherTab({ canManage }) {
  const [status, setStatus] = useState([])
  const [selected, setSelected] = useState('')
  const [series, setSeries] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')

  const loadStatus = useCallback(() => {
    getWeatherStatus().then((s) => { setStatus(s); if (!selected && s.length) setSelected(s[0].subCounty) }).catch(() => setStatus([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(loadStatus, [loadStatus])
  useEffect(() => { if (selected) getWeatherSeries(selected, 90).then(setSeries).catch(() => setSeries([])) }, [selected])

  async function refresh() {
    setRefreshing(true); setMessage('')
    try {
      const r = await refreshWeather()
      setMessage(`Updated ${r.saved} days.` + (r.failed?.length ? ` Failed: ${r.failed.join(', ')}.` : ''))
      loadStatus()
      if (selected) getWeatherSeries(selected, 90).then(setSeries)
    } catch (e) { setMessage(e.message || 'Refresh failed.') } finally { setRefreshing(false) }
  }

  const tickFont = { family: CHART_FONT.family, size: 11 }
  const chartData = useMemo(() => ({
    labels: series.map((d) => new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
    datasets: [{ label: 'Rainfall (mm)', data: series.map((d) => d.rainfall_mm), backgroundColor: '#3B82F6', borderRadius: 2 }],
  }), [series])

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-100 flex-wrap">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Weather import</h3>
            <p className="text-xs text-gray-400">Daily rainfall and temperature from Open-Meteo, imported automatically every day. Only sub-county coordinates are sent.</p>
          </div>
          {canManage && (
            <button onClick={refresh} disabled={refreshing} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-60">
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh now
            </button>
          )}
        </div>
        {message && <p className="px-5 py-2 text-xs text-gray-600 bg-gray-50 border-b border-gray-100">{message}</p>}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 text-xs bg-gray-50 border-b border-gray-100">
              <th className="px-5 py-3 font-medium">Sub-county</th>
              <th className="px-5 py-3 font-medium">Latest day</th>
              <th className="px-5 py-3 font-medium">Days stored</th>
              <th className="px-5 py-3 font-medium">Last import</th>
            </tr>
          </thead>
          <tbody>
            {status.map((s) => (
              <tr key={s.subCounty} onClick={() => setSelected(s.subCounty)}
                className={['border-b border-gray-50 cursor-pointer', selected === s.subCounty ? 'bg-red-50/40' : 'hover:bg-gray-50'].join(' ')}>
                <td className="px-5 py-3 text-gray-900">{s.subCountyName} <span className="text-xs text-gray-400">· {s.county}</span></td>
                <td className="px-5 py-3 text-gray-700">{s.hasCoordinates ? fmtDate(s.lastDate) : <span className="text-amber-700 text-xs">No coordinates set</span>}</td>
                <td className="px-5 py-3 text-gray-700">{s.days.toLocaleString()}</td>
                <td className="px-5 py-3 text-gray-500 text-xs">{s.lastImport ? new Date(s.lastImport.replace(' ', 'T').slice(0, 19)).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Daily rainfall, last 90 days</h3>
          <p className="text-xs text-gray-400 mb-4">{status.find((s) => s.subCounty === selected)?.subCountyName}</p>
          <div className="h-64">
            {series.length ? (
              <Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false }, ticks: { font: tickFont, maxTicksLimit: 12 } }, y: { beginAtZero: true, ticks: { font: tickFont } } } }} />
            ) : <p className="h-full flex items-center justify-center text-sm text-gray-400"><Info className="w-4 h-4 mr-2" />No weather data yet.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
