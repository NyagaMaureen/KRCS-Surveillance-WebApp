import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, FileSpreadsheet, FileText, FileJson, Image as ImageIcon } from 'lucide-react'
import { FOCUS } from '../../data/eventHelpers'

// One Download button with the format to choose: PNG, PDF or Excel (KRCS 23 Nov 2026).
// onPick('png' | 'pdf' | 'xlsx' | 'csv' | 'json'); busy: the format being prepared, if any.
// formats: which of them to offer (default PNG, PDF, Excel).
const ALL_FORMATS = {
  png: { key: 'png', label: 'PNG image', icon: ImageIcon },
  pdf: { key: 'pdf', label: 'PDF (print)', icon: FileText },
  xlsx: { key: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  csv: { key: 'csv', label: 'CSV (Excel)', icon: FileSpreadsheet },
  json: { key: 'json', label: 'JSON', icon: FileJson },
}

export default function DownloadMenu({ onPick, busy, label = 'Download', className = '', formats = ['png', 'pdf', 'xlsx'] }) {
  const FORMATS = formats.map((k) => ALL_FORMATS[k]).filter(Boolean)
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={box} className={`relative ${className}`}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={!!busy} onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`}>
        <Download className="h-4 w-4" aria-hidden="true" />
        {busy ? 'Preparing…' : label}
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {FORMATS.map((f) => (
            <button key={f.key} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(f.key) }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
              <f.icon className="h-4 w-4 text-gray-700" aria-hidden="true" />{f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
