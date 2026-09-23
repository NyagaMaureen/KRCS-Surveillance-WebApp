import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Loader2, CheckCircle2, AlertCircle, Camera, Mic, FileText, Paperclip, X } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getList, createReport, getMyProfile, uploadFile } from '../api/frappe'
import { CATEGORIES, SEXES } from '../data/formOptions'

const steps = ['Reporter Info', 'Symptoms', 'Details', 'Review Report']

const ATTACHMENT_TYPES = [
  { type: 'Photo', icon: Camera, accept: 'image/*' },
  { type: 'Voice Note', icon: Mic, accept: 'audio/*' },
  { type: 'Text Note', icon: FileText, accept: null },
  { type: 'Attachment', icon: Paperclip, accept: '' },
]

function formatCoords(lat, lng) {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}\u00b0${latDir}, ${Math.abs(lng).toFixed(4)}\u00b0${lngDir}`
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10)
}

function formatReadableDate(value) {
  if (!value) return '\u2014'
  return new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' })
}

export default function RecordHealthSignal() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(1)
  const [regions, setRegions] = useState([])
  const [symptoms, setSymptoms] = useState([])
  const [gpsLabel, setGpsLabel] = useState('GPS not captured yet')
  const [gpsState, setGpsState] = useState('idle')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState({})
  const [uploadErrors, setUploadErrors] = useState({})
  const [showTextNote, setShowTextNote] = useState(false)
  const [textNoteValue, setTextNoteValue] = useState('')

  const fileInputRefs = {
    Photo: useRef(null),
    'Voice Note': useRef(null),
    Attachment: useRef(null),
  }

  const [form, setForm] = useState({
    reported_by: '', reporter_name: '', phone_number: '',
    signal_type: '', category: '', region: '', location_name: '',
    latitude: null, longitude: null, affected_count: '', sex: '',
    symptoms: [], onset_date: '', attachments: [], additional_notes: '',
  })

  function updateForm(fields) {
    setForm((prev) => ({ ...prev, ...fields }))
  }

  function toggleSymptom(name) {
    setForm((prev) => ({
      ...prev,
      symptoms: prev.symptoms.includes(name) ? prev.symptoms.filter((s) => s !== name) : [...prev.symptoms, name],
    }))
  }

  const symptomCategories = useMemo(() => [...new Set(symptoms.map((s) => s.category))], [symptoms])
  const symptomsByCategory = (cat) => symptoms.filter((s) => s.category === cat)
  const regionLabel = useMemo(() => (regions.find((r) => r.name === form.region) || {}).region_name || '', [regions, form.region])
  const symptomLabels = useMemo(() => form.symptoms.map((id) => (symptoms.find((s) => s.name === id) || {}).symptom_name).filter(Boolean), [form.symptoms, symptoms])

  function captureGPS() {
    if (!navigator.geolocation) { setGpsLabel('GPS not supported on this device/browser.'); return }
    setGpsState('loading')
    setGpsLabel('Capturing location...')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latitude = pos.coords.latitude
        const longitude = pos.coords.longitude
        updateForm({ latitude, longitude })
        setGpsState('success')
        setGpsLabel(`GPS: ${formatCoords(latitude, longitude)} (accuracy \u00b1${Math.round(pos.coords.accuracy)}m)`)
      },
      () => {
        setGpsState('error')
        setGpsLabel('Could not get location \u2014 check browser permission, or enter location name manually.')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function setOnsetToday() {
    updateForm({ onset_date: toDateInputValue(new Date()) })
  }

  function setOnsetYesterday() {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    updateForm({ onset_date: toDateInputValue(d) })
  }

  function setOnsetThisWeek() {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    updateForm({ onset_date: toDateInputValue(d) })
  }

  function addAttachment(attachment) {
    setForm((prev) => ({ ...prev, attachments: [...prev.attachments, attachment] }))
  }

  function removeAttachment(index) {
    setForm((prev) => ({ ...prev, attachments: prev.attachments.filter((_, i) => i !== index) }))
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

  function attachmentPreview(a) {
    if (a.attachment_type === 'Text Note') return a.text_content
    return a.file.split('/').pop()
  }

  async function submitReport() {
    setSubmitError('')
    setSubmitting(true)
    try {
      await createReport({
        reported_by: form.reported_by, reporter_name: form.reporter_name, phone_number: form.phone_number,
        signal_type: form.signal_type, category: form.category,
        region: form.region, location_name: form.location_name, latitude: form.latitude, longitude: form.longitude,
        affected_count: form.affected_count, sex: form.sex,
        symptoms: form.symptoms.map((s) => ({ symptom: s })),
        onset_date: form.onset_date, attachments: form.attachments,
        additional_notes: form.additional_notes, channel: 'Web', status: 'Submitted',
      })
      navigate('/reports')
    } catch (e) {
      setSubmitError(e.message || 'Something went wrong submitting the report.')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    getList('Region', ['name', 'region_name']).then(setRegions)
    getList('Symptom', ['name', 'symptom_name', 'category']).then(setSymptoms)
    getMyProfile().then((profile) => {
      updateForm({
        reported_by: profile.name || '',
        reporter_name: profile.full_name || '',
        phone_number: profile.phone_number || '',
      })
    })
  }, [])

  return (
    <AppShell>
      <div className="w-full">
        <h2 className="text-xl font-bold text-gray-900">Record Health Signal</h2>
        <p className="text-sm text-gray-400 mb-8">Quick community or facility health surveillance signal recording</p>

        <div className="flex items-center mb-8">
          {steps.map((label, i) => (
            <div key={label} className={['flex items-center', i < steps.length - 1 ? 'flex-1' : ''].join(' ')}>
              <div className="flex flex-col items-center">
                <div className={['w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors', i + 1 <= currentStep ? 'bg-red-600 text-white shadow-sm shadow-red-200' : 'bg-gray-200 text-gray-500'].join(' ')}>{i + 1}</div>
                <div className={['text-xs mt-1.5 whitespace-nowrap', i + 1 <= currentStep ? 'text-red-600 font-semibold' : 'text-gray-400'].join(' ')}>{label}</div>
              </div>
              {i < steps.length - 1 && (
                <div className={['flex-1 h-0.5 mx-2 rounded-full transition-colors', i + 1 < currentStep ? 'bg-red-600' : 'bg-gray-200'].join(' ')}></div>
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 lg:p-10 w-full">

          {currentStep === 1 && (
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-4">Reporter Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Category</label>
                  <select value={form.category} onChange={(e) => updateForm({ category: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
                    <option value="">Select category</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Signal Type</label>
                  <select value={form.signal_type} onChange={(e) => updateForm({ signal_type: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
                    <option value="">Select signal type</option>
                    <option>Suspected Outbreak</option><option>Community Signal</option><option>Facility Signal</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Region</label>
                  <select value={form.region} onChange={(e) => updateForm({ region: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
                    <option value="">Select region</option>
                    {regions.map((r) => <option key={r.name} value={r.name}>{r.region_name}</option>)}
                  </select>
                </div>
              </div>
              <label className="block text-sm font-semibold mb-1">Location</label>
              <div className="flex gap-2 mb-1">
                <input value={form.location_name} onChange={(e) => updateForm({ location_name: e.target.value })} className="flex-1 bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow" placeholder="Location name" />
                <button
                  type="button"
                  onClick={captureGPS}
                  disabled={gpsState === 'loading'}
                  className={['border rounded-lg px-4 flex items-center justify-center transition-colors', gpsState === 'success' ? 'border-green-200 bg-green-50 text-green-600' : gpsState === 'error' ? 'border-red-200 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300'].join(' ')}
                >
                  {gpsState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : gpsState === 'success' ? <CheckCircle2 className="w-4 h-4" /> : gpsState === 'error' ? <AlertCircle className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                </button>
              </div>
              <div
                className={['inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 mb-8', gpsState === 'success' ? 'bg-green-50 text-green-600' : gpsState === 'error' ? 'bg-red-50 text-red-600' : gpsState === 'loading' ? 'bg-amber-50 text-amber-600' : 'text-gray-400'].join(' ')}
              >
                {gpsState === 'loading' && <Loader2 className="w-3 h-3 animate-spin" />}
                {gpsState === 'success' && <CheckCircle2 className="w-3 h-3" />}
                {gpsState === 'error' && <AlertCircle className="w-3 h-3" />}
                {gpsLabel}
              </div>
              <div className="flex justify-end">
                <button onClick={() => setCurrentStep(2)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">Continue</button>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-4">Affected Person Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-semibold mb-1">Number of Affected Persons</label>
                  <input value={form.affected_count} onChange={(e) => updateForm({ affected_count: e.target.value })} type="number" min="0" className="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow" placeholder="Estimated count" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Sex</label>
                  <select value={form.sex} onChange={(e) => updateForm({ sex: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
                    <option value="">Select sex</option>
                    {SEXES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <h3 className="text-sm font-bold text-gray-900 mb-3 pt-2 border-t border-gray-100">Select All Observed Symptoms</h3>
              {symptomCategories.map((cat) => (
                <div key={cat}>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mt-4 mb-2">{cat}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {symptomsByCategory(cat).map((s) => (
                      <label
                        key={s.name}
                        className={['flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors', form.symptoms.includes(s.name) ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 hover:bg-gray-50'].join(' ')}
                      >
                        <input type="checkbox" checked={form.symptoms.includes(s.name)} onChange={() => toggleSymptom(s.name)} className="accent-red-600" /> {s.symptom_name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex justify-between mt-6">
                <button onClick={() => setCurrentStep(1)} className="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Back</button>
                <button onClick={() => setCurrentStep(3)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">Continue</button>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-4">Additional Details</h3>

              <label className="block text-sm font-semibold mb-1">When Did It Start?</label>
              <div className="flex flex-col sm:flex-row gap-2 mb-6">
                <input type="date" value={form.onset_date} onChange={(e) => updateForm({ onset_date: e.target.value })} className="sm:flex-1 bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow" />
                <div className="flex gap-2">
                  <button type="button" onClick={setOnsetToday} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-gray-50 transition-colors">Today</button>
                  <button type="button" onClick={setOnsetYesterday} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-gray-50 transition-colors">Yesterday</button>
                  <button type="button" onClick={setOnsetThisWeek} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-gray-50 transition-colors">This Week</button>
                </div>
              </div>

              <h3 className="text-sm font-bold text-gray-900 mb-3">Add Supporting Info</h3>
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
                <div className="mb-4 bg-gray-50 rounded-lg p-3">
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

              {form.attachments.length > 0 && (
                <div className="mb-6 space-y-2">
                  {form.attachments.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-gray-500 shrink-0">{a.attachment_type}</span>
                        <span className="text-gray-700 truncate">{attachmentPreview(a)}</span>
                      </div>
                      <button type="button" onClick={() => removeAttachment(i)} className="text-gray-400 hover:text-red-600 transition-colors shrink-0 ml-2">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label className="block text-sm font-semibold mb-1">Additional Notes</label>
              <textarea value={form.additional_notes} onChange={(e) => updateForm({ additional_notes: e.target.value })} rows={4} className="w-full bg-gray-50 rounded-lg px-4 py-3 mb-6 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow" placeholder="Describe the situation..."></textarea>

              <div className="flex justify-between">
                <button onClick={() => setCurrentStep(2)} className="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Back</button>
                <button onClick={() => setCurrentStep(4)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">Continue</button>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div>
              <h3 className="font-bold text-center text-gray-900 mb-6">Review your report</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm mb-6">
                <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-400">Category</span><span className="font-medium">{form.category || '\u2014'}</span></div>
                <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-400">Signal Type</span><span className="font-medium">{form.signal_type || '\u2014'}</span></div>
                <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-400">Region</span><span className="font-medium">{regionLabel || '\u2014'}</span></div>
                <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-400">Location</span><span className="font-medium">{form.location_name || '\u2014'}</span></div>
                <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-400">Affected Persons</span><span className="font-medium">{form.affected_count || '\u2014'}</span></div>
                <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-400">Sex</span><span className="font-medium">{form.sex || '\u2014'}</span></div>
                <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-400">Onset Date</span><span className="font-medium">{formatReadableDate(form.onset_date)}</span></div>
                <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-400">Supporting Information</span><span className="font-medium">{form.attachments.length ? `${form.attachments.length} items attached` : 'None'}</span></div>
              </div>
              <div className="border-b border-gray-100 pb-3 mb-4">
                <span className="text-gray-400 text-sm block mb-1.5">Symptoms</span>
                {symptomLabels.length ? (
                  symptomLabels.map((s) => (
                    <span key={s} className="inline-block bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full mr-1 mb-1">{s}</span>
                  ))
                ) : (
                  <span className="text-sm text-gray-400">\u2014</span>
                )}
              </div>
              <div className="mb-6">
                <span className="text-gray-400 text-sm block mb-1.5">Notes</span>
                <p className="text-sm text-gray-700">{form.additional_notes || '\u2014'}</p>
              </div>
              {submitError && <p className="text-red-600 text-sm mb-4">{submitError}</p>}
              <div className="flex justify-between">
                <button onClick={() => setCurrentStep(3)} className="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Back</button>
                <button onClick={submitReport} disabled={submitting} className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">
                  {submitting ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </AppShell>
  )
}
