export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const COMPRESS_OVER_BYTES = 2 * 1024 * 1024
export const MAX_PHOTOS = 3
export const MAX_RECORD_SECONDS = 180

export const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'ogg', 'webm', 'aac', 'amr']

export function fileExtension(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '')
  return m ? m[1].toLowerCase() : ''
}

export function isPhoneDevice() {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

export function isAllowedPhoto(file) {
  return PHOTO_EXTENSIONS.includes(fileExtension(file.name)) ||
    /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)
}

export function isAllowedAudio(file) {
  return AUDIO_EXTENSIONS.includes(fileExtension(file.name)) || /^audio\//i.test(file.type)
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function photoExtension(file) {
  const ext = fileExtension(file.name)
  if (ext === 'jpeg') return 'jpg'
  if (ext) return ext
  const sub = (file.type.split('/')[1] || 'jpg').toLowerCase()
  return sub === 'jpeg' ? 'jpg' : sub
}

// Resizes to max 1600px on the long side and re-encodes as JPEG at 0.8.
// Returns the original file if the browser cannot decode it (e.g. HEIC outside Safari).
export async function compressImage(file) {
  if (file.size <= COMPRESS_OVER_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close && bitmap.close()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export function readAudioDuration(url) {
  return new Promise((resolve) => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) { resolve(audio.duration); return }
      // WebM from MediaRecorder reports Infinity until the end is seeked.
      audio.currentTime = 1e101
      audio.ontimeupdate = () => {
        audio.ontimeupdate = null
        resolve(Number.isFinite(audio.duration) ? audio.duration : null)
      }
    }
    audio.onerror = () => resolve(null)
    audio.src = url
  })
}
