<template>
  <AppShell>
    <div class="max-w-4xl mx-auto">
      <router-link to="/reports" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4 transition-colors">
        <ArrowLeft class="w-4 h-4" /> Back to Reports
      </router-link>

      <div v-if="loading" class="bg-white rounded-2xl border border-gray-100 py-24 text-center text-sm text-gray-400">
        Loading report...
      </div>

      <div v-else-if="loadError" class="bg-white rounded-2xl border border-gray-100 py-24 text-center">
        <p class="text-sm text-red-500 mb-4">{{ loadError }}</p>
        <router-link to="/reports" class="text-sm font-semibold text-red-600 hover:underline">Return to Reports</router-link>
      </div>

      <template v-else-if="report">
        <div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div class="flex flex-wrap items-start justify-between gap-4 px-6 py-5 border-b border-gray-100 bg-white">
                      <!-- <div class="flex flex-wrap items-start justify-between gap-4 px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-red-50/60 to-white"> -->

            <div>
              <div class="flex items-center gap-3 mb-1">
                <h2 class="text-xl font-bold text-gray-900">{{ report.name }}</h2>
                <span :class="['text-xs font-semibold px-2.5 py-1 rounded-full', statusColor(report.status)]">{{ report.status }}</span>
              </div>
              <p class="text-sm text-gray-400">Submitted {{ formatDateTime(report.creation) }} via {{ (report.channel || '—').toUpperCase() }}</p>
            </div>

            <div v-if="mode === 'view'" class="flex gap-2">
              <button
                @click="startEdit"
                class="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-amber-100 transition-colors"
              >
                <Pencil class="w-4 h-4" /> Edit
              </button>
              <button
                @click="confirmingDelete = true"
                class="inline-flex items-center gap-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-red-100 transition-colors"
              >
                <Trash2 class="w-4 h-4" /> Delete
              </button>
            </div>
          </div>

          <div class="p-6">
            <p v-if="actionError" class="text-red-600 text-sm mb-4">{{ actionError }}</p>

            <template v-if="mode === 'view'">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 mb-8">
                <div v-for="f in detailFields" :key="f.label">
                  <div class="text-xs font-medium text-gray-400 mb-1">{{ f.label }}</div>
                  <div class="text-sm font-medium text-gray-900">{{ f.value || '—' }}</div>
                </div>
                <div>
                  <div class="text-xs font-medium text-gray-400 mb-1">Channel</div>
                  <span :class="['inline-block text-xs font-semibold px-2.5 py-1 rounded-full', channelColor(report.channel)]">{{ (report.channel || '—').toUpperCase() }}</span>
                </div>
              </div>

              <div class="mb-8">
                <div class="text-xs font-medium text-gray-400 mb-2">Symptoms</div>
                <div v-if="symptomTags(report.symptom_tags).length" class="flex flex-wrap gap-1.5">
                  <span v-for="s in symptomTags(report.symptom_tags)" :key="s" class="bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full">{{ s }}</span>
                </div>
                <span v-else class="text-sm text-gray-400">—</span>
              </div>

              <div>
                <div class="text-xs font-medium text-gray-400 mb-2">Additional Notes</div>
                <p class="text-sm text-gray-700 bg-gray-50 rounded-lg p-4 leading-relaxed">{{ report.additional_notes || 'No additional notes provided.' }}</p>
              </div>
            </template>

            <template v-else-if="mode === 'edit'">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-6">
                <div>
                  <label class="block text-sm font-semibold mb-1">Location</label>
                  <input v-model="editForm.location_name" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" placeholder="Location name">
                </div>
                <div>
                  <label class="block text-sm font-semibold mb-1">Status</label>
                  <select v-model="editForm.status" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                    <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-semibold mb-1">Severity</label>
                  <select v-model="editForm.severity" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                    <option value="">Select severity...</option>
                    <option v-for="s in severityOptions" :key="s" :value="s">{{ s }}</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-semibold mb-1">Age Band</label>
                  <select v-model="editForm.age_band" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                    <option value="">Select age band...</option>
                    <option v-for="a in ageBandOptions" :key="a" :value="a">{{ a }}</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-semibold mb-1">Sex</label>
                  <select v-model="editForm.sex" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                    <option value="">Select sex...</option>
                    <option v-for="s in sexOptions" :key="s" :value="s">{{ s }}</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-semibold mb-1">Nationality</label>
                  <select v-model="editForm.nationality" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-100">
                    <option value="">Select nationality...</option>
                    <option v-for="n in nationalityOptions" :key="n" :value="n">{{ n }}</option>
                  </select>
                </div>
              </div>

              <label class="block text-sm font-semibold mb-1">Additional Notes</label>
              <textarea v-model="editForm.additional_notes" rows="4" class="w-full bg-gray-50 rounded-lg px-4 py-2.5 mb-6 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" placeholder="Describe the situation..."></textarea>

              <div class="flex justify-end gap-3">
                <button @click="mode = 'view'" class="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
                <button @click="saveEdit" :disabled="saving" class="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors">
                  {{ saving ? 'Saving...' : 'Save Changes' }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>

    <div v-if="confirmingDelete" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="confirmingDelete = false">
      <div class="bg-white rounded-xl w-full max-w-md p-6">
        <h3 class="font-bold text-gray-900 mb-2">Delete Report</h3>
        <div class="bg-red-50 border border-red-100 rounded-lg p-4 mb-6">
          <p class="text-sm text-gray-700">Are you sure you want to delete report <span class="font-semibold">{{ report?.name }}</span>? This action cannot be undone.</p>
        </div>
        <p v-if="actionError" class="text-red-600 text-sm mb-4">{{ actionError }}</p>
        <div class="flex justify-end gap-3">
          <button @click="confirmingDelete = false" class="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
          <button @click="confirmDelete" :disabled="deleting" class="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors">
            {{ deleting ? 'Deleting...' : 'Delete Report' }}
          </button>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import { getDoc, updateDoc, deleteDoc } from '@/api/frappe'
import { STATUSES, SEVERITIES, AGE_BANDS, SEXES, NATIONALITIES, formatDateTime } from '@/data/formOptions.js'

function withCurrentValue(list, value) {
  return value && !list.includes(value) ? [...list, value] : list
}

const STATUS_COLORS = { Submitted: 'bg-amber-50 text-amber-600', Reviewed: 'bg-green-50 text-green-600', Linked: 'bg-red-50 text-red-600', Investigating: 'bg-blue-50 text-blue-600', Closed: 'bg-gray-100 text-gray-500' }
const CHANNEL_COLORS = { Mobile: 'bg-red-50 text-red-600', SMS: 'bg-green-50 text-green-600', USSD: 'bg-amber-50 text-amber-600', WhatsApp: 'bg-gray-100 text-gray-600', Web: 'bg-yellow-50 text-yellow-600' }
const statusColor = (s) => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'
const channelColor = (c) => CHANNEL_COLORS[c] || 'bg-gray-100 text-gray-600'
const symptomTags = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean)

const route = useRoute()
const router = useRouter()

const report = ref(null)
const detailFields = computed(() => {
  if (!report.value) return []
  return [
    { label: 'Reporter', value: report.value.reporter_name },
    { label: 'Phone Number', value: report.value.phone_number },
    { label: 'Location', value: report.value.location_name },
    { label: 'Region', value: report.value.region },
    { label: 'Age Band', value: report.value.age_band },
    { label: 'Sex', value: report.value.sex },
    { label: 'Nationality', value: report.value.nationality },
    { label: 'Affected Persons', value: report.value.affected_count },
    { label: 'Severity', value: report.value.severity },
  ]
})
const statusOptions = computed(() => withCurrentValue(STATUSES, report.value?.status))
const severityOptions = computed(() => withCurrentValue(SEVERITIES, report.value?.severity))
const ageBandOptions = computed(() => withCurrentValue(AGE_BANDS, report.value?.age_band))
const sexOptions = computed(() => withCurrentValue(SEXES, report.value?.sex))
const nationalityOptions = computed(() => withCurrentValue(NATIONALITIES, report.value?.nationality))

const loading = ref(true)
const loadError = ref('')
const mode = ref('view')
const editForm = reactive({ location_name: '', status: '', severity: '', additional_notes: '', age_band: '', sex: '', nationality: '' })
const actionError = ref('')
const saving = ref(false)
const confirmingDelete = ref(false)
const deleting = ref(false)

function startEdit() {
  actionError.value = ''
  Object.assign(editForm, {
    location_name: report.value.location_name || '',
    status: report.value.status || '',
    severity: report.value.severity || '',
    additional_notes: report.value.additional_notes || '',
    age_band: report.value.age_band || '',
    sex: report.value.sex || '',
    nationality: report.value.nationality || '',
  })
  mode.value = 'edit'
}

async function saveEdit() {
  actionError.value = ''
  saving.value = true
  try {
    const updated = await updateDoc('Case Report', report.value.name, editForm)
    report.value = { ...report.value, ...updated }
    mode.value = 'view'
  } catch (e) {
    actionError.value = e.message || 'Something went wrong saving the report.'
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  actionError.value = ''
  deleting.value = true
  try {
    await deleteDoc('Case Report', report.value.name)
    router.push('/reports')
  } catch (e) {
    actionError.value = e.message || 'Something went wrong deleting the report.'
    deleting.value = false
  }
}

onMounted(async () => {
  try {
    report.value = await getDoc('Case Report', route.params.id)
  } catch (e) {
    loadError.value = e.message || 'Could not load report details.'
  } finally {
    loading.value = false
  }
})
</script>
