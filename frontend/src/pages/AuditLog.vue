<template>
  <AppShell>
    <div class="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div>
        <h2 class="text-xl font-bold text-gray-900">Audit Log</h2>
        <p class="text-sm text-gray-400">Access activity, User Logs, Alert Created, Data Export and System Backup</p>
      </div>
      <div class="flex gap-3">
        <select v-model="dateRange" class="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 bg-white focus:outline-none">
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
        <button @click="handleExport" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
          <Download class="w-4 h-4" /> Export
        </button>
      </div>
    </div>

    <div class="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap gap-3 mb-6">
      <div class="relative flex-1 min-w-[220px]">
        <Search class="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input v-model="search" type="text" placeholder="Search" class="w-full bg-gray-50 border border-gray-100 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
      </div>
      <select v-model="categoryFilter" class="border border-gray-100 bg-gray-50 rounded-lg px-3.5 py-2.5 text-sm text-gray-700 min-w-[170px]">
        <option value="">All Categories</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="roleFilter" class="border border-gray-100 bg-gray-50 rounded-lg px-3.5 py-2.5 text-sm text-gray-700 min-w-[170px]">
        <option value="">All Roles</option>
        <option v-for="r in roles" :key="r" :value="r">{{ r }}</option>
      </select>
      <select v-model="userFilter" class="border border-gray-100 bg-gray-50 rounded-lg px-3.5 py-2.5 text-sm text-gray-700 min-w-[170px]">
        <option value="">All Users</option>
        <option v-for="u in users" :key="u" :value="u">{{ u }}</option>
      </select>
    </div>

    <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-gray-900 text-xs font-medium bg-gray-50 border-b border-gray-100">
            <th class="px-5 py-3.5 font-medium">Timestamp</th>
            <th class="px-5 py-3.5 font-medium">Category</th>
            <th class="px-5 py-3.5 font-medium">Action</th>
            <th class="px-5 py-3.5 font-medium">User</th>
            <th class="px-5 py-3.5 font-medium">Role</th>
            <th class="px-5 py-3.5 font-medium">Details</th>
            <th class="px-5 py-3.5 font-medium w-10"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in pagedLogs" :key="log.name" class="border-b border-gray-50 hover:bg-gray-50">
            <td class="px-5 py-4 text-gray-500 whitespace-nowrap">{{ formatTimestamp(log.timestamp) }}</td>
            <td class="px-5 py-4">
              <span :class="['inline-block text-xs font-medium px-4 py-1.5 rounded-full', categoryColor(log.category)]">{{ log.category }}</span>
            </td>
            <td class="px-5 py-4 font-medium text-gray-900 whitespace-nowrap">{{ log.action }}</td>
            <td class="px-5 py-4 text-gray-900 whitespace-nowrap">{{ log.user }}</td>
            <td class="px-5 py-4 text-gray-500 whitespace-nowrap">{{ log.role }}</td>
            <td class="px-5 py-4 text-gray-500 max-w-xs">{{ log.details }}</td>
            <td class="px-5 py-4 text-right relative">
              <button @click="toggleMenu(log.name)" class="text-gray-400 hover:text-gray-700">
                <MoreHorizontal class="w-5 h-5" />
              </button>
              <div v-if="openMenu === log.name" v-click-outside="closeMenu" class="absolute right-5 top-10 z-10 bg-white border border-gray-100 rounded-lg shadow-lg py-1 w-40">
                <button @click="viewDetails(log)" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <Eye class="w-3.5 h-3.5" /> View Details
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!pagedLogs.length">
            <td colspan="7" class="px-5 py-12 text-center text-gray-400">No audit log entries match your filters</td>
          </tr>
        </tbody>
      </table>

      <div class="flex items-center justify-between px-5 py-4 border-t border-gray-100 flex-wrap gap-3">
        <div class="flex gap-2">
          <button @click="page = 0" :disabled="page === 0" class="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">First</button>
          <button @click="page = Math.max(0, page - 1)" :disabled="page === 0" class="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Previous</button>
        </div>
        <span class="text-sm text-gray-500">{{ paginationLabel }}</span>
        <div class="flex gap-2">
          <button @click="page = Math.min(lastPage, page + 1)" :disabled="page >= lastPage" class="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Next</button>
          <button @click="page = lastPage" :disabled="page >= lastPage" class="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:bg-gray-50">Last</button>
        </div>
      </div>
    </div>

    <div v-if="detailsLog" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="detailsLog = null">
      <div class="bg-white rounded-xl w-full max-w-md p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-gray-900">Log Details</h3>
          <button @click="detailsLog = null" class="text-gray-400 hover:text-gray-700"><X class="w-5 h-5" /></button>
        </div>
        <dl class="space-y-3 text-sm">
          <div class="flex justify-between gap-4"><dt class="text-gray-400">Entry ID</dt><dd class="text-gray-900 font-medium">{{ detailsLog.name }}</dd></div>
          <div class="flex justify-between gap-4"><dt class="text-gray-400">Timestamp</dt><dd class="text-gray-900 font-medium">{{ formatTimestamp(detailsLog.timestamp) }}</dd></div>
          <div class="flex justify-between gap-4"><dt class="text-gray-400">Category</dt><dd><span :class="['text-xs font-medium px-3 py-1 rounded-full', categoryColor(detailsLog.category)]">{{ detailsLog.category }}</span></dd></div>
          <div class="flex justify-between gap-4"><dt class="text-gray-400">Action</dt><dd class="text-gray-900 font-medium">{{ detailsLog.action }}</dd></div>
          <div class="flex justify-between gap-4"><dt class="text-gray-400">User</dt><dd class="text-gray-900 font-medium">{{ detailsLog.user }}</dd></div>
          <div class="flex justify-between gap-4"><dt class="text-gray-400">Role</dt><dd class="text-gray-900 font-medium">{{ detailsLog.role }}</dd></div>
          <div><dt class="text-gray-400 mb-1">Details</dt><dd class="text-gray-700">{{ detailsLog.details }}</dd></div>
        </dl>
      </div>
    </div>
  </AppShell>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Search, Download, MoreHorizontal, Eye, X } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import { getAuditLogs, exportCsv } from '@/api/frappe'

const PAGE_SIZE = 7

const CATEGORY_COLORS = {
  Auth: 'bg-[#DB2424]/10 text-[#DB2424]',
  Alert: 'bg-[#F2C94C]/10 text-[#F2C94C]',
  Report: 'bg-[#27AE60]/10 text-[#27AE60]',
  Case: 'bg-[#1447E6]/10 text-[#1447E6]',
  Config: 'bg-gray-100 text-gray-500',
  User: 'bg-gray-50 text-gray-900',
  AI: 'bg-[#DB2424]/10 text-[#DB2424]',
}
const categoryColor = (c) => CATEGORY_COLORS[c] || 'bg-gray-100 text-gray-600'

const logs = ref([])
const search = ref('')
const categoryFilter = ref('')
const roleFilter = ref('')
const userFilter = ref('')
const dateRange = ref('all')
const page = ref(0)
const openMenu = ref(null)
const detailsLog = ref(null)

const categories = computed(() => [...new Set(logs.value.map((l) => l.category))].sort())
const roles = computed(() => [...new Set(logs.value.map((l) => l.role))].sort())
const users = computed(() => [...new Set(logs.value.map((l) => l.user))].sort())

const DATE_RANGE_MS = { today: 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 }

const filteredLogs = computed(() => {
  const q = search.value.trim().toLowerCase()
  const cutoff = DATE_RANGE_MS[dateRange.value] ? Date.now() - DATE_RANGE_MS[dateRange.value] : null

  return logs.value.filter((l) => {
    if (q) {
      const haystack = `${l.action} ${l.user} ${l.role} ${l.details} ${l.category}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (categoryFilter.value && l.category !== categoryFilter.value) return false
    if (roleFilter.value && l.role !== roleFilter.value) return false
    if (userFilter.value && l.user !== userFilter.value) return false
    if (cutoff && new Date(l.timestamp).getTime() < cutoff) return false
    return true
  })
})

const lastPage = computed(() => Math.max(0, Math.ceil(filteredLogs.value.length / PAGE_SIZE) - 1))
const pagedLogs = computed(() => filteredLogs.value.slice(page.value * PAGE_SIZE, page.value * PAGE_SIZE + PAGE_SIZE))
const paginationLabel = computed(() => {
  if (!filteredLogs.value.length) return 'Showing 0 of 0'
  const start = page.value * PAGE_SIZE + 1
  const end = Math.min(start + PAGE_SIZE - 1, filteredLogs.value.length)
  return `Showing ${start} to ${end} of ${filteredLogs.value.length}`
})

function formatTimestamp(v) {
  return new Date(v).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'medium' })
}

function toggleMenu(name) {
  openMenu.value = openMenu.value === name ? null : name
}
function closeMenu() {
  openMenu.value = null
}
function viewDetails(log) {
  detailsLog.value = log
  openMenu.value = null
}

function handleExport() {
  exportCsv('audit-log.csv', filteredLogs.value, [
    { label: 'Timestamp', value: (r) => formatTimestamp(r.timestamp) },
    { label: 'Category', value: (r) => r.category },
    { label: 'Action', value: (r) => r.action },
    { label: 'User', value: (r) => r.user },
    { label: 'Role', value: (r) => r.role },
    { label: 'Details', value: (r) => r.details },
  ])
}

const vClickOutside = {
  mounted(el, binding) {
    el._clickOutside = (e) => {
      if (!el.contains(e.target)) binding.value(e)
    }
    document.addEventListener('click', el._clickOutside, true)
  },
  unmounted(el) {
    document.removeEventListener('click', el._clickOutside, true)
  },
}

async function loadLogs() {
  logs.value = await getAuditLogs({ limit: 500 })
}

onMounted(loadLogs)
</script>
