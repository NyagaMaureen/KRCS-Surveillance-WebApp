import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Search, X, AlertCircle, Building2 } from 'lucide-react'
import { getHealthUnits, saveHealthUnit, getRegions, getSubCounties } from '../../api/frappe'
import { useCapabilities } from '../../context/CapabilitiesContext'

// Community Health Units registry (KRCS 17 Nov 2026): a CHP belongs to one CHU, a CHA heads one or more.
// CHAs see the signals of the CHPs in their CHU(s). Managed with Manage Users.
const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5'
const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500'

export default function HealthUnits() {
  const { has } = useCapabilities()
  const canManage = has('manage_users')
  const [units, setUnits] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [subFilter, setSubFilter] = useState('')
  const [regions, setRegions] = useState([])
  const [allSubs, setAllSubs] = useState([])
  const [editing, setEditing] = useState(null)   // {id?, name, region, subCounty, active}
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    getHealthUnits().then(setUnits).catch((e) => setError(e.message || 'Could not load the Community Health Units'))
  }
  useEffect(() => {
    load()
    getRegions().then(setRegions).catch(() => {})
    getSubCounties('').then(setAllSubs).catch(() => {})
  }, [])

  const editRegion = editing ? editing.region : ''
  const formSubs = useMemo(() => (editRegion ? allSubs.filter((s) => s.region === editRegion) : []), [allSubs, editRegion])

  const shown = useMemo(() => (units || []).filter((u) =>
    (!subFilter || u.subCounty === subFilter)
    && (!search || `${u.name} ${u.subCountyName} ${(u.chas || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()))), [units, search, subFilter])

  function openAdd() {
    setFormError('')
    const sc = allSubs.find((s) => s.name === subFilter)   // the sub-county being viewed, if any
    setEditing({ name: '', region: sc ? sc.region : '', subCounty: sc ? sc.name : '', active: true })
  }
  function openEdit(u) {
    setFormError('')
    setEditing({ id: u.id, name: u.name, region: u.region || '', subCounty: u.subCounty, active: u.active })
  }
  async function save() {
    setFormError('')
    if (!editing.name.trim()) { setFormError('Give the Community Health Unit a name.'); return }
    if (!editing.subCounty) { setFormError('Choose the sub-county.'); return }
    setSaving(true)
    try {
      await saveHealthUnit(editing)
      setEditing(null)
      load()
    } catch (e) {
      setFormError(e.message || 'Could not save the Community Health Unit.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="bg-white rounded-xl p-4 flex flex-wrap gap-3 mb-4 border border-gray-100">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search units or CHAs" aria-label="Search"
            className="w-full bg-gray-50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none" />
        </div>
        <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)} aria-label="Sub-county"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 bg-gray-50">
          <option value="">All Sub-counties</option>
          {allSubs.map((s) => <option key={s.name} value={s.name}>{s.sub_county_name}</option>)}
        </select>
        {canManage && (
          <button onClick={openAdd} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4" aria-hidden="true" /> Add Community Health Unit
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 text-xs bg-gray-50 border-b border-gray-100">
              <th className="px-5 py-3 font-medium">Community Health Unit</th>
              <th className="px-5 py-3 font-medium">Sub-county</th>
              <th className="px-5 py-3 font-medium">Region</th>
              <th className="px-5 py-3 font-medium">Headed by (CHA)</th>
              <th className="px-5 py-3 font-medium text-center">CHPs</th>
              <th className="px-5 py-3 font-medium">Status</th>
              {canManage && <th className="px-5 py-3 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {units === null ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : !shown.length ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400">No Community Health Units yet</td></tr>
            ) : shown.map((u) => (
              <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <Building2 className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
                    <span className="text-gray-900">{u.name}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-gray-700">{u.subCountyName}</td>
                <td className="px-5 py-3 text-gray-700">{u.regionName || '—'}</td>
                <td className="px-5 py-3 text-gray-700">{u.chas?.length ? u.chas.join(', ') : <span className="text-amber-700">No CHA yet</span>}</td>
                <td className="px-5 py-3 text-gray-900 tabular-nums text-center">{u.chps}</td>
                <td className="px-5 py-3">
                  <span className={['text-xs font-medium px-3 py-1 rounded-full', u.active ? 'bg-[#29A847]/10 text-[#29A847]' : 'bg-gray-100 text-gray-600'].join(' ')}>
                    {u.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {canManage && (
                  <td className="px-5 py-3">
                    <button onClick={() => openEdit(u)} className="text-gray-500 hover:text-gray-800" aria-label={`Edit ${u.name}`}><Pencil className="w-4 h-4" /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Add each CHP and CHA to their Community Health Unit in Users. A CHA sees the signals of the CHPs in the units they head,
        plus CBS and WhatsApp community reports in their sub-county.
      </p>

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null) }}>
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{editing.id ? 'Edit Community Health Unit' : 'Add Community Health Unit'}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className={labelCls} htmlFor="chu-name">Name <span className="text-red-600">*</span></label>
                <input id="chu-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} placeholder="e.g. Ifo Block A" autoFocus />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls} htmlFor="chu-region">Region <span className="text-red-600">*</span></label>
                  <select id="chu-region" value={editing.region} onChange={(e) => setEditing({ ...editing, region: e.target.value, subCounty: '' })} className={inputCls}>
                    <option value="">Select a region</option>
                    {regions.map((r) => <option key={r.name} value={r.name}>{r.region_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="chu-sub">Sub-county <span className="text-red-600">*</span></label>
                  <select id="chu-sub" value={editing.subCounty} onChange={(e) => setEditing({ ...editing, subCounty: e.target.value })} disabled={!editing.region}
                    className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-400`}>
                    <option value="">{editing.region ? 'Select a sub-county' : 'Select a region first'}</option>
                    {formSubs.map((s) => <option key={s.name} value={s.name}>{s.sub_county_name}</option>)}
                    {editing.subCounty && !formSubs.some((s) => s.name === editing.subCounty) && <option value={editing.subCounty}>{editing.subCounty}</option>}
                  </select>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
                Active (can be chosen for new users)
              </label>
            </div>
            {formError && (
              <div className="mx-6 mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><span>{formError}</span>
              </div>
            )}
            <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-xl">
              <button onClick={() => setEditing(null)} className="border border-gray-200 bg-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
