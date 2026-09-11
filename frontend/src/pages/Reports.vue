<template>
  <AppShell>
    <div class="flex items-start justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-gray-900">Reports Management</h2>
        <p class="text-sm text-gray-400">Generate, import, export, and manage surveillance reports</p>
      </div>
      <div class="flex gap-3">
        <button @click="handleExport" class="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50">
          <Upload class="w-4 h-4" /> Export Report
        </button>
        <router-link to="/record-health-signal" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2">
          <Plus class="w-4 h-4" /> Create Report
        </router-link>
      </div>
    </div>

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
        <input type="text" placeholder="Search" class="w-full bg-gray-50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none">
      </div>
      <select class="border border-gray-200 rounded-lg px-3 text-sm text-gray-600"><option>All Status</option></select>
      <select class="border border-gray-200 rounded-lg px-3 text-sm text-gray-600"><option>All Locations</option></select>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div class="px-5 py-4 font-semibold text-gray-900 text-sm">Reports List</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-400 text-xs border-t border-b border-gray-100">
              <th class="px-5 py-3 font-medium">Report ID</th>
              <th class="px-5 py-3 font-medium">Reporter</th>
              <th class="px-5 py-3 font-medium">Symptoms</th>
              <th class="px-5 py-3 font-medium">Location</th>
              <th class="px-5 py-3 font-medium">Channel</th>
              <th class="px-5 py-3 font-medium">Status</th>
              <th class="px-5 py-3 font-medium">Date</th>
              <th class="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in reports" :key="r.name" class="border-b border-gray-50 hover:bg-gray-50">
              <td class="px-5 py-3 font-medium text-gray-900">{{ r.name }}</td>
              <td class="px-5 py-3 text-gray-700">{{ r.reporter_name }}</td>
              <td class="px-5 py-3">
                <span v-for="s in symptomTags(r.symptom_tags)" :key="s" class="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full mr-1">{{ s }}</span>
              </td>
              <td class="px-5 py-3 text-gray-700">{{ r.location_name }}</td>
              <td class="px-5 py-3"><span :class="['text-xs font-medium px-2 py-1 rounded-full', channelColor(r.channel)]">{{ (r.channel || '').toUpperCase() }}</span></td>
              <td class="px-5 py-3"><span :class="['text-xs font-medium px-2 py-1 rounded-full', statusColor(r.status)]">{{ r.status }}</span></td>
              <td class="px-5 py-3 text-gray-500 whitespace-nowrap">{{ formatDateTime(r.creation) }}</td>
              <td class="px-5 py-3">
                <div class="flex items-center justify-end">
                  <button
                    @click="openView(r)"
                    title="View report"
                    class="inline-flex items-center gap-1.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-blue-100 hover:border-blue-200 transition-colors"
                  >
                    <Eye class="w-3.5 h-3.5" /> View
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!reports.length">
              <td colspan="8" class="px-5 py-10 text-center text-gray-400">No reports found</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-t border-gray-100">
        <button @click="goToPage(0)" class="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">First</button>
        <button @click="goToPage(page - 1)" class="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Previous</button>
        <span class="text-xs text-gray-500">{{ paginationLabel }}</span>
        <button @click="goToPage(page + 1)" class="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Next</button>
        <button @click="goToPage(lastPage)" class="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">Last</button>
      </div>
    </div>

  </AppShell>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { FileText, Clock, CheckCircle, Link as LinkIcon, Search, Upload, Plus, Eye } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import { getList, getCount, exportExcel } from '@/api/frappe'
import { formatDateTime } from '@/data/formOptions.js'

const router = useRouter()
const PAGE_SIZE = 6
const page = ref(0)
const totalCount = ref(0)
const reports = ref([])
const counts = ref({ total: 0, submitted: 0, reviewed: 0, linked: 0 })

const statCards = computed(() => [
  { label: 'Total Reports', value: counts.value.total, icon: FileText },
  { label: 'Pending Approval', value: counts.value.submitted, icon: Clock },
  { label: 'Reviewed', value: counts.value.reviewed, icon: CheckCircle },
  { label: 'Linked', value: counts.value.linked, icon: LinkIcon },
])

const lastPage = computed(() => Math.max(0, Math.floor((totalCount.value - 1) / PAGE_SIZE)))
const paginationLabel = computed(() => {
  const start = page.value * PAGE_SIZE + 1
  const end = Math.min(start + PAGE_SIZE - 1, totalCount.value)
  return `Showing ${start} to ${end} of ${totalCount.value}`
})

const STATUS_COLORS = { Submitted: 'bg-amber-50 text-amber-600', Reviewed: 'bg-green-50 text-green-600', Linked: 'bg-red-50 text-red-600', Investigating: 'bg-blue-50 text-blue-600', Closed: 'bg-gray-100 text-gray-500' }
const CHANNEL_COLORS = { Mobile: 'bg-red-50 text-red-600', SMS: 'bg-green-50 text-green-600', USSD: 'bg-amber-50 text-amber-600', WhatsApp: 'bg-gray-100 text-gray-600', Web: 'bg-yellow-50 text-yellow-600' }
const statusColor = (s) => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'
const channelColor = (c) => CHANNEL_COLORS[c] || 'bg-gray-100 text-gray-600'
const symptomTags = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3)

function goToPage(n) { page.value = Math.max(0, Math.min(n, lastPage.value)); loadReports() }
function handleExport() { exportExcel('Case Report', ['name', 'reporter_name', 'symptom_tags', 'location_name', 'channel', 'status', 'report_date']) }

function openView(r) {
  router.push(`/reports/${r.name}`)
}

async function openEdit(r) {
  modalError.value = ''
  modalMode.value = 'edit'
  selectedReport.value = r
  showModal.value = true
  modalLoading.value = true
  try {
    const full = await getDoc('Case Report', r.name)
    selectedReport.value = full
    Object.assign(editForm, {
      location_name: full.location_name || '',
      status: full.status || '',
      severity: full.severity || '',
      additional_notes: full.additional_notes || '',
      age_band: full.age_band || '',
      sex: full.sex || '',
      nationality: full.nationality || '',
    })
  } catch (e) {
    modalError.value = e.message || 'Could not load report details.'
  } finally {
    modalLoading.value = false
  }
}

function openDeleteRow(r) {
  modalError.value = ''
  modalMode.value = 'delete'
  selectedReport.value = r
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  selectedReport.value = null
}

async function saveEdit() {
  modalError.value = ''
  try {
    await updateDoc('Case Report', selectedReport.value.name, editForm)
    closeModal()
    await loadReports()
  } catch (e) {
    modalError.value = e.message || 'Something went wrong saving the report.'
  }
}

async function confirmDelete() {
  modalError.value = ''
  try {
    await deleteDoc('Case Report', selectedReport.value.name)
    closeModal()
    await loadCounts()
    await loadReports()
  } catch (e) {
    modalError.value = e.message || 'Something went wrong deleting the report.'
  }
}

async function loadCounts() {
  const [total, submitted, reviewed, linked] = await Promise.all([
    getCount('Case Report'), getCount('Case Report', { status: 'Submitted' }),
    getCount('Case Report', { status: 'Reviewed' }), getCount('Case Report', { status: 'Linked' }),
  ])
  counts.value = { total, submitted, reviewed, linked }
  totalCount.value = total
}

async function loadReports() {
  reports.value = await getList(
    'Case Report',
    ['name', 'reporter_name', 'symptom_tags', 'location_name', 'channel', 'status', 'report_date', 'creation'],
    { limit: PAGE_SIZE, start: page.value * PAGE_SIZE, orderBy: 'creation desc' }
  )
}

onMounted(() => { loadCounts(); loadReports() })
</script>
