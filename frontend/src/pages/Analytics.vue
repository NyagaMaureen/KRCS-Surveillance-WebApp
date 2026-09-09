<template>
  <AppShell>
    <div class="flex items-start justify-between mb-6 flex-wrap gap-4">
      <div>
        <h2 class="text-xl font-bold text-gray-900">Analytics Dashboard</h2>
        <p class="text-sm text-gray-400">Epidemiological trends, AI insights, and performance metrics</p>
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

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
      <StatCard
        v-for="s in summary"
        :key="s.key"
        :icon="iconFor(s.icon)"
        :label="s.label"
        :value="s.value"
        :change-pct="s.changePct"
        :trend="s.trend"
        :sentiment="s.sentiment"
      />
    </div>

    <div class="grid grid-cols-1 gap-5">
      <ChartCard title="Disease Trends (6-Week View)" height="h-72 sm:h-96">
        <template #legend>
          <div class="flex items-center gap-4 flex-wrap justify-end">
            <span v-for="s in diseaseTrends.series" :key="s.name" class="inline-flex items-center gap-1.5 text-xs font-medium" :style="{ color: s.color }">
              <span class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: s.color }" />{{ s.name }}
            </span>
          </div>
        </template>
        <Line v-if="diseaseTrendsData" :data="diseaseTrendsData" :options="lineOptions" />
      </ChartCard>

      <ChartCard title="Reporting Channels Distribution" height="h-72 sm:h-80">
        <template #legend>
          <div class="flex items-center gap-4 flex-wrap justify-end">
            <span v-for="(label, i) in reportingChannels.labels" :key="label" class="inline-flex items-center gap-1.5 text-xs font-medium" :style="{ color: reportingChannels.colors[i] }">
              <span class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: reportingChannels.colors[i] }" />{{ label }} {{ reportingChannels.data[i] }}%
            </span>
          </div>
        </template>
        <Doughnut v-if="reportingChannelsData" :data="reportingChannelsData" :options="doughnutOptions" />
      </ChartCard>

      <ChartCard title="Facility Response Time (hours)" height="h-72 sm:h-80">
        <Bar v-if="facilityResponseTimeData" :data="facilityResponseTimeData" :options="horizontalBarOptions" />
      </ChartCard>

      <ChartCard title="AI Predictive Forecast" height="h-80 sm:h-96">
        <template #legend>
          <div class="flex items-center gap-4 flex-wrap justify-end">
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500" />Actual
            </span>
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
              <span class="w-2.5 h-2.5 rounded-full bg-red-600" />Predicted
            </span>
          </div>
        </template>
        <Line v-if="aiForecastData" :data="aiForecastData" :options="forecastOptions" />
      </ChartCard>

      <ChartCard title="Month-over-Month Comparison" height="h-72 sm:h-96">
        <template #legend>
          <div class="flex items-center gap-4 flex-wrap justify-end">
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
              <span class="w-2.5 h-2.5 rounded-full bg-red-600" />Current Period
            </span>
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
              <span class="w-2.5 h-2.5 rounded-full bg-gray-400" />Previous Period
            </span>
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-500">
              <span class="w-2.5 h-2.5 rounded-full bg-blue-500" />Target
            </span>
          </div>
        </template>
        <Bar v-if="monthOverMonthData" :data="monthOverMonthData" :options="monthOverMonthOptions" />
      </ChartCard>

      <ChartCard title="Response Time Improvement" height="h-72 sm:h-96">
        <template #legend>
          <div class="flex items-center gap-4 flex-wrap justify-end">
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500" />Avg Response Time (hrs)
            </span>
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
              <span class="w-2.5 h-2.5 rounded-full bg-red-500" />Target (2.5 hrs)
            </span>
          </div>
        </template>
        <Line v-if="responseTimeImprovementData" :data="responseTimeImprovementData" :options="responseTimeOptions" />
      </ChartCard>

      <ChartCard title="Age & Gender Distribution" height="h-72 sm:h-96">
        <template #legend>
          <div class="flex items-center gap-4 flex-wrap justify-end">
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-pink-500">
              <span class="w-2.5 h-2.5 rounded-full bg-pink-500" />Female
            </span>
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-500">
              <span class="w-2.5 h-2.5 rounded-full bg-blue-500" />Male
            </span>
          </div>
        </template>
        <Bar v-if="ageGenderData" :data="ageGenderData" :options="groupedBarOptions" />
      </ChartCard>

      <ChartCard title="Alert Reporting Pattern by Hour" height="h-72 sm:h-96">
        <Bar v-if="alertPatternData" :data="alertPatternData" :options="singleBarOptions" />
      </ChartCard>

      <ChartCard title="Response Effectiveness Score" height="h-80 sm:h-[28rem]">
        <Radar v-if="effectivenessData" :data="effectivenessData" :options="radarOptions" />
      </ChartCard>
    </div>
  </AppShell>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Line, Bar, Doughnut, Radar } from 'vue-chartjs'
import { Clock, Sparkles, AlertTriangle, Map, Download } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import ChartCard from '@/components/analytics/ChartCard.vue'
import StatCard from '@/components/analytics/StatCard.vue'
import { CHART_FONT } from '@/charts/chartSetup'
import {
  getAnalyticsSummary,
  getDiseaseTrends,
  getReportingChannelsDistribution,
  getFacilityResponseTime,
  getAiPredictiveForecast,
  getMonthOverMonthComparison,
  getResponseTimeImprovement,
  getAgeGenderDistribution,
  getAlertReportingPattern,
  getResponseEffectivenessScore,
  exportCsv,
} from '@/api/frappe'

const ICONS = { Clock, Sparkles, AlertTriangle, Map }
const iconFor = (name) => ICONS[name] || Clock

const summary = ref([])
const diseaseTrends = ref({ labels: [], series: [] })
const reportingChannels = ref({ labels: [], colors: [], data: [] })
const facilityResponseTime = ref({ labels: [], data: [] })
const aiForecast = ref(null)
const monthOverMonth = ref(null)
const responseTimeImprovement = ref(null)
const ageGender = ref(null)
const alertPattern = ref(null)
const effectiveness = ref(null)

onMounted(async () => {
  const [
    summaryRes, diseaseTrendsRes, reportingChannelsRes, facilityResponseTimeRes,
    aiForecastRes, monthOverMonthRes, responseTimeImprovementRes, ageGenderRes,
    alertPatternRes, effectivenessRes,
  ] = await Promise.all([
    getAnalyticsSummary(), getDiseaseTrends(), getReportingChannelsDistribution(), getFacilityResponseTime(),
    getAiPredictiveForecast(), getMonthOverMonthComparison(), getResponseTimeImprovement(), getAgeGenderDistribution(),
    getAlertReportingPattern(), getResponseEffectivenessScore(),
  ])
  summary.value = summaryRes
  diseaseTrends.value = diseaseTrendsRes
  reportingChannels.value = reportingChannelsRes
  facilityResponseTime.value = facilityResponseTimeRes
  aiForecast.value = aiForecastRes
  monthOverMonth.value = monthOverMonthRes
  responseTimeImprovement.value = responseTimeImprovementRes
  ageGender.value = ageGenderRes
  alertPattern.value = alertPatternRes
  effectiveness.value = effectivenessRes
})

const GRID_COLOR = '#F0F0F0'
const TICK_COLOR = '#666666'
const tickFont = { family: CHART_FONT.family, size: 12 }

const baseScales = {
  x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont } },
  y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont }, beginAtZero: true },
}

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { titleFont: tickFont, bodyFont: tickFont } },
}

const diseaseTrendsData = computed(() => {
  if (!diseaseTrends.value.labels.length) return null
  return {
    labels: diseaseTrends.value.labels,
    datasets: diseaseTrends.value.series.map((s) => ({
      label: s.name,
      data: s.data,
      borderColor: s.color,
      backgroundColor: s.color,
      tension: 0.35,
      pointRadius: 3,
      pointBackgroundColor: '#fff',
      pointBorderColor: s.color,
      pointBorderWidth: 2,
      borderWidth: 2,
    })),
  }
})
const lineOptions = { ...baseOptions, scales: baseScales }

const reportingChannelsData = computed(() => {
  if (!reportingChannels.value.labels.length) return null
  return {
    labels: reportingChannels.value.labels,
    datasets: [{ data: reportingChannels.value.data, backgroundColor: reportingChannels.value.colors, borderColor: '#fff', borderWidth: 2 }],
  }
})
const doughnutOptions = { ...baseOptions, cutout: '55%' }

const facilityResponseTimeData = computed(() => {
  if (!facilityResponseTime.value.labels.length) return null
  return {
    labels: facilityResponseTime.value.labels,
    datasets: [{ label: 'Avg Response Time (s)', data: facilityResponseTime.value.data, backgroundColor: '#D62728', borderRadius: 4, barThickness: 28 }],
  }
})
const horizontalBarOptions = {
  ...baseOptions,
  indexAxis: 'y',
  scales: {
    x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, font: tickFont }, beginAtZero: true },
    y: { grid: { display: false }, ticks: { color: TICK_COLOR, font: tickFont } },
  },
}

const aiForecastData = computed(() => {
  const f = aiForecast.value
  if (!f) return null
  return {
    labels: f.labels,
    datasets: [
      { label: 'Upper bound', data: f.upperBand, borderWidth: 0, backgroundColor: 'rgba(220,38,38,0.12)', fill: '+1', pointRadius: 0, tension: 0.35, order: 3 },
      { label: 'Lower bound', data: f.lowerBand, borderWidth: 0, backgroundColor: 'rgba(220,38,38,0.12)', fill: false, pointRadius: 0, tension: 0.35, order: 3 },
      { label: 'Actual', data: f.actual, borderColor: '#10B981', backgroundColor: '#10B981', tension: 0.35, pointRadius: 4, borderWidth: 2, order: 1 },
      { label: 'Predicted', data: f.predicted, borderColor: '#DC2626', backgroundColor: '#DC2626', borderDash: [6, 6], tension: 0.35, pointRadius: 4, borderWidth: 2, order: 2 },
    ],
  }
})
const forecastOptions = {
  ...baseOptions,
  scales: baseScales,
  plugins: { ...baseOptions.plugins, legend: { display: false, labels: { filter: (item) => !item.text.includes('bound') } } },
}

const monthOverMonthData = computed(() => {
  const m = monthOverMonth.value
  if (!m) return null
  return {
    labels: m.labels,
    datasets: [
      { type: 'bar', label: 'Current Period', data: m.current, backgroundColor: '#DC2626', borderRadius: 4 },
      { type: 'bar', label: 'Previous Period', data: m.previous, backgroundColor: '#9CA3AF', borderRadius: 4 },
      { type: 'line', label: 'Target', data: m.labels.map(() => m.target), borderColor: '#3B82F6', borderDash: [6, 6], pointRadius: 0, borderWidth: 2, tension: 0 },
    ],
  }
})
const monthOverMonthOptions = { ...baseOptions, scales: baseScales }

const responseTimeImprovementData = computed(() => {
  const r = responseTimeImprovement.value
  if (!r) return null
  return {
    labels: r.labels,
    datasets: [
      { label: 'Avg Response Time (hrs)', data: r.avgResponseTime, borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.15)', fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2 },
      { label: 'Target (2.5 hrs)', data: r.labels.map(() => r.target), borderColor: '#EF4444', borderDash: [6, 6], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
    ],
  }
})
const responseTimeOptions = { ...baseOptions, scales: baseScales }

const ageGenderData = computed(() => {
  const a = ageGender.value
  if (!a) return null
  return {
    labels: a.labels,
    datasets: [
      { label: 'Female', data: a.female, backgroundColor: '#EC4899', borderRadius: 4 },
      { label: 'Male', data: a.male, backgroundColor: '#3B82F6', borderRadius: 4 },
    ],
  }
})
const groupedBarOptions = { ...baseOptions, scales: baseScales }

const alertPatternData = computed(() => {
  const a = alertPattern.value
  if (!a) return null
  return { labels: a.labels, datasets: [{ label: 'Alerts', data: a.data, backgroundColor: '#8B5CF6', borderRadius: 4 }] }
})
const singleBarOptions = { ...baseOptions, scales: baseScales }

const effectivenessData = computed(() => {
  const e = effectiveness.value
  if (!e) return null
  return {
    labels: e.labels,
    datasets: [{ label: 'Score', data: e.data, backgroundColor: 'rgba(220,38,38,0.35)', borderColor: '#DC2626', borderWidth: 2, pointBackgroundColor: '#DC2626' }],
  }
})
const radarOptions = {
  ...baseOptions,
  scales: {
    r: {
      min: 0,
      max: 100,
      grid: { color: GRID_COLOR },
      angleLines: { color: GRID_COLOR },
      ticks: { color: TICK_COLOR, font: tickFont, backdropColor: 'transparent' },
      pointLabels: { color: TICK_COLOR, font: tickFont },
    },
  },
}

function handleExportCsv() {
  exportCsv('analytics-summary.csv', summary.value, [
    { label: 'Metric', value: (r) => r.label },
    { label: 'Value', value: (r) => r.value },
    { label: 'Change %', value: (r) => r.changePct },
    { label: 'Trend', value: (r) => r.trend },
  ])
}

function handleExportJson() {
  const payload = {
    summary: summary.value,
    diseaseTrends: diseaseTrends.value,
    reportingChannels: reportingChannels.value,
    facilityResponseTime: facilityResponseTime.value,
    aiForecast: aiForecast.value,
    monthOverMonth: monthOverMonth.value,
    responseTimeImprovement: responseTimeImprovement.value,
    ageGender: ageGender.value,
    alertPattern: alertPattern.value,
    effectiveness: effectiveness.value,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'analytics-summary.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
</script>
