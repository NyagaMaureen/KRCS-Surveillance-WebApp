<template>
  <AppShell>
    <div class="flex items-start justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-gray-900">User Management</h2>
        <p class="text-sm text-gray-400">Control users, roles, permissions, and platform access</p>
      </div>
      <div v-if="activeTab === 'users'" class="flex gap-3">
        <button @click="openRoleModal" class="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-500 flex items-center gap-2 hover:bg-gray-50">
          <Plus class="w-4 h-4" /> Add Role
        </button>
        <button @click="openAddUser" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
          <Plus class="w-4 h-4" /> Add User
        </button>
      </div>
    </div>

    <div class="flex w-full gap-1 bg-white border border-gray-100 rounded-2xl p-1.5 mb-6">
      <div v-for="tab in tabs" :key="tab.key" class="flex flex-1 justify-center">
        <button
          @click="activeTab = tab.key"
          :class="[
            'flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
            activeTab === tab.key ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50',
          ]"
        >
          <component :is="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
        </button>
      </div>
    </div>

    <RolesPermissions v-if="activeTab === 'roles'" :roles="roles" :users="users" />

    <template v-else>
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div v-for="c in statCards" :key="c.label" class="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
          <div>
            <div class="text-xs text-gray-400">{{ c.label }}</div>
            <div class="text-2xl font-bold text-gray-900">{{ c.value }}</div>
          </div>
          <div class="bg-gray-100 rounded-full p-2"><component :is="c.icon" class="w-4 h-4 text-gray-500" /></div>
        </div>
      </div>

      <div class="bg-white rounded-xl p-4 flex gap-3 mb-4 border border-gray-100">
        <div class="relative flex-1">
          <Search class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input v-model="search" type="text" placeholder="Search" class="w-full bg-gray-50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none">
        </div>
        <select v-model="roleFilter" class="border border-gray-200 rounded-lg px-3 text-sm text-gray-600 bg-gray-50">
          <option value="">All Roles</option>
          <option v-for="r in roles" :key="r.name" :value="r.role">{{ r.role }}</option>
        </select>
        <select v-model="statusFilter" class="border border-gray-200 rounded-lg px-3 text-sm text-gray-600 bg-gray-50">
          <option value="">All Status</option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select v-model="regionFilter" class="border border-gray-200 rounded-lg px-3 text-sm text-gray-600 bg-gray-50">
          <option value="">All Regions</option>
          <option v-for="r in regions" :key="r.name" :value="r.name">{{ r.region_name }}</option>
        </select>
      </div>

      <div class="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-400 text-xs bg-gray-50 border-b border-gray-100">
              <th class="px-5 py-3 font-medium">User</th>
              <th class="px-5 py-3 font-medium">Role</th>
              <th class="px-5 py-3 font-medium">Region</th>
              <th class="px-5 py-3 font-medium">Status</th>
              <th class="px-5 py-3 font-medium">Last Login</th>
              <th class="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in pagedUsers" :key="u.name" class="border-b border-gray-50 hover:bg-gray-50">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2.5">
                  <UserRound class="w-5 h-5 text-gray-400 shrink-0" />
                  <div>
                    <div class="text-gray-900">{{ u.full_name || `${u.first_name} ${u.last_name || ''}`.trim() }}</div>
                    <div class="text-xs text-gray-400">{{ u.name }}</div>
                  </div>
                </div>
              </td>
              <td class="px-5 py-3"><span class="border border-gray-200 bg-gray-50 rounded-full px-2.5 py-1 text-xs font-medium text-gray-900">{{ u.primary_role || '—' }}</span></td>
              <td class="px-5 py-3 text-gray-700">
                <span>{{ regionInfo(u.assigned_region).label }}</span>
                <span
                  v-if="regionInfo(u.assigned_region).unresolved"
                  class="ml-1.5 text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full align-middle"
                >unresolved</span>
              </td>
              <td class="px-5 py-3"><span :class="['text-xs font-medium px-3 py-1 rounded-full', statusColor(u.account_status)]">{{ u.account_status || 'Active' }}</span></td>
              <td class="px-5 py-3 text-gray-500">{{ formatDate(u.last_login) }}</td>
              <td class="px-5 py-3">
                <div class="flex items-center gap-3">
                  <button @click="openEditUser(u)" class="text-gray-500 hover:text-gray-800"><Pencil class="w-4 h-4" /></button>
                  <button @click="removeUser(u)" class="text-red-500 hover:text-red-700"><Trash2 class="w-4 h-4" /></button>
                </div>
              </td>
            </tr>
            <tr v-if="!pagedUsers.length">
              <td colspan="6" class="px-5 py-10 text-center text-gray-400">No users found</td>
            </tr>
          </tbody>
        </table>

        <div class="flex items-center justify-between px-5 py-4 border-t border-gray-100">
          <div class="flex gap-2">
            <button @click="page = 0" class="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">First</button>
            <button @click="page = Math.max(0, page - 1)" class="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Previous</button>
          </div>
          <span class="text-xs text-gray-500">{{ paginationLabel }}</span>
          <div class="flex gap-2">
            <button @click="page = Math.min(lastPage, page + 1)" class="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Next</button>
            <button @click="page = lastPage" class="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Last</button>
          </div>
        </div>
      </div>

      <div v-if="showUserModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="closeUserModal">
        <div class="bg-white rounded-xl w-full max-w-md p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-gray-900">{{ editingUser ? 'Edit User' : 'Add User' }}</h3>
            <button @click="closeUserModal" class="text-gray-400 hover:text-gray-700"><X class="w-5 h-5" /></button>
          </div>

          <label class="block text-sm font-semibold mb-1">Email</label>
          <input v-model="form.email" :disabled="!!editingUser" type="email" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm disabled:text-gray-400" placeholder="name@krcs.org">

          <template v-if="!editingUser">
            <label class="block text-sm font-semibold mb-1">Temporary Password</label>
            <div class="flex gap-2 mb-4">
              <input v-model="form.password" type="text" class="flex-1 bg-gray-50 rounded-lg px-4 py-2.5 text-sm" placeholder="Set a temporary password">
              <button type="button" @click="generatePassword" class="border border-gray-200 rounded-lg px-4 text-sm font-medium text-gray-600 hover:bg-gray-50">Generate</button>
            </div>
          </template>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-semibold mb-1">First Name</label>
              <input v-model="form.first_name" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm" placeholder="First name">
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Last Name</label>
              <input v-model="form.last_name" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm" placeholder="Last name">
            </div>
          </div>

          <label class="block text-sm font-semibold mb-1">Role</label>
          <select v-model="form.primary_role" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm">
            <option value="">Select a role</option>
            <option v-for="r in roles" :key="r.name" :value="r.name">{{ r.role_name || r.name }}</option>
          </select>

          <label class="block text-sm font-semibold mb-1">Region</label>
          <select v-model="form.assigned_region" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-4 text-sm">
            <option value="">Select a region</option>
            <option v-for="r in regions" :key="r.name" :value="r.name">{{ r.region_name }}</option>
          </select>

          <label class="block text-sm font-semibold mb-1">Status</label>
          <select v-model="form.account_status" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-6 text-sm">
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>

          <p v-if="formError" class="text-red-600 text-sm mb-4">{{ formError }}</p>

          <div class="flex justify-end gap-3">
            <button @click="closeUserModal" class="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold">Cancel</button>
            <button @click="saveUser" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">{{ editingUser ? 'Save Changes' : 'Add User' }}</button>
          </div>
        </div>
      </div>

      <div v-if="lastCreatedPassword" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="lastCreatedPassword = ''">
        <div class="bg-white rounded-xl w-full max-w-sm p-6">
          <h3 class="font-bold text-gray-900 mb-2">User created</h3>
          <p class="text-sm text-gray-500 mb-3">Share this password with them directly — it won't be shown again.</p>
          <div class="bg-gray-50 rounded-lg px-4 py-3 text-sm font-mono text-center mb-4">{{ lastCreatedPassword }}</div>
          <button @click="lastCreatedPassword = ''" class="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 text-sm font-semibold">Done</button>
        </div>
      </div>

      <div v-if="showRoleModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="showRoleModal = false">
        <div class="bg-white rounded-xl w-full max-w-sm p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-gray-900">Add Role</h3>
            <button @click="showRoleModal = false" class="text-gray-400 hover:text-gray-700"><X class="w-5 h-5" /></button>
          </div>

          <label class="block text-sm font-semibold mb-1">Role Name</label>
          <input v-model="newRole" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-2 text-sm" placeholder="e.g. Field Supervisor">

          <p v-if="roleError" class="text-red-600 text-sm mb-4">{{ roleError }}</p>

          <div class="flex justify-end gap-3">
            <button @click="showRoleModal = false" class="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold">Cancel</button>
            <button @click="addRole" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">Add Role</button>
          </div>
        </div>
      </div>
    </template>
  </AppShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Search, Plus, Pencil, Trash2, X, UserRound, Users, CheckCircle2, UserX, Ban, ShieldCheck } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import RolesPermissions from '@/components/settings/RolesPermissions.vue'
import { getUsers, createUser, updateUser, deleteUser, getRoles, getRegions, createRole, getReferenceLabels } from '@/api/frappe'


const tabs = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'roles', label: 'Roles & Permissions', icon: ShieldCheck },
]

const activeTab = ref('users')

const PAGE_SIZE = 8
const STATUSES = ['Active', 'Inactive', 'Suspended']

const STATUS_COLORS = {
  Active: 'bg-[#29A847]/10 text-[#29A847]',
  Inactive: 'bg-[#F2C94C]/10 text-[#F2C94C]',
  Suspended: 'bg-[#DB2424]/10 text-[#DB2424]',
}

const statusColor = (s) => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'

const users = ref([])
const roles = ref([])
const regions = ref([])
const search = ref('')
const roleFilter = ref('')
const statusFilter = ref('')
const regionFilter = ref('')
const page = ref(0)

const showUserModal = ref(false)
const showRoleModal = ref(false)
const editingUser = ref(null)
const formError = ref('')
const roleError = ref('')
const newRole = ref('')

const emptyForm = () => ({
  email: '',
  first_name: '',
  last_name: '',
  primary_role: '',
  assigned_region: '',
  account_status: 'Active',
  password: ''
})

const form = reactive(emptyForm())
const lastCreatedPassword = ref('')

const regionMap = ref({})
onMounted(async () => {
  const labels = await getReferenceLabels()
  regionMap.value = labels.regions
})


function regionInfo(id) {
  if (!id) return { label: '—', unresolved: false }
  const label = regionMap.value[id]
  if (label) return { label, unresolved: false }
  return { label: id, unresolved: true }
}
const statCards = computed(() => [
  { label: 'Total Users', value: users.value.length, icon: Users },
  { label: 'Active', value: users.value.filter((u) => (u.account_status || 'Active') === 'Active').length, icon: CheckCircle2 },
  { label: 'Inactive', value: users.value.filter((u) => u.account_status === 'Inactive').length, icon: UserX },
  { label: 'Suspended', value: users.value.filter((u) => u.account_status === 'Suspended').length, icon: Ban },
])

const filteredUsers = computed(() => {
  const q = search.value.trim().toLowerCase()

  return users.value.filter((u) => {
    const name = (u.full_name || `${u.first_name} ${u.last_name || ''}`).toLowerCase()

    if (q && !name.includes(q) && !u.name.toLowerCase().includes(q)) return false
    if (roleFilter.value && u.primary_role !== roleFilter.value) return false
    if (statusFilter.value && (u.account_status || 'Active') !== statusFilter.value) return false
    if (regionFilter.value && u.assigned_region !== regionFilter.value) return false

    return true
  })
})

const lastPage = computed(() => Math.max(0, Math.ceil(filteredUsers.value.length / PAGE_SIZE) - 1))

const pagedUsers = computed(() =>
  filteredUsers.value.slice(page.value * PAGE_SIZE, page.value * PAGE_SIZE + PAGE_SIZE)
)

const paginationLabel = computed(() => {
  if (!filteredUsers.value.length) return 'Showing 0 of 0'

  const start = page.value * PAGE_SIZE + 1
  const end = Math.min(start + PAGE_SIZE - 1, filteredUsers.value.length)

  return `Showing ${start} to ${end} of ${filteredUsers.value.length}`
})

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  form.password = Array.from(
    { length: 10 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}

function formatDate(v) {
  if (!v) return '—'

  return new Date(v).toLocaleString('en-US', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
}

function openAddUser() {
  editingUser.value = null
  formError.value = ''
  Object.assign(form, emptyForm())
  showUserModal.value = true
}

function openEditUser(u) {
  editingUser.value = u
  formError.value = ''

  Object.assign(form, {
    email: u.name,
    first_name: u.first_name,
    last_name: u.last_name || '',
    primary_role: u.primary_role || '',
    assigned_region: u.assigned_region || '',
    account_status: u.account_status || 'Active',
  })

  showUserModal.value = true
}

function closeUserModal() {
  showUserModal.value = false
}

async function saveUser() {
  formError.value = ''

  if (!editingUser.value && !form.password) {
    formError.value = 'Set a temporary password before adding this user.'
    return
  }

  try {
    if (editingUser.value) {
      await updateUser(editingUser.value.name, form)
    } else {
      await createUser(form)
      lastCreatedPassword.value = form.password
    }

    showUserModal.value = false
    await loadUsers()
  } catch (e) {
    formError.value = e.message || 'Something went wrong saving the user.'
  }
}

async function removeUser(u) {
  if (!confirm(`Remove ${u.full_name || u.name}?`)) return

  await deleteUser(u.name)
  await loadUsers()
}

function openRoleModal() {
  newRole.value = ''
  roleError.value = ''
  showRoleModal.value = true
}

async function addRole() {
  roleError.value = ''

  const role = newRole.value.trim()

  if (!role) return

  if (roles.value.some((r) => r.name.toLowerCase() === role.toLowerCase())) {
    roleError.value = 'That role already exists.'
    return
  }

  try {
    await createRole(role)
    showRoleModal.value = false
    await loadRoles()
  } catch (e) {
    roleError.value = e.message || 'Could not create that role.'
  }
}

async function loadUsers() {
  users.value = await getUsers({ limit: 500 })
}

async function loadRoles() {
  roles.value = (await getRoles()).filter((r) => !r.disabled)
}

async function loadRegions() {
  const labels = await getReferenceLabels()
  regions.value = Object.entries(labels.regions).map(([name, region_name]) => ({ name, region_name }))
}

onMounted(() => {
  loadUsers()
  loadRoles()
  loadRegions()
})
</script>
