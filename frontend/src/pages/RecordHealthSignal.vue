<template>
  <AppShell>
    <div class="max-w-3xl">
      <h2 class="text-xl font-bold text-gray-900">Record Health Signal</h2>
      <p class="text-sm text-gray-400 mb-6">Quick community or facility health surveillance signal recording</p>

      <div class="flex items-center mb-8">
        <div v-for="(label, i) in steps" :key="label" :class="['flex items-center', i < steps.length - 1 ? 'flex-1' : '']">
          <div class="flex flex-col items-center">
            <div :class="['w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold', i + 1 <= currentStep ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-500']">{{ i + 1 }}</div>
            <div :class="['text-xs mt-1', i + 1 <= currentStep ? 'text-red-600 font-medium' : 'text-gray-400']">{{ label }}</div>
          </div>
          <div v-if="i < steps.length - 1" :class="['flex-1 h-0.5 mx-2', i + 1 < currentStep ? 'bg-red-600' : 'bg-gray-200']"></div>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-gray-100 p-6">

        <div v-if="currentStep === 1">
          <label class="block text-sm font-semibold mb-1">Reporter Name</label>
          <input v-model="form.reporter_name" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm" placeholder="Full name">
          <label class="block text-sm font-semibold mb-1">Phone Number</label>
          <input v-model="form.phone_number" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm" placeholder="+254...">
          <label class="block text-sm font-semibold mb-1">Signal Type</label>
          <select v-model="form.signal_type" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
            <option value="">Select signal type</option>
            <option>Suspected Outbreak</option><option>Unusual Symptom Cluster</option><option>Environmental Hazard</option><option>Other</option>
          </select>
          <label class="block text-sm font-semibold mb-1">Region</label>
          <select v-model="form.region" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
            <option value="">Select region</option>
            <option v-for="r in regions" :key="r.name" :value="r.name">{{ r.region_name }}</option>
          </select>
          <label class="block text-sm font-semibold mb-1">Location</label>
          <div class="flex gap-2 mb-1">
            <input v-model="form.location_name" class="flex-1 bg-gray-50 rounded-lg px-4 py-3 text-sm" placeholder="Location name">
            <button type="button" @click="captureGPS" class="border border-gray-200 rounded-lg px-4 text-gray-500 hover:bg-gray-50"><MapPin class="w-4 h-4" /></button>
          </div>
          <p class="text-xs text-gray-400 mb-6">{{ gpsLabel }}</p>
          <div class="flex justify-end">
            <button @click="currentStep = 2" class="bg-red-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold">Continue</button>
          </div>
        </div>

        <div v-else-if="currentStep === 2">
          <label class="block text-sm font-semibold mb-1">Number of Affected Persons</label>
          <input v-model="form.affected_count" type="number" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-2 text-sm" placeholder="Estimated count">
          <p class="text-sm font-semibold mt-4">Select All Observed Symptoms</p>
          <template v-for="cat in symptomCategories" :key="cat">
            <p class="text-xs text-gray-400 mt-4 mb-2">{{ cat }}</p>
            <div class="grid grid-cols-2 gap-2">
              <label v-for="s in symptomsByCategory(cat)" :key="s.name" class="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <input type="checkbox" :value="s.name" v-model="form.symptoms"> {{ s.symptom_name }}
              </label>
            </div>
          </template>
          <label class="block text-sm font-semibold mb-1 mt-6">Severity Assessment</label>
          <select v-model="form.severity" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-6 text-sm">
            <option value="">Select severity...</option>
            <option>Mild</option><option>Moderate</option><option>Severe</option><option>Critical</option>
          </select>
          <div class="flex justify-between">
            <button @click="currentStep = 1" class="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold">Back</button>
            <button @click="currentStep = 3" class="bg-red-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold">Continue</button>
          </div>
        </div>

        <div v-else-if="currentStep === 3">
          <label class="block text-sm font-semibold mb-1">Additional Notes</label>
          <textarea v-model="form.additional_notes" rows="4" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-6 text-sm" placeholder="Describe the situation..."></textarea>
          <label class="block text-sm font-semibold mb-1">Voice Note</label>
          <div class="border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-400 mb-1">Record Voice Note</div>
          <p class="text-xs text-gray-400 mb-6">Speech-to-Text powered by Whisper AI \u2014 coming later</p>
          <div class="flex justify-between">
            <button @click="currentStep = 2" class="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold">Back</button>
            <button @click="currentStep = 4" class="bg-red-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold">Continue</button>
          </div>
        </div>

        <div v-else-if="currentStep === 4">
          <h3 class="font-bold text-center mb-6">Review your report</h3>
          <div class="space-y-3 text-sm mb-6">
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Reporter</span><span class="font-medium">{{ form.reporter_name }}</span></div>
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Region</span><span class="font-medium">{{ regionLabel }}</span></div>
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Location</span><span class="font-medium">{{ form.location_name }}</span></div>
            <div class="border-b border-gray-100 pb-2">
              <span class="text-gray-400 block mb-1">Symptoms</span>
              <span v-for="s in symptomLabels" :key="s" class="inline-block bg-gray-100 text-xs px-2 py-1 rounded-full mr-1">{{ s }}</span>
            </div>
            <div><span class="text-gray-400 block mb-1">Notes</span><span>{{ form.additional_notes || '\u2014' }}</span></div>
          </div>
          <p v-if="submitError" class="text-red-600 text-sm mb-4">{{ submitError }}</p>
          <div class="flex justify-between">
            <button @click="currentStep = 3" class="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold">Back</button>
            <button @click="submitReport" class="bg-red-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold">Submit Report</button>
          </div>
        </div>

      </div>
    </div>
  </AppShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { MapPin } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import { getList, insertDoc } from '@/api/frappe'

const router = useRouter()
const steps = ['Reporter Info', 'Symptoms', 'Details', 'Review Report']
const currentStep = ref(1)
const regions = ref([])
const symptoms = ref([])
const gpsLabel = ref('GPS not captured yet')
const submitError = ref('')

const form = reactive({
  reporter_name: '', phone_number: '', signal_type: '', region: '', location_name: '',
  latitude: null, longitude: null, affected_count: '', symptoms: [], severity: '', additional_notes: '',
})

const symptomCategories = computed(() => [...new Set(symptoms.value.map((s) => s.category))])
const symptomsByCategory = (cat) => symptoms.value.filter((s) => s.category === cat)
const regionLabel = computed(() => (regions.value.find((r) => r.name === form.region) || {}).region_name || '')
const symptomLabels = computed(() => form.symptoms.map((id) => (symptoms.value.find((s) => s.name === id) || {}).symptom_name).filter(Boolean))

function formatCoords(lat, lng) {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}\u00b0${latDir}, ${Math.abs(lng).toFixed(4)}\u00b0${lngDir}`
}

function captureGPS() {
  if (!navigator.geolocation) { gpsLabel.value = 'GPS not supported on this device/browser.'; return }
  gpsLabel.value = 'Capturing location...'
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      form.latitude = pos.coords.latitude
      form.longitude = pos.coords.longitude
      gpsLabel.value = `GPS: ${formatCoords(form.latitude, form.longitude)} (accuracy \u00b1${Math.round(pos.coords.accuracy)}m)`
    },
    () => { gpsLabel.value = 'Could not get location \u2014 check browser permission, or enter location name manually.' },
    { enableHighAccuracy: true, timeout: 10000 }
  )
}

async function submitReport() {
  submitError.value = ''
  try {
    await insertDoc({
      doctype: 'Case Report',
      reporter_name: form.reporter_name, phone_number: form.phone_number, signal_type: form.signal_type,
      region: form.region, location_name: form.location_name, latitude: form.latitude, longitude: form.longitude,
      affected_count: form.affected_count, symptoms: form.symptoms.map((s) => ({ symptom: s })),
      severity: form.severity, additional_notes: form.additional_notes, channel: 'Mobile', status: 'Submitted',
    })
    router.push('/reports')
  } catch (e) {
    submitError.value = e.message || 'Something went wrong submitting the report.'
  }
}

onMounted(async () => {
  regions.value = await getList('Region', ['name', 'region_name'])
  symptoms.value = await getList('Symptom', ['name', 'symptom_name', 'category'])
})
</script>