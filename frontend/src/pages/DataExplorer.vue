<template>
  <AppShell>
    <div class="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div>
        <h2 class="text-xl font-bold text-gray-900">Data Explorer</h2>
        <p class="text-sm text-gray-400">Search database by keywords, visualize trends, and set AI notification alerts</p>
      </div>
      <div class="flex gap-3">
        <button @click="handleExportCsv" class="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50">
          <Download class="w-4 h-4" /> Export CSV
        </button>
        <button @click="handleExportJson" class="border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 flex items-center gap-2 hover:bg-gray-50">
          <Download class="w-4 h-4" /> Export JSON
        </button>
      </div>
    </div>

    <div class="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6 mb-6">
      <div class="relative">
        <Search class="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          v-model="search"
          type="text"
          placeholder="Search"
          class="w-full bg-gray-50 border border-gray-100 rounded-lg pl-12 pr-28 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100"
          @keyup.enter="page = 0"
        >
        <button
          @click="page = 0"
          class="absolute right-2 top-1/2 -translate-y-1/2 bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold"
        >
          Search
        </button>
      </div>
      <div class="flex items-center gap-3 flex-wrap mt-4">
        <span class="text-sm font-medium text-gray-500">Quick search:</span>
        <button
          v-for="tag in quickSearchTags"
          :key="tag"
          @click="applyQuickSearch(tag)"
          :class="['text-sm font-medium px-3 py-1 rounded-md transition-colors',
                    search === tag ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-500 hover:bg-gray-300']"
        >
          {{ tag }}
        </button>
      </div>
    </div>

    <div class="flex justify-center mb-6">
      <div class="bg-gray-100 rounded-full p-1 inline-flex gap-1 flex-wrap justify-center">
        <button
          v-for="v in views"
          :key="v.key"
          @click="view = v.key"
          :class="['flex items-center gap-2 px-6 py-2 rounded-full text-sm font-medium transition-colors',
                    view === v.key ? 'bg-red-600 text-white' : 'bg-white text-gray-900']"
        >
          <component :is="v.icon" class="w-4 h-4" /> {{ v.label }}
        </button>
      </div>
    </div>

    <div class="bg-white rounded-2xl border border-gray-100 p-5 sm:p-6">
      <h3 class="text-base font-medium text-gray-900 mb-4">Query Results</h3>

      <div v-if="view === 'table'">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-gray-500 text-xs font-medium border-b border-gray-100">
                <th class="py-3 pr-4 font-medium">Data ID</th>
                <th class="py-3 pr-4 font-medium">Title</th>
                <th class="py-3 pr-4 font-medium">Disease</th>
                <th class="py-3 pr-4 font-medium">Region</th>
                <th class="py-3 pr-4 font-medium">Severity</th>
                <th class="py-3 pr-4 font-medium">Status</th>
                <th class="py-3 pr-4 font-medium">Risk Score</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in pagedRecords" :key="r.name" class="border-b border-gray-50 hover:bg-gray-50">
                <td class="py-4 pr-4 text-gray-900 font-medium whitespace-nowrap">{{ r.name }}</td>
                <td class="py-4 pr-4 text-gray-900 whitespace-nowrap">{{ r.title }}</td>
                <td class="py-4 pr-4 text-gray-500 whitespace-nowrap">{{ r.disease }}</td>
                <td class="py-4 pr-4 text-gray-500 whitespace-nowrap">{{ r.region }}</td>
                <td class="py-4 pr-4">
                  <span :class="['inline-block text-xs font-medium px-3 py-1 rounded-full border', severityColor(r.severity)]">{{ r.severity }}</span>
                </td>
                <td class="py-4 pr-4">
                  <span class="inline-block text-xs font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-400">{{ r.status }}</span>
                </td>
                <td class="py-4 pr-4 text-gray-900 font-medium whitespace-nowrap">{{ r.riskScore }}%</td>
              </tr>
              <tr v-if="!pagedRecords.length">
                <td colspan="7" class="py-12 text-center text-gray-400">No records match your search</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between pt-5 mt-2 border-t border-gray-100 flex-wrap gap-3">
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

      <div v-else class="relative w-full h-72 sm:h-96">
        <Bar v-if="view === 'bar' && chartData" :data="chartData" :options="chartOptions" />
        <Line v-else-if="view === 'line' && chartData" :data="chartData" :options="chartOptions" />
        <Pie v-else-if="view === 'pie' && chartData" :data="chartData" :options="pieOptions" />
        <div v-if="!filteredRecords.length" class="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">No records match your search</div>
      </div>
    </div>
  </AppShell>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Bar, Line, Pie } from 'vue-chartjs'
import { Search, Download, Table, BarChart3, LineChart, PieChart } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import { CHART_FONT } from '@/charts/chartSetup'
import { getDataExplorerRecords, exportCsv } from '@/api/frappe'

const PAGE_SIZE = 6

const SEVERITY_COLORS = {
  critical: 'border-red-200 text-red-600',
  high: 'border-orange-200 text-orange-600',
  medium: 'border-yellow-200 text-yellow-600',
  low: 'border-emerald-200 text-emerald-600',
}
const severityColor = (s) => SEVERITY_COLORS[s] || 'border-gray-200 text-gray-600'

const CHART_COLORS = ['#DC2626', '#F2C94C', '#2F80ED', '#27AE60', '#8B5CF6', '#EC4899', '#F97316', '#0EA5E9']

const views = [
  { key: 'table', label: 'Table', icon: Table },
  { key: 'bar', label: 'Bar', icon: BarChart3 },
  { key: 'line', label: 'Line', icon: LineChart },
  { key: 'pie', label: 'Pie', icon: PieChart },
]
const quickSearchTags = ['AWD', 'Malaria', 'Measles', 'Respiratory', 'Fever']

const records = ref([])
const search = ref('')
const view = ref('table')
const page = ref(0)

onMounted(async () => {
  records.value = await getDataExplorerRecords({ limit: 500 })
})

function applyQuickSearch(tag) {
  search.value = search.value === tag ? '' : tag
  page.value = 0
}

const filteredRecords = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return records.value
  return records.value.filter((r) => {
    const haystack = `${r.name} ${r.title} ${r.disease} ${r.region} ${r.severity} ${r.status}`.toLowerCase()
    return haystack.includes(q)
  })
})

const lastPage = computed(() => Math.max(0, Math.ceil(filteredRecords.value.length / PAGE_SIZE) - 1))
const pagedRecords = computed(() => filteredRecords.value.slice(page.value * PAGE_SIZE, page.value * PAGE_SIZE + PAGE_SIZE))
const paginationLabel = computed(() => {
  if (!filteredRecords.value.length) return 'Showing 0 of 0'
  const start = page.value * PAGE_SIZE + 1
  const end = Math.min(start + PAGE_SIZE - 1, filteredRecords.value.length)
  return `Showing ${start} to ${end} of ${filteredRecords.value.length}`
})

const diseaseCounts = computed(() => {
  const counts = {}
  for (const r of filteredRecords.value) counts[r.disease] = (counts[r.disease] || 0) + 1
  return counts
})

const chartData = computed(() => {
  const labels = Object.keys(diseaseCounts.value)
  if (!labels.length) return null
  const data = Object.values(diseaseCounts.value)
  const colors = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
  if (view.value === 'pie') {
    return { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#fff', borderWidth: 2 }] }
  }
  if (view.value === 'line') {
    return { labels, datasets: [{ label: 'Records', data, borderColor: '#DC2626', backgroundColor: '#DC2626', tension: 0.35, pointRadius: 4, borderWidth: 2 }] }
  }
  return { labels, datasets: [{ label: 'Records', data, backgroundColor: '#DC2626', borderRadius: 4 }] }
})

const GRID_COLOR = '#F0F0F0'
const TICK_COLOR = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { titleFont: tickFont, bodyFont: tickFont } },
  scales: {
    x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont } },
    y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont }, beginAtZero: true },
  },
}
const pieOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom', labels: { font: tickFont, color: TICK_COLOR } } },
}

function handleExportCsv() {
  exportCsv('data-explorer.csv', filteredRecords.value, [
    { label: 'Data ID', value: (r) => r.name },
    { label: 'Title', value: (r) => r.title },
    { label: 'Disease', value: (r) => r.disease },
    { label: 'Region', value: (r) => r.region },
    { label: 'Severity', value: (r) => r.severity },
    { label: 'Status', value: (r) => r.status },
    { label: 'Risk Score', value: (r) => r.riskScore },
  ])
}

function handleExportJson() {
  const blob = new Blob([JSON.stringify(filteredRecords.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'data-explorer.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
</script>
