import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Loader2 } from 'lucide-react'
import { kbDocumentUrl } from '../api/frappe'

// Knowledge Base > View for Word documents (KRCS 19 Nov 2026): opens in its own browser tab, full screen, drawn as it
// looks in Word (fonts, headings, tables, pages) with docx-preview from the same file Download gives. PDFs open in the
// browser's own viewer instead. Who may open a document is checked by the server (surveillance.knowledge_base).
export default function KbDocumentView() {
  const { id } = useParams()
  const title = new URLSearchParams(window.location.search).get('title') || id
  const box = useRef(null)
  const [state, setState] = useState('loading')   // loading | ready | error
  const [error, setError] = useState('')

  useEffect(() => { document.title = title }, [title])
  useEffect(() => {
    let gone = false
    ;(async () => {
      try {
        const res = await fetch(kbDocumentUrl(id, true), { credentials: 'include' })
        if (res.status === 403) throw new Error('This document is not available to you.')
        if (!res.ok) throw new Error('This document could not be opened.')
        const blob = await res.blob()
        const { renderAsync } = await import('docx-preview')
        if (gone || !box.current) return
        await renderAsync(blob, box.current, undefined, { inWrapper: true, breakPages: true })
        if (!gone) setState('ready')
      } catch (e) {
        if (!gone) { setError(e.message || 'This document could not be shown here. Use Download to open it in Word.'); setState('error') }
      }
    })()
    return () => { gone = true }
  }, [id])

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="min-w-0 truncate text-base font-bold text-gray-900">{title}</h1>
        <a href={kbDocumentUrl(id, true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-50">
          <Download className="h-4 w-4" aria-hidden="true" />Download
        </a>
      </header>
      {state === 'loading' && <div className="flex items-center gap-2 p-6 text-sm text-gray-700"><Loader2 className="h-4 w-4 animate-spin" />Opening…</div>}
      {state === 'error' && <p className="p-6 text-sm text-red-700">{error}</p>}
      <div ref={box} />
    </div>
  )
}
