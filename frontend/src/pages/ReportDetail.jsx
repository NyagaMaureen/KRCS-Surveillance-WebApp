import { useState, useMemo, useEffect, useRef } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, Camera, Mic, FileText, Paperclip, X, Loader2, File as FileIcon, Stethoscope, Check, HelpCircle } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getReport, updateReport, deleteDoc, uploadFile, getReferenceLabels, getDiseaseOptions, setSuspectedDisease, getReportCandidates, getReporterRole, getSubCounties, getRegions } from '../api/frappe'
import { parseReason } from '../components/risk/reasonParts'
import { CATEGORIES, AGE_GROUPS, ANIMAL_EXPOSURE_OPTIONS, formatDateTime } from '../data/formOptions'
import { useCapabilities } from '../context/CapabilitiesContext'

const CLASSIFIED_BY_BADGES = {
  Rules: { label: 'Case definition', className: 'bg-blue-50 text-blue-600' },
  Officer: { label: 'Officer verified', className: 'bg-emerald-50 text-emerald-600' },
  Model: { label: 'AI model', className: 'bg-purple-50 text-purple-600' },
}

function alsoConsistentWith(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean)
}

function withCurrentValue(list, value) {
  return value && !list.includes(value) ? [...list, value] : list
}

const STATUS_COLORS = { Submitted: 'bg-amber-50 text-amber-600', Reviewed: 'bg-green-50 text-green-600', Linked: 'bg-red-50 text-red-700', Investigating: 'bg-blue-50 text-blue-600', Closed: 'bg-gray-100 text-gray-500' }
const CHANNEL_COLORS = { Mobile: 'bg-red-50 text-red-700', SMS: 'bg-green-50 text-green-600', USSD: 'bg-amber-50 text-amber-600', WhatsApp: 'bg-gray-100 text-gray-600', Web: 'bg-yellow-50 text-yellow-600' }
const statusColor = (s) => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'
const channelColor = (c) => CHANNEL_COLORS[c] || 'bg-gray-100 text-gray-600'
const symptomTags = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean)

const ATTACHMENT_TYPES = [
  { type: 'Photo', icon: Camera, accept: 'image/*' },
  { type: 'Voice Note', icon: Mic, accept: 'audio/*' },
  { type: 'Text Note', icon: FileText, accept: null },
  { type: 'Attachment', icon: Paperclip, accept: '' },
]

function formatReadableDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fileNameFromUrl(url) {
  return (url || '').split('/').pop() || 'File'
}

function SupportingInfoItem({ item, onOpenImage, onRemove }) {
  return (
    <div className="relative bg-gray-50 rounded-lg p-3">
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-red-700 hover:border-red-200 flex items-center justify-center shadow-sm transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      {item.attachment_type === 'Photo' && (
        <button type="button" onClick={() => onOpenImage(item.file)} className="block">
          <img src={item.file} alt="Attachment" className="w-24 h-24 object-cover rounded-lg hover:opacity-90 transition-opacity" />
        </button>
      )}
      {item.attachment_type === 'Voice Note' && (
        <audio controls preload="metadata" src={item.file} className="w-full max-w-full" />
      )}
      {item.attachment_type === 'Text Note' && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.text_content}</p>
      )}
      {item.attachment_type === 'Attachment' && (
        <a href={item.file} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-gray-700 hover:text-red-700 transition-colors">
          <FileIcon className="w-4 h-4 shrink-0" />
          <span className="truncate">{fileNameFromUrl(item.file)}</span>
        </a>
      )}
    </div>
  )
}

// "Which is it?" panel: the suggested diseases with their reasons (from ai_classifier.get_report_candidates).
const pct = (p) => `${Math.round(p * 100)}%`

// Per-disease precision in the app (ml/evaluate.py, precision_shown): of past clinic visits where the app
// would have suggested this disease, the share that really were it.
function pastRecord(why, name) {
  const r = why && why.record
  if (!r || r.right_when_shown == null) return ''
  const n = Math.round(r.right_when_shown * 10)
  const d = String(name || 'this disease').replace(/^Suspected\s+/i, '')
  return n === 0
    ? `In past clinic visits where ${d} was suggested, it was rarely correct.`
    : `In past clinic visits where ${d} was suggested, it was correct about ${n} times in 10.`
}

function ReasonRow({ icon: Icon, tone, label, items, question }) {
  if (!items || !items.length) return null
  return (
    <div className="flex items-start gap-1.5 text-xs leading-5">
      <Icon className={['w-3.5 h-3.5 mt-[3px] shrink-0', tone].join(' ')} aria-hidden="true" />
      <span className="text-gray-800"><span className="text-gray-500">{label}</span> {question ? items.map((x) => `${x}?`).join('  ') : items.join(', ')}</span>
    </div>
  )
}

function Reasons({ why, definition }) {
  if (!why) return null
  return (
    <div className="mt-2 space-y-0.5">
      <ReasonRow icon={Check} tone="text-emerald-600" label={definition ? 'Matches:' : 'Points to it:'} items={why.for} />
      <ReasonRow icon={X} tone="text-gray-400" label="Points away:" items={why.against} />
      <ReasonRow icon={HelpCircle} tone="text-blue-600" label="Ask the reporter:" items={why.ask} question />
      <ReasonRow icon={X} tone="text-red-500" label="Rules it out if present:" items={why.rulesOut} />
    </div>
  )
}

function DiseaseChoices({ cands, current, saving, onChoose }) {
  const list = cands.candidates || []
  const others = cands.modelOther || []
  const modelOnly = list.length > 0 && list.every((c) => c.source === 'Model')
  const best = modelOnly ? list.reduce((a, c) => ((c.probability || 0) > (a.probability || 0) ? c : a), list[0]) : null
  const lean = best && others[0] && others[0].probability > (best.probability || 0)
  return (
    <div className="mb-4">
      {list.length > 0 && <div className="text-xs font-medium text-gray-400 mb-2">Which is it? Choose the disease to investigate</div>}
      {lean && (
        <p className="mb-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The AI model finds a common illness ({others[0].disease}, {pct(others[0].probability)}) more likely than {best.name} ({pct(best.probability)}). Use the questions below before choosing.
        </p>
      )}
      {list.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((c) => {
            const on = current === c.key
            const definition = c.source !== 'Model'
            const record = pastRecord(c.why, c.name)
            return (
              <div key={c.key} className={['rounded-xl border p-3', on ? 'border-red-300 bg-red-50/60' : 'border-gray-200'].join(' ')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                    <div className="text-xs text-gray-500">
                      {definition ? 'Matches the case definition' : `AI model suggestion \u00b7 estimate ${pct(c.probability)}`}
                      {definition && c.probability ? ` \u00b7 AI model also ${pct(c.probability)}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={saving || on}
                    onClick={() => onChoose(c.key)}
                    className={['shrink-0 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors',
                      on ? 'border-red-200 bg-white text-red-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'].join(' ')}
                  >
                    {on && <Check className="w-3.5 h-3.5" aria-hidden="true" />}{on ? 'Chosen' : 'Choose'}
                  </button>
                </div>
                <Reasons why={c.why} definition={definition} />
                {record && <p className="mt-2 text-[11px] text-gray-400">{record}</p>}
              </div>
            )
          })}
        </div>
      )}
      {others.length > 0 && (
        <div className={list.length ? 'mt-3' : ''}>
          <div className="text-xs font-medium text-gray-400 mb-1.5">{list.length ? 'Or a common illness (not a priority disease)' : 'The AI model sees a common illness (not a priority disease)'}</div>
          <div className="space-y-2">
            {others.map((o) => (
              <div key={o.disease} className="rounded-xl bg-gray-50 px-3 py-2">
                <div className="text-sm font-medium text-gray-800">{o.disease} <span className="text-xs font-normal text-gray-500">{`\u00b7 estimate ${pct(o.probability)}`}</span></div>
                <Reasons why={o.why} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReportDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [mode, setMode] = useState('view')
  const [editForm, setEditForm] = useState({ location_name: '', status: '', additional_notes: '', category: '', onset_date: '', region: '', sub_county: '', latitude: null, longitude: null })
  const [editAttachments, setEditAttachments] = useState([])
  const [actionError, setActionError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [lightboxImage, setLightboxImage] = useState(null)
  const [uploading, setUploading] = useState({})
  const [uploadErrors, setUploadErrors] = useState({})
  const [showTextNote, setShowTextNote] = useState(false)
  const [textNoteValue, setTextNoteValue] = useState('')
  const [regionMap, setRegionMap] = useState({})
  const [subCounties, setSubCounties] = useState([])
  const [regions, setRegions] = useState([])
  const [diseaseOptions, setDiseaseOptions] = useState([])
  const [changingDisease, setChangingDisease] = useState(false)
  const [savingDisease, setSavingDisease] = useState(false)
  const [toast, setToast] = useState({ show: false, message: '', error: false })
  const toastTimerRef = useRef(null)
  const { has } = useCapabilities()
  const [reporterRole, setReporterRole] = useState('')
  useEffect(() => {
    if (!report?.name) return
    let live = true
    getReporterRole(report.name).then((r) => live && setReporterRole(r)).catch(() => live && setReporterRole(''))
    return () => { live = false }
  }, [report?.name])

  function showToast(message, error = false) {
    setToast({ show: true, message, error })
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000)
  }

  const fileInputRefs = {
    Photo: useRef(null),
    'Voice Note': useRef(null),
    Attachment: useRef(null),
  }

  const detailFields = useMemo(() => {
    if (!report) return []
    return [
      { label: 'Reporter', value: [report.reporter_name || report.reported_by, reporterRole].filter(Boolean).join(' \u00b7 ') },
      { label: 'Phone Number', value: report.phone_number },
      { label: 'Location', value: report.location_name },
      { label: 'Region', value: regionMap[report.region] || report.region },
      { label: 'Sub-county', value: report.sub_county },
      { label: 'Category', value: report.category },
      { label: 'Onset Date', value: formatReadableDate(report.onset_date) },
      { label: 'Affected Persons', value: report.affected_count },
      { label: 'Created at', value: formatDateTime(report.creation) },
      { label: 'Age Group', value: (AGE_GROUPS.find((g) => g.value === report.age_group) || {}).label, empty: 'Not recorded' },
      { label: 'Animal Exposure', value: (ANIMAL_EXPOSURE_OPTIONS.find((o) => o.value === report.animal_exposure) || {}).label, empty: 'Not recorded' },
      { label: 'Number of Deaths', value: report.deaths_count === null || report.deaths_count === undefined ? '' : String(report.deaths_count), empty: 'Not recorded' },
    ]
  }, [report, regionMap, reporterRole])

  const diseaseName = useMemo(() => {
    const d = diseaseOptions.find((o) => o.key === report?.suspected_disease)
    return d ? d.name : ''
  }, [diseaseOptions, report])

  const classificationLines = useMemo(() => {
    const reason = report?.classification_reason || ''
    const idx = reason.indexOf('\nRules view:')
    if (idx === -1) return { decision: reason, rulesView: '' }
    return { decision: reason.slice(0, idx), rulesView: reason.slice(idx + 1).replace(/^Rules view:\s*/, '') }
  }, [report])

  const [cands, setCands] = useState(null)
  useEffect(() => {
    if (!report?.name || !has('verify_suspected_disease')) return
    let live = true
    getReportCandidates(report.name).then((c) => live && setCands(c)).catch(() => live && setCands(null))
    return () => { live = false }
  }, [report?.name, report?.suspected_disease, report?.classified_by]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleChangeDisease(key) {
    setSavingDisease(true)
    try {
      const updated = await setSuspectedDisease(report.name, key)
      setReport((prev) => ({ ...prev, ...updated }))
      setChangingDisease(false)
      showToast('Suspected disease updated')
    } catch (e) {
      showToast(e.message || 'Could not update suspected disease', true)
    } finally {
      setSavingDisease(false)
    }
  }

  const categoryOptions = useMemo(() => withCurrentValue(CATEGORIES, report?.category), [report])
  const attachments = report?.attachments || []

  function startEdit() {
    setActionError('')
    setEditForm({
      location_name: report.location_name || '',
      status: report.status || '',
      additional_notes: report.additional_notes || '',
      category: report.category || '',
      onset_date: report.onset_date || '',
      region: report.region || '',
      sub_county: report.sub_county || '',
      latitude: report.latitude ?? null,
      longitude: report.longitude ?? null,
    })
    setEditAttachments(attachments)
    setUploadErrors({})
    setShowTextNote(false)
    setTextNoteValue('')
    setMode('edit')
  }

  function cancelEdit() {
    setEditAttachments(attachments)
    setShowTextNote(false)
    setTextNoteValue('')
    setMode('view')
  }

  function addAttachment(attachment) {
    setEditAttachments((prev) => [...prev, attachment])
  }

  function removeAttachment(index) {
    setEditAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleFileSelected(type, e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setUploadErrors((prev) => ({ ...prev, [type]: '' }))
    setUploading((prev) => ({ ...prev, [type]: true }))
    try {
      const fileUrl = await uploadFile(file, type === 'Photo' ? 0 : 1)
      addAttachment({ attachment_type: type, file: fileUrl, text_content: '' })
    } catch (err) {
      setUploadErrors((prev) => ({ ...prev, [type]: err.message || 'Upload failed' }))
    } finally {
      setUploading((prev) => ({ ...prev, [type]: false }))
    }
  }

  function confirmTextNote() {
    if (!textNoteValue.trim()) { setShowTextNote(false); return }
    addAttachment({ attachment_type: 'Text Note', file: '', text_content: textNoteValue.trim() })
    setTextNoteValue('')
    setShowTextNote(false)
  }

  async function saveEdit() {
    setActionError('')
    if (!editForm.sub_county) {
      setActionError('Select a sub-county')
      return
    }
    setSaving(true)
    try {
      const updated = await updateReport(report.name, { ...editForm, attachments: editAttachments })
      setReport({ ...report, ...updated })
      setMode('view')
    } catch (e) {
      setActionError(e.message || 'Something went wrong saving the report.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    setActionError('')
    setDeleting(true)
    try {
      await deleteDoc('Case Report', report.name)
      navigate('/reports')
    } catch (e) {
      setActionError(e.message || 'Something went wrong deleting the report.')
      setDeleting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    getReport(id)
      .then((doc) => { if (!cancelled) setReport(doc) })
      .catch((e) => { if (!cancelled) setLoadError(e.message || 'Could not load report details.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    getReferenceLabels().then((labels) => setRegionMap(labels.regions || {}))
    getDiseaseOptions().then(setDiseaseOptions)
    getRegions().then(setRegions)
  }, [])

  useEffect(() => {
    if (mode !== 'edit' || !editForm.region) { setSubCounties([]); return }
    getSubCounties(editForm.region).then((list) => {
      setSubCounties(list)
      setEditForm((f) => (list.some((s) => s.name === f.sub_county) ? f : { ...f, sub_county: list.length === 1 ? list[0].name : '' }))
    })
  }, [mode, editForm.region])

  return (
    <AppShell>
      <div>
        <Link to="/reports" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Reports
        </Link>

        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-24 text-center text-sm text-gray-400">
            Loading report...
          </div>
        ) : loadError ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-24 text-center">
            <p className="text-sm text-red-700 mb-4">{loadError}</p>
            <Link to="/reports" className="text-sm font-semibold text-red-700 hover:underline">Return to Reports</Link>
          </div>
        ) : report && (
          <div className="bg-white rounded-2xl border border-gray-100">
            <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-xl font-bold text-brand-navy">{report.name}</h2>
                  <span className={['text-xs font-semibold px-2.5 py-1 rounded-full', statusColor(report.status)].join(' ')}>{report.status}</span>
                </div>
                <p className="text-sm text-gray-400">Submitted {formatDateTime(report.creation)} via {(report.channel || '—').toUpperCase()}</p>
              </div>

              {mode === 'view' && (has('edit_reports') || has('delete_reports')) && (
                <div className="flex gap-2">
                  {has('edit_reports') && <button
                    onClick={startEdit}
                    className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-amber-100 transition-colors"
                  >
                    <Pencil className="w-4 h-4" /> Edit
                  </button>}
                  {has('delete_reports') && <button
                    onClick={() => setConfirmingDelete(true)}
                    className="inline-flex items-center gap-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>}
                </div>
              )}
            </div>

            <div className="p-6">
              {actionError && <p className="text-red-700 text-sm mb-4">{actionError}</p>}

              {mode === 'view' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5 mb-8">
                    {detailFields.map((f) => (
                      <div key={f.label}>
                        <div className="text-xs font-medium text-gray-400 mb-1">{f.label}</div>
                        <div className="text-sm font-medium text-gray-900">{f.value || f.empty || '—'}</div>
                      </div>
                    ))}
                    <div>
                      <div className="text-xs font-medium text-gray-400 mb-1">Channel</div>
                      <span className={['inline-block text-xs font-semibold px-2.5 py-1 rounded-full', channelColor(report.channel)].join(' ')}>{(report.channel || '—').toUpperCase()}</span>
                    </div>
                  </div>
                                    <div className="mb-8 -mt-4 text-sm">
                    {report.latitude != null && report.longitude != null && (Number(report.latitude) || Number(report.longitude)) ? (
                      <a
                        href={`https://www.google.com/maps?q=${report.latitude},${report.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-red-700 font-semibold hover:underline"
                      >
                        Open in Maps ({Number(report.latitude).toFixed(5)}, {Number(report.longitude).toFixed(5)})
                      </a>
                    ) : (
                      <span className="text-gray-400">No GPS recorded</span>
                    )}
                  </div>

                  <div className="pt-6 border-t border-gray-100 mb-8">
                    <div className="text-xs font-medium text-gray-400 mb-2">Symptoms</div>
                    {symptomTags(report.symptom_tags).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {symptomTags(report.symptom_tags).map((s) => (
                          <span key={s} className="bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full">{s}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">
                        {report.animal_exposure && report.animal_exposure !== 'None' ? 'No symptoms recorded' : '—'}
                      </span>
                    )}
                    {report.animal_exposure && report.animal_exposure !== 'None' && (
                      <div className="flex justify-between border-t border-gray-100 mt-4 pt-3 text-sm">
                        <span className="text-gray-400">Animal exposure</span>
                        <span className="font-medium text-gray-900">{report.animal_exposure}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-6 border-t border-gray-100 mb-8">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-gray-900">Suspected Disease</h3>
                        {report.classified_by && CLASSIFIED_BY_BADGES[report.classified_by] && (
                          <span className={['text-xs font-semibold px-2.5 py-1 rounded-full', CLASSIFIED_BY_BADGES[report.classified_by].className].join(' ')}>
                            {CLASSIFIED_BY_BADGES[report.classified_by].label}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 mb-3">
                      <Stethoscope className="w-5 h-5 text-red-700 shrink-0" />
                      <span className={['text-lg font-bold', report.suspected_disease ? 'text-gray-900' : 'text-gray-400'].join(' ')}>
                        {report.suspected_disease ? (diseaseName || report.suspected_disease) : 'Not classified'}
                      </span>
                    </div>

                    {cands && ((cands.candidates || []).length > 0 || (cands.modelOther || []).length > 0) && (
                      <DiseaseChoices
                        cands={cands}
                        current={report.classified_by === 'Officer' ? report.suspected_disease : null}
                        saving={savingDisease}
                        onChoose={handleChangeDisease}
                      />
                    )}

                    {has('verify_suspected_disease') && !changingDisease && (
                      <button
                        type="button"
                        onClick={() => setChangingDisease(true)}
                        className="mb-3 text-xs font-medium text-red-700 hover:underline"
                      >
                        {cands && (cands.candidates || []).length > 0 ? 'None of these? Choose another disease' : report.suspected_disease ? 'Change the suspected disease' : 'Choose a disease'}
                      </button>
                    )}

                    {has('verify_suspected_disease') && changingDisease && (
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <select
                          autoFocus
                          defaultValue=""
                          disabled={savingDisease}
                          onChange={(e) => handleChangeDisease(e.target.value === '__rules__' ? '' : e.target.value)}
                          className="w-full sm:w-72 bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100"
                        >
                          <option value="" disabled>Select a disease...</option>
                          <option value="__rules__">Let the case definition decide</option>
                          {diseaseOptions.map((d) => (
                            <option key={d.key} value={d.key}>{d.name}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => setChangingDisease(false)} className="text-xs font-medium text-gray-500 hover:text-gray-900">
                          Cancel
                        </button>
                      </div>
                    )}

                    {report.classification_reason && (() => {
                      const byPerson = report.classified_by === 'Officer'
                      const dec = parseReason(classificationLines.decision)
                      const rules = classificationLines.rulesView ? parseReason(classificationLines.rulesView) : null
                      return (
                        <div className="mb-3">
                          {byPerson ? (
                            <>
                              <p className="text-sm text-gray-700">{classificationLines.decision}</p>
                              {rules && (
                                <p className="mt-1 text-xs text-gray-500">
                                  The case definition suggested: {rules.head.replace(/^Suspected\s+/i, '')}{rules.signs ? ` (${rules.signs})` : ''}
                                </p>
                              )}
                            </>
                          ) : dec.signs ? (
                            <>
                              <p className="text-sm text-gray-700"><span className="text-gray-400">Matched:</span> {dec.signs}</p>
                              {dec.note && <p className="mt-1 text-xs text-gray-500">{dec.note}</p>}
                              {dec.definition && (
                                <details className="mt-1.5 text-sm">
                                  <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-900">{dec.source || 'Official'} definition</summary>
                                  <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{dec.definition}</p>
                                </details>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-gray-700">{classificationLines.decision}</p>
                          )}
                        </div>
                      )
                    })()}

                    {alsoConsistentWith(report.also_consistent_with).length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-gray-400 mb-1.5">Also consistent with</div>
                        <div className="flex flex-wrap gap-1.5">
                          {alsoConsistentWith(report.also_consistent_with).map((d) => (
                            <span key={d} className="bg-gray-100 text-gray-600 text-xs font-medium px-2.5 py-1 rounded-full">{d}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-6 border-t border-gray-100 mb-8">
                    <div className="text-xs font-medium text-gray-400 mb-2">Additional Notes</div>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-4 leading-relaxed">{report.additional_notes || 'No additional notes provided.'}</p>
                  </div>

                  <div className="pt-6 border-t border-gray-100">
                    <div className="text-xs font-medium text-gray-400 mb-2">Attachments</div>
                    {attachments.length ? (
                      <div className="space-y-4">
                        {attachments.some((a) => a.attachment_type === 'Photo') && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1.5">Photos</div>
                            <div className="flex flex-wrap gap-3">
                              {attachments.filter((a) => a.attachment_type === 'Photo').map((item, i) => (
                                <SupportingInfoItem key={i} item={item} onOpenImage={setLightboxImage} />
                              ))}
                            </div>
                          </div>
                        )}
                        {attachments.some((a) => a.attachment_type === 'Voice Note') && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1.5">Voice notes</div>
                            <div className="flex flex-col gap-2 max-w-md">
                              {attachments.filter((a) => a.attachment_type === 'Voice Note').map((item, i) => (
                                <SupportingInfoItem key={i} item={item} onOpenImage={setLightboxImage} />
                              ))}
                            </div>
                          </div>
                        )}
                        {attachments.some((a) => a.attachment_type !== 'Photo' && a.attachment_type !== 'Voice Note') && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1.5">Other</div>
                            <div className="flex flex-wrap gap-3">
                              {attachments.filter((a) => a.attachment_type !== 'Photo' && a.attachment_type !== 'Voice Note').map((item, i) => (
                                <SupportingInfoItem key={i} item={item} onOpenImage={setLightboxImage} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">No attachments.</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-6">
                    <div>
                      <label className="block text-sm font-semibold mb-1">Location</label>
                      <input value={editForm.location_name} onChange={(e) => setEditForm({ ...editForm, location_name: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" placeholder="Location name" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Region</label>
                      <select value={editForm.region} onChange={(e) => setEditForm({ ...editForm, region: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                        <option value="">Select a region...</option>
                        {regions.map((r) => <option key={r.name} value={r.name}>{r.region_name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Sub-county <span className="text-red-700">*</span></label>
                      <select
                        value={editForm.sub_county}
                        onChange={(e) => setEditForm({ ...editForm, sub_county: e.target.value })}
                        disabled={!editForm.region}
                        className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 disabled:opacity-60"
                      >
                        <option value="">{editForm.region ? 'Select a sub-county...' : 'Select a region first'}</option>
                        {subCounties.map((s) => <option key={s.name} value={s.name}>{`${s.sub_county_name} · ${s.county}`}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Latitude</label>
                      <input type="number" step="any" value={editForm.latitude ?? ''} onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value === '' ? null : Number(e.target.value) })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" placeholder="Latitude" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Longitude</label>
                      <input type="number" step="any" value={editForm.longitude ?? ''} onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value === '' ? null : Number(e.target.value) })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" placeholder="Longitude" />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.geolocation.getCurrentPosition((pos) => {
                            setEditForm((f) => ({ ...f, latitude: pos.coords.latitude, longitude: pos.coords.longitude }))
                          }, undefined, { enableHighAccuracy: true })
                        }}
                        className="mt-2 text-xs font-semibold text-red-700 hover:underline"
                      >
                        Use my current location
                      </button>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Status</label>
                      <input type="text" value={editForm.status} disabled readOnly className="w-full bg-gray-100 text-gray-500 rounded-lg px-4 py-2.5 text-sm cursor-not-allowed" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Category</label>
                      <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                        <option value="">Select category...</option>
                        {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Onset Date</label>
                      <input type="date" value={editForm.onset_date} onChange={(e) => setEditForm({ ...editForm, onset_date: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Reported By</label>
                      <input value={report.reporter_name || report.reported_by || ''} readOnly disabled className="w-full bg-gray-100 rounded-lg px-4 py-2.5 text-sm text-gray-500 cursor-not-allowed" />
                    </div>
                  </div>

                  <label className="block text-sm font-semibold mb-1">Additional Notes</label>
                  <textarea value={editForm.additional_notes} onChange={(e) => setEditForm({ ...editForm, additional_notes: e.target.value })} rows={4} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-6 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" placeholder="Describe the situation..."></textarea>

                  <div className="mb-6">
                    <div className="text-sm font-semibold mb-2">Supporting Information</div>

                    {editAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-3 mb-4">
                        {editAttachments.map((item, i) => (
                          <SupportingInfoItem key={i} item={item} onOpenImage={setLightboxImage} onRemove={() => removeAttachment(i)} />
                        ))}
                      </div>
                    )}

                    <div className="text-xs font-medium text-gray-400 mb-2">Add Supporting Info</div>
                    <div className="flex gap-3 mb-2">
                      {ATTACHMENT_TYPES.map(({ type, icon: Icon, accept }) => (
                        <div key={type} className="flex flex-col items-center">
                          <button
                            type="button"
                            onClick={() => {
                              if (type === 'Text Note') { setShowTextNote((prev) => !prev); return }
                              fileInputRefs[type].current && fileInputRefs[type].current.click()
                            }}
                            disabled={uploading[type]}
                            className="w-12 h-12 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors disabled:opacity-60"
                          >
                            {uploading[type] ? <Loader2 className="w-5 h-5 animate-spin text-red-700" /> : <Icon className="w-5 h-5 text-gray-500" />}
                          </button>
                          <span className="text-[11px] text-gray-500 mt-1 text-center">{type}</span>
                          {uploadErrors[type] && <span className="text-[10px] text-red-700 mt-0.5 text-center max-w-[80px]">{uploadErrors[type]}</span>}
                          {accept !== null && (
                            <input
                              ref={fileInputRefs[type]}
                              type="file"
                              accept={accept}
                              className="hidden"
                              onChange={(e) => handleFileSelected(type, e)}
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    {showTextNote && (
                      <div className="mt-2 bg-gray-50 rounded-lg p-3">
                        <textarea
                          value={textNoteValue}
                          onChange={(e) => setTextNoteValue(e.target.value)}
                          rows={3}
                          className="w-full bg-white rounded-lg px-3 py-2 text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow"
                          placeholder="Type a note..."
                        ></textarea>
                        <div className="flex justify-end gap-2 mt-2">
                          <button type="button" onClick={() => { setShowTextNote(false); setTextNoteValue('') }} className="text-xs font-semibold text-gray-500 px-3 py-1.5 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                          <button type="button" onClick={confirmTextNote} className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg transition-colors">Add Note</button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-3">
                    <button onClick={cancelEdit} className="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
                    <button onClick={saveEdit} disabled={saving} className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors">
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {lightboxImage && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setLightboxImage(null)}>
          <button onClick={() => setLightboxImage(null)} className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors">
            <X className="w-6 h-6" />
          </button>
          <img src={lightboxImage} alt="Attachment full size" className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {confirmingDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setConfirmingDelete(false) }}>
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h3 className="font-bold text-gray-900 mb-2">Delete Report</h3>
            <div className="bg-red-50 border border-red-100 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-700">Are you sure you want to delete report <span className="font-semibold">{report?.name}</span>? This action cannot be undone.</p>
            </div>
            {actionError && <p className="text-red-700 text-sm mb-4">{actionError}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmingDelete(false)} className="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors">
                {deleting ? 'Deleting...' : 'Delete Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
