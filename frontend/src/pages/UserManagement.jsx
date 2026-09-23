import { useState, useMemo, useEffect } from 'react'
import { Search, Plus, Pencil, Trash2, X, UserRound, Users, CheckCircle2, UserX, Ban, ShieldCheck } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import RolesPermissions from '../components/settings/RolesPermissions'
import { getUsers, createUser, updateUser, deleteUser, getRoles, getRegions, createRole, getReferenceLabels } from '../api/frappe'

const tabs = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck },
]

const PAGE_SIZE = 8
const STATUSES = ['Active', 'Inactive', 'Suspended']

const STATUS_COLORS = {
  Active: 'bg-[#29A847]/10 text-[#29A847]',
  Inactive: 'bg-[#F2C94C]/10 text-[#F2C94C]',
  Suspended: 'bg-[#DB2424]/10 text-[#DB2424]',
}
const statusColor = (s) => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'

const emptyForm = () => ({
  email: '',
  first_name: '',
  last_name: '',
  primary_role: '',
  assigned_region: '',
  account_status: 'Active',
  password: '',
})

export default function UserManagement() {
  const [activeTab, setActiveTab] = useState('users')

  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [regions, setRegions] = useState([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [page, setPage] = useState(0)

  const [showUserModal, setShowUserModal] = useState(false)
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [formError, setFormError] = useState('')
  const [roleError, setRoleError] = useState('')
  const [newRole, setNewRole] = useState('')

  const [form, setForm] = useState(emptyForm())
  const [lastCreatedPassword, setLastCreatedPassword] = useState('')
  const [regionMap, setRegionMap] = useState({})

  function updateForm(fields) {
    setForm((prev) => ({ ...prev, ...fields }))
  }

  useEffect(() => {
    getReferenceLabels().then((labels) => setRegionMap(labels.regions))
  }, [])

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

  const lastPage = Math.max(0, Math.ceil(filteredUsers.length / PAGE_SIZE) - 1)
  const pagedUsers = filteredUsers.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
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
    setEditingUser(null)
    setFormError('')
    setForm(emptyForm())
    setShowUserModal(true)
  }

  function openEditUser(u) {
    setEditingUser(u)
    setFormError('')
    setForm({
      email: u.name,
      first_name: u.first_name,
      last_name: u.last_name || '',
      primary_role: u.primary_role || '',
      assigned_region: u.assigned_region || '',
      account_status: u.account_status || 'Active',
      password: '',
    })
    setShowUserModal(true)
  }

  function closeUserModal() {
    setShowUserModal(false)
  }

  async function saveUser() {
    setFormError('')
    if (!editingUser && !form.password) {
      setFormError('Set a temporary password before adding this user.')
      return
    }
    try {
      if (editingUser) {
        await updateUser(editingUser.name, form)
      } else {
        await createUser(form)
        setLastCreatedPassword(form.password)
      }
      setShowUserModal(false)
      await loadUsers()
    } catch (e) {
      setFormError(e.message || 'Something went wrong saving the user.')
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
    } catch (e) {
      setRoleError(e.message || 'Could not create that role.')
    }
  }

  async function loadUsers() {
    setUsers(await getUsers({ limit: 500 }))
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
          <h2 className="text-xl font-bold text-gray-900">User Management</h2>
          <p className="text-sm text-gray-400">Control users, roles, permissions, and platform access</p>
        </div>
        {activeTab === 'users' && (
          <div className="flex gap-3">
            <button onClick={openRoleModal} className="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-500 flex items-center gap-2 hover:bg-gray-50">
              <Plus className="w-4 h-4" /> Add Role
            </button>
            <button onClick={openAddUser} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add User
            </button>
          </div>
        )}
      </div>

      <div className="flex w-full gap-1 bg-white border border-gray-100 rounded-2xl p-1.5 mb-6">
        {tabs.map((tab) => (
          <div key={tab.key} className="flex flex-1 justify-center">
            <button
              onClick={() => setActiveTab(tab.key)}
              className={['flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                activeTab === tab.key ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50'].join(' ')}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          </div>
        ))}
      </div>

      {activeTab === 'roles' ? (
        <RolesPermissions roles={roles} users={users} />
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
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Region</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Last Login</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map((u) => (
                  <tr key={u.name} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <UserRound className="w-5 h-5 text-gray-400 shrink-0" />
                        <div>
                          <div className="text-gray-900">{u.full_name || `${u.first_name} ${u.last_name || ''}`.trim()}</div>
                          <div className="text-xs text-gray-400">{u.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3"><span className="border border-gray-200 bg-gray-50 rounded-full px-2.5 py-1 text-xs font-medium text-gray-900">{u.primary_role || '—'}</span></td>
                    <td className="px-5 py-3 text-gray-700">
                      <span>{regionInfo(u.assigned_region).label}</span>
                      {regionInfo(u.assigned_region).unresolved && (
                        <span className="ml-1.5 text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full align-middle">unresolved</span>
                      )}
                    </td>
                    <td className="px-5 py-3"><span className={['text-xs font-medium px-3 py-1 rounded-full', statusColor(u.account_status)].join(' ')}>{u.account_status || 'Active'}</span></td>
                    <td className="px-5 py-3 text-gray-500">{formatDate(u.last_login)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openEditUser(u)} className="text-gray-500 hover:text-gray-800"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => removeUser(u)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!pagedUsers.length && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-400">No users found</td>
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
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.min(lastPage, page + 1))} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Next</button>
                <button onClick={() => setPage(lastPage)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Last</button>
              </div>
            </div>
          </div>

          {showUserModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) closeUserModal() }}>
              <div className="bg-white rounded-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900">{editingUser ? 'Edit User' : 'Add User'}</h3>
                  <button onClick={closeUserModal} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>

                <label className="block text-sm font-semibold mb-1">Email</label>
                <input value={form.email} onChange={(e) => updateForm({ email: e.target.value })} disabled={!!editingUser} type="email" className="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm disabled:text-gray-400" placeholder="name@krcs.org" />

                {!editingUser && (
                  <>
                    <label className="block text-sm font-semibold mb-1">Temporary Password</label>
                    <div className="flex gap-2 mb-4">
                      <input value={form.password} onChange={(e) => updateForm({ password: e.target.value })} type="text" className="flex-1 bg-gray-50 rounded-lg px-4 py-2.5 text-sm" placeholder="Set a temporary password" />
                      <button type="button" onClick={generatePassword} className="border border-gray-200 rounded-lg px-4 text-sm font-medium text-gray-600 hover:bg-gray-50">Generate</button>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold mb-1">First Name</label>
                    <input value={form.first_name} onChange={(e) => updateForm({ first_name: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm" placeholder="First name" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">Last Name</label>
                    <input value={form.last_name} onChange={(e) => updateForm({ last_name: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm" placeholder="Last name" />
                  </div>
                </div>

                <label className="block text-sm font-semibold mb-1">Role</label>
                <select value={form.primary_role} onChange={(e) => updateForm({ primary_role: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm">
                  <option value="">Select a role</option>
                  {roles.map((r) => <option key={r.name} value={r.name}>{r.role_name || r.name}</option>)}
                </select>

                <label className="block text-sm font-semibold mb-1">Region</label>
                <select value={form.assigned_region} onChange={(e) => updateForm({ assigned_region: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm">
                  <option value="">Select a region</option>
                  {regions.map((r) => <option key={r.name} value={r.name}>{r.region_name}</option>)}
                </select>

                <label className="block text-sm font-semibold mb-1">Status</label>
                <select value={form.account_status} onChange={(e) => updateForm({ account_status: e.target.value })} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-6 text-sm">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>

                {formError && <p className="text-red-600 text-sm mb-4">{formError}</p>}

                <div className="flex justify-end gap-3">
                  <button onClick={closeUserModal} className="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold">Cancel</button>
                  <button onClick={saveUser} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">{editingUser ? 'Save Changes' : 'Add User'}</button>
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

          {showRoleModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowRoleModal(false) }}>
              <div className="bg-white rounded-xl w-full max-w-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900">Add Role</h3>
                  <button onClick={() => setShowRoleModal(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>

                <label className="block text-sm font-semibold mb-1">Role Name</label>
                <input value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-2 text-sm" placeholder="e.g. Field Supervisor" />

                {roleError && <p className="text-red-600 text-sm mb-4">{roleError}</p>}

                <div className="flex justify-end gap-3">
                  <button onClick={() => setShowRoleModal(false)} className="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold">Cancel</button>
                  <button onClick={addRole} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">Add Role</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  )
}
