<template>
  <AppShell>
    <div class="w-full">
      <h2 class="text-xl font-bold text-gray-900">Record Health Signal</h2>
      <p class="text-sm text-gray-400 mb-8">Quick community or facility health surveillance signal recording</p>

      <div class="flex items-center mb-8">
        <div v-for="(label, i) in steps" :key="label" :class="['flex items-center', i < steps.length - 1 ? 'flex-1' : '']">
          <div class="flex flex-col items-center">
            <div :class="['w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors', i + 1 <= currentStep ? 'bg-red-600 text-white shadow-sm shadow-red-200' : 'bg-gray-200 text-gray-500']">{{ i + 1 }}</div>
            <div :class="['text-xs mt-1.5 whitespace-nowrap', i + 1 <= currentStep ? 'text-red-600 font-semibold' : 'text-gray-400']">{{ label }}</div>
          </div>
          <div v-if="i < steps.length - 1" :class="['flex-1 h-0.5 mx-2 rounded-full transition-colors', i + 1 < currentStep ? 'bg-red-600' : 'bg-gray-200']"></div>
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 lg:p-10 w-full">

        <div v-if="currentStep === 1">
          <h3 class="text-sm font-bold text-gray-900 mb-4">Reporter Information</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-semibold mb-1">Reporter Name</label>
              <input v-model="form.reporter_name" class="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow" placeholder="Full name">
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Phone Number</label>
              <input v-model="form.phone_number" class="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow" placeholder="+254...">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-semibold mb-1">Signal Type</label>
              <select v-model="form.signal_type" class="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
                <option value="">Select signal type</option>
                <option>Suspected Outbreak</option><option>Community Signal</option><option>Facility Signal</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Region</label>
              <select v-model="form.region" class="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
                <option value="">Select region</option>
                <option v-for="r in regions" :key="r.name" :value="r.name">{{ r.region_name }}</option>
              </select>
            </div>
          </div>
          <label class="block text-sm font-semibold mb-1">Location</label>
          <div class="flex gap-2 mb-1">
            <input v-model="form.location_name" class="flex-1 bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow" placeholder="Location name">
            <button
              type="button"
              @click="captureGPS"
              :disabled="gpsState === 'loading'"
              :class="['border rounded-lg px-4 flex items-center justify-center transition-colors', gpsState === 'success' ? 'border-green-200 bg-green-50 text-green-600' : gpsState === 'error' ? 'border-red-200 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300']"
            >
              <Loader2 v-if="gpsState === 'loading'" class="w-4 h-4 animate-spin" />
              <CheckCircle2 v-else-if="gpsState === 'success'" class="w-4 h-4" />
              <AlertCircle v-else-if="gpsState === 'error'" class="w-4 h-4" />
              <MapPin v-else class="w-4 h-4" />
            </button>
          </div>
          <div
            :class="['inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 mb-8', gpsState === 'success' ? 'bg-green-50 text-green-600' : gpsState === 'error' ? 'bg-red-50 text-red-600' : gpsState === 'loading' ? 'bg-amber-50 text-amber-600' : 'text-gray-400']"
          >
            <Loader2 v-if="gpsState === 'loading'" class="w-3 h-3 animate-spin" />
            <CheckCircle2 v-else-if="gpsState === 'success'" class="w-3 h-3" />
            <AlertCircle v-else-if="gpsState === 'error'" class="w-3 h-3" />
            {{ gpsLabel }}
          </div>
          <div class="flex justify-end">
            <button @click="currentStep = 2" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">Continue</button>
          </div>
        </div>

        <div v-else-if="currentStep === 2">
          <h3 class="text-sm font-bold text-gray-900 mb-4">Affected Person Details</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-semibold mb-1">Number of Affected Persons</label>
              <input v-model="form.affected_count" type="number" min="0" class="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow" placeholder="Estimated count">
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Age Band</label>
              <select v-model="form.age_band" class="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
                <option value="">Select age band</option>
                <option v-for="a in AGE_BANDS" :key="a" :value="a">{{ a }}</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label class="block text-sm font-semibold mb-1">Sex</label>
              <select v-model="form.sex" class="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
                <option value="">Select sex</option>
                <option v-for="s in SEXES" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Nationality</label>
              <select v-model="form.nationality" class="w-full bg-gray-50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
                <option value="">Select nationality</option>
                <option v-for="n in NATIONALITIES" :key="n" :value="n">{{ n }}</option>
              </select>
            </div>
          </div>

          <h3 class="text-sm font-bold text-gray-900 mb-3 pt-2 border-t border-gray-100">Select All Observed Symptoms</h3>
          <template v-for="cat in symptomCategories" :key="cat">
            <p class="text-xs font-medium text-gray-400 uppercase tracking-wide mt-4 mb-2">{{ cat }}</p>
            <div class="grid grid-cols-2 gap-2">
              <label
                v-for="s in symptomsByCategory(cat)"
                :key="s.name"
                :class="['flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors', form.symptoms.includes(s.name) ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 hover:bg-gray-50']"
              >
                <input type="checkbox" :value="s.name" v-model="form.symptoms" class="accent-red-600"> {{ s.symptom_name }}
              </label>
            </div>
          </template>
          <label class="block text-sm font-semibold mb-1 mt-6">Severity Assessment</label>
          <select v-model="form.severity" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-6 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow">
            <option value="">Select severity...</option>
            <option>Low</option><option>Moderate</option><option>Critical</option>
          </select>
          <div class="flex justify-between">
            <button @click="currentStep = 1" class="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Back</button>
            <button @click="currentStep = 3" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">Continue</button>
          </div>
        </div>

        <div v-else-if="currentStep === 3">
          <h3 class="text-sm font-bold text-gray-900 mb-4">Additional Details</h3>
          <label class="block text-sm font-semibold mb-1">Additional Notes</label>
          <textarea v-model="form.additional_notes" rows="4" class="w-full bg-gray-50 rounded-lg px-4 py-3 mb-6 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 transition-shadow" placeholder="Describe the situation..."></textarea>
          <label class="block text-sm font-semibold mb-1">Voice Note</label>
          <div class="border border-dashed border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-400 mb-1">Record Voice Note</div>
          <p class="text-xs text-gray-400 mb-8">Speech-to-Text powered by Whisper AI \u2014 coming later</p>
          <div class="flex justify-between">
            <button @click="currentStep = 2" class="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Back</button>
            <button @click="currentStep = 4" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">Continue</button>
          </div>
        </div>

        <div v-else-if="currentStep === 4">
          <h3 class="font-bold text-center text-gray-900 mb-6">Review your report</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm mb-6">
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Reporter</span><span class="font-medium">{{ form.reporter_name || '\u2014' }}</span></div>
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Region</span><span class="font-medium">{{ regionLabel || '\u2014' }}</span></div>
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Location</span><span class="font-medium">{{ form.location_name || '\u2014' }}</span></div>
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Affected Persons</span><span class="font-medium">{{ form.affected_count || '\u2014' }}</span></div>
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Age Band</span><span class="font-medium">{{ form.age_band || '\u2014' }}</span></div>
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Sex</span><span class="font-medium">{{ form.sex || '\u2014' }}</span></div>
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Nationality</span><span class="font-medium">{{ form.nationality || '\u2014' }}</span></div>
            <div class="flex justify-between border-b border-gray-100 pb-2"><span class="text-gray-400">Severity</span><span class="font-medium">{{ form.severity || '\u2014' }}</span></div>
          </div>
          <div class="border-b border-gray-100 pb-3 mb-4">
            <span class="text-gray-400 text-sm block mb-1.5">Symptoms</span>
            <template v-if="symptomLabels.length">
              <span v-for="s in symptomLabels" :key="s" class="inline-block bg-gray-100 text-gray-700 text-xs font-medium px-2.5 py-1 rounded-full mr-1 mb-1">{{ s }}</span>
            </template>
            <span v-else class="text-sm text-gray-400">\u2014</span>
          </div>
          <div class="mb-6">
            <span class="text-gray-400 text-sm block mb-1.5">Notes</span>
            <p class="text-sm text-gray-700">{{ form.additional_notes || '\u2014' }}</p>
          </div>
          <p v-if="submitError" class="text-red-600 text-sm mb-4">{{ submitError }}</p>
          <div class="flex justify-between">
            <button @click="currentStep = 3" class="border border-gray-200 rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors">Back</button>
            <button @click="submitReport" :disabled="submitting" class="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors">
              {{ submitting ? 'Submitting...' : 'Submit Report' }}
            </button>
          </div>
        </div>

      </div>
    </div>
  </AppShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { MapPin, Loader2, CheckCircle2, AlertCircle } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import { getList, createReport } from '@/api/frappe'
import { AGE_BANDS, SEXES, NATIONALITIES } from '@/data/formOptions'

const router = useRouter()
const steps = ['Reporter Info', 'Symptoms', 'Details', 'Review Report']
const currentStep = ref(1)
const regions = ref([])
const symptoms = ref([])
const gpsLabel = ref('GPS not captured yet')
const gpsState = ref('idle')
const submitError = ref('')
const submitting = ref(false)



const form = reactive({
  reporter_name: '', phone_number: '', signal_type: '', region: '', location_name: '',
  latitude: null, longitude: null, affected_count: '', age_band: '', sex: '', nationality: '',
  symptoms: [], severity: '', additional_notes: '',
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
  submitting.value = true
  try {
    await createReport({
      reporter_name: form.reporter_name, phone_number: form.phone_number, signal_type: form.signal_type,
      region: form.region, location_name: form.location_name, latitude: form.latitude, longitude: form.longitude,
      affected_count: form.affected_count, age_band: form.age_band, sex: form.sex, nationality: form.nationality,
      symptoms: form.symptoms.map((s) => ({ symptom: s })),
      severity: form.severity, additional_notes: form.additional_notes, channel: 'Web', status: 'Submitted',
    })
    router.push('/reports')
  } catch (e) {
    submitError.value = e.message || 'Something went wrong submitting the report.'
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  regions.value = await getList('Region', ['name', 'region_name'])
  symptoms.value = await getList('Symptom', ['name', 'symptom_name', 'category'])
})
</script>
