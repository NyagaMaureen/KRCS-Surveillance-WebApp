import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Pencil, Trash2, Search, X, Upload } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { listFaqs, saveFaq, deleteFaq, getHelpContact, saveHelpContact, listHelpResources, saveHelpResource, deleteHelpResource, uploadFile } from '../api/frappe'

// Help Center Content (KRCS 27 Nov 2026), System settings, for anyone with Manage Help Center: tabs for the FAQs,
// the Contact Us details, Guides and Video Tutorials. FAQs, guides and videos are ticked per workspace; Contact Us is
// one block for everyone. The Help Center pages (HelpPages.jsx) and the mobile app read the same data (help_faqs).
// Plain tables with grid lines, black text and bold labels.

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'
const INPUT = `w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 ${FOCUS}`
const TH = 'border border-gray-200 bg-gray-50 px-3 py-2 text-left font-bold text-gray-900'
const TD = 'border border-gray-200 px-3 py-2.5 align-top text-gray-900'
const EMPTY = { question: '', answer: '', question_sw: '', answer_sw: '', topic: 'Getting started', sort_order: 10, published: true, everyone: false, workspaces: [] }

function FaqForm({ faq, topics, workspaces, onClose, onSaved }) {
  const [f, setF] = useState(faq)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const toggle = (w) => set('workspaces', f.workspaces.includes(w) ? f.workspaces.filter((x) => x !== w) : [...f.workspaces, w])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSaved(await saveFaq(f))
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="faq-form-title">
      <form onSubmit={submit} className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 id="faq-form-title" className="text-lg font-bold text-gray-900">{f.id ? 'Change FAQ' : 'Add FAQ'}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className={`rounded p-1 text-gray-700 hover:bg-gray-100 ${FOCUS}`}><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Question (English)</span>
            <input className={INPUT} value={f.question} onChange={(e) => set('question', e.target.value)} required maxLength={1000} /></label>
          <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Answer (English)</span>
            <textarea className={INPUT} rows={4} value={f.answer} onChange={(e) => set('answer', e.target.value)} required /></label>
          <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Question (Kiswahili) <span className="font-normal">optional</span></span>
            <input className={INPUT} value={f.question_sw} onChange={(e) => set('question_sw', e.target.value)} maxLength={1000} /></label>
          <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Answer (Kiswahili) <span className="font-normal">optional</span></span>
            <textarea className={INPUT} rows={4} value={f.answer_sw} onChange={(e) => set('answer_sw', e.target.value)} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Topic</span>
              <select className={INPUT} value={f.topic} onChange={(e) => set('topic', e.target.value)}>
                {topics.map((t) => <option key={t}>{t}</option>)}
              </select></label>
            <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Order <span className="font-normal">(lower shows first)</span></span>
              <input type="number" className={INPUT} value={f.sort_order} onChange={(e) => set('sort_order', e.target.value)} /></label>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-bold text-gray-900">Show to</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {workspaces.map((w) => (
                <label key={w.key} className="flex items-center gap-2 text-sm text-gray-900">
                  <input type="checkbox" checked={f.workspaces.includes(w.key)} disabled={f.everyone} onChange={() => toggle(w.key)} />{w.label}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <input type="checkbox" checked={f.everyone} onChange={(e) => set('everyone', e.target.checked)} />Everyone
              </label>
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} />Published (shown in the Help Center)
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>Cancel</button>
          <button type="submit" disabled={busy} className={`rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 ${FOCUS}`}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

function FaqsTab({ adding = false, doneAdding }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(adding ? EMPTY : null)   // Add FAQ on the FAQs page opens the form straight away
  const [who, setWho] = useState('')
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let off = false
    listFaqs().then((d) => { if (!off) setData(d) }).catch((e) => { if (!off) setError(e.message || 'Could not load the FAQs.') })
    return () => { off = true }
  }, [reload])

  const label = useMemo(() => Object.fromEntries((data?.workspaces || []).map((w) => [w.key, w.label])), [data])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.faqs || []).filter((f) => (!who || f.everyone || f.workspaces.includes(who))
      && (!q || `${f.question} ${f.answer} ${f.question_sw} ${f.answer_sw}`.toLowerCase().includes(q)))
  }, [data, who, query])

  async function remove(f) {
    if (!window.confirm(`Remove this FAQ?\n\n${f.question}`)) return
    try {
      await deleteFaq(f.id)
      setReload((n) => n + 1)
    } catch (e) {
      setError(e.message || 'Could not remove it.')
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-900">Questions and answers on the FAQs page and in the mobile app. Each one is shown only to the workspaces ticked.</p>
        <div className="flex items-center gap-3">
          <Link to="/help-faqs" className="text-sm font-semibold text-red-700 hover:underline">See the FAQs page</Link>
          <button type="button" onClick={() => setEditing(EMPTY)} disabled={!data}
            className={`inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 ${FOCUS}`}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add FAQ
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Shown to</span>
          <select className={`${INPUT} w-56`} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">All workspaces</option>
            {(data?.workspaces || []).map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select></label>
        <label className="relative block flex-1 min-w-[220px]"><span className="mb-1 block text-sm font-bold text-gray-900">Search</span>
          <Search className="absolute left-3 top-[34px] h-4 w-4 text-gray-500" aria-hidden="true" />
          <input className={`${INPUT} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Question or answer" /></label>
      </div>

      {error && <p className="mb-4 rounded-lg border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!data ? <div className="h-40 animate-pulse rounded-2xl bg-gray-100" /> : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead><tr>
              <th className={`${TH} w-12`}>No.</th><th className={TH}>Question</th><th className={TH}>Topic</th><th className={TH}>Shown to</th>
              <th className={TH}>Kiswahili</th><th className={TH}>Published</th><th className={TH}><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {rows.map((f, i) => (
                <tr key={f.id}>
                  <td className={`${TD} tabular-nums`}>{i + 1}</td>
                  <td className={TD}><b>{f.question}</b><span className="mt-0.5 block line-clamp-2">{f.answer}</span></td>
                  <td className={`${TD} whitespace-nowrap`}>{f.topic}</td>
                  <td className={TD}>{f.everyone ? 'Everyone' : f.workspaces.map((w) => label[w] || w).join(', ')}</td>
                  <td className={TD}>{f.question_sw && f.answer_sw ? 'Yes' : 'No'}</td>
                  <td className={TD}>{f.published ? 'Yes' : 'No'}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <button type="button" onClick={() => setEditing(f)} className={`mr-3 inline-flex items-center gap-1 font-semibold text-red-700 hover:underline ${FOCUS}`}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Change
                    </button>
                    <button type="button" onClick={() => remove(f)} className={`inline-flex items-center gap-1 font-semibold text-gray-900 hover:underline ${FOCUS}`}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className={`${TD} py-8 text-center`}>No FAQs here yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editing && data && (
        <FaqForm faq={editing} topics={data.topics} workspaces={data.workspaces} onClose={() => { setEditing(null); doneAdding?.() }}
          onSaved={() => { setEditing(null); doneAdding?.(); setReload((n) => n + 1) }} />
      )}
    </>
  )
}

// ---------- Contact Us ----------

function ContactTab() {
  const [c, setC] = useState(null)   // what is saved
  const [draft, setDraft] = useState(null)   // the form, only while editing
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let off = false
    getHelpContact().then((d) => { if (!off) setC(d.contact) }).catch((e) => { if (!off) setError(e.message || 'Could not load.') })
    return () => { off = true }
  }, [])
  const set = (k, v) => setDraft((x) => ({ ...x, [k]: v }))

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setNote('')
    try {
      setC(await saveHelpContact({ ...draft, note: c.note }))
      setDraft(null)
      setNote('Saved.')
    } catch (err) {
      setNote(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="text-sm text-red-700">{error}</p>
  if (!c) return <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
  const FIELDS = [['email', 'Support email', 'email'], ['phone', 'Support phone', 'text'], ['hours', 'Hours', 'text']]
  return (
    <div className="max-w-2xl rounded-2xl border border-gray-200 bg-white p-6">
      <p className="mb-4 text-sm text-gray-900">Shown to everyone on Contact Us. Support tickets sent from that page go to Feedback Received.</p>
      {!draft ? (
        <>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {FIELDS.map(([k, l]) => (
                <tr key={k}>
                  <th scope="row" className={`${TH} w-40`}>{l}</th>
                  <td className={TD}>{c[k] || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => { setDraft(c); setNote('') }}
              className={`inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 ${FOCUS}`}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
            </button>
            <Link to="/help-contact" className="text-sm font-semibold text-red-700 hover:underline">See the Contact Us page</Link>
            {note && <p className="text-sm text-gray-900" role="status">{note}</p>}
          </div>
        </>
      ) : (
        <form onSubmit={save} className="space-y-4">
          {FIELDS.map(([k, l, type]) => (
            <label key={k} className="block"><span className="mb-1 block text-sm font-bold text-gray-900">{l}</span>
              <input type={type} className={INPUT} value={draft[k]} onChange={(e) => set(k, e.target.value)} /></label>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className={`rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 ${FOCUS}`}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setDraft(null)} className={`rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>Cancel</button>
            {note && <p className="text-sm text-red-700" role="status">{note}</p>}
          </div>
        </form>
      )}
    </div>
  )
}

// ---------- Guides and Video Tutorials ----------

function ResourceForm({ item, kind, workspaces, onClose, onSaved }) {
  const [f, setF] = useState(item)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const toggle = (w) => set('workspaces', f.workspaces.includes(w) ? f.workspaces.filter((x) => x !== w) : [...f.workspaces, w])
  const noun = kind === 'Video' ? 'video' : 'guide'

  async function upload(file) {
    if (!file) return
    setBusy('upload')
    setError('')
    try {
      set('file', await uploadFile(file, 0))   // public: every signed-in user opens it from the Help Center
    } catch (err) {
      setError(err.message || 'Could not upload the file.')
    } finally {
      setBusy('')
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy('save')
    setError('')
    try {
      onSaved(await saveHelpResource({ ...f, kind }))
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy('')
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="res-form-title">
      <form onSubmit={submit} className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 id="res-form-title" className="text-lg font-bold text-gray-900">{f.id ? `Change ${noun}` : `Add ${noun}`}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className={`rounded p-1 text-gray-700 hover:bg-gray-100 ${FOCUS}`}><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Title</span>
            <input className={INPUT} value={f.title} onChange={(e) => set('title', e.target.value)} required maxLength={140} /></label>
          <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Description <span className="font-normal">optional</span></span>
            <textarea className={INPUT} rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-sm font-bold text-gray-900">Link</span>
            <input type="url" className={INPUT} value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" /></label>
          <div>
            <span className="mb-1 block text-sm font-bold text-gray-900">Or upload a file</span>
            <div className="flex flex-wrap items-center gap-3">
              <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
                <Upload className="h-4 w-4" aria-hidden="true" /> {busy === 'upload' ? 'Uploading…' : 'Choose file'}
                <input type="file" className="sr-only" accept={kind === 'Video' ? 'video/*' : '.pdf,.doc,.docx,.ppt,.pptx'} onChange={(e) => upload(e.target.files?.[0])} />
              </label>
              {f.file && <span className="text-sm text-gray-900">{f.file.split('/').pop()} <button type="button" onClick={() => set('file', '')} className="ml-2 font-semibold underline">Remove</button></span>}
            </div>
          </div>
          <label className="block w-40"><span className="mb-1 block text-sm font-bold text-gray-900">Order</span>
            <input type="number" className={INPUT} value={f.sort_order} onChange={(e) => set('sort_order', e.target.value)} /></label>
          <fieldset>
            <legend className="mb-1 text-sm font-bold text-gray-900">Show to</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {workspaces.map((w) => (
                <label key={w.key} className="flex items-center gap-2 text-sm text-gray-900">
                  <input type="checkbox" checked={f.workspaces.includes(w.key)} disabled={f.everyone} onChange={() => toggle(w.key)} />{w.label}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <input type="checkbox" checked={f.everyone} onChange={(e) => set('everyone', e.target.checked)} />Everyone
              </label>
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} />Published
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>Cancel</button>
          <button type="submit" disabled={!!busy} className={`rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 ${FOCUS}`}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

const EMPTY_RESOURCE = { title: '', description: '', url: '', file: '', sort_order: 10, published: true, everyone: true, workspaces: [] }

function ResourcesTab({ kind, workspaces }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [reload, setReload] = useState(0)
  const label = useMemo(() => Object.fromEntries(workspaces.map((w) => [w.key, w.label])), [workspaces])
  const noun = kind === 'Video' ? 'video' : 'guide'
  const page = kind === 'Video' ? '/help-videos' : '/help-guides'

  useEffect(() => {
    let off = false
    listHelpResources(kind).then((d) => { if (!off) setItems(d.items) }).catch((e) => { if (!off) setError(e.message || 'Could not load.') })
    return () => { off = true }
  }, [kind, reload])

  async function remove(r) {
    if (!window.confirm(`Remove this ${noun}?\n\n${r.title}`)) return
    try {
      await deleteHelpResource(r.id)
      setReload((n) => n + 1)
    } catch (e) {
      setError(e.message || 'Could not remove it.')
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-end gap-3">
        <div className="flex items-center gap-3">
          <Link to={page} className="text-sm font-semibold text-red-700 hover:underline">See the page</Link>
          <button type="button" onClick={() => setEditing(EMPTY_RESOURCE)}
            className={`inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 ${FOCUS}`}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add {noun}
          </button>
        </div>
      </div>
      {error && <p className="mb-4 rounded-lg border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!items ? <div className="h-32 animate-pulse rounded-2xl bg-gray-100" /> : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead><tr>
              <th className={`${TH} w-12`}>No.</th><th className={TH}>Title</th><th className={TH}>Opens</th><th className={TH}>Shown to</th><th className={TH}>Published</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={r.id}>
                  <td className={`${TD} tabular-nums`}>{i + 1}</td>
                  <td className={TD}><b>{r.title}</b>{r.description && <span className="mt-0.5 block">{r.description}</span>}</td>
                  <td className={`${TD} break-all`}>{r.file ? `File: ${r.file.split('/').pop()}` : r.url}</td>
                  <td className={TD}>{r.everyone ? 'Everyone' : r.workspaces.map((w) => label[w] || w).join(', ')}</td>
                  <td className={TD}>{r.published ? 'Yes' : 'No'}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <button type="button" onClick={() => setEditing(r)} className={`mr-3 inline-flex items-center gap-1 font-semibold text-red-700 hover:underline ${FOCUS}`}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Change
                    </button>
                    <button type="button" onClick={() => remove(r)} className={`inline-flex items-center gap-1 font-semibold text-gray-900 hover:underline ${FOCUS}`}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={6} className={`${TD} py-8 text-center`}>No {noun}s yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ResourceForm item={editing} kind={kind} workspaces={workspaces} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); setReload((n) => n + 1) }} />}
    </>
  )
}

// ---------- the page ----------

const TABS = [['faqs', 'FAQs'], ['contact', 'Contact Us'], ['guides', 'Guides'], ['videos', 'Video Tutorials']]
const WORKSPACES = [{ key: 'chp', label: 'CHP' }, { key: 'cha', label: 'CHA' }, { key: 'fhw', label: 'Facility Health Worker' },
  { key: 'officer', label: 'Surveillance Officer' }, { key: 'dataai', label: 'Data & AI Admin' }, { key: 'full', label: 'County / National' },
  { key: 'sysadmin', label: 'System Administrator' }]

export default function HelpCenterContent() {
  const [sp, setSp] = useSearchParams()
  const tab = TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'faqs'
  return (
    <AppShell>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">Help Center Content</h2>
        <p className="text-sm text-gray-900">What people see under Help Center: FAQs, Contact Us, Guides and Video Tutorials.</p>
      </div>
      {/* tabs across the full width; the one you are on is red (KRCS 27 Nov 2026) */}
      <div role="tablist" aria-label="Help Center Content" className="mb-6 flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setSp({ tab: k }, { replace: true })}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-bold ${tab === k ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50'} ${FOCUS}`}>{l}</button>
        ))}
      </div>
      {tab === 'faqs' && <FaqsTab adding={sp.get('add') === '1'} doneAdding={() => setSp({ tab: 'faqs' }, { replace: true })} />}
      {tab === 'contact' && <ContactTab />}
      {tab === 'guides' && <ResourcesTab key="Guide" kind="Guide" workspaces={WORKSPACES} />}
      {tab === 'videos' && <ResourcesTab key="Video" kind="Video" workspaces={WORKSPACES} />}
    </AppShell>
  )
}
