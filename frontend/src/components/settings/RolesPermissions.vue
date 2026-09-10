<template>
  <div class="flex gap-5 items-start">
    <div class="bg-white rounded-xl border border-gray-100 w-72 shrink-0 flex flex-col max-h-[calc(100vh-160px)]">
      <div class="p-4 border-b border-gray-100">
        <h3 class="font-bold text-gray-900 mb-3">Roles</h3>
        <div class="relative">
          <Search class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input v-model="search" type="text" placeholder="Search roles" class="w-full bg-gray-50 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none">
        </div>
      </div>
      <div class="flex-1 overflow-y-auto p-2 space-y-1.5">
        <button
          v-for="r in filteredRoles"
          :key="r.name"
          @click="selectRole(r)"
          :class="[
            'w-full text-left rounded-lg px-3 py-2.5 border transition-colors',
            selectedRole && selectedRole.name === r.name
              ? 'border-red-600 bg-red-50'
              : 'border-transparent hover:bg-gray-50',
          ]"
        >
          <div :class="['text-sm font-semibold', selectedRole && selectedRole.name === r.name ? 'text-red-600' : 'text-gray-900']">{{ r.role }}</div>
          <div class="text-xs text-gray-400">{{ r.subtitle }}</div>
        </button>
        <div v-if="!filteredRoles.length" class="text-center text-sm text-gray-400 py-8">No roles found</div>
      </div>
    </div>

    <div class="flex-1 min-w-0 space-y-4">
      <template v-if="selectedRole">
        <div class="bg-white rounded-xl border border-gray-100 p-5">
          <h2 class="text-lg font-bold text-gray-900">{{ selectedRole.role }}</h2>
          <p class="text-sm text-gray-500 mt-1">Configure what {{ selectedRole.role }} can view, create, and manage across the platform.</p>
        </div>

        <div v-if="loading" class="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">Loading permissions…</div>

        <div v-else-if="!categories.length" class="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No capabilities found for this role.</div>

        <div v-else v-for="cat in categories" :key="cat.key" class="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <button @click="toggleCategory(cat.key)" class="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50">
            <span class="font-semibold text-gray-900">{{ cat.label }}</span>
            <ChevronDown :class="['w-4 h-4 text-gray-400 transition-transform', (openCategories[cat.key] ?? true) ? 'rotate-180' : '']" />
          </button>
          <div v-show="openCategories[cat.key] ?? true" class="border-t border-gray-100 px-5 divide-y divide-gray-50">
            <template v-for="group in cat.groups" :key="group.recordType">
              <div v-if="cat.groups.length > 1" class="pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{{ group.recordType }}</div>
              <label v-for="cap in group.capabilities" :key="cap.name" class="flex items-start gap-3 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  class="mt-1 w-4 h-4 rounded border-gray-300 accent-red-600 focus:ring-red-500 cursor-pointer"
                  :checked="isEnabled(cap.name)"
                  @change="toggleCapability(cap, $event)"
                >
                <div>
                  <div class="text-sm font-bold text-gray-900">{{ cap.capability_name }}</div>
                  <div class="text-xs text-gray-400 mt-0.5">{{ cap.description }}</div>
                </div>
              </label>
            </template>
          </div>
        </div>

        <div class="bg-gray-50 rounded-xl border border-gray-200 border-dashed p-5">
          <div class="flex items-center gap-2 mb-1">
            <Bell class="w-4 h-4 text-gray-500" />
            <h3 class="font-semibold text-gray-900">Notifications</h3>
          </div>
          <p class="text-xs text-gray-400 mb-4">Personal preferences for your own account — these don't affect role permissions.</p>
          <div class="divide-y divide-gray-200/70">
            <div v-for="pref in notificationPrefs" :key="pref.key" class="flex items-center justify-between py-3">
              <div>
                <div class="text-sm font-semibold text-gray-900">{{ pref.name }}</div>
                <div class="text-xs text-gray-400 mt-0.5">{{ pref.description }}</div>
              </div>
              <button
                type="button"
                @click="toggleNotificationPref(pref.key)"
                :class="['w-10 h-5 rounded-full relative transition-colors shrink-0', prefState[pref.key] ? 'bg-red-600' : 'bg-gray-200']"
              >
                <span :class="['absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform', prefState[pref.key] ? 'translate-x-5' : '']"></span>
              </button>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="bg-white rounded-xl border border-gray-100 p-10 text-center text-sm text-gray-400">Select a role to view its permissions</div>
    </div>

    <transition name="fade">
      <div v-if="toast.show" class="fixed bottom-6 right-6 bg-gray-900 text-white text-sm rounded-lg px-4 py-2.5 flex items-center gap-2 shadow-lg z-50">
        <Check v-if="!toast.error" class="w-4 h-4 text-green-400" />
        <span>{{ toast.message }}</span>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { Search, ChevronDown, Bell, Check } from 'lucide-vue-next'
import { getRoleCapabilities, setRoleCapability } from '@/api/frappe'

const props = defineProps({
  roles: { type: Array, default: () => [] },
  users: { type: Array, default: () => [] },
})

const search = ref('')
const selectedRole = ref(null)
const loading = ref(false)
const rawCapabilities = ref([])
const capState = ref({})
const openCategories = reactive({})

const categories = computed(() => {
  const byCategory = new Map()
  for (const cap of rawCapabilities.value) {
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
})

const NOTIFICATION_PREFS = [
  { key: 'email_new_alert', name: 'Email me on new alerts', description: 'Get an email whenever a new alert is created in your region.' },
  { key: 'weekly_summary', name: 'Weekly summary email', description: 'Receive a weekly digest of surveillance activity.' },
  { key: 'sms_critical', name: 'SMS for critical cases', description: 'Get a text message when a case is marked critical.' },
]
const notificationPrefs = NOTIFICATION_PREFS
const PREFS_STORAGE_KEY = 'krcs_notification_prefs'
const prefState = reactive(loadPrefs())

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || '{}')
    return Object.fromEntries(NOTIFICATION_PREFS.map((p) => [p.key, !!saved[p.key]]))
  } catch (e) {
    return Object.fromEntries(NOTIFICATION_PREFS.map((p) => [p.key, false]))
  }
}

function toggleNotificationPref(key) {
  prefState[key] = !prefState[key]
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefState))
  showToast('Preference saved')
}

const roleUserCounts = computed(() => {
  const counts = {}
  props.users.forEach((u) => {
    if (u.primary_role) counts[u.primary_role] = (counts[u.primary_role] || 0) + 1
  })
  return counts
})

const roleCards = computed(() =>
  props.roles.map((r) => {
    const count = roleUserCounts.value[r.role] || 0
    return { name: r.name, role: r.role, subtitle: count === 1 ? '1 user assigned' : `${count} users assigned` }
  })
)

const filteredRoles = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return roleCards.value
  return roleCards.value.filter((r) => r.role.toLowerCase().includes(q))
})

const toast = reactive({ show: false, message: '', error: false })
let toastTimer = null
function showToast(message, error = false) {
  toast.message = message
  toast.error = error
  toast.show = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.show = false }, 2000)
}

function toggleCategory(key) {
  openCategories[key] = !(openCategories[key] ?? true)
}

function selectRole(r) {
  selectedRole.value = r
}

function isEnabled(name) {
  return !!capState.value[name]
}

async function loadCapabilities(role) {
  loading.value = true
  try {
    const list = await getRoleCapabilities(role)
    rawCapabilities.value = list || []
    const state = {}
    for (const cap of rawCapabilities.value) state[cap.name] = !!cap.enabled
    capState.value = state
  } catch (err) {
    rawCapabilities.value = []
    showToast(err.message || 'Failed to load capabilities', true)
  } finally {
    loading.value = false
  }
}

async function toggleCapability(cap, event) {
  const enabled = event.target.checked
  try {
    await setRoleCapability(selectedRole.value.role, cap.name, enabled ? 1 : 0)
    capState.value[cap.name] = enabled
    showToast('Capability updated')
  } catch (err) {
    event.target.checked = !enabled
    showToast(err.message || 'Failed to update capability', true)
  }
}

watch(selectedRole, (r) => {
  if (r) loadCapabilities(r.role)
})

watch(
  () => props.roles,
  (roles) => {
    if (!selectedRole.value && roles.length) {
      selectRole({ name: roles[0].name, role: roles[0].role })
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
