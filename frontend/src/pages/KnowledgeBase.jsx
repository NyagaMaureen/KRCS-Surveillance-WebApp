import { useMemo, useRef, useState, useEffect } from 'react'
import {
  FileText,
  Clock,
  ShieldCheck,
  Database,
  UploadCloud,
  Search,
  Filter,
  RotateCcw,
  Trash2,
  X,
  ChevronDown,
  Check,
  Ban,
  Undo2,
  Pencil,
} from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { KB_CATEGORIES, KB_WORKSPACE_LIMIT_BYTES } from '../data/mockKnowledgeBase'
import { uploadFile, getKbDocuments, createKbDocument, reindexKbDocument, deleteKbDocument, updateKbDocument, setKbApproval, getRoles, getDiseaseOptions } from '../api/frappe'
import { useCapabilities } from '../context/CapabilitiesContext'

const STATUS_STYLES = {
  indexed: 'bg-emerald-500/10 text-emerald-600',
  processing: 'bg-amber-500/10 text-amber-600',
  failed: 'bg-rose-500/10 text-rose-600',
}

const STATUS_LABELS = { indexed: 'Indexed', processing: 'Processing', failed: 'Failed' }

const APPROVAL_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-emerald-500/10 text-emerald-600',
  retired: 'bg-amber-500/10 text-amber-600',
}

const APPROVAL_LABELS = { draft: 'Draft', approved: 'Approved', retired: 'Retired' }

const approvalKey = (doc) => String(doc.approvalStatus || 'draft').toLowerCase()

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

function formatTimestamp(v) {
  return new Date(v).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })
}

function useClickOutside(ref, handler) {
  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) handler()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [ref, handler])
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5.5 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-400">{label}</div>
        <div className="text-2xl font-semibold text-gray-900 mt-2">{value}</div>
        <div className="text-xs font-medium text-gray-400 mt-2 truncate">{sub}</div>
      </div>
      <div className="bg-gray-100 rounded-full w-14 h-14 flex items-center justify-center shrink-0">
        <Icon className="w-6 h-6 text-gray-500" />
      </div>
    </div>
  )
}

function toOptions(list) {
  return list.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
}

function MultiSelectDropdown({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, () => setOpen(false))
  const normalized = toOptions(options || [])
  const labelFor = (v) => normalized.find((o) => o.value === v)?.label || v
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 border-2 border-gray-100 rounded-xl px-5 py-4 text-left bg-white hover:border-gray-200"
      >
        <span className="text-gray-700 truncate">{selected.length ? selected.map(labelFor).join(', ') : label}</span>
        <ChevronDown className={['w-5 h-5 text-gray-400 shrink-0 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-full bg-white border border-gray-100 rounded-xl shadow-lg py-2 max-h-60 overflow-y-auto">
          {normalized.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggleOption(opt.value)} className="accent-red-600" />
              {opt.label}
            </label>
          ))}
          {!normalized.length && <div className="px-4 py-2 text-sm text-gray-400">No options</div>}
        </div>
      )}
    </div>
  )
}

function EditDocumentModal({ doc, roleOptions, diseaseOptions, onClose, onSave }) {
  const [category, setCategory] = useState(doc.category)
  const [version, setVersion] = useState(doc.version || 'v1.0')
  const [appliedTo, setAppliedTo] = useState(doc.appliedTo?.length ? doc.appliedTo : ['All roles'])
  const [diseases, setDiseases] = useState(doc.diseases || [])
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    await onSave({ category, version, applied_to: appliedTo.length ? appliedTo : ['All roles'], diseases })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-100 w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900">Edit document</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4 truncate">{doc.name}</p>
        <div className="space-y-4">
          <div>
            <label className="block text-gray-700 font-medium mb-2">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 text-gray-700 bg-white">
              {KB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-2">Version</label>
            <input value={version} onChange={(e) => setVersion(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 text-gray-700" />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-2">Apply to</label>
            <MultiSelectDropdown label="Select roles" options={roleOptions} selected={appliedTo} onChange={setAppliedTo} />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-2">Diseases</label>
            <MultiSelectDropdown label="Select diseases" options={diseaseOptions} selected={diseases} onChange={setDiseases} />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-4">Changing category or version re-indexes the document. Audience and diseases update immediately.</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-200 text-white text-sm font-medium">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

const ACCEPTED = ['pdf', 'docx', 'txt', 'md']
const MAX_BYTES = 25 * 1024 * 1024

export default function KnowledgeBase() {
  const [documents, setDocuments] = useState([])
  const [pendingFiles, setPendingFiles] = useState([])
  const [category, setCategory] = useState(KB_CATEGORIES[0])
  const [applyTo, setApplyTo] = useState(['All roles'])
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [appliedToFilter, setAppliedToFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')


    const [approvalFilter, setApprovalFilter] = useState('')
  const [diseases, setDiseases] = useState([])
  const [editingDoc, setEditingDoc] = useState(null)
  const [roles, setRoles] = useState([])
  const [diseaseOptions, setDiseaseOptions] = useState([])
  const [toast, setToast] = useState({ show: false, message: '', error: false })

  const { has } = useCapabilities()
  const canManage = has('manage_knowledge_base')
  const canApprove = has('approve_knowledge_base')

  function showToast(message, error = false) {
    setToast({ show: true, message, error })
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000)
  }

  // Role names must be the Surveillance Role names (the same values as users' primary_role)
  const roleOptions = useMemo(
    () => ['All roles', ...roles.map((r) => (typeof r === 'string' ? r : r.name)).filter((n) => n && n !== 'All roles')],
    [roles]
  )
  const diseaseSelectOptions = useMemo(() => diseaseOptions.map((d) => ({ value: d.key, label: d.name })), [diseaseOptions])
  const diseaseNames = useMemo(() => Object.fromEntries(diseaseOptions.map((d) => [d.key, d.name])), [diseaseOptions])
  const fileInputRef = useRef(null)

  async function loadDocuments() {
    try {
      setDocuments(await getKbDocuments())
    } catch (e) {
      setError(e.message || 'Could not load documents')
    }
  }

    useEffect(() => {
    loadDocuments()
    getRoles().then(setRoles).catch(() => {})
    getDiseaseOptions().then(setDiseaseOptions).catch(() => {})
  }, [])
  // While anything is processing, refresh every 3 seconds
  const anyProcessing = documents.some((d) => d.status === 'processing')
  useEffect(() => {
    if (!anyProcessing) return
    const t = setInterval(loadDocuments, 3000)
    return () => clearInterval(t)
  }, [anyProcessing])

  const stats = useMemo(() => {
    const totalSize = documents.reduce((sum, d) => sum + d.sizeBytes, 0)
    const processing = documents.filter((d) => d.status === 'processing').length
    const indexedDocs = documents.filter((d) => d.status === 'indexed')
    const totalChunks = indexedDocs.reduce((sum, d) => sum + d.chunks, 0)
    return {
      total: documents.length,
      categories: new Set(documents.map((d) => d.category)).size,
      processing,
      indexed: indexedDocs.length,
      totalChunks,
      sizeLabel: formatBytes(totalSize),
      sizePct: Math.min(100, Math.round((totalSize / KB_WORKSPACE_LIMIT_BYTES) * 100)),
    }
  }, [documents])

  const filteredDocuments = useMemo(() => {
    const q = search.trim().toLowerCase()
    return documents.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false
      if (categoryFilter && d.category !== categoryFilter) return false
      if (appliedToFilter && !d.appliedTo.includes(appliedToFilter)) return false
      if (statusFilter && d.status !== statusFilter) return false
      if (approvalFilter && approvalKey(d) !== approvalFilter) return false
      return true
    })
  }, [documents, search, categoryFilter, appliedToFilter, statusFilter])

  function addFiles(fileList) {
    setError('')
    const files = Array.from(fileList)
    const bad = files.filter((f) => !ACCEPTED.includes((f.name.split('.').pop() || '').toLowerCase()) || f.size > MAX_BYTES)
    if (bad.length) setError(`Skipped ${bad.map((f) => f.name).join(', ')}: only PDF, DOCX, TXT or MD up to 25MB.`)
    const ok = files.filter((f) => !bad.includes(f))
    if (ok.length) setPendingFiles((prev) => [...prev, ...ok])
  }

  function removePendingFile(index) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function onDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }

  async function processDocuments() {
    if (!pendingFiles.length) return
    setUploading(true)
    setError('')
    const failed = []
    for (const file of pendingFiles) {
      try {
        const fileUrl = await uploadFile(file, 1)
        const doc = await createKbDocument({ file_url: fileUrl, category, applied_to: applyTo.length ? applyTo : ['All roles'], diseases })
        setDocuments((prev) => [doc, ...prev])
      } catch (e) {
        failed.push(`${file.name}: ${e.message || 'upload failed'}`)
      }
    }
    setPendingFiles([])
    setDiseases([])
    setUploading(false)
    if (failed.length) setError(failed.join(' | '))
  }

  async function reindexDocument(id) {
    try {
      const doc = await reindexKbDocument(id)
      setDocuments((prev) => prev.map((d) => (d.id === id ? doc : d)))
    } catch (e) {
      setError(e.message || 'Could not reindex')
    }
  }

  async function changeApproval(doc, status, message) {
    try {
      const updated = await setKbApproval(doc.id, status)
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? updated : d)))
      showToast(message)
    } catch (e) {
      showToast(e.message || 'Could not update approval', true)
    }
  }

  async function saveEdit(values) {
    try {
      const updated = await updateKbDocument(editingDoc.id, values)
      setDocuments((prev) => prev.map((d) => (d.id === editingDoc.id ? updated : d)))
      setEditingDoc(null)
      showToast('Document updated')
    } catch (e) {
      showToast(e.message || 'Could not update document', true)
    }
  }
  async function deleteDocument(id) {
    if (!window.confirm('Delete this document and remove it from the AI knowledge base?')) return
    try {
      await deleteKbDocument(id)
      setDocuments((prev) => prev.filter((d) => d.id !== id))
    } catch (e) {
      setError(e.message || 'Could not delete')
    }
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">AI Knowledge Base</h1>
        <p className="text-sm text-gray-400 mt-1">
          Upload KRCS protocols, case definitions and behaviour instructions for the system AI to index and apply.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <StatCard icon={FileText} label="Total Documents" value={stats.total} sub={`${stats.categories} categories`} />
        <StatCard icon={Clock} label="Processing" value={stats.processing} sub="in the indexing queue" />
        <StatCard icon={ShieldCheck} label="Total Indexed" value={stats.indexed} sub={`${stats.totalChunks.toLocaleString()} chunks embedded`} />
        <StatCard icon={Database} label="Knowledge Size" value={stats.sizeLabel} sub="of 2 GB workspace" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center gap-2.5 mb-5">
          <UploadCloud className="w-5 h-5 text-gray-900" />
          <h2 className="text-lg font-semibold text-gray-900">Document Upload</h2>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={[
            'rounded-xl border-2 border-dashed p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-colors',
            isDragging ? 'border-red-400 bg-red-50/40' : 'border-red-200/60 bg-white hover:bg-gray-50',
          ].join(' ')}
        >
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          <div className="w-14 h-14 rounded-full bg-slate-500 flex items-center justify-center mb-4">
            <UploadCloud className="w-6 h-6 text-white" />
          </div>
          <p className="text-gray-900 text-lg">Drag and Drop files here</p>
          <p className="text-slate-500 font-medium mt-1">PDF, DOCX, TXT up to 25MB</p>
        </div>

        {pendingFiles.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {pendingFiles.map((file, i) => (
              <span key={`${file.name}-${i}`} className="inline-flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 text-xs text-gray-600">
                <FileText className="w-3.5 h-3.5 text-gray-400" />
                <span className="truncate max-w-[180px]">{file.name}</span>
                <span className="text-gray-400">{formatBytes(file.size)}</span>
                <button onClick={() => removePendingFile(i)} className="text-gray-400 hover:text-red-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <div>
            <label className="block text-gray-700 font-medium mb-2">Category</label>
            <div className="relative">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full appearance-none border-2 border-gray-100 rounded-xl px-5 py-4 text-gray-700 bg-white focus:outline-none focus:border-gray-200"
              >
                {KB_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <ChevronDown className="w-5 h-5 text-gray-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-2">Apply to</label>
            <MultiSelectDropdown label="Select roles" options={roleOptions} selected={applyTo} onChange={setApplyTo} />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-2">Diseases</label>
            <MultiSelectDropdown label="Select diseases" options={diseaseSelectOptions} selected={diseases} onChange={setDiseases} />
          </div>
        </div>

        {error && <p className="mt-4 bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">{error}</p>}

        <button
          onClick={processDocuments}
          disabled={!pendingFiles.length || uploading}
          className="w-full mt-6 bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl py-4 text-lg font-medium transition-colors"
        >
          {uploading ? 'Uploading...' : 'Process Documents'}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Search documents..."
            className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100"
          />
        </div>
        <div className="relative min-w-[180px]">
          <Filter className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-11 pr-8 py-3 text-sm text-gray-700"
          >
            <option value="">Category</option>
            {KB_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        <div className="relative min-w-[180px]">
          <Filter className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <select
            value={appliedToFilter}
            onChange={(e) => setAppliedToFilter(e.target.value)}
            className="w-full appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-11 pr-8 py-3 text-sm text-gray-700"
          >
            <option value="">Applied to</option>
            {roleOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        <div className="relative min-w-[180px]">
          <Filter className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-11 pr-8 py-3 text-sm text-gray-700"
          >
            <option value="">Status</option>
            <option value="indexed">Indexed</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>
              <div className="relative min-w-[180px]">
          <Filter className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <select
            value={approvalFilter}
            onChange={(e) => setApprovalFilter(e.target.value)}
            className="w-full appearance-none bg-gray-50 border border-gray-100 rounded-lg pl-11 pr-8 py-3 text-sm text-gray-700"
          >
            <option value="">Approval</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="retired">Retired</option>
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Knowledge base documents</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-900 text-xs font-medium bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-3.5 font-medium">Document</th>
                <th className="px-6 py-3.5 font-medium text-center">Category</th>
                <th className="px-6 py-3.5 font-medium text-center">Applied to</th>
                <th className="px-6 py-3.5 font-medium text-center">Size</th>
                <th className="px-6 py-3.5 font-medium text-center">Status</th>
                <th className="px-6 py-3.5 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map((doc) => (
                <tr key={doc.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-start gap-3">
                      <FileText className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-gray-900 truncate max-w-[280px]">{doc.name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {doc.id} · {doc.extension} · {doc.version} · {doc.uploadedBy} · {formatTimestamp(doc.uploadedAt)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-block text-xs font-medium px-3 py-2 rounded-md border border-gray-100 bg-gray-50 text-gray-900">{doc.category}</span>
                  </td>
                  <td className="px-6 py-4 text-center text-xs text-gray-900">{doc.appliedTo.join(', ')}
                    {doc.diseases && doc.diseases.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-1 mt-2">
                        {doc.diseases.map((k) => (
                          <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{diseaseNames[k] || k}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center text-gray-500">{formatBytes(doc.sizeBytes)}</td>
                  <td className="px-6 py-4 text-center">
                    <span title={doc.error || ''} className={['inline-block text-xs font-medium px-4 py-1.5 rounded-full', STATUS_STYLES[doc.status]].join(' ')}>
                      {STATUS_LABELS[doc.status]}
                    </span>
                    <div className="mt-2">
                      <span className={['inline-block text-xs font-medium px-3 py-1 rounded-full', APPROVAL_STYLES[approvalKey(doc)] || APPROVAL_STYLES.draft].join(' ')}>
                        {APPROVAL_LABELS[approvalKey(doc)] || doc.approvalStatus}
                      </span>
                      {approvalKey(doc) === 'approved' && doc.approvedBy && (
                        <div className="text-[11px] text-gray-400 mt-1">by {doc.approvedBy}</div>
                      )}
                    </div>
                    {doc.status === 'failed' && doc.error && <div className="text-[11px] text-rose-500 mt-1 max-w-[200px] mx-auto truncate" title={doc.error}>{doc.error}</div>}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-3">
                      {canApprove && approvalKey(doc) !== 'approved' && (
                        <button
                          onClick={() => changeApproval(doc, 'Approved', 'Document approved')}
                          disabled={doc.status !== 'indexed'}
                          title={doc.status !== 'indexed' ? 'Available once indexing completes' : 'Approve'}
                          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      {canApprove && approvalKey(doc) === 'approved' && (
                        <button onClick={() => changeApproval(doc, 'Retired', 'Document retired')} title="Retire" className="text-amber-600 hover:text-amber-700">
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                      {canApprove && approvalKey(doc) !== 'draft' && (
                        <button onClick={() => changeApproval(doc, 'Draft', 'Moved back to draft')} title="Back to draft" className="text-gray-500 hover:text-gray-900">
                          <Undo2 className="w-4 h-4" />
                        </button>
                      )}
                      {canManage && (
                        <button onClick={() => setEditingDoc(doc)} title="Edit" className="text-gray-500 hover:text-gray-900">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                     {canManage && (
                      <>
                      <button
                        onClick={() => reindexDocument(doc.id)}
                        disabled={doc.status === 'processing'}
                        title="Reindex"
                        className="text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteDocument(doc.id)} title="Delete" className="text-red-500 hover:text-red-700">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      </>
                       )}
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredDocuments.length && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">No documents match your filters</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {editingDoc && (
        <EditDocumentModal doc={editingDoc} roleOptions={roleOptions} diseaseOptions={diseaseSelectOptions} onClose={() => setEditingDoc(null)} onSave={saveEdit} />
      )}
      {toast.show && (
        <div className={['fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-sm text-white shadow-lg', toast.error ? 'bg-red-600' : 'bg-gray-900'].join(' ')}>{toast.message}</div>
      )}
    </AppShell>
  )
}
