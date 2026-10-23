import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Info, Loader2, X, Plus, Pencil,
  History, Grid3x3, Building2, RefreshCw,
} from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import {
  uploadFileWithProgress, previewFacilityUpload, confirmFacilityUpload, discardFacilityUpload,
  getFacilityUploads, getFacilityCoverage, getReportingFacilities, saveReportingFacility, getSubCounties,
} from '../api/frappe'

const TABS = [
  { key: 'upload', label: 'Upload files', icon: Upload },
  { key: 'coverage', label: 'Coverage', icon: Grid3x3 },
  { key: 'history', label: 'Upload history', icon: History },
  { key: 'facilities', label: 'Facilities', icon: Building2 },
]

const STATUS_STYLES = {
  Ready: 'bg-blue-50 text-blue-700',
  Ingested: 'bg-green-50 text-green-700',
  Failed: 'bg-red-50 text-red-700',
  Discarded: 'bg-gray-100 text-gray-500',
}

const CELL_STYLES = {
  cases: 'bg-red-500 text-white',
  zero: 'bg-green-100 text-green-700',
  not_reported: 'bg-amber-100 text-amber-700',
  none: 'bg-gray-100 text-gray-300',
}
const CELL_LABELS = {
  cases: 'Cases reported',
  zero: 'Reported, no cases',
  not_reported: 'Not reported (from reporting file)',
  none: 'Nothing uploaded',
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T').slice(0, 19))
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T').slice(0, 19))
  return isNaN(d) ? '—' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function shortWeek(v) {
  const d = new Date(v)
  return isNaN(d) ? v : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function FacilityData() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'upload'
  const setTab = (key) => setParams({ tab: key })

  const [facilityModal, setFacilityModal] = useState(null) // null | {} (new) | facility (edit) | {prefill}
  const [facilitiesVersion, setFacilitiesVersion] = useState(0)

  function openAddFacility(prefillUnit) {
    setFacilityModal(prefillUnit ? { prefillUnit } : {})
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Facility Data</h2>
          <p className="text-sm text-gray-400">Upload weekly MOH 505 (IDSR) exports from KHIS. They feed straight into outbreak detection.</p>
        </div>
      </div>

      <div className="flex w-full gap-1 bg-white border border-gray-100 rounded-2xl p-1.5 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <div key={t.key} className="flex flex-1 justify-center">
            <button
              onClick={() => setTab(t.key)}
              className={['flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                tab === t.key ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50'].join(' ')}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          </div>
        ))}
      </div>

      {tab === 'upload' && <UploadTab onAddFacility={openAddFacility} />}
      {tab === 'coverage' && <CoverageTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'facilities' && <FacilitiesTab version={facilitiesVersion} onAdd={() => openAddFacility()} onEdit={(f) => setFacilityModal(f)} />}

      {facilityModal && (
        <FacilityModal
          facility={facilityModal.name ? facilityModal : null}
          prefillUnit={facilityModal.prefillUnit}
          onClose={() => setFacilityModal(null)}
          onSaved={() => { setFacilityModal(null); setFacilitiesVersion((v) => v + 1) }}
        />
      )}
    </AppShell>
  )
}

/* ---------------- Upload ---------------- */

function UploadTab({ onAddFacility }) {
  const [items, setItems] = useState([]) // {id, fileName, stage: uploading|reading|ready|failed|saving|done|discarded, progress, upload, error, result}
  const [runDetection, setRunDetection] = useState(true)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const update = (id, fields) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...fields } : it)))

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    for (const file of files) {
      const id = `${Date.now()}-${Math.random()}`
      const ok = /\.xlsx?$/i.test(file.name)
      setItems((prev) => [{ id, fileName: file.name, stage: ok ? 'uploading' : 'failed', progress: 0,
        error: ok ? '' : 'Only Excel files (.xls or .xlsx) exported from KHIS can be uploaded.' }, ...prev])
      if (!ok) continue
      try {
        const url = await uploadFileWithProgress(file, { isPrivate: 1, onProgress: (p) => update(id, { progress: p }) })
        update(id, { stage: 'reading' })
        const upload = await previewFacilityUpload(url)
        update(id, { upload, stage: upload.status === 'Ready' ? 'ready' : 'failed', error: upload.error })
      } catch (e) {
        update(id, { stage: 'failed', error: e.message || 'Could not upload this file.' })
      }
    }
  }

  async function confirm(it) {
    update(it.id, { stage: 'saving', error: '' })
    try {
      const result = await confirmFacilityUpload(it.upload.name, runDetection)
      update(it.id, { stage: 'done', result, upload: result })
    } catch (e) {
      update(it.id, { stage: 'ready', error: e.message || 'Could not save this upload.' })
    }
  }

  async function discard(it) {
    if (it.upload?.name) {
      try { await discardFacilityUpload(it.upload.name) } catch { /* already gone */ }
    }
    update(it.id, { stage: 'discarded' })
  }

  const ready = items.filter((it) => it.stage === 'ready')
  const visible = items.filter((it) => it.stage !== 'discarded')

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={['bg-white rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors',
          dragging ? 'border-red-400 bg-red-50/40' : 'border-gray-200 hover:border-red-300'].join(' ')}
      >
        <input ref={inputRef} type="file" accept=".xls,.xlsx" multiple className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <Upload className="w-6 h-6 text-red-600" />
        </div>
        <p className="text-sm font-semibold text-gray-900">Drop KHIS exports here, or click to choose files</p>
        <p className="text-xs text-gray-400 mt-1">MOH 505 cases files (e.g. 2026.xls) and reporting-rate files (e.g. reporting_26.xls). You can add several at once.</p>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-800 flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          Each file is checked first and nothing changes until you confirm it. A file replaces only its own facility's weeks,
          so uploading a corrected file for the same weeks updates them. Reporting-rate files tell a week with no cases apart from a week that wasn't reported.
        </div>
      </div>

      {visible.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={runDetection} onChange={(e) => setRunDetection(e.target.checked)} className="w-4 h-4 accent-red-600" />
            Run outbreak detection after saving
          </label>
          {ready.length > 1 && (
            <button onClick={() => ready.forEach(confirm)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold">
              Confirm all {ready.length} ready files
            </button>
          )}
        </div>
      )}

      <div className="space-y-4">
        {visible.map((it) => (
          <UploadCard key={it.id} item={it} onConfirm={() => confirm(it)} onDiscard={() => discard(it)} onAddFacility={onAddFacility} />
        ))}
      </div>
    </div>
  )
}

function UploadCard({ item, onConfirm, onDiscard, onAddFacility }) {
  const u = item.upload
  const s = u?.summary || {}
  const busy = ['uploading', 'reading', 'saving'].includes(item.stage)
  const unknownFacility = item.stage === 'failed' && s.unit && !s.facility

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5 text-gray-500" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{item.fileName}</div>
            <div className="text-xs text-gray-400">
              {s.kind ? (s.kind === 'Reporting' ? 'Reporting-rate file' : 'MOH 505 cases file') : 'KHIS export'}
              {s.facility && <> · <span className="text-gray-700 font-medium">{s.facility}</span></>}
              {s.unit && !s.facility && <> · unit “{s.unit}”</>}
            </div>
          </div>
        </div>
        <StageBadge item={item} />
      </div>

      <div className="px-5 py-4">
        {item.stage === 'uploading' && (
          <div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-red-500 transition-all" style={{ width: `${item.progress}%` }} /></div>
            <p className="text-xs text-gray-400 mt-2">Uploading… {item.progress}%</p>
          </div>
        )}
        {item.stage === 'reading' && <p className="text-xs text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading the file…</p>}

        {s.weeks > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Stat label="Weeks" value={s.weeks} sub={`${fmtDate(s.first_week)} – ${fmtDate(s.last_week)}`} />
            {s.kind === 'Reporting' ? (
              <>
                <Stat label="Reported" value={s.weeks_reported ?? 0} sub="weeks" />
                <Stat label="Not reported" value={s.weeks_not_reported ?? 0} sub="weeks" />
              </>
            ) : (
              <>
                <Stat label="Cases" value={s.cases ?? 0} sub="tracked diseases" />
                <Stat label="Deaths" value={s.deaths ?? 0} />
              </>
            )}
            <Stat label="Already in system" value={s.replaces_weeks ?? 0} sub={s.replaces_weeks ? 'weeks will be replaced' : 'all weeks are new'} />
          </div>
        )}

        {s.kind === 'Cases' && s.diseases?.length > 0 && (
          <div className="border border-gray-100 rounded-lg overflow-hidden mb-4">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50 text-gray-400 text-left"><th className="px-3 py-2 font-medium">Disease</th><th className="px-3 py-2 font-medium text-right">Cases</th><th className="px-3 py-2 font-medium text-right">Deaths</th></tr></thead>
              <tbody>
                {s.diseases.slice(0, 8).map((d) => (
                  <tr key={d.key} className="border-t border-gray-50"><td className="px-3 py-1.5 text-gray-800">{d.name}</td><td className="px-3 py-1.5 text-right font-semibold">{d.cases}</td><td className="px-3 py-1.5 text-right text-gray-500">{d.deaths}</td></tr>
                ))}
              </tbody>
            </table>
            {s.diseases.length > 8 && <div className="px-3 py-1.5 text-[11px] text-gray-400 bg-gray-50">+ {s.diseases.length - 8} more diseases</div>}
          </div>
        )}

        {s.not_tracked?.length > 0 && (
          <p className="text-xs text-gray-500 mb-3">Saved but not used for alerts yet (no alert threshold set): {s.not_tracked.join(', ')}.</p>
        )}

        {s.replaces_weeks > 0 && item.stage === 'ready' && (
          <Note tone="amber" icon={AlertTriangle}>
            {plural(s.replaces_weeks, 'week')} for {s.facility} {s.replaces_weeks === 1 ? 'is' : 'are'} already in the system and will be replaced by this file.
          </Note>
        )}

        {item.error && (
          <Note tone="red" icon={XCircle}>
            {item.error}
            {unknownFacility && (
              <button onClick={() => onAddFacility(s.unit)} className="ml-2 font-semibold underline">Add this facility</button>
            )}
          </Note>
        )}

        {item.stage === 'done' && (
          <Note tone="green" icon={CheckCircle2}>
            Saved {plural(s.weeks, 'week')} for {s.facility}.
            {item.result?.detectionQueued ? ' Outbreak detection is running in the background; new alerts appear in Epi Trends within a few minutes.' : ''}
          </Note>
        )}
      </div>

      {(item.stage === 'ready' || item.stage === 'saving' || item.stage === 'failed') && (
        <div className="flex justify-end gap-3 px-5 py-3 bg-gray-50 border-t border-gray-100">
          <button onClick={onDiscard} disabled={busy} className="border border-gray-200 bg-white rounded-lg px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {item.stage === 'failed' ? 'Remove' : 'Discard'}
          </button>
          {item.stage !== 'failed' && (
            <button onClick={onConfirm} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-60">
              {item.stage === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
              {item.stage === 'saving' ? 'Saving…' : 'Confirm and save'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StageBadge({ item }) {
  const map = {
    uploading: ['Uploading', 'bg-gray-100 text-gray-600'],
    reading: ['Checking', 'bg-gray-100 text-gray-600'],
    ready: ['Ready to confirm', 'bg-blue-50 text-blue-700'],
    saving: ['Saving', 'bg-blue-50 text-blue-700'],
    done: ['Saved', 'bg-green-50 text-green-700'],
    failed: ['Problem', 'bg-red-50 text-red-700'],
  }
  const [label, cls] = map[item.stage] || ['', '']
  return <span className={['text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0', cls].join(' ')}>{label}</span>
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-lg font-bold text-gray-900 leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  )
}

function Note({ tone, icon: Icon, children }) {
  const tones = {
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    red: 'bg-red-50 border-red-200 text-red-700',
    green: 'bg-green-50 border-green-200 text-green-800',
  }
  return (
    <div className={['flex items-start gap-2 border rounded-lg px-3 py-2 text-xs mb-2', tones[tone]].join(' ')}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  )
}

/* ---------------- Coverage ---------------- */

function CoverageTab() {
  const [weeks, setWeeks] = useState(12)
  const [data, setData] = useState({ weeks: [], facilities: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    getFacilityCoverage(weeks)
      .then((d) => { setData(d); setError('') })
      .catch((e) => setError(e.message || 'Could not load coverage'))
      .finally(() => setLoading(false))
  }, [weeks])
  useEffect(load, [load])

  const groups = useMemo(() => {
    const g = {}
    data.facilities.forEach((f) => { const k = `${f.county || '—'} / ${f.subCounty || '—'}`; (g[k] = g[k] || []).push(f) })
    return Object.entries(g)
  }, [data])

  return (
    <div className="bg-white rounded-2xl border border-gray-200">
      <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-4 border-b border-gray-100">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Which weeks each facility has sent</h3>
          <p className="text-xs text-gray-400">Up to the last complete week. Gaps mean the facility's file for that week hasn't been uploaded.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-1 flex gap-1">
            {[12, 26, 52].map((w) => (
              <button key={w} onClick={() => setWeeks(w)} className={['px-3 py-1.5 rounded-md text-xs font-medium', weeks === w ? 'bg-red-600 text-white' : 'text-gray-900'].join(' ')}>{w} weeks</button>
            ))}
          </div>
          <button onClick={load} className="border border-gray-200 rounded-lg p-2 text-gray-500 hover:bg-gray-50" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 px-5 py-3 border-b border-gray-50 text-[11px] text-gray-500">
        {Object.entries(CELL_LABELS).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1.5"><span className={['w-3 h-3 rounded-sm', CELL_STYLES[k]].join(' ')} />{label}</span>
        ))}
      </div>

      {error ? <p className="p-6 text-sm text-red-600">{error}</p> : loading ? (
        <p className="p-10 text-center text-sm text-gray-400">Loading coverage…</p>
      ) : !data.facilities.length ? (
        <p className="p-10 text-center text-sm text-gray-400">No facilities yet. Add them under Facilities.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-separate border-spacing-0.5 min-w-full">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white text-left font-medium text-gray-400 px-4 py-2 min-w-[180px]">Facility</th>
                {data.weeks.map((w, i) => (
                  <th key={w} className="font-medium text-gray-400 px-0.5 py-2 whitespace-nowrap">
                    <span className={weeks > 12 && i % 2 ? 'invisible' : ''}>{shortWeek(w)}</span>
                  </th>
                ))}
                <th className="font-medium text-gray-400 px-4 py-2 text-left whitespace-nowrap">Latest week</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, facilities]) => (
                <FragmentRows key={group} group={group} facilities={facilities} cols={data.weeks.length} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FragmentRows({ group, facilities, cols }) {
  return (
    <>
      <tr><td colSpan={cols + 2} className="sticky left-0 bg-white px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group}</td></tr>
      {facilities.map((f) => (
        <tr key={f.facility}>
          <td className="sticky left-0 bg-white px-4 py-1 text-gray-800 font-medium whitespace-nowrap">
            {f.facility}{!f.active && <span className="ml-1.5 text-[10px] text-gray-400">(inactive)</span>}
          </td>
          {f.weeks.map((c) => (
            <td key={c.week} className="p-0">
              <div title={`Week of ${fmtDate(c.week)}: ${CELL_LABELS[c.status]}${c.status === 'cases' ? ` (${c.cases})` : ''}`}
                className={['h-7 min-w-[28px] rounded flex items-center justify-center text-[10px] font-semibold', CELL_STYLES[c.status]].join(' ')}>
                {c.status === 'cases' ? c.cases : ''}
              </div>
            </td>
          ))}
          <td className="px-4 py-1 text-gray-500 whitespace-nowrap">{f.latestWeek ? fmtDate(f.latestWeek) : 'None'}</td>
        </tr>
      ))}
    </>
  )
}

/* ---------------- History ---------------- */

function HistoryTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(null)

  const [discarding, setDiscarding] = useState(false)
  const [discardError, setDiscardError] = useState('')

  async function discardOpen() {
    setDiscarding(true)
    setDiscardError('')
    try {
      const updated = await discardFacilityUpload(open.name)
      setRows((prev) => prev.map((r) => (r.name === updated.name ? updated : r)))
      setOpen(null)
    } catch (e) {
      setDiscardError(e.message || 'Could not discard this upload.')
    } finally {
      setDiscarding(false)
    }
  }

  useEffect(() => {
    getFacilityUploads(200).then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  }, [])

  const filtered = status ? rows.filter((r) => r.status === status) : rows.filter((r) => r.status !== 'Discarded')

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-100 flex-wrap">
        <h3 className="text-base font-semibold text-gray-900">Upload history</h3>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-gray-50">
          <option value="">All statuses</option>
          {Object.keys(STATUS_STYLES).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 text-xs bg-gray-50 border-b border-gray-100">
              <th className="px-5 py-3 font-medium">File</th>
              <th className="px-5 py-3 font-medium">Facility</th>
              <th className="px-5 py-3 font-medium">Weeks</th>
              <th className="px-5 py-3 font-medium">Cases</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : !filtered.length ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">No uploads yet</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.name} onClick={() => setOpen(r)} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                <td className="px-5 py-3">
                  <div className="text-gray-900">{r.fileName}</div>
                  <div className="text-xs text-gray-400">{r.fileType === 'Reporting' ? 'Reporting-rate file' : r.fileType === 'Cases' ? 'Cases file' : '—'} · {r.name}</div>
                </td>
                <td className="px-5 py-3 text-gray-700">{r.facility || <span className="text-gray-400">{r.unit || '—'}</span>}</td>
                <td className="px-5 py-3 text-gray-700 whitespace-nowrap">{r.weeks ? `${r.weeks} · ${fmtDate(r.firstWeek)} – ${fmtDate(r.lastWeek)}` : '—'}</td>
                <td className="px-5 py-3 text-gray-700">{r.fileType === 'Cases' ? r.cases : '—'}</td>
                <td className="px-5 py-3"><span className={['text-xs font-medium px-2.5 py-1 rounded-full', STATUS_STYLES[r.status]].join(' ')}>{r.status}</span></td>
                <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                  <div>{fmtDateTime(r.uploadedOn)}</div>
                  <div className="text-xs text-gray-400">{r.uploadedBy}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null) }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">{open.fileName}</h3>
                <p className="text-xs text-gray-400">{open.name}</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-2 text-sm">
              <Row label="Status" value={open.status} />
              <Row label="Facility" value={open.facility || '—'} />
              <Row label="Unit in file" value={open.unit || '—'} />
              <Row label="Weeks" value={open.weeks ? `${open.weeks} (${fmtDate(open.firstWeek)} – ${fmtDate(open.lastWeek)})` : '—'} />
              {open.fileType === 'Cases' && <Row label="Cases / deaths" value={`${open.cases} / ${open.deaths}`} />}
              <Row label="Uploaded" value={`${fmtDateTime(open.uploadedOn)} by ${open.uploadedBy || '—'}`} />
              {open.ingestedOn && <Row label="Saved" value={`${fmtDateTime(open.ingestedOn)} by ${open.ingestedBy || '—'}`} />}
              {open.error && <Note tone="red" icon={XCircle}>{open.error}</Note>}
              {open.summary?.diseases?.length > 0 && (
                <div className="pt-2">
                  <div className="text-xs font-semibold text-gray-500 mb-1">Diseases</div>
                  <div className="flex flex-wrap gap-1.5">
                    {open.summary.diseases.map((d) => <span key={d.key} className="text-[11px] bg-gray-100 rounded-full px-2 py-0.5 text-gray-700">{d.name} · {d.cases}</span>)}
                  </div>
                                </div>
              )}
              {discardError && <Note tone="red" icon={XCircle}>{discardError}</Note>}
            </div>
            {(open.status === 'Ready' || open.status === 'Failed') && (
              <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
                <p className="text-xs text-gray-500 mr-auto self-center">This upload was never saved, so discarding it changes no data.</p>
                <button onClick={discardOpen} disabled={discarding} className="border border-red-200 bg-white text-red-600 hover:bg-red-50 rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-60">
                  {discarding && <Loader2 className="w-4 h-4 animate-spin" />}
                  Discard upload
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-900 text-right">{value}</span>
    </div>
  )
}

/* ---------------- Facilities ---------------- */

function FacilitiesTab({ version, onAdd, onEdit }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getReportingFacilities().then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  }, [version])

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-100">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Reporting facilities</h3>
          <p className="text-xs text-gray-400">Which facility each KHIS file belongs to, and the sub-county its cases count under.</p>
        </div>
        <button onClick={onAdd} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add facility
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 text-xs bg-gray-50 border-b border-gray-100">
            <th className="px-5 py-3 font-medium">Facility</th>
            <th className="px-5 py-3 font-medium">Name in KHIS files</th>
            <th className="px-5 py-3 font-medium">Sub-county</th>
            <th className="px-5 py-3 font-medium">Weeks loaded</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">Loading…</td></tr>
          ) : !rows.length ? (
            <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">No facilities yet</td></tr>
          ) : rows.map((f) => (
            <tr key={f.name} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-5 py-3 text-gray-900 font-medium">{f.name}</td>
              <td className="px-5 py-3"><code className="text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">{f.khisMatch}</code></td>
              <td className="px-5 py-3 text-gray-700">{f.county} / {f.subCountyName}</td>
              <td className="px-5 py-3 text-gray-700">{f.weeksLoaded}</td>
              <td className="px-5 py-3">
                <span className={['text-xs font-medium px-2.5 py-1 rounded-full', f.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'].join(' ')}>{f.active ? 'Active' : 'Inactive'}</span>
              </td>
              <td className="px-5 py-3 text-right">
                <button onClick={() => onEdit(f)} className="text-gray-500 hover:text-gray-800" title="Edit"><Pencil className="w-4 h-4" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FacilityModal({ facility, prefillUnit, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    facilityName: facility?.name || '',
    khisMatch: facility?.khisMatch || (prefillUnit ? prefillUnit.toLowerCase().replace(/\b(hospital|health centre|health center|dispensary|clinic|sub[- ]county)\b/g, '').trim() : ''),
    subCounty: facility?.subCounty || '',
    active: facility ? facility.active : true,
  }))
  const [subCounties, setSubCounties] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { getSubCounties('').then(setSubCounties).catch(() => setSubCounties([])) }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const matches = useMemo(() => {
    if (!prefillUnit || !form.khisMatch) return null
    try { return new RegExp(form.khisMatch, 'i').test(prefillUnit) } catch { return prefillUnit.toLowerCase().includes(form.khisMatch.toLowerCase()) }
  }, [prefillUnit, form.khisMatch])

  async function save() {
    setError('')
    if (!form.facilityName.trim() || !form.khisMatch.trim() || !form.subCounty) {
      setError('Facility name, name in KHIS files and sub-county are required.')
      return
    }
    setSaving(true)
    try {
      await saveReportingFacility({ name: facility?.name, ...form })
      onSaved()
    } catch (e) {
      setError(e.message || 'Could not save the facility.')
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center"><Building2 className="w-5 h-5 text-red-600" /></div>
            <div>
              <h3 className="font-bold text-gray-900">{facility ? 'Edit facility' : 'Add facility'}</h3>
              <p className="text-xs text-gray-400">{prefillUnit ? `From the file: “${prefillUnit}”` : 'A health facility that sends MOH 505 reports'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Facility name <span className="text-red-600">*</span></label>
            <input value={form.facilityName} disabled={!!facility} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} className={field + ' disabled:bg-gray-50 disabled:text-gray-400'} placeholder="e.g. Ifo" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Name in KHIS files <span className="text-red-600">*</span></label>
            <input value={form.khisMatch} onChange={(e) => setForm({ ...form, khisMatch: e.target.value })} className={field + ' font-mono'} placeholder="e.g. ifo" />
            <p className="text-xs text-gray-400 mt-1">A word from the organisation unit name at the top of this facility's KHIS exports. Not case-sensitive.</p>
            {matches === true && <p className="text-xs text-green-700 mt-1 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Matches the file.</p>}
            {matches === false && <p className="text-xs text-amber-700 mt-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Doesn't match “{prefillUnit}” yet.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Sub-county <span className="text-red-600">*</span></label>
            <select value={form.subCounty} onChange={(e) => setForm({ ...form, subCounty: e.target.value })} className={field}>
              <option value="">Select a sub-county</option>
              {subCounties.map((s) => <option key={s.name} value={s.name}>{s.sub_county_name} · {s.county}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">This facility's cases count under this sub-county for outbreak detection.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 accent-red-600" />
            Active (files from this facility are accepted)
          </label>
          {error && <Note tone="red" icon={XCircle}>{error}</Note>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
          <button onClick={onClose} className="border border-gray-200 bg-white rounded-lg px-5 py-2.5 text-sm font-semibold">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {facility ? 'Save changes' : 'Add facility'}
          </button>
        </div>
      </div>
    </div>
  )
}
