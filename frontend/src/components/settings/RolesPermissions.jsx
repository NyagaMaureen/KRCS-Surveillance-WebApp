import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, ChevronDown, Bell, Check } from 'lucide-react'
import { getRoleCapabilities, setRoleCapability } from '../../api/frappe'

const NOTIFICATION_PREFS = [
  { key: 'email_new_alert', name: 'Email me on new alerts', description: 'Get an email whenever a new alert is created in your region.' },
  { key: 'weekly_summary', name: 'Weekly summary email', description: 'Receive a weekly digest of surveillance activity.' },
  { key: 'sms_critical', name: 'SMS for critical cases', description: 'Get a text message when a case is marked critical.' },
]
const PREFS_STORAGE_KEY = 'krcs_notification_prefs'

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || '{}')
    return Object.fromEntries(NOTIFICATION_PREFS.map((p) => [p.key, !!saved[p.key]]))
  } catch (e) {
    return Object.fromEntries(NOTIFICATION_PREFS.map((p) => [p.key, false]))
  }
}

export default function RolesPermissions({ roles = [], users = [] }) {
  const [search, setSearch] = useState('')
  const [selectedRole, setSelectedRole] = useState(null)
  const [loading, setLoading] = useState(false)
  const [rawCapabilities, setRawCapabilities] = useState([])
  const [capState, setCapState] = useState({})
  const [openCategories, setOpenCategories] = useState({})
  const [prefState, setPrefState] = useState(loadPrefs)

  const categories = useMemo(() => {
    const byCategory = new Map()
    for (const cap of rawCapabilities) {
      if (!byCategory.has(cap.category)) byCategory.set(cap.category, new Map())
      const byDoctype = byCategory.get(cap.category)
      if (!byDoctype.has(cap.target_doctype)) byDoctype.set(cap.target_doctype, [])
      byDoctype.get(cap.target_doctype).push(cap)
    }
    return Array.from(byCategory.entries())
      .map(([category, byDoctype]) => ({
        key: category,
        label: category,
        groups: Array.from(byDoctype.entries()).map(([recordType, capabilities]) => ({ recordType, capabilities })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rawCapabilities])

  function toggleNotificationPref(key) {
    setPrefState((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
    showToast('Preference saved')
  }

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
      return { name: r.name, role: r.role, subtitle: count === 1 ? '1 user assigned' : `${count} users assigned` }
    }),
    [roles, roleUserCounts]
  )

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return roleCards
    return roleCards.filter((r) => r.role.toLowerCase().includes(q))
  }, [search, roleCards])

  const [toast, setToast] = useState({ show: false, message: '', error: false })
  const toastTimer = useRef(null)
  function showToast(message, error = false) {
    setToast({ show: true, message, error })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000)
  }

  function toggleCategory(key) {
    setOpenCategories((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }))
  }

  function selectRole(r) {
    setSelectedRole(r)
  }

  function isEnabled(name) {
    return !!capState[name]
  }

  async function loadCapabilities(role) {
    setLoading(true)
    try {
      const list = await getRoleCapabilities(role)
      const caps = list || []
      setRawCapabilities(caps)
      const state = {}
      for (const cap of caps) state[cap.name] = !!cap.enabled
      setCapState(state)
    } catch (err) {
      setRawCapabilities([])
      showToast(err.message || 'Failed to load capabilities', true)
    } finally {
      setLoading(false)
    }
  }

  async function toggleCapability(cap, event) {
    const enabled = event.target.checked
    try {
      await setRoleCapability(selectedRole.role, cap.name, enabled ? 1 : 0)
      setCapState((prev) => ({ ...prev, [cap.name]: enabled }))
      showToast('Capability updated')
    } catch (err) {
      event.target.checked = !enabled
      showToast(err.message || 'Failed to update capability', true)
    }
  }

  useEffect(() => {
    if (selectedRole) loadCapabilities(selectedRole.role)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole])

  useEffect(() => {
    if (!selectedRole && roles.length) {
      selectRole({ name: roles[0].name, role: roles[0].role })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles])

  return (
    <div className="flex gap-5 items-start">
      <div className="bg-white rounded-xl border border-gray-100 w-72 shrink-0 flex flex-col max-h-[calc(100vh-160px)]">
        <div className="p-4 border-b border-gray-100">
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
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {filteredRoles.map((r) => (
            <button
              key={r.name}
              onClick={() => selectRole(r)}
              className={[
                'w-full text-left rounded-lg px-3 py-2.5 border transition-colors',
                selectedRole && selectedRole.name === r.name
                  ? 'border-red-600 bg-red-50'
                  : 'border-transparent hover:bg-gray-50',
              ].join(' ')}
            >
              <div className={['text-sm font-semibold', selectedRole && selectedRole.name === r.name ? 'text-red-600' : 'text-gray-900'].join(' ')}>{r.role}</div>
              <div className="text-xs text-gray-400">{r.subtitle}</div>
            </button>
          ))}
          {!filteredRoles.length && (
            <div className="text-center text-sm text-gray-400 py-8">No roles found</div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-4">
        {selectedRole ? (
          <>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-lg font-bold text-gray-900">{selectedRole.role}</h2>
              <p className="text-sm text-gray-500 mt-1">Configure what {selectedRole.role} can view, create, and manage across the platform.</p>
            </div>

            {loading ? (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">Loading permissions…</div>
            ) : !categories.length ? (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No capabilities found for this role.</div>
            ) : (
              categories.map((cat) => (
                <div key={cat.key} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <button onClick={() => toggleCategory(cat.key)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50">
                    <span className="font-semibold text-gray-900">{cat.label}</span>
                    <ChevronDown className={['w-4 h-4 text-gray-400 transition-transform', (openCategories[cat.key] ?? true) ? 'rotate-180' : ''].join(' ')} />
                  </button>
                  {(openCategories[cat.key] ?? true) && (
                    <div className="border-t border-gray-100 px-5 divide-y divide-gray-50">
                      {cat.groups.map((group) => (
                        <div key={group.recordType}>
                          {cat.groups.length > 1 && (
                            <div className="pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group.recordType}</div>
                          )}
                          {group.capabilities.map((cap) => (
                            <label key={cap.name} className="flex items-start gap-3 py-3 cursor-pointer">
                              <input
                                type="checkbox"
                                className="mt-1 w-4 h-4 rounded border-gray-300 accent-red-600 focus:ring-red-500 cursor-pointer"
                                checked={isEnabled(cap.name)}
                                onChange={(e) => toggleCapability(cap, e)}
                              />
                              <div>
                                <div className="text-sm font-bold text-gray-900">{cap.capability_name}</div>
                                <div className="text-xs text-gray-400 mt-0.5">{cap.description}</div>
                              </div>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}

            <div className="bg-gray-50 rounded-xl border border-gray-200 border-dashed p-5">
              <div className="flex items-center gap-2 mb-1">
                <Bell className="w-4 h-4 text-gray-500" />
                <h3 className="font-semibold text-gray-900">Notifications</h3>
              </div>
              <p className="text-xs text-gray-400 mb-4">Personal preferences for your own account — these don't affect role permissions.</p>
              <div className="divide-y divide-gray-200/70">
                {NOTIFICATION_PREFS.map((pref) => (
                  <div key={pref.key} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{pref.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{pref.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleNotificationPref(pref.key)}
                      className={['w-10 h-5 rounded-full relative transition-colors shrink-0', prefState[pref.key] ? 'bg-red-600' : 'bg-gray-200'].join(' ')}
                    >
                      <span className={['absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform', prefState[pref.key] ? 'translate-x-5' : ''].join(' ')}></span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-sm text-gray-400">Select a role to view its permissions</div>
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
