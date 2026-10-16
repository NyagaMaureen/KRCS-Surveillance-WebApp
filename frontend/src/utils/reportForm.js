export const MB = 1024 * 1024
export const MAX_PHOTOS = 3
export const MAX_PHOTO_BYTES = 10 * MB
export const MAX_AUDIO_BYTES = 10 * MB
export const MAX_RECORD_SECONDS = 180

const PHOTO_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const AUDIO_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'webm', 'aac', 'amr']

export function fileExt(name) {
  const i = (name || '').lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

export function localDateString(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function checkPhoto(file) {
  if (!PHOTO_TYPES.includes(file.type) && !PHOTO_EXT.includes(fileExt(file.name))) {
    return `${file.name}: use a JPG, PNG, WEBP or HEIC photo.`
  }
  if (file.size > MAX_PHOTO_BYTES) return `${file.name}: photo is larger than 10 MB.`
  return ''
}

export function checkAudio(file) {
  if (!AUDIO_EXT.includes(fileExt(file.name))) {
    return 'Use an mp3, m4a, wav, ogg, webm, aac or amr audio file.'
  }
  if (file.size > MAX_AUDIO_BYTES) return 'Audio file is larger than 10 MB.'
  return ''
}

export const AUDIO_ACCEPT = '.mp3,.m4a,.wav,.ogg,.webm,.aac,.amr,audio/*'
export const PHOTO_ACCEPT = 'image/*'

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function normalisePhone(value) {
  const v = (value || '').replace(/[\s-]/g, '')
  const m = /^(?:\+254|0)([17]\d{8})$/.exec(v)
  return m ? `+254${m[1]}` : ''
}

export async function compressImage(file) {
  if (file.size <= 2 * MB) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close && bitmap.close()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export function photoUploadName(file, index) {
  const ext = file.type === 'image/jpeg' || ['jpg', 'jpeg'].includes(fileExt(file.name)) ? 'jpg' : fileExt(file.name) || 'jpg'
  return `photo-${index + 1}.${ext}`
}

export function voiceUploadName(voice) {
  const ext = voice.file.type.includes('mp4') ? 'm4a' : fileExt(voice.file.name) || (voice.file.type.split('/')[1] || 'webm').split(';')[0]
  return `voice-note.${ext}`
}

export const FIELD_LABELS = {
  phone_number: 'Phone number',
  category: 'Category',
  signal_type: 'Signal type',
  region: 'Region',
  sub_county: 'Sub-county',
  location_name: 'Location',
  gps: 'GPS location',
  affected_count: 'People affected',
  deaths_count: 'Deaths',
  age_group: 'Age group',
  symptoms: 'Symptoms or animal exposure',
  onset_date: 'Onset date',
  report_date: 'Report date',
  photos: 'Photo',
  voice: 'Voice note',
}

export const FIELD_ORDER = ['phone_number', 'category', 'signal_type', 'region', 'sub_county', 'location_name', 'gps', 'affected_count', 'deaths_count', 'symptoms', 'age_group', 'onset_date', 'report_date', 'photos', 'voice']

export const FIELD_STEP = {
  phone_number: 1, category: 1, signal_type: 1, region: 1, sub_county: 1, location_name: 1, gps: 1,
  affected_count: 2, deaths_count: 2, symptoms: 2, age_group: 2,
  onset_date: 3, report_date: 3, photos: 3, voice: 3,
}

function isWholeNumber(v) {
  return /^\d+$/.test(String(v).trim())
}

export function validateReport(form, photoCount, hasVoice) {
  const e = {}
  const today = localDateString()

  if (!form.phone_number.trim()) e.phone_number = 'Enter the reporter phone number'
  else if (!normalisePhone(form.phone_number)) e.phone_number = 'Use 07XXXXXXXX, 01XXXXXXXX or +2547XXXXXXXX'

  if (!form.category) e.category = 'Select a category'
  if (!form.signal_type) e.signal_type = 'Select a signal type'
  if (!form.region) e.region = 'Select a region'
  if (!form.sub_county) e.sub_county = 'Select a sub-county'
  if (!form.location_name.trim()) e.location_name = 'Enter the location, village or block name'

  const lat = form.latitude === '' || form.latitude === null ? NaN : Number(form.latitude)
  const lng = form.longitude === '' || form.longitude === null ? NaN : Number(form.longitude)
  if (Number.isNaN(lat) || Number.isNaN(lng)) e.gps = 'Capture your GPS location or enter latitude and longitude'
  else if (lat < -5 || lat > 5) e.gps = 'Latitude must be between -5 and 5 for Kenya'
  else if (lng < 33 || lng > 42) e.gps = 'Longitude must be between 33 and 42 for Kenya'

  const affected = String(form.affected_count).trim()
  if (!affected) e.affected_count = 'Enter the number of people affected'
  else if (!isWholeNumber(affected) || Number(affected) < 1) e.affected_count = 'Enter a whole number, at least 1'

  const deaths = String(form.deaths_count).trim()
  if (deaths === '') e.deaths_count = 'Enter the number of deaths (0 if none)'
  else if (!isWholeNumber(deaths)) e.deaths_count = 'Enter a whole number'
  else if (!e.affected_count && Number(deaths) > Number(affected)) e.deaths_count = 'Deaths cannot exceed people affected'

  if (!form.age_group) e.age_group = 'Select an age group'
  if (!form.symptoms.length && (!form.animal_exposure || form.animal_exposure === 'None')) {
    e.symptoms = 'Select at least one symptom or an animal exposure'
  }

  if (!form.onset_date) e.onset_date = 'Enter the onset date'
  else if (form.onset_date > today) e.onset_date = 'Onset date cannot be in the future'

  if (!form.report_date) e.report_date = 'Enter the report date'
  else if (form.report_date > today) e.report_date = 'Report date cannot be in the future'
  else if (form.onset_date && form.report_date < form.onset_date) e.report_date = 'Report date cannot be before the onset date'

  if (!photoCount) e.photos = 'Add at least one photo'
  if (!hasVoice) e.voice = 'Add a voice note'
  return e
}
