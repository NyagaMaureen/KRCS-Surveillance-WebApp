import { useRef, useState } from 'react'
import { Camera, X, Loader2, RefreshCw, ImageOff } from 'lucide-react'
import { MAX_PHOTOS, MAX_FILE_BYTES, compressImage, isAllowedPhoto, isPhoneDevice } from '../../utils/media'

export function ImageModal({ src, onClose }) {
  if (!src) return null
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Close preview" className="absolute top-4 right-4 text-white hover:text-gray-300">
        <X className="w-6 h-6" />
      </button>
      <img src={src} alt="Full size preview" className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}

export function UploadStatus({ item, onRetry }) {
  if (item.status === 'uploading') {
    return (
      <div className="mt-1">
        <div className="h-1 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-red-600 transition-all" style={{ width: `${item.progress || 0}%` }} /></div>
        <span className="text-[10px] text-gray-500">Uploading {item.progress || 0}%</span>
      </div>
    )
  }
  if (item.status === 'done') return <span className="text-[10px] text-green-600 mt-1 block">Uploaded</span>
  if (item.status === 'error') {
    return (
      <div className="mt-1 text-[10px] text-red-600">
        {item.error}{' '}
        <button type="button" onClick={onRetry} className="font-semibold underline">Retry</button>
      </div>
    )
  }
  return null
}

let nextId = 1

export default function PhotoField({ photos, setPhotos, onRetry }) {
  const inputRef = useRef(null)
  const replaceIdRef = useRef(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const phone = isPhoneDevice()

  function openPicker(replaceId = null) {
    replaceIdRef.current = replaceId
    inputRef.current && inputRef.current.click()
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    const replaceId = replaceIdRef.current
    replaceIdRef.current = null
    if (!files.length) return
    setError('')

    const room = replaceId ? 1 : MAX_PHOTOS - photos.length
    if (room <= 0) { setError(`You can add up to ${MAX_PHOTOS} photos.`); return }

    const accepted = []
    for (const file of files.slice(0, room)) {
      if (!isAllowedPhoto(file)) { setError('Photos must be JPG, PNG, WEBP or HEIC.'); continue }
      if (file.size > MAX_FILE_BYTES) { setError('Each photo must be 10 MB or smaller.'); continue }
      accepted.push(file)
    }
    if (files.length > room) setError(`You can add up to ${MAX_PHOTOS} photos.`)

    for (const original of accepted) {
      const file = await compressImage(original)
      const item = { id: nextId++, file, previewUrl: URL.createObjectURL(file), status: 'idle', progress: 0, error: '', url: '' }
      setPhotos((prev) => {
        if (replaceId) {
          const old = prev.find((p) => p.id === replaceId)
          if (old) URL.revokeObjectURL(old.previewUrl)
          return prev.map((p) => (p.id === replaceId ? item : p))
        }
        return prev.length < MAX_PHOTOS ? [...prev, item] : (URL.revokeObjectURL(item.previewUrl), prev)
      })
    }
  }

  function remove(id) {
    setPhotos((prev) => {
      const old = prev.find((p) => p.id === id)
      if (old) URL.revokeObjectURL(old.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-2">
        {photos.map((p) => (
          <div key={p.id} className="w-28">
            <button type="button" onClick={() => setPreview(p.previewUrl)} className="block w-28 h-28 rounded-lg overflow-hidden bg-gray-100 relative">
              <img
                src={p.previewUrl}
                alt="Photo preview"
                className="w-full h-full object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }}
              />
              <span style={{ display: 'none' }} className="absolute inset-0 items-center justify-center text-gray-400"><ImageOff className="w-6 h-6" /></span>
              {p.status === 'uploading' && <span className="absolute inset-0 bg-white/60 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-red-600" /></span>}
            </button>
            <div className="flex justify-between mt-1 text-[11px]">
              <button type="button" onClick={() => openPicker(p.id)} className="inline-flex items-center gap-0.5 text-gray-600 hover:text-red-600">
                <RefreshCw className="w-3 h-3" /> {phone ? 'Retake' : 'Replace'}
              </button>
              <button type="button" onClick={() => remove(p.id)} className="text-gray-600 hover:text-red-600">Remove</button>
            </div>
            <UploadStatus item={p} onRetry={() => onRetry(p.id)} />
          </div>
        ))}
      </div>

      {photos.length < MAX_PHOTOS && (
        <button
          type="button"
          onClick={() => openPicker(null)}
          className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Camera className="w-3.5 h-3.5" /> Add photo
        </button>
      )}
      <span className="text-xs text-gray-400 ml-2">{photos.length}/{MAX_PHOTOS} · JPG, PNG, WEBP, HEIC · max 10 MB</span>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleFiles}
        {...(phone
          ? { accept: 'image/*', capture: 'environment' }
          : { accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif', multiple: true })}
      />
      <ImageModal src={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
