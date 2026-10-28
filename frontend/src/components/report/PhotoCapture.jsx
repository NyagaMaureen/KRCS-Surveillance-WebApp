import { useEffect, useRef, useState } from 'react'
import { Camera, X, RefreshCw, Trash2, Loader2 } from 'lucide-react'
import { MAX_PHOTOS, PHOTO_ACCEPT, checkPhoto } from '../../utils/reportForm'

let nextId = 1

export function UploadStatus({ upload, onRetry }) {
  if (!upload) return null
  if (upload.error) {
    return (
      <div className="text-[11px] text-red-700 mt-1">
        {upload.error}{' '}
        {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline">Retry</button>}
      </div>
    )
  }
  if (upload.status === 'uploading') {
    return (
      <div className="mt-1">
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-red-600 transition-all" style={{ width: `${upload.progress || 0}%` }} /></div>
        <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Uploading {upload.progress || 0}%</div>
      </div>
    )
  }
  if (upload.status === 'done') return <div className="text-[11px] text-green-600 mt-1">Uploaded</div>
  return null
}

export default function PhotoCapture({ photos, onChange, uploads, onRetry, error }) {
  const inputRef = useRef(null)
  const replaceIdRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [fileError, setFileError] = useState('')

  useEffect(() => {
    if (!preview) return
    const onKey = (e) => { if (e.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  function openPicker(replaceId = null) {
    replaceIdRef.current = replaceId
    inputRef.current && inputRef.current.click()
  }

  function handleSelected(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    const replaceId = replaceIdRef.current
    replaceIdRef.current = null
    if (!files.length) return

    const problems = []
    const valid = []
    for (const f of files) {
      const msg = checkPhoto(f)
      if (msg) problems.push(msg)
      else valid.push(f)
    }

    let next = photos
    if (replaceId && valid.length) {
      const old = photos.find((p) => p.id === replaceId)
      if (old) URL.revokeObjectURL(old.url)
      next = photos.map((p) => (p.id === replaceId ? { id: nextId++, file: valid[0], url: URL.createObjectURL(valid[0]) } : p))
    } else {
      const room = MAX_PHOTOS - photos.length
      if (valid.length > room) problems.push(`You can add up to ${MAX_PHOTOS} photos.`)
      next = [...photos, ...valid.slice(0, Math.max(room, 0)).map((f) => ({ id: nextId++, file: f, url: URL.createObjectURL(f) }))]
    }
    setFileError(problems.join(' '))
    if (next !== photos) onChange(next)
  }

  function remove(photo) {
    URL.revokeObjectURL(photo.url)
    onChange(photos.filter((p) => p.id !== photo.id))
    setFileError('')
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept={PHOTO_ACCEPT} capture="environment" multiple={photos.length < MAX_PHOTOS - 1} className="hidden" onChange={handleSelected} />
      <div className="flex flex-wrap gap-3 mb-2">
        {photos.map((p, i) => {
          const upload = uploads[`photo-${p.id}`]
          return (
            <div key={p.id} className="w-28">
              <button type="button" onClick={() => setPreview(p)} className="block w-28 h-28 rounded-lg overflow-hidden border border-gray-200 bg-gray-50" aria-label={`Open photo ${i + 1}`}>
                <img src={p.url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              </button>
              <div className="flex justify-between mt-1">
                <button type="button" onClick={() => openPicker(p.id)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-red-700"><RefreshCw className="w-3 h-3" /> Replace</button>
                <button type="button" onClick={() => remove(p)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-red-700"><Trash2 className="w-3 h-3" /> Remove</button>
              </div>
              <UploadStatus upload={upload} onRetry={onRetry} />
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => openPicker(null)}
        disabled={photos.length >= MAX_PHOTOS}
        className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        <Camera className="w-3.5 h-3.5" /> Add photo
      </button>
      <span className="text-xs text-gray-400 ml-2">{photos.length}/{MAX_PHOTOS} · JPG, PNG, WEBP, HEIC · max 10 MB each</span>
      {fileError && <p className="text-xs text-red-700 mt-1">{fileError}</p>}
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}

      {preview && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setPreview(null)}>
          <button type="button" onClick={() => setPreview(null)} className="absolute top-4 right-4 text-white hover:text-gray-300" aria-label="Close preview"><X className="w-6 h-6" /></button>
          <img src={preview.url} alt="Full size preview" className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
