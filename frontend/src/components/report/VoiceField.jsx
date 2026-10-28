import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Upload, Trash2, RefreshCw } from 'lucide-react'
import { UploadStatus } from './PhotoField'
import { MAX_FILE_BYTES, MAX_RECORD_SECONDS, AUDIO_EXTENSIONS, fileExtension, formatDuration, isAllowedAudio, readAudioDuration } from '../../utils/media'

const MIC_BLOCKED = 'Microphone access is blocked. Allow it in your browser settings or upload an audio file instead.'

export default function VoiceField({ voice, setVoice, onRetry }) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const chunksRef = useRef([])
  const startedAtRef = useRef(0)
  const fileInputRef = useRef(null)
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  useEffect(() => () => {
    clearInterval(timerRef.current)
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.onstop = null
      recorderRef.current.stop()
    }
    streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop())
    if (voiceRef.current) URL.revokeObjectURL(voiceRef.current.previewUrl)
  }, [])

  function replaceVoice(next) {
    setVoice((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return next
    })
  }

  function deleteVoice() {
    replaceVoice(null)
    setError('')
  }

  async function startRecording() {
    setError('')
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported on this device. Upload an audio file instead.')
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setError(err && err.name === 'NotFoundError' ? 'No microphone found. Upload an audio file instead.' : MIC_BLOCKED)
      return
    }
    streamRef.current = stream

    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
    const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(mime) ? { mimeType: mime } : undefined)
    recorderRef.current = recorder
    chunksRef.current = []
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
    recorder.onstop = () => {
      clearInterval(timerRef.current)
      stream.getTracks().forEach((t) => t.stop())
      setRecording(false)
      const type = recorder.mimeType || mime
      const blob = new Blob(chunksRef.current, { type })
      const seconds = Math.min(MAX_RECORD_SECONDS, Math.round((Date.now() - startedAtRef.current) / 1000))
      replaceVoice({
        file: blob,
        ext: type.includes('mp4') ? 'm4a' : 'webm',
        previewUrl: URL.createObjectURL(blob),
        duration: seconds,
        status: 'idle', progress: 0, error: '', url: '',
      })
    }
    recorder.start()
    startedAtRef.current = Date.now()
    setElapsed(0)
    setRecording(true)
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setElapsed(secs)
      if (secs >= MAX_RECORD_SECONDS) stopRecording()
    }, 250)
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state === 'recording') recorderRef.current.stop()
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setError('')
    if (!isAllowedAudio(file) || (fileExtension(file.name) && !AUDIO_EXTENSIONS.includes(fileExtension(file.name)))) {
      setError('Audio must be mp3, m4a, wav, ogg, webm, aac or amr.')
      return
    }
    if (file.size > MAX_FILE_BYTES) { setError('The audio file must be 10 MB or smaller.'); return }
    const previewUrl = URL.createObjectURL(file)
    const duration = await readAudioDuration(previewUrl)
    replaceVoice({
      file, ext: fileExtension(file.name) || 'webm', previewUrl, duration,
      status: 'idle', progress: 0, error: '', url: '',
    })
  }

  return (
    <div>
      {recording ? (
        <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
          <span className="text-sm font-semibold text-red-700 tabular-nums">{formatDuration(elapsed)} / {formatDuration(MAX_RECORD_SECONDS)}</span>
          <button type="button" onClick={stopRecording} className="ml-auto inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold">
            <Square className="w-3 h-3 fill-current" /> Stop
          </button>
        </div>
      ) : voice ? (
        <div className="bg-gray-50 rounded-lg p-3">
          <audio controls src={voice.previewUrl} className="w-full max-w-md" />
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
            {voice.duration ? <span className="text-gray-500">Duration {formatDuration(voice.duration)}</span> : null}
            <button type="button" onClick={startRecording} className="inline-flex items-center gap-1 text-gray-600 hover:text-red-700"><RefreshCw className="w-3 h-3" /> Re-record</button>
            <button type="button" onClick={deleteVoice} className="inline-flex items-center gap-1 text-gray-600 hover:text-red-700"><Trash2 className="w-3 h-3" /> Delete</button>
          </div>
          <UploadStatus item={voice} onRetry={onRetry} />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={startRecording} className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
            <Mic className="w-3.5 h-3.5" /> Record voice note
          </button>
          <button type="button" onClick={() => fileInputRef.current && fileInputRef.current.click()} className="inline-flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
            <Upload className="w-3.5 h-3.5" /> Upload audio file
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-700 mt-1.5">{error}</p>}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={AUDIO_EXTENSIONS.map((e) => `.${e}`).join(',') + ',audio/*'}
        onChange={handleFile}
      />
    </div>
  )
}
