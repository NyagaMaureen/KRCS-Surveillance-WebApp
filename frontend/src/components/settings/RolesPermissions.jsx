import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, Check, Lock } from 'lucide-react'
import { getRoleCapabilities, setRoleCapability } from '../../api/frappe'

export default function RolesPermissions({ roles = [], users = [], initialRole = '', onRoleChange }) {
  const [search, setSearch] = useState('')
  const [selectedRole, setSelectedRole] = useState(null)
  const [loading, setLoading] = useState(false)
  const [rawCapabilities, setRawCapabilities] = useState([])
  const [capState, setCapState] = useState({})
  const [locked, setLocked] = useState(false)
  const [capFilter, setCapFilter] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  const categories = useMemo(() => {
    const byCategory = new Map()
    for (const cap of rawCapabilities) {
      if (!byCategory.has(cap.category)) byCategory.set(cap.category, new Map())
      const byDoctype = byCategory.get(cap.category)
      const groupKey = cap.target_doctype || 'all'
      if (!byDoctype.has(groupKey)) byDoctype.set(groupKey, [])
      byDoctype.get(groupKey).push(cap)
    }
    return Array.from(byCategory.entries())
      .map(([category, byDoctype]) => ({
        key: category,
        label: category,
        groups: Array.from(byDoctype.entries()).map(([recordType, capabilities]) => ({ recordType, capabilities })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rawCapabilities])

  const roleUserCounts = useMemo(() => {
    const counts = {}
    users.forEach((u) => {
      if (u.primary_role) counts[u.primary_role] = (counts[u.primary_role] || 0) + 1
    })
    return counts
  }, [users])

  const roleCards = useMemo(() =>
    roles.map((r) => {
      const count = roleUserCounts[r.role] || 0
      return { name: r.name, role: r.role, countLabel: count === 1 ? '1 user' : `${count} users` }
    }),
    [roles, roleUserCounts]
  )

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return roleCards
    return roleCards.filter((r) => r.role.toLowerCase().includes(q))
  }, [search, roleCards])

  const enabledTotal = rawCapabilities.filter((c) => capState[c.key]).length

  const visibleCategories = useMemo(() => {
    const q = capFilter.trim().toLowerCase()
    return categories
      .map((cat) => ({
        ...cat,
        groups: cat.groups
          .map((g) => ({
            ...g,
            capabilities: q
              ? g.capabilities.filter((c) => `${c.name} ${c.description || ''}`.toLowerCase().includes(q))
              : g.capabilities,
          }))
          .filter((g) => g.capabilities.length),
      }))
      .filter((cat) => cat.groups.length)
  }, [categories, capFilter])

  const [toast, setToast] = useState({ show: false, message: '', error: false })
  const toastTimer = useRef(null)
  function showToast(message, error = false) {
    setToast({ show: true, message, error })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000)
  }

  function selectRole(r) {
    setSelectedRole(r)
  }

  function pickRole(r) {
    selectRole(r)
    onRoleChange?.(r.role)
  }

  async function loadCapabilities(role) {
    setLoading(true)
    try {
      const res = await getRoleCapabilities(role)
      const caps = res?.capabilities || []
      setRawCapabilities(caps)
      setLocked(!!res?.locked)
      setCapState(Object.fromEntries(caps.map((c) => [c.key, !!c.enabled])))
    } catch (err) {
      setRawCapabilities([])
      showToast(err.message || 'Failed to load capabilities', true)
    } finally {
      setLoading(false)
    }
  }

  async function toggleCapability(cap, event) {
    const enabled = event.target.checked
    setCapState((prev) => ({ ...prev, [cap.key]: enabled }))
    try {
      const res = await setRoleCapability(selectedRole.role, cap.key, enabled ? 1 : 0)
      if (res?.capabilities) {
        setCapState(Object.fromEntries(res.capabilities.map((c) => [c.key, !!c.enabled])))
      }
      showToast('Permissions saved')
    } catch (err) {
      setCapState((prev) => ({ ...prev, [cap.key]: !enabled }))
      showToast(err.message || 'Failed to update capability', true)
    }
  }

  function categoryCaps(cat) {
    return cat.groups.flatMap((g) => g.capabilities)
  }

  async function bulkToggle(cat) {
    const caps = categoryCaps(cat)
    const target = !caps.every((c) => capState[c.key])
    setBulkBusy(true)
    try {
      for (const cap of caps) {
        if (!!capState[cap.key] !== target) {
          await toggleCapability(cap, { target: { checked: target } })
        }
      }
    } finally {
      setBulkBusy(false)
    }
  }

  function bulkLabel(cat) {
    return categoryCaps(cat).every((c) => capState[c.key]) ? 'Disable all' : 'Enable all'
  }

  useEffect(() => {
    if (selectedRole) loadCapabilities(selectedRole.role)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole])

  useEffect(() => {
    if (!roles.length) return
    const match = initialRole && roles.find((r) => r.role === initialRole || r.name === initialRole)
    if (match) {
      setSelectedRole((cur) => (cur && cur.name === match.name ? cur : { name: match.name, role: match.role }))
    } else if (!selectedRole) {
      selectRole({ name: roles[0].name, role: roles[0].role })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, initialRole])

  const isSelected = (r) => selectedRole && selectedRole.name === r.name

  function renderTile(cap) {
    const on = !!capState[cap.key]
    return (
      <button
        key={cap.key}
        type="button"
        role="switch"
        aria-checked={on}
        disabled={locked}
        onClick={() => toggleCapability(cap, { target: { checked: !capState[cap.key] } })}
        className={[
          'flex items-start justify-between gap-3 text-left border rounded-lg p-3 transition-colors',
          on ? 'border-red-200 bg-red-50/30' : 'border-gray-100 hover:border-gray-200',
          locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        ].join(' ')}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">{cap.name}</div>
          <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{cap.description}</div>
        </div>
        <span className={['w-10 h-5 rounded-full relative transition-colors shrink-0 mt-0.5', on ? 'bg-red-600' : 'bg-gray-200'].join(' ')}>
          <span className={['absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform', on ? 'translate-x-5' : ''].join(' ')}></span>
        </span>
      </button>
    )
  }

  function renderGroups(cat) {
    return cat.groups.map((group) => (
      <div key={group.recordType} className="contents">
        {cat.groups.length > 1 && (
          <div className="col-span-full pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group.recordType}</div>
        )}
        {group.capabilities.map(renderTile)}
      </div>
    ))
  }

  const bulkButton = (cat) => !locked && (
    <button
      type="button"
      onClick={() => bulkToggle(cat)}
      disabled={bulkBusy}
      className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
    >
      {bulkLabel(cat)}
    </button>
  )

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-[calc(100vh-220px)] min-h-[520px]">
      <div className="hidden lg:flex bg-white rounded-xl border border-gray-100 w-64 shrink-0 flex-col min-h-0">
        <div className="p-4 border-b border-gray-100 shrink-0">
          <h3 className="font-bold text-gray-900 mb-3">Roles</h3>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="text"
              placeholder="Search roles"
              className="w-full bg-gray-50 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
          {filteredRoles.map((r) => (
            <button
              key={r.name}
              onClick={() => pickRole(r)}
              className={[
                'w-full text-left rounded-lg px-3 py-2.5 border transition-colors flex items-center justify-between gap-2',
                isSelected(r) ? 'border-red-600 bg-red-50' : 'border-transparent hover:bg-gray-50',
              ].join(' ')}
            >
              <span className={['text-sm font-semibold truncate', isSelected(r) ? 'text-red-600' : 'text-gray-900'].join(' ')}>{r.role}</span>
              <span className="text-[11px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">{r.countLabel}</span>
            </button>
          ))}
          {!filteredRoles.length && (
            <div className="text-center text-sm text-gray-400 py-8">No roles found</div>
          )}
        </div>
      </div>

      <div className="lg:hidden flex gap-2 overflow-x-auto shrink-0 pb-1">
        {roleCards.map((r) => (
          <button
            key={r.name}
            onClick={() => pickRole(r)}
            className={[
              'whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium border',
              isSelected(r) ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-200 bg-white text-gray-700',
            ].join(' ')}
          >
            {r.role} <span className="text-xs text-gray-400">{r.countLabel}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0 min-h-0 bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden">
        {selectedRole ? (
          <>
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-gray-900">{selectedRole.role}</h2>
                    {locked && (
                      <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full px-2.5 py-1">
                        <Lock className="w-3 h-3" /> System role · full access
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{enabledTotal} of {rawCapabilities.length} permissions enabled</p>
                </div>
                <div className="relative w-48 shrink-0">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={capFilter}
                    onChange={(e) => setCapFilter(e.target.value)}
                    type="text"
                    placeholder="Filter permissions"
                    className="w-full bg-gray-50 rounded-lg pl-9 pr-3 py-1.5 text-sm focus:outline-none"
                  />
                </div>
              </div>

            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-5">
              {loading ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading permissions…</div>
              ) : !categories.length ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-400">No capabilities found for this role.</div>
              ) : !visibleCategories.length ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-400">No permissions match your filter.</div>
              ) : (
                <div className="space-y-6">
                  {visibleCategories.map((cat) => (
                    <div key={cat.key}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{cat.label}</h4>
                        {bulkButton(cat)}
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{renderGroups(cat)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Select a role to view its permissions</div>
        )}
      </div>

      {toast.show && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm rounded-lg px-4 py-2.5 flex items-center gap-2 shadow-lg z-50 transition-opacity duration-200">
          {!toast.error && <Check className="w-4 h-4 text-green-400" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  )
}
