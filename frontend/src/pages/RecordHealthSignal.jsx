import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Paperclip, FileText, X, Stethoscope, MapPin, AlertCircle, CheckCircle2 } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import SymptomPicker from '../components/report/SymptomPicker'
import PhotoField, { ImageModal, UploadStatus } from '../components/report/PhotoField'
import VoiceField from '../components/report/VoiceField'
import ConsentQuestion, { consentOk, consentFields } from '../components/report/ConsentQuestion'
import { getList, createReport, getMyProfile, getLoggedInUserPhone, getSubCounties, uploadFile, uploadFileWithProgress, classifyPreview, getReporterAdvice } from '../api/frappe'
import { CATEGORIES, AGE_GROUPS, ANIMAL_EXPOSURE_OPTIONS } from '../data/formOptions'
import { formatDuration, photoExtension } from '../utils/media'

const steps = ['Reporter Info', 'Symptoms', 'Details', 'Review Report']

const ATTACHMENT_TYPES = [
  { type: 'Text Note', icon: FileText, accept: null },
  { type: 'Attachment', icon: Paperclip, accept: '' },
]

const FIELD_META = {
  phone_number: { label: 'Phone number', step: 1 },
  category: { label: 'Category', step: 1 },
  signal_type: { label: 'Signal type', step: 1 },
  region: { label: 'Region', step: 1 },
  sub_county: { label: 'Sub-county', step: 1 },
  gps: { label: 'GPS location', step: 1 },
  affected_count: { label: 'People affected', step: 2 },
  deaths_count: { label: 'Deaths', step: 2 },
  symptoms: { label: 'Symptoms or animal exposure', step: 2 },
  age_group: { label: 'Age group', step: 2 },
  onset_date: { label: 'Onset date', step: 3 },
  report_date: { label: 'Report date', step: 3 },
}

const WHOLE_NUMBER = /^\d+$/

function toDateInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatReadableDate(value) {
  if (!value) return '\u2014'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { dateStyle: 'medium' })
}

function validate(f, today) {
  const e = {}
  if (!f.phone_number) e.phone_number = 'Add your phone number to your profile'
  if (!f.category) e.category = 'Select a category'
  if (!f.signal_type) e.signal_type = 'Select a signal type'
  if (!f.region) e.region = 'Select a region'
  if (!f.sub_county) e.sub_county = 'Select a sub-county'
  const { latitude: lat, longitude: lng } = f

  if (lat === null || lng === null) e.gps = 'Capture your location or enter the coordinates'
  else if (!Number.isFinite(lat) || lat < -5 || lat > 5) e.gps = 'Latitude must be between -5 and 5 (Kenya)'
  else if (!Number.isFinite(lng) || lng < 33 || lng > 42) e.gps = 'Longitude must be between 33 and 42 (Kenya)'

  const affected = String(f.affected_count).trim()
  if (!WHOLE_NUMBER.test(affected) || Number(affected) < 1) e.affected_count = 'Enter a whole number, at least 1'
  const deaths = String(f.deaths_count).trim()
  if (!WHOLE_NUMBER.test(deaths)) e.deaths_count = 'Enter a whole number (0 or more)'
  else if (!e.affected_count && Number(deaths) > Number(affected)) e.deaths_count = 'Deaths cannot exceed people affected'

  if (!f.symptoms.length && (!f.animal_exposure || f.animal_exposure === 'None')) e.symptoms = 'Select at least one symptom or an animal exposure'
  if (!f.age_group) e.age_group = 'Select an age group'

  if (!f.onset_date) e.onset_date = 'Enter the onset date'
  else if (f.onset_date > today) e.onset_date = 'Onset date cannot be in the future'
  if (!f.report_date) e.report_date = 'Enter the report date'
  else if (f.report_date > today) e.report_date = 'Report date cannot be in the future'
  else if (f.onset_date && f.report_date < f.onset_date) e.report_date = 'Report date cannot be before the onset date'
  return e
}

function Field({ id, label, required, error, hint, children }) {
  return (
    <div id={`field-${id}`}>
      <label className="block text-sm font-semibold mb-1">{label}{required && <span className="text-red-700"> *</span>}</label>
      {children}
      {hint && !error && <p className="text-xs text-gray-400 mt-1.5">{hint}</p>}
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  )
}

const inputBase = 'w-full rounded-lg px-4 py-3 text-sm border focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow'
const inputCls = (err) => `${inputBase} ${err ? 'border-red-400 bg-red-50' : 'border-transparent bg-gray-50'}`

export default function RecordHealthSignal() {
  const navigate = useNavigate()
  const today = toDateInputValue(new Date())
  const [currentStep, setCurrentStep] = useState(1)
  const [regions, setRegions] = useState([])
  const [symptoms, setSymptoms] = useState([])
  const [subCounties, setSubCounties] = useState([])
  const [geoError, setGeoError] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const [manualGps, setManualGps] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [touched, setTouched] = useState({})
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [locationLocked, setLocationLocked] = useState(false)   // CHPs and FHWs: always their assigned area
  const [editLocation, setEditLocation] = useState(false)
  const [uploading, setUploading] = useState({})
  const [uploadErrors, setUploadErrors] = useState({})
  const [showTextNote, setShowTextNote] = useState(false)
  const [textNoteValue, setTextNoteValue] = useState('')
  const [photos, setPhotos] = useState([])
  const [voice, setVoice] = useState(null)
  const [mediaConsent, setMediaConsent] = useState({ peopleShown: false, consent: '' })   // default: no person shown
  // one reference per report: if Submit is pressed twice (or the network retries), the server keeps one report
  const clientRef = useRef(globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const [reviewImage, setReviewImage] = useState(null)

  const photosRef = useRef(photos)
  photosRef.current = photos
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  const fileInputRefs = { Attachment: useRef(null) }

  const [form, setForm] = useState({
    reported_by: '', reporter_name: '', phone_number: '',
    signal_type: '', category: '', region: '', sub_county: '', location_name: '',
    latitude: null, longitude: null, gps_accuracy: null, affected_count: '',
    symptoms: [], onset_date: '', report_date: today, attachments: [], additional_notes: '',
    age_group: '', animal_exposure: '', deaths_count: '0',
  })

  const [classifyResults, setClassifyResults] = useState([])
  const [sent, setSent] = useState(null)   // after submit: { name, diseaseName, advice }
  const classifyTimerRef = useRef(null)

  const errors = useMemo(() => validate(form, today), [form, today])
  const shown = (key) => (errors[key] && (touched[key] || attempted) ? errors[key] : '')
  const touch = (key) => setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
  const [stepTried, setStepTried] = useState({})   // steps where Continue was pressed with problems
  const summaryKeys = Object.keys(FIELD_META).filter((k) => errors[k] && (attempted || (stepTried[FIELD_META[k].step] && FIELD_META[k].step === currentStep)))

  function updateForm(fields) {
    setForm((prev) => ({ ...prev, ...fields }))
  }

  function toggleSymptom(name) {
    setForm((prev) => ({
      ...prev,
      symptoms: prev.symptoms.includes(name) ? prev.symptoms.filter((s) => s !== name) : [...prev.symptoms, name],
    }))
  }

  useEffect(() => {
    clearTimeout(classifyTimerRef.current)
    if (!form.symptoms.length && !form.animal_exposure) {
      setClassifyResults([])
      return
    }
    classifyTimerRef.current = setTimeout(() => {
      classifyPreview({ symptoms: form.symptoms, age_group: form.age_group, animal_exposure: form.animal_exposure })
        .then(setClassifyResults)
        .catch(() => setClassifyResults([]))
    }, 400)
    return () => clearTimeout(classifyTimerRef.current)
  }, [form.symptoms, form.age_group, form.animal_exposure])

  useEffect(() => () => {
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl))
  }, [])

  const subCountyLabel = useMemo(() => (subCounties.find((s) => s.name === form.sub_county) || {}).sub_county_name || '', [subCounties, form.sub_county])
  const regionLabel = useMemo(() => (regions.find((r) => r.name === form.region) || {}).region_name || '', [regions, form.region])
  const symptomLabels = useMemo(() => form.symptoms.map((id) => (symptoms.find((s) => s.name === id) || {}).symptom_name).filter(Boolean), [form.symptoms, symptoms])

  function useMyLocation() {
    touch('gps')
    if (!navigator.geolocation) {
      setGeoError('This device has no GPS. Enter the coordinates manually.')
      setManualGps(true)
      return
    }
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false)
        setGeoError('')
        updateForm({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, gps_accuracy: pos.coords.accuracy })
      },
      (err) => {
        setGeoLoading(false)
        setGeoError(err && err.code === 1
          ? 'Location permission was denied. Allow it in your browser settings or enter the coordinates manually.'
          : "Couldn't get your location. Enter the coordinates manually.")
        setManualGps(true)
      },
      { enableHighAccuracy: true, timeout: 20000 }
    )
  }

  function setOnset(date) {
    updateForm({ onset_date: toDateInputValue(date) })
    touch('onset_date')
  }

  function setOnsetToday() { setOnset(new Date()) }

  function setOnsetYesterday() {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    setOnset(d)
  }

  function setOnsetThisWeek() {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    setOnset(d)
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
      const fileUrl = await uploadFile(file, 1)
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

  function patchPhoto(id, patch) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  function patchVoice(patch) {
    setVoice((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  async function uploadPhoto(id) {
    const index = photosRef.current.findIndex((p) => p.id === id)
    const item = photosRef.current[index]
    if (!item) return ''
    if (item.status === 'done') return item.url
    patchPhoto(id, { status: 'uploading', progress: 0, error: '' })
    try {
      const url = await uploadFileWithProgress(item.file, {
        fileName: `photo-${index + 1}.${photoExtension(item.file)}`,
        isPrivate: 1,
        onProgress: (progress) => patchPhoto(id, { progress }),
      })
      patchPhoto(id, { status: 'done', progress: 100, url })
      return url
    } catch (err) {
      patchPhoto(id, { status: 'error', error: err.message || 'Upload failed' })
      throw err
    }
  }

  async function uploadVoice() {
    const item = voiceRef.current
    if (!item) return ''
    if (item.status === 'done') return item.url
    patchVoice({ status: 'uploading', progress: 0, error: '' })
    try {
      const url = await uploadFileWithProgress(item.file, {
        fileName: `voice-note.${item.ext}`,
        isPrivate: 1,
        onProgress: (progress) => patchVoice({ progress }),
      })
      patchVoice({ status: 'done', progress: 100, url })
      return url
    } catch (err) {
      patchVoice({ status: 'error', error: err.message || 'Upload failed' })
      throw err
    }
  }

  function goToField(key) {
    setCurrentStep(FIELD_META[key].step)
    setTimeout(() => {
      const el = document.getElementById(`field-${key}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const focusable = el.querySelector('input, select, textarea, button')
      focusable && focusable.focus({ preventScroll: true })
    }, 50)
  }

  async function submitReport() {
    setSubmitError('')
    setAttempted(true)
    const firstKey = Object.keys(FIELD_META).find((k) => errors[k])
    if (firstKey) {
      goToField(firstKey)
      return
    }

    const hasMedia = photosRef.current.length > 0 || !!voiceRef.current
    if (hasMedia && !consentOk(mediaConsent)) {
      setSubmitError('Answer the consent question under the photo and voice note (step 3), or remove them.')
      return
    }

    setSubmitting(true)
    try {
      const uploaded = []
      let failed = 0
      for (const p of photosRef.current) {
        try { uploaded.push({ attachment_type: 'Photo', file: await uploadPhoto(p.id), text_content: '', ...consentFields(mediaConsent) }) } catch { failed++ }
      }
      if (voiceRef.current) {
        try { uploaded.push({ attachment_type: 'Voice Note', file: await uploadVoice(), text_content: '', ...consentFields(mediaConsent) }) } catch { failed++ }
      }
      if (failed) {
        setSubmitError(`${failed} file${failed > 1 ? 's' : ''} could not be uploaded. Your answers are kept. Retry the upload, or press Submit report again.`)
        return
      }

      const saved = await createReport({
        reported_by: form.reported_by, reporter_name: form.reporter_name, phone_number: form.phone_number,
        signal_type: form.signal_type, category: form.category,
        region: form.region, sub_county: form.sub_county, location_name: form.location_name.trim(), latitude: form.latitude, longitude: form.longitude,
        affected_count: Number(form.affected_count),
        symptoms: form.symptoms.map((s) => ({ symptom: s })),
        onset_date: form.onset_date, report_date: form.report_date, attachments: [...form.attachments, ...uploaded],
        additional_notes: form.additional_notes, channel: 'Web', status: 'Submitted', client_ref: clientRef.current,
        age_group: form.age_group, animal_exposure: form.animal_exposure, deaths_count: Number(form.deaths_count),
      })
      const advice = await getReporterAdvice(saved?.suspected_disease).catch(() => null)
      setSent({ name: saved?.name, diseaseName: advice?.diseaseName || (saved?.suspected_disease ? classifyResults[0]?.name : null), advice })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      if (/already received/i.test(e.message || '')) { navigate('/reports'); return }   // first press got through
      setSubmitError(e.message || 'Something went wrong submitting the report.')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    getList('Region', ['name', 'region_name']).then(setRegions)
    getList('Symptom', ['*']).then(setSymptoms)
    Promise.all([getMyProfile().catch(() => ({})), getLoggedInUserPhone()]).then(([profile, phone]) => {
      updateForm({
        reported_by: profile.name || '',
        reporter_name: profile.full_name || '',
        phone_number: phone || profile.phone_number || '',
        region: profile.assigned_region || '',
        sub_county: profile.assigned_sub_county || '',

      })
      setLocationLocked(!!profile.location_locked)
      if (!profile.assigned_region || !profile.assigned_sub_county) setEditLocation(true)
      setProfileLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!form.region) {
      setSubCounties([])
      updateForm({ sub_county: '' })
      return
    }
    let cancelled = false
    getSubCounties(form.region).then((list) => {
      if (cancelled) return
      setSubCounties(list)
      setForm((prev) => ({
        ...prev,
        sub_county: list.some((s) => s.name === prev.sub_county) ? prev.sub_county : (list.length === 1 ? list[0].name : ''),
      }))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.region])

  // Moving forward checks each step on the way; the first step with a problem stops there and shows it.
  // Going back is always allowed.
  const consentMissing = (photos.length > 0 || !!voice) && !consentOk(mediaConsent)
  function goToStep(n) {
    for (let s = currentStep; s < n; s++) {
      if (s === 3 && consentMissing) {
        setStepTried((prev) => ({ ...prev, consent: true }))
        if (s !== currentStep) setCurrentStep(s)
        setTimeout(() => document.getElementById('field-consent')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
        return
      }
      const keys = Object.keys(FIELD_META).filter((k) => FIELD_META[k].step === s)
      const bad = keys.filter((k) => errors[k])
      if (bad.length) {
        setTouched((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, true])) }))
        setStepTried((prev) => ({ ...prev, [s]: true }))
        if (s !== currentStep) setCurrentStep(s)
        setTimeout(() => document.getElementById(`field-${bad[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
        return
      }
    }
    setCurrentStep(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const stepHasErrors = (s) => Object.keys(FIELD_META).some((k) => FIELD_META[k].step === s && errors[k])

  const phoneMissing = profileLoaded && !form.phone_number
  const phoneWarning = (
    <p className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1.5">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      Add your phone number to your profile before submitting.
      <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/settings`} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open settings</a>
    </p>
  )
  const optionalHint = <span className="text-xs font-normal text-gray-400">(optional, but helps verification)</span>

  return (
    <AppShell>
      <div className="w-full">
        <h2 className="text-xl font-bold text-brand-navy">Record Health Signal</h2>
        <p className="text-sm text-gray-400 mb-8">Quick community or facility health surveillance signal recording</p>

        {sent ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 w-full">
            <div className="flex items-start gap-3 mb-6">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" aria-hidden="true" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Report sent{sent.name ? `: ${sent.name}` : ''}</h3>
                <p className="text-sm text-gray-500">The surveillance officer will review it and may call you.</p>
              </div>
            </div>
            <div className="rounded-xl border border-red-100 bg-red-50/60 p-4 mb-6">
              <p className="text-xs text-gray-500">Suspected disease</p>
              <p className="text-base font-semibold text-gray-900">{sent.diseaseName || 'No disease matched: treated as an unusual event'}</p>
              <p className="text-xs text-gray-400 mt-0.5">Based on the signs you entered. An officer will verify.</p>
            </div>
            {(sent.advice?.steps?.length > 0 || sent.advice?.general?.length > 0) && (
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">What to do now</h4>
                {sent.advice.steps?.length > 0 && (
                  <ol className="flex flex-col gap-2.5 mb-4">
                    {sent.advice.steps.map((s, i) => (
                      <li key={i} className="flex gap-3 text-sm text-gray-800">
                        <span className="w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-600 flex items-center justify-center shrink-0">{i + 1}</span>
                        <span>{s.step}{s.timeframe && <span className="block text-xs text-gray-500 mt-0.5">{s.timeframe}</span>}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {sent.advice.general?.length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-gray-600 flex flex-col gap-1 marker:text-gray-300">
                    {sent.advice.general.map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => window.location.reload()} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">Record another report</button>
              <button type="button" onClick={() => navigate('/reports')} className="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-gray-50">View my reports</button>
            </div>
          </div>
        ) : (<>
        <div className="flex items-center mb-8">
          {steps.map((label, i) => (
            <div key={label} className={['flex items-center', i < steps.length - 1 ? 'flex-1' : ''].join(' ')}>
              <button type="button" onClick={() => goToStep(i + 1)} aria-current={i + 1 === currentStep ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${label}`} className="flex flex-col items-center rounded-lg px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200">
                <div className={['w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors',
                  i + 1 === currentStep ? 'bg-red-600 text-white shadow-sm shadow-red-200'
                    : i + 1 < currentStep ? (stepTried[i + 1] && stepHasErrors(i + 1) ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700')
                      : 'bg-gray-200 text-gray-500 hover:bg-gray-300'].join(' ')}>{i + 1}</div>
                <div className={['text-xs mt-1.5 whitespace-nowrap', i + 1 === currentStep ? 'text-red-700 font-semibold' : i + 1 < currentStep ? 'text-gray-700' : 'text-gray-400'].join(' ')}>{label}</div>
              </button>
              {i < steps.length - 1 && (
                <div className={['flex-1 h-0.5 mx-2 rounded-full transition-colors', i + 1 < currentStep ? 'bg-red-600' : 'bg-gray-200'].join(' ')}></div>
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 lg:p-10 w-full">

          {(summaryKeys.length > 0 || submitError) && (
            <div role="alert" className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-6 text-sm text-red-700">
              {summaryKeys.length > 0 && (
                <p>
                  <span className="font-semibold">Please complete: </span>
                  {summaryKeys.map((k, i) => (
                    <span key={k}>
                      <button type="button" onClick={() => goToField(k)} className="underline hover:text-red-900">{FIELD_META[k].label}</button>
                      {i < summaryKeys.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
              )}
              {submitError && <p className={summaryKeys.length ? 'mt-1' : ''}>{submitError}</p>}
            </div>
          )}

          {currentStep === 1 && (
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-4">Reporter Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="block text-sm font-semibold mb-1">Reporter</div>
                  <p className="text-sm text-gray-700 py-1">{form.reporter_name || '\u2014'}</p>
                </div>
                <Field id="phone_number" label="Phone number" required error={shown('phone_number')}>
                  <p className="text-sm text-gray-700 py-1">{form.phone_number || '\u2014'}</p>
                  {phoneMissing && phoneWarning}
                </Field>
                <div>
                  <div className="block text-sm font-semibold mb-1">Channel <span className="text-red-700">*</span></div>
                  <p className="text-sm text-gray-700 py-1">Web</p>
                </div>
                {form.region && form.sub_county && (locationLocked || !editLocation) && (
                  <div>
                    <div className="block text-sm font-semibold mb-1">Reporting area</div>
                    <p className="text-sm text-gray-700 py-1">
                      <span className="text-gray-400">Region:</span> {regionLabel || '\u2014'}
                      <span className="text-gray-300 mx-2">|</span>
                      <span className="text-gray-400">Sub-county:</span> {subCountyLabel || '\u2014'}
                      {!locationLocked && (
                        <button type="button" onClick={() => setEditLocation(true)} className="ml-3 text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-800 rounded">Change</button>
                      )}
                    </p>
                    {/* {locationLocked && <p className="text-xs text-gray-400">Your assigned area. Ask your supervisor to change it.</p>} */}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <Field id="category" label="Category" required error={shown('category')}>
                  <select value={form.category} onChange={(e) => updateForm({ category: e.target.value })} onBlur={() => touch('category')} className={inputCls(shown('category'))}>
                    <option value="">Select category</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field id="signal_type" label="Signal Type" required error={shown('signal_type')}>
                  <select value={form.signal_type} onChange={(e) => updateForm({ signal_type: e.target.value })} onBlur={() => touch('signal_type')} className={inputCls(shown('signal_type'))}>
                    <option value="">Select signal type</option>
                    <option>Suspected Outbreak</option><option>Community Signal</option><option>Facility Signal</option>
                  </select>
                </Field>
              </div>
              <h3 className="text-sm font-bold text-gray-900 mt-6 mb-4">Location</h3>
              {locationLocked && !(form.region && form.sub_county) ? (
                <p className="flex items-center gap-1.5 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Your account has no assigned region and sub-county. Ask your supervisor to assign them before reporting.
                </p>
              ) : (!locationLocked && editLocation) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <Field id="region" label="Region" required error={shown('region')}>
                  <select value={form.region} onChange={(e) => updateForm({ region: e.target.value })} onBlur={() => touch('region')} className={inputCls(shown('region'))}>
                    <option value="">Select region</option>
                    {regions.map((r) => <option key={r.name} value={r.name}>{r.region_name}</option>)}
                  </select>
                </Field>
                <Field id="sub_county" label="Sub-county" required error={shown('sub_county')} hint="Use this when the signal is from outside your usual area.">
                  <select
                    value={form.sub_county}
                    onChange={(e) => updateForm({ sub_county: e.target.value })}
                    onBlur={() => touch('sub_county')}
                    disabled={!form.region}
                    className={`${inputCls(shown('sub_county'))} disabled:text-gray-400`}
                  >
                    <option value="">{form.region ? 'Select sub-county' : 'Select a region first'}</option>
                    {subCounties.map((sc) => <option key={sc.name} value={sc.name}>{`${sc.sub_county_name} \u00b7 ${sc.county}`}</option>)}
                  </select>
                </Field>
              </div>
              )}
              <div className="mb-4">
                <Field id="location_name" label="Location / village / block name" hint="Optional, but helps the team find the place." error={shown('location_name')}>
                  <input value={form.location_name} onChange={(e) => updateForm({ location_name: e.target.value })} onBlur={() => touch('location_name')} className={inputCls(shown('location_name'))} placeholder="e.g. Ifo camp, Block C4, near the water point" />
                </Field>
              </div>

              <div className="mb-8" id="field-gps">
                <label className="block text-sm font-semibold mb-1">GPS location <span className="text-red-700">*</span></label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={useMyLocation}
                    disabled={geoLoading}
                    className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
                  >
                    {geoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />} Use my location
                  </button>
                  {form.gps_accuracy !== null && !errors.gps && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-700">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Captured ✓ {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)} (±{Math.round(form.gps_accuracy)} m)
                    </span>
                  )}
                  {!manualGps && (
                    <button type="button" onClick={() => setManualGps(true)} className="text-xs text-gray-500 underline hover:text-gray-800">Enter manually</button>
                  )}
                </div>
                {geoError && <p className="text-xs text-red-700 mt-1.5">{geoError}</p>}
                {manualGps && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1">Latitude</label>
                      <input type="number" step="any" value={form.latitude ?? ''} onChange={(e) => updateForm({ latitude: e.target.value === '' ? null : Number(e.target.value), gps_accuracy: null })} onBlur={() => touch('gps')} className={inputCls(shown('gps'))} placeholder="-5 to 5, e.g. 0.3476" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Longitude</label>
                      <input type="number" step="any" value={form.longitude ?? ''} onChange={(e) => updateForm({ longitude: e.target.value === '' ? null : Number(e.target.value), gps_accuracy: null })} onBlur={() => touch('gps')} className={inputCls(shown('gps'))} placeholder="33 to 42, e.g. 32.5825" />
                    </div>
                  </div>
                )}
                {shown('gps') && <p className="text-xs text-red-700 mt-1">{shown('gps')}</p>}
              </div>

              <div className="flex justify-end">
                <button onClick={() => goToStep(2)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">Continue</button>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-4">Affected Person Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <Field id="affected_count" label="Number of people affected" required error={shown('affected_count')}>
                  <input value={form.affected_count} onChange={(e) => updateForm({ affected_count: e.target.value })} onBlur={() => touch('affected_count')} type="number" min="1" step="1" className={inputCls(shown('affected_count'))} placeholder="Estimated count" />
                </Field>
                <Field id="deaths_count" label="Deaths" required error={shown('deaths_count')}>
                  <input value={form.deaths_count} onChange={(e) => updateForm({ deaths_count: e.target.value })} onBlur={() => touch('deaths_count')} type="number" min="0" step="1" className={inputCls(shown('deaths_count'))} />
                </Field>
              </div>

              <h3 className="text-sm font-bold text-gray-900 mb-3 pt-2 border-t border-gray-100">
                Select All Observed Symptoms <span className="text-red-700">*</span>
                <span className="block text-xs font-normal text-gray-400 mt-0.5">Select at least one symptom, or an animal exposure below.</span>
              </h3>
              <SymptomPicker symptoms={symptoms} selected={form.symptoms} onToggle={(id) => { toggleSymptom(id); touch('symptoms') }} invalid={!!shown('symptoms')} onBlur={() => touch('symptoms')} />
              {shown('symptoms') && <p className="text-xs text-red-700 mt-1">{shown('symptoms')}</p>}

              <div className="pt-6 mt-6 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 mb-4">About the affected person(s)</h3>

                <div className="mb-5">
                  <Field id="age_group" label="Age group" required error={shown('age_group')} hint="Age of the person reported (or the youngest, if several).">
                    <div className="flex flex-wrap gap-2">
                      {AGE_GROUPS.map((g) => (
                        <button
                          key={g.value}
                          type="button"
                          onClick={() => { updateForm({ age_group: form.age_group === g.value ? '' : g.value }); touch('age_group') }}
                          className={['px-4 py-2 rounded-full text-sm font-medium border transition-colors', form.age_group === g.value ? 'bg-red-600 border-red-600 text-white' : shown('age_group') ? 'border-red-300 text-gray-600 hover:bg-gray-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'].join(' ')}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>

                <div className="mb-5">
                  <label className="block text-sm font-semibold mb-2">Was anyone bitten or scratched by an animal, or did they handle a sick or dead animal?</label>
                  <div className="flex flex-col gap-2">
                    {ANIMAL_EXPOSURE_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="radio"
                          name="animal_exposure"
                          checked={form.animal_exposure === opt.value}
                          onChange={() => { updateForm({ animal_exposure: opt.value }); touch('symptoms') }}
                          className="accent-red-600"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

              </div>

              <div className="flex justify-between mt-6">
                <button onClick={() => setCurrentStep(1)} className="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Back</button>
                <button onClick={() => goToStep(3)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">Continue</button>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-4">Additional Details</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
                <Field id="onset_date" label="When Did It Start?" required error={shown('onset_date')}>
                  <input type="date" max={today} value={form.onset_date} onChange={(e) => updateForm({ onset_date: e.target.value })} onBlur={() => touch('onset_date')} className={inputCls(shown('onset_date'))} />
                </Field>
                <Field id="report_date" label="Report date" required error={shown('report_date')}>
                  <input type="date" max={today} min={form.onset_date || undefined} value={form.report_date} onChange={(e) => updateForm({ report_date: e.target.value })} onBlur={() => touch('report_date')} className={inputCls(shown('report_date'))} />
                </Field>
              </div>
              <div className="flex gap-2 mb-6">
                <button type="button" onClick={setOnsetToday} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-gray-50 transition-colors">Today</button>
                <button type="button" onClick={setOnsetYesterday} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-gray-50 transition-colors">Yesterday</button>
                <button type="button" onClick={setOnsetThisWeek} className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-gray-50 transition-colors">This Week</button>
                <span className="text-xs text-gray-400 self-center">Set onset date</span>
              </div>

              <div className="mb-6">
                <h3 className="text-sm font-bold text-gray-900 mb-2">Add photo {optionalHint}</h3>
                <PhotoField photos={photos} setPhotos={setPhotos} onRetry={(id) => uploadPhoto(id).catch(() => {})} />
              </div>

              <div className="mb-6">
                <h3 className="text-sm font-bold text-gray-900 mb-2">Record voice note {optionalHint}</h3>
                <VoiceField voice={voice} setVoice={setVoice} onRetry={() => uploadVoice().catch(() => {})} />
              </div>

              {(photos.length > 0 || voice) && (
                <div id="field-consent" className={`mb-6 rounded-xl border p-3 ${stepTried.consent && consentMissing ? 'border-red-300 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
                  <ConsentQuestion value={mediaConsent} onChange={setMediaConsent} />
                  {stepTried.consent && consentMissing && <p className="text-xs text-red-700 mt-1.5">Choose who agreed, or untick if no person is shown. Otherwise remove the photo or voice note.</p>}
                </div>
              )}

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
                      <button type="button" onClick={() => removeAttachment(i)} className="text-gray-400 hover:text-red-700 transition-colors shrink-0 ml-2">
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
                <button onClick={() => goToStep(4)} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">Continue</button>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div>
              <h3 className="font-bold text-center text-gray-900 mb-6">Review your report</h3>
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50/60 p-4">
                <Stethoscope className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-xs text-gray-500">Suspected disease (from the signs you entered)</p>
                  <p className="text-base font-semibold text-gray-900">{classifyResults[0]?.name || 'No disease matched; it will be reviewed as an unusual event'}</p>
                  {classifyResults.length > 1 && <p className="text-xs text-gray-500 mt-0.5">Also consistent with: {classifyResults.slice(1).map((r) => r.name).join(', ')}</p>}
                  <p className="text-xs text-gray-400 mt-1">Based on Ministry of Health case definitions. An officer will verify.</p>
                </div>
              </div>
              {(() => {
                const Item = ({ label, children, wide }) => (
                  <div className={wide ? 'sm:col-span-2' : ''}>
                    <dt className="text-xs text-gray-400">{label}</dt>
                    <dd className="text-sm font-medium text-gray-900 mt-0.5 break-words">{children || '\u2014'}</dd>
                  </div>
                )
                const Group = ({ title, step, children }) => (
                  <section className="border-b border-gray-100 pb-5 mb-5">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
                      <button type="button" onClick={() => setCurrentStep(step)} className="text-xs font-medium text-red-700 hover:underline">Edit</button>
                    </div>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">{children}</dl>
                  </section>
                )
                return (
                  <>
                    <Group title="Reporter and place" step={1}>
                      <Item label="Reporter">{form.reporter_name}{form.phone_number ? ` \u00b7 ${form.phone_number}` : ''}</Item>
                      <Item label="Region / Sub-county">{[regionLabel, subCountyLabel].filter(Boolean).join(' / ')}</Item>
                      <Item label="Category">{form.category}</Item>
                      <Item label="Signal type">{form.signal_type}</Item>
                      <Item label="Location">{form.location_name}</Item>
                      <Item label="GPS">{form.latitude !== null && form.longitude !== null ? `${Number(form.latitude).toFixed(5)}, ${Number(form.longitude).toFixed(5)}${form.gps_accuracy !== null ? ` (\u00b1${Math.round(form.gps_accuracy)} m)` : ''}` : ''}</Item>
                    </Group>
                    <Group title="What happened" step={2}>
                      <Item label="People affected">{form.affected_count}</Item>
                      <Item label="Deaths">{form.deaths_count === '' ? '' : String(form.deaths_count)}</Item>
                      <Item label="Age group">{form.age_group}</Item>
                      <Item label="Animal exposure">{form.animal_exposure && form.animal_exposure !== 'None' ? (ANIMAL_EXPOSURE_OPTIONS.find((o) => o.value === form.animal_exposure) || {}).label : 'None'}</Item>
                      <Item label="Symptoms" wide>
                        {symptomLabels.length ? symptomLabels.map((s) => (
                          <span key={s} className="inline-block bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full mr-1 mb-1">{s}</span>
                        )) : null}
                      </Item>
                    </Group>
                    <Group title="Dates" step={3}>
                      <Item label="Onset date">{formatReadableDate(form.onset_date)}</Item>
                      <Item label="Report date">{formatReadableDate(form.report_date)}</Item>
                    </Group>
                  </>
                )
              })()}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 border-b border-gray-100 pb-4 mb-4">
                <div>
                  <span className="text-gray-400 text-sm block mb-1.5">Photos</span>
                  {photos.length ? (
                    <div className="flex flex-wrap gap-3">
                      {photos.map((p) => (
                        <div key={p.id} className="w-20">
                          <button type="button" onClick={() => setReviewImage(p.previewUrl)} className="block w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
                            <img src={p.previewUrl} alt="Photo" className="w-full h-full object-cover" />
                          </button>
                          <UploadStatus item={p} onRetry={() => uploadPhoto(p.id).catch(() => {})} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">No photo</span>
                  )}
                </div>
                <div>
                  <span className="text-gray-400 text-sm block mb-1.5">Voice note</span>
                  {voice ? (
                    <div>
                      <audio controls src={voice.previewUrl} className="w-full max-w-sm" />
                      {voice.duration ? <span className="text-xs text-gray-500">Duration {formatDuration(voice.duration)}</span> : null}
                      <UploadStatus item={voice} onRetry={() => uploadVoice().catch(() => {})} />
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">No voice note</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mb-6">
                <div>
                  <span className="text-xs text-gray-400 block">Notes</span>
                  <p className="text-sm text-gray-700 mt-0.5">{form.additional_notes || '\u2014'}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Other attachments</span>
                  <p className="text-sm text-gray-700 mt-0.5">{form.attachments.length ? `${form.attachments.length} attached` : 'None'}</p>
                </div>
              </div>
              {phoneMissing && <div className="mb-4">{phoneWarning}</div>}
              <div className="flex justify-between">
                <button onClick={() => setCurrentStep(1)} className="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Edit</button>
                <button onClick={submitReport} disabled={submitting || phoneMissing} className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">
                  {submitting ? 'Submitting...' : 'Submit report'}
                </button>
              </div>
            </div>
          )}

        </div>
        </>)}
      </div>
      <ImageModal src={reviewImage} onClose={() => setReviewImage(null)} />
    </AppShell>
  )
}
