import { useState, useMemo, useEffect, useRef } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, Camera, Mic, FileText, Paperclip, X, Loader2, File as FileIcon } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getReport, updateReport, deleteDoc, uploadFile, getReferenceLabels } from '../api/frappe'
import { STATUSES, CATEGORIES, SEXES, formatDateTime } from '../data/formOptions'

function withCurrentValue(list, value) {
  return value && !list.includes(value) ? [...list, value] : list
}

const STATUS_COLORS = { Submitted: 'bg-amber-50 text-amber-600', Reviewed: 'bg-green-50 text-green-600', Linked: 'bg-red-50 text-red-600', Investigating: 'bg-blue-50 text-blue-600', Closed: 'bg-gray-100 text-gray-500' }
const CHANNEL_COLORS = { Mobile: 'bg-red-50 text-red-600', SMS: 'bg-green-50 text-green-600', USSD: 'bg-amber-50 text-amber-600', WhatsApp: 'bg-gray-100 text-gray-600', Web: 'bg-yellow-50 text-yellow-600' }
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
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 flex items-center justify-center shadow-sm transition-colors"
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
        <audio controls src={item.file} className="max-w-full" />
      )}
      {item.attachment_type === 'Text Note' && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.text_content}</p>
      )}
      {item.attachment_type === 'Attachment' && (
        <a href={item.file} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-gray-700 hover:text-red-600 transition-colors">
          <FileIcon className="w-4 h-4 shrink-0" />
          <span className="truncate">{fileNameFromUrl(item.file)}</span>
        </a>
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
  const [editForm, setEditForm] = useState({ location_name: '', status: '', additional_notes: '', category: '', sex: '', onset_date: '' })
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

  const fileInputRefs = {
    Photo: useRef(null),
    'Voice Note': useRef(null),
    Attachment: useRef(null),
  }

  const detailFields = useMemo(() => {
    if (!report) return []
    return [
      { label: 'Reporter', value: report.reporter_name },
      { label: 'Phone Number', value: report.phone_number },
      { label: 'Location', value: report.location_name },
      { label: 'Region', value: regionMap[report.region] || report.region },
      { label: 'Category', value: report.category },
      { label: 'Sex', value: report.sex },
      { label: 'Onset Date', value: formatReadableDate(report.onset_date) },
      { label: 'Affected Persons', value: report.affected_count },
      { label: 'Reported By', value: report.reporter_name || report.reported_by },
    ]
  }, [report, regionMap])

  const statusOptions = useMemo(() => withCurrentValue(STATUSES, report?.status), [report])
  const categoryOptions = useMemo(() => withCurrentValue(CATEGORIES, report?.category), [report])
  const sexOptions = useMemo(() => withCurrentValue(SEXES, report?.sex), [report])
  const attachments = report?.attachments || []

  function startEdit() {
    setActionError('')
    setEditForm({
      location_name: report.location_name || '',
      status: report.status || '',
      additional_notes: report.additional_notes || '',
      category: report.category || '',
      sex: report.sex || '',
      onset_date: report.onset_date || '',
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
  }, [])

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
            <p className="text-sm text-red-500 mb-4">{loadError}</p>
            <Link to="/reports" className="text-sm font-semibold text-red-600 hover:underline">Return to Reports</Link>
          </div>
        ) : report && (
          <div className="bg-white rounded-2xl border border-gray-100">
            <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-xl font-bold text-gray-900">{report.name}</h2>
                  <span className={['text-xs font-semibold px-2.5 py-1 rounded-full', statusColor(report.status)].join(' ')}>{report.status}</span>
                </div>
                <p className="text-sm text-gray-400">Submitted {formatDateTime(report.creation)} via {(report.channel || '—').toUpperCase()}</p>
              </div>

              {mode === 'view' && (
                <div className="flex gap-2">
                  <button
                    onClick={startEdit}
                    className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-amber-100 transition-colors"
                  >
                    <Pencil className="w-4 h-4" /> Edit
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    className="inline-flex items-center gap-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              )}
            </div>

            <div className="p-6">
              {actionError && <p className="text-red-600 text-sm mb-4">{actionError}</p>}

              {mode === 'view' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5 mb-8">
                    {detailFields.map((f) => (
                      <div key={f.label}>
                        <div className="text-xs font-medium text-gray-400 mb-1">{f.label}</div>
                        <div className="text-sm font-medium text-gray-900">{f.value || '—'}</div>
                      </div>
                    ))}
                    <div>
                      <div className="text-xs font-medium text-gray-400 mb-1">Channel</div>
                      <span className={['inline-block text-xs font-semibold px-2.5 py-1 rounded-full', channelColor(report.channel)].join(' ')}>{(report.channel || '—').toUpperCase()}</span>
                    </div>
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
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </div>

                  <div className="pt-6 border-t border-gray-100 mb-8">
                    <div className="text-xs font-medium text-gray-400 mb-2">Additional Notes</div>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-4 leading-relaxed">{report.additional_notes || 'No additional notes provided.'}</p>
                  </div>

                  <div className="pt-6 border-t border-gray-100">
                    <div className="text-xs font-medium text-gray-400 mb-2">Supporting Information</div>
                    {attachments.length ? (
                      <div className="flex flex-wrap gap-3">
                        {attachments.map((item, i) => (
                          <SupportingInfoItem key={i} item={item} onOpenImage={setLightboxImage} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">No supporting information attached.</span>
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
                      <label className="block text-sm font-semibold mb-1">Status</label>
                      <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                        {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Category</label>
                      <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                        <option value="">Select category...</option>
                        {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1">Sex</label>
                      <select value={editForm.sex} onChange={(e) => setEditForm({ ...editForm, sex: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                        <option value="">Select sex...</option>
                        {sexOptions.map((s) => <option key={s} value={s}>{s}</option>)}
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
                            {uploading[type] ? <Loader2 className="w-5 h-5 animate-spin text-red-600" /> : <Icon className="w-5 h-5 text-gray-500" />}
                          </button>
                          <span className="text-[11px] text-gray-500 mt-1 text-center">{type}</span>
                          {uploadErrors[type] && <span className="text-[10px] text-red-600 mt-0.5 text-center max-w-[80px]">{uploadErrors[type]}</span>}
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
            {actionError && <p className="text-red-600 text-sm mb-4">{actionError}</p>}
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
