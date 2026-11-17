import { useState, useMemo, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { rolePermissionsLink } from '../utils/links'
import { Search, Plus, Pencil, Trash2, X, UserRound, UserPlus, AlertCircle, Loader2, Users, CheckCircle2, UserX, Ban, ShieldCheck, Building2, ArrowLeft } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { PageSizeSelect } from '../components/common/Pager'
import RolesPermissions from '../components/settings/RolesPermissions'
import HealthUnits from '../components/settings/HealthUnits'
import { getUsers, createUser, updateUser, deleteUser, getRoles, getRegions, createRole, getReferenceLabels, getUserRoles, getSubCounties, getReferralFacilities, getHealthUnits, getUserHealthUnits, saveHealthUnit } from '../api/frappe'
import { useCapabilities } from '../context/CapabilitiesContext'

const tabs = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck },
]

const STATUSES = ['Active', 'Inactive', 'Suspended']

const STATUS_COLORS = {
  Active: 'bg-[#29A847]/10 text-[#29A847]',
  Inactive: 'bg-[#F2C94C]/10 text-[#F2C94C]',
  Suspended: 'bg-brand-red/10 text-red-700',
}
const statusColor = (s) => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'

const STATUS_SELECTED = {
  Active: 'bg-green-50 border-green-500 text-green-700',
  Inactive: 'bg-amber-50 border-amber-500 text-amber-700',
  Suspended: 'bg-red-50 border-red-500 text-red-700',
}

const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5'
const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500'
const req = <span className="text-red-700 ml-0.5">*</span>

// Community Health Units (KRCS 17 Nov 2026): a CHP belongs to one CHU, a CHA heads one or more
const CHP_ROLES = ['CHP', 'Community Health Promoter']
const CHA_ROLES = ['CHA', 'Community Health Assistant']
const unitKind = (role) => (CHA_ROLES.includes(role) ? 'cha' : CHP_ROLES.includes(role) ? 'chp' : null)

const emptyForm = () => ({
  email: '',
  first_name: '',
  last_name: '',
  mobile_no: '',
  primary_role: '',
  assigned_region: '',
  assigned_sub_county: '',
  assigned_facility: '',
  health_units: [],
  account_status: 'Active',
  password: '',
})

export default function UserManagement() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = ['roles', 'units'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'users'
  const roleParam = searchParams.get('role') || ''
  const [roleNotice, setRoleNotice] = useState('')

  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [regions, setRegions] = useState([])
  const [subCounties, setSubCounties] = useState([])
  const [subCountyMap, setSubCountyMap] = useState({})
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [page, setPage] = useState(0)

  const [showUserModal, setShowUserModal] = useState(false)
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [roleError, setRoleError] = useState('')
  const [newRole, setNewRole] = useState('')

  const [form, setForm] = useState(emptyForm())
  const [lastCreatedPassword, setLastCreatedPassword] = useState('')
  const [regionMap, setRegionMap] = useState({})
  const [userRolesMap, setUserRolesMap] = useState({})
  const [userUnits, setUserUnits] = useState({})   // {user: [{id, name}]}
  const [unitsBySub, setUnitsBySub] = useState({})   // CHUs per sub-county, loaded when a sub-county is chosen on the form
  const { has } = useCapabilities()
  const [newUnit, setNewUnit] = useState(null)   // name typed in "+ New unit" on the user form
  const [newUnitError, setNewUnitError] = useState('')
  const [savingUnit, setSavingUnit] = useState(false)
  const kind = unitKind(form.primary_role)

  function updateForm(fields) {
    setForm((prev) => ({ ...prev, ...fields }))
  }

  useEffect(() => {
    getSubCounties('').then((list) => {
      setSubCountyMap(Object.fromEntries(list.map((s) => [s.name, s.sub_county_name])))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!form.assigned_region) { setSubCounties([]); return }
    let cancelled = false
    getSubCounties(form.assigned_region).then((list) => { if (!cancelled) setSubCounties(list) }).catch(() => { if (!cancelled) setSubCounties([]) })
    return () => { cancelled = true }
  }, [form.assigned_region])

  useEffect(() => {
    getReferenceLabels().then((labels) => setRegionMap(labels.regions))
  }, [])

  const unitSub = showUserModal && kind ? form.assigned_sub_county : ''
  const unitOptions = unitsBySub[unitSub] || []
  useEffect(() => {
    if (!unitSub) return
    let cancelled = false
    getHealthUnits({ subCounty: unitSub }).then((list) => { if (!cancelled) setUnitsBySub((m) => ({ ...m, [unitSub]: list })) }).catch(() => {})
    return () => { cancelled = true }
  }, [unitSub])

  function regionInfo(id) {
    if (!id) return { label: '—', unresolved: false }
    const label = regionMap[id]
    if (label) return { label, unresolved: false }
    return { label: id, unresolved: true }
  }

  const statCards = useMemo(() => [
    { label: 'Total Users', value: users.length, icon: Users },
    { label: 'Active', value: users.filter((u) => (u.account_status || 'Active') === 'Active').length, icon: CheckCircle2 },
    { label: 'Inactive', value: users.filter((u) => u.account_status === 'Inactive').length, icon: UserX },
    { label: 'Suspended', value: users.filter((u) => u.account_status === 'Suspended').length, icon: Ban },
  ], [users])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      const name = (u.full_name || `${u.first_name} ${u.last_name || ''}`).toLowerCase()
      if (q && !name.includes(q) && !u.name.toLowerCase().includes(q)) return false
      if (roleFilter && u.primary_role !== roleFilter) return false
      if (statusFilter && (u.account_status || 'Active') !== statusFilter) return false
      if (regionFilter && u.assigned_region !== regionFilter) return false
      return true
    })
  }, [users, search, roleFilter, statusFilter, regionFilter])

  const [PAGE_SIZE, setPageSize] = useState(10)
  const lastPage = Math.max(0, Math.ceil(filteredUsers.length / PAGE_SIZE) - 1)
  const pagedUsers = filteredUsers.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  useEffect(() => {
    let cancelled = false
    Promise.all(
      pagedUsers.map((u) =>
        getUserRoles(u.name).then((r) => [u.name, r]).catch(() => [u.name, null])
      )
    ).then((entries) => {
      if (!cancelled) setUserRolesMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }))
    })
    return () => { cancelled = true }
  }, [users, page, search, roleFilter, statusFilter, regionFilter])

  const paginationLabel = (() => {
    if (!filteredUsers.length) return 'Showing 0 of 0'
    const start = page * PAGE_SIZE + 1
    const end = Math.min(start + PAGE_SIZE - 1, filteredUsers.length)
    return `Showing ${start} to ${end} of ${filteredUsers.length}`
  })()

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    const password = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    updateForm({ password })
  }

  function formatDate(v) {
    if (!v) return '—'
    return new Date(v).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })
  }

  function openAddUser() {
    setNewUnit(null)
    setEditingUser(null)
    setFormError('')
    setForm(emptyForm())
    setShowUserModal(true)
  }

  function openEditUser(u) {
    setNewUnit(null)
    setEditingUser(u)
    setFormError('')
    setForm({
      email: u.name,
      first_name: u.first_name,
      last_name: u.last_name || '',
      mobile_no: u.mobile_no || '',
      primary_role: u.primary_role || '',
      assigned_region: u.assigned_region || '',
      assigned_sub_county: u.assigned_sub_county || '',
      assigned_facility: u.assigned_facility || '',
      health_units: (userUnits[u.name] || []).map((x) => x.id),
      account_status: u.account_status || 'Active',
      password: '',
    })
    setShowUserModal(true)
  }

  function closeUserModal() {
    setShowUserModal(false)
  }

  useEffect(() => {
    if (!showUserModal) return
    const onKey = (e) => { if (e.key === 'Escape') setShowUserModal(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showUserModal])

  async function saveUser() {
    setFormError('')
    if (!editingUser && !form.password) {
      setFormError('Set a temporary password before adding this user.')
      return
    }
    if (!form.assigned_region || !form.assigned_sub_county) {   // every user has a region and sub-county (KRCS, 16 Nov 2026)
      setFormError('Choose the region and sub-county for this user.')
      return
    }
    if (kind && !form.health_units.length) {
      setFormError(`Choose the Community Health Unit for this ${kind === 'chp' ? 'CHP' : 'CHA'}.`)
      return
    }
    const phone = (form.mobile_no || '').replace(/\s+/g, '')
    if (phone && !/^\+?\d{9,15}$/.test(phone)) {
      setFormError('Enter a valid phone number, e.g. +254712345678')
      return
    }
    setSaving(true)
    try {
      const data = { ...form, health_units: kind ? form.health_units : [] }   // only CHPs and CHAs have a CHU
      if (editingUser) {
        await updateUser(editingUser.name, data)
      } else {
        await createUser(data)
        setLastCreatedPassword(form.password)
      }
      setShowUserModal(false)
      await loadUsers()
    } catch (e) {
      setFormError(e.message || 'Something went wrong saving the user.')
    } finally {
      setSaving(false)
    }
  }

  // "+ New unit" on the user form: add a CHU in the chosen sub-county and select it, without leaving the form
  async function addUnitFromForm() {
    const name = (newUnit || '').trim()
    if (!name) { setNewUnitError('Type the unit name.'); return }
    setSavingUnit(true)
    setNewUnitError('')
    try {
      const saved = await saveHealthUnit({ name, subCounty: form.assigned_sub_county, active: true })
      const list = await getHealthUnits({ subCounty: form.assigned_sub_county })
      setUnitsBySub((m) => ({ ...m, [form.assigned_sub_county]: list }))
      updateForm({ health_units: kind === 'chp' ? [saved.id] : [...form.health_units, saved.id] })
      setNewUnit(null)
    } catch (e) {
      setNewUnitError(e.message || 'Could not add the unit.')
    } finally {
      setSavingUnit(false)
    }
  }

  async function removeUser(u) {
    if (!confirm(`Remove ${u.full_name || u.name}?`)) return
    await deleteUser(u.name)
    await loadUsers()
  }

  function openRoleModal() {
    setNewRole('')
    setRoleError('')
    setShowRoleModal(true)
  }

  async function addRole() {
    setRoleError('')
    const role = newRole.trim()
    if (!role) return
    if (roles.some((r) => r.name.toLowerCase() === role.toLowerCase())) {
      setRoleError('That role already exists.')
      return
    }
    try {
      await createRole(role)
      setShowRoleModal(false)
      await loadRoles()
      setSearchParams({ tab: 'roles', role })
      setRoleNotice('Role created. Choose what it can do.')
      setTimeout(() => setRoleNotice(''), 4000)
    } catch (e) {
      setRoleError(e.message || 'Could not create that role.')
    }
  }

  async function loadUsers() {
    setUsers(await getUsers({ limit: 500 }))
    setUserUnits(await getUserHealthUnits().catch(() => ({})))
  }

  async function loadRoles() {
    setRoles((await getRoles()).filter((r) => !r.disabled))
  }

  async function loadRegions() {
    const labels = await getReferenceLabels()
    setRegions(Object.entries(labels.regions).map(([name, region_name]) => ({ name, region_name })))
  }

  useEffect(() => {
    loadUsers()
    loadRoles()
    loadRegions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-brand-navy">{activeTab === 'roles' ? 'Roles & Permissions' : activeTab === 'units' ? 'Community Health Units' : 'Users'}</h2>
          <p className="text-sm text-gray-400">{activeTab === 'roles' ? 'What each role can see and do' : activeTab === 'units' ? 'Each CHP belongs to a Community Health Unit; each CHA heads one or more' : 'Add and manage the people who use the system'}</p>
        </div>
        <div className="flex gap-3">
          {activeTab === 'roles' && <button onClick={openRoleModal} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-500 flex items-center gap-2 hover:bg-gray-50">
            <Plus className="w-4 h-4" /> Add Role
          </button>}
          {activeTab === 'units' && (
            <button onClick={() => setSearchParams({ tab: 'users' })} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 flex items-center gap-2 hover:bg-gray-50">
              <ArrowLeft className="w-4 h-4" /> Back to Users
            </button>
          )}
          {activeTab === 'users' && (
            <button onClick={() => setSearchParams({ tab: 'units' })} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 flex items-center gap-2 hover:bg-gray-50">
              <Building2 className="w-4 h-4" /> Community Health Units
            </button>
          )}
          {activeTab === 'users' && (
            <button onClick={openAddUser} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add User
            </button>
          )}
        </div>
      </div>

      {roleNotice && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">{roleNotice}</div>
      )}

      {activeTab === 'units' ? (
        <HealthUnits />
      ) : activeTab === 'roles' ? (
        <RolesPermissions
          roles={roles}
          users={users}
          initialRole={roleParam}
          onRoleChange={(role) => setSearchParams({ tab: 'roles', role }, { replace: true })}
        />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
            {statCards.map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-400">{c.label}</div>
                  <div className="text-2xl font-bold text-gray-900">{c.value}</div>
                </div>
                <div className="bg-gray-100 rounded-full p-2"><c.icon className="w-4 h-4 text-gray-500" /></div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl p-4 flex gap-3 mb-4 border border-gray-100">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} type="text" placeholder="Search" className="w-full bg-gray-50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none" />
            </div>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 text-sm text-gray-600 bg-gray-50">
              <option value="">All Roles</option>
              {roles.map((r) => <option key={r.name} value={r.role}>{r.role}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 text-sm text-gray-600 bg-gray-50">
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 text-sm text-gray-600 bg-gray-50">
              <option value="">All Regions</option>
              {regions.map((r) => <option key={r.name} value={r.name}>{r.region_name}</option>)}
            </select>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 text-xs bg-gray-50 border-b border-gray-100">
                  <th className="w-10 px-5 py-3 font-medium">#</th>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Region</th>
                  <th className="px-5 py-3 font-medium">Sub-county</th>
                  <th className="px-5 py-3 font-medium">Health unit</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Last Login</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map((u, i) => (
                  <tr key={u.name} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3 tabular-nums text-gray-900">{page * PAGE_SIZE + i + 1}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <UserRound className="w-5 h-5 text-gray-400 shrink-0" />
                        <div>
                          <div className="text-gray-900">{u.full_name || `${u.first_name} ${u.last_name || ''}`.trim()}</div>
                          <div className="text-xs text-gray-400">{u.name}</div>
                          {u.mobile_no && <div className="text-xs text-gray-400">{u.mobile_no}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">{u.primary_role ? (
                      <Link to={rolePermissionsLink(u.primary_role)} title="View permissions for this role" className="border border-gray-200 bg-gray-50 rounded-full px-2.5 py-1 text-xs font-medium text-gray-900 hover:border-red-300 hover:text-red-700">{u.primary_role}</Link>
                    ) : (
                      <span className="border border-gray-200 bg-gray-50 rounded-full px-2.5 py-1 text-xs font-medium text-gray-900">—</span>
                    )}
                     
                      {userRolesMap[u.name] && u.primary_role && !userRolesMap[u.name].includes(u.primary_role) && (
                        <div className="text-[10px] font-medium text-amber-600">Mismatch: primary role not in Frappe roles</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      <span>{regionInfo(u.assigned_region).label}</span>
                      {regionInfo(u.assigned_region).unresolved && (
                        <span className="ml-1.5 text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full align-middle">unresolved</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-700">{u.assigned_sub_county ? (subCountyMap[u.assigned_sub_county] || u.assigned_sub_county) : '—'}</td>
                    <td className="px-5 py-3 text-gray-700">{(userUnits[u.name] || []).map((x) => x.name).join(', ') || (unitKind(u.primary_role) ? <span className="text-amber-700">Not set</span> : '—')}</td>
                    <td className="px-5 py-3"><span className={['text-xs font-medium px-3 py-1 rounded-full', statusColor(u.account_status)].join(' ')}>{u.account_status || 'Active'}</span></td>
                    <td className="px-5 py-3 text-gray-500">{formatDate(u.last_login)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openEditUser(u)} className="text-gray-500 hover:text-gray-800"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => removeUser(u)} className="text-red-700 hover:text-red-800"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!pagedUsers.length && (
                  <tr>
                    <td colSpan={9} className="px-5 py-10 text-center text-gray-400">No users found</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
              <div className="flex gap-2">
                <button onClick={() => setPage(0)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">First</button>
                <button onClick={() => setPage(Math.max(0, page - 1))} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Previous</button>
              </div>
              <span className="text-xs text-gray-500">{paginationLabel}</span>
              <PageSizeSelect value={PAGE_SIZE} onChange={(n) => { setPageSize(n); setPage(0) }} />
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.min(lastPage, page + 1))} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Next</button>
                <button onClick={() => setPage(lastPage)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Last</button>
              </div>
            </div>
          </div>

          {showUserModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) closeUserModal() }}>
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 shrink-0">
                  <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                    {editingUser ? <Pencil className="w-5 h-5 text-red-700" /> : <UserPlus className="w-5 h-5 text-red-700" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-900">{editingUser ? 'Edit user' : 'Add user'}</h3>
                    <p className="text-sm text-gray-500 truncate">{editingUser ? editingUser.name : 'Create an account and assign their role and area'}</p>
                  </div>
                  <button onClick={closeUserModal} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                  <section>
                    <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase mb-3">Account details</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>First name{req}</label>
                        <input value={form.first_name} onChange={(e) => updateForm({ first_name: e.target.value })} className={inputCls} placeholder="First name" />
                      </div>
                      <div>
                        <label className={labelCls}>Last name</label>
                        <input value={form.last_name} onChange={(e) => updateForm({ last_name: e.target.value })} className={inputCls} placeholder="Last name" />
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelCls}>Email{req}</label>
                        <input value={form.email} onChange={(e) => updateForm({ email: e.target.value })} disabled={!!editingUser} type="email" className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-400`} placeholder="name@krcs.org" />
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelCls}>Phone number</label>
                        <input value={form.mobile_no} onChange={(e) => updateForm({ mobile_no: e.target.value })} type="tel" className={inputCls} placeholder="+2547XXXXXXXX" />
                        <p className="text-xs text-gray-500 mt-1.5">Used for SMS alerts. Include the country code.</p>
                      </div>
                      {!editingUser && (
                        <div className="md:col-span-2">
                          <label className={labelCls}>Temporary password{req}</label>
                          <div className="flex gap-2">
                            <input value={form.password} onChange={(e) => updateForm({ password: e.target.value })} type="text" className={`${inputCls} flex-1`} placeholder="Set a temporary password" />
                            <button type="button" onClick={generatePassword} className="border border-gray-200 rounded-lg px-4 text-sm font-medium text-gray-600 hover:bg-gray-50">Generate</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase mb-3">Role &amp; access</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>Role{req}</label>
                        <select value={form.primary_role} onChange={(e) => updateForm({ primary_role: e.target.value })} className={inputCls}>
                          <option value="">Select a role</option>
                          {roles.map((r) => <option key={r.name} value={r.name}>{r.role_name || r.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Status</label>
                        <div className="grid grid-cols-3 gap-2">
                          {STATUSES.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => updateForm({ account_status: s })}
                              className={['rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                                form.account_status === s ? STATUS_SELECTED[s] : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'].join(' ')}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold tracking-wide text-gray-500 uppercase mb-3">Area assignment</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>Region <span className="text-red-600">*</span></label>
                        <select value={form.assigned_region} onChange={(e) => updateForm({ assigned_region: e.target.value, assigned_sub_county: '' })} className={inputCls}>
                          <option value="">Select a region</option>
                          {regions.map((r) => <option key={r.name} value={r.name}>{r.region_name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Sub-county <span className="text-red-600">*</span></label>
                        <select value={form.assigned_sub_county} onChange={(e) => updateForm({ assigned_sub_county: e.target.value, health_units: [] })} disabled={!form.assigned_region} className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-400`}>
                          <option value="">{form.assigned_region ? 'Select a sub-county' : 'Select a region first'}</option>
                          {subCounties.map((s) => <option key={s.name} value={s.name}>{s.sub_county_name} · {s.county}</option>)}
                        </select>
                        <p className="text-xs text-gray-500 mt-1.5">CHA / SCDSC: receives alerts for new signals in this sub-county.</p>
                      </div>
                      {kind && (
                        <div className="md:col-span-2">
                          <div className="flex items-center justify-between gap-3">
                            <label className={labelCls}>{kind === 'chp' ? 'Community Health Unit' : 'Community Health Unit(s) this CHA heads'} <span className="text-red-600">*</span></label>
                            {form.assigned_sub_county && has('manage_users') && newUnit === null && (
                              <button type="button" onClick={() => { setNewUnit(''); setNewUnitError('') }} className="mb-1.5 inline-flex items-center gap-1 text-sm font-medium text-red-700 hover:underline">
                                <Plus className="w-3.5 h-3.5" /> New unit
                              </button>
                            )}
                          </div>
                          {newUnit !== null && (
                            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                              <p className="text-xs text-gray-500 mb-2">New Community Health Unit in {subCounties.find((s) => s.name === form.assigned_sub_county)?.sub_county_name || 'this sub-county'}</p>
                              <div className="flex gap-2">
                                <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUnitFromForm() } }}
                                  autoFocus placeholder="Unit name, e.g. Ifo Block A" aria-label="New unit name" className={`${inputCls} flex-1`} />
                                <button type="button" onClick={addUnitFromForm} disabled={savingUnit} className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-4 text-sm font-semibold">
                                  {savingUnit ? 'Adding…' : 'Add'}
                                </button>
                                <button type="button" onClick={() => setNewUnit(null)} className="border border-gray-200 bg-white rounded-lg px-4 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                              </div>
                              {newUnitError && <p className="mt-2 text-sm text-red-700">{newUnitError}</p>}
                            </div>
                          )}
                          {!form.assigned_sub_county ? (
                            <p className="text-sm text-gray-400">Select a sub-county first</p>
                          ) : !unitOptions.length ? (
                            newUnit === null && <p className="text-sm text-amber-700">No Community Health Units in this sub-county yet. Use + New unit to add one.</p>
                          ) : kind === 'chp' ? (
                            <select value={form.health_units[0] || ''} onChange={(e) => updateForm({ health_units: e.target.value ? [e.target.value] : [] })} className={inputCls}>
                              <option value="">Select a Community Health Unit</option>
                              {unitOptions.filter((o) => o.active || form.health_units.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {unitOptions.filter((o) => o.active || form.health_units.includes(o.id)).map((o) => {
                                const on = form.health_units.includes(o.id)
                                return (
                                  <button key={o.id} type="button" aria-pressed={on}
                                    onClick={() => updateForm({ health_units: on ? form.health_units.filter((x) => x !== o.id) : [...form.health_units, o.id] })}
                                    className={['rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                                      on ? 'bg-red-50 border-red-500 text-red-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'].join(' ')}>
                                    {on ? '✓ ' : ''}{o.name}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                          <p className="text-xs text-gray-500 mt-1.5">{kind === 'chp'
                            ? "The CHU this CHP belongs to. Their CHU's CHA sees the signals they send."
                            : 'Choose every CHU this CHA is in charge of. They see the signals from these CHUs, plus CBS and WhatsApp community reports in the sub-county.'}</p>
                        </div>
                      )}
                      {form.primary_role === 'Facility Health Worker' && (
                        <div>
                          <label className={labelCls}>Facility</label>
                          <FacilitySelect value={form.assigned_facility} onChange={(v) => updateForm({ assigned_facility: v })} className={inputCls} />
                          <p className="text-xs text-gray-500 mt-1.5">Referrals CHPs make to this facility show on this person's Referrals page. Add facilities under MOH 505 Facility Reports → Facilities.</p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                {formError && (
                  <div className="mx-6 mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 shrink-0">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100 shrink-0">
                  <button onClick={closeUserModal} className="border border-gray-200 bg-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
                  <button onClick={saveUser} disabled={saving} className="bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg px-5 py-2.5 text-sm font-semibold flex items-center gap-2">
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {editingUser ? 'Save changes' : 'Add user'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {lastCreatedPassword && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setLastCreatedPassword('') }}>
              <div className="bg-white rounded-xl w-full max-w-sm p-6">
                <h3 className="font-bold text-gray-900 mb-2">User created</h3>
                <p className="text-sm text-gray-500 mb-3">Share this password with them directly — it won't be shown again.</p>
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm font-mono text-center mb-4">{lastCreatedPassword}</div>
                <button onClick={() => setLastCreatedPassword('')} className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 text-sm font-semibold">Done</button>
              </div>
            </div>
          )}

        </>
      )}

      {showRoleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowRoleModal(false) }}>
          <div className="bg-white rounded-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Add Role</h3>
              <button onClick={() => setShowRoleModal(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>

            <label className="block text-sm font-semibold mb-1">Role Name</label>
            <input value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-2 text-sm" placeholder="e.g. Field Supervisor" />

            {roleError && <p className="text-red-700 text-sm mb-4">{roleError}</p>}

            <div className="flex justify-end gap-3">
              <button onClick={() => setShowRoleModal(false)} className="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold">Cancel</button>
              <button onClick={addRole} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">Add Role</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

// facility list (MOH 505 Reporting Facilities); facilities added on that page appear here straight away
function FacilitySelect({ value, onChange, className }) {
  const [list, setList] = useState(null)
  useEffect(() => { getReferralFacilities().then(setList).catch(() => setList([])) }, [])
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{list === null ? 'Loading…' : 'Select a facility'}</option>
      {(list || []).map((f) => <option key={f.name} value={f.name}>{f.name}{f.subCounty ? ` · ${f.subCounty}` : ''}</option>)}
    </select>
  )
}
