<template>
  <AppShell>
    <div class="mb-6">
      <h2 class="text-xl font-bold text-gray-900">Settings</h2>
      <p class="text-sm text-gray-400">Manage the system settings and preferences</p>
    </div>

    <div class="flex w-full gap-1 bg-white border border-gray-100 rounded-2xl p-1.5 mb-6">
      <button
        v-for="tab in TABS" :key="tab.key" @click="activeTab = tab.key"
        :class="['flex flex-1 items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
                  activeTab === tab.key ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50']"
      >
        <component :is="tab.icon" class="w-4 h-4" />
        {{ tab.label }}
      </button>
    </div>

    <div v-if="activeTab === 'profile'" class="space-y-6">
      <div class="bg-white rounded-2xl border border-gray-100 p-6">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3">
            <UserCircle class="w-7 h-7 text-gray-900" />
            <h3 class="text-lg font-semibold text-gray-900">Profile Information</h3>
          </div>
          <span class="bg-gray-100 text-gray-900 text-xs font-semibold rounded-full px-4 py-1.5">{{ roleLabel }}</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">First Name</label>
            <input v-model="form.first_name" :disabled="!editing" class="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Middle Name</label>
            <input v-model="form.middle_name" :disabled="!editing" class="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Last Name</label>
            <input v-model="form.last_name" :disabled="!editing" class="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Phone Number</label>
            <input v-model="form.mobile_no" :disabled="!editing" class="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Email Address</label>
            <input :value="user?.name" disabled class="w-full rounded-lg border border-gray-200 bg-gray-50 text-gray-500 px-4 py-3 text-sm">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Region</label>
            <select v-model="form.assigned_region" :disabled="!editing" class="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
              <option value="">Unassigned</option>
              <option v-for="r in regions" :key="r.name" :value="r.name">{{ r.region_name }}</option>
            </select>
          </div>
        </div>

        <p v-if="profileError" class="text-red-600 text-sm mb-4">{{ profileError }}</p>

        <div class="flex gap-3">
          <button v-if="!editing" @click="startEdit" class="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">
            <Pencil class="w-4 h-4" /> Edit Profile
          </button>
          <template v-else>
            <button @click="saveProfile" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">Save Changes</button>
            <button @click="cancelEdit" class="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold text-gray-600">Cancel</button>
          </template>
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-gray-100 p-6">
        <div class="flex items-center gap-3 mb-6">
          <ShieldCheck class="w-7 h-7 text-gray-900" />
          <h3 class="text-lg font-semibold text-gray-900">Change Password</h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Current Password</label>
            <input v-model="password.current" type="password" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">New Password</label>
            <input v-model="password.next" type="password" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Confirm Password</label>
            <input v-model="password.confirm" type="password" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
          </div>
        </div>

        <button disabled class="bg-red-600/20 text-white rounded-lg px-5 py-2.5 text-sm font-semibold cursor-not-allowed">Update Password</button>
      </div>
    </div>

    <div v-else-if="activeTab === 'notifications'" class="bg-white rounded-2xl border border-gray-100 p-6">
      <div class="flex items-center gap-3 mb-2">
        <Bell class="w-7 h-7 text-gray-900" />
        <h3 class="text-lg font-semibold text-gray-900">Notification Preferences</h3>
      </div>

      <div class="divide-y divide-gray-100">
        <div v-for="pref in notificationPrefs" :key="pref.key" class="flex items-center justify-between gap-6 py-5">
          <div>
            <p class="text-sm font-medium text-gray-900">{{ pref.label }}</p>
            <p class="text-sm text-gray-400 mt-0.5">{{ pref.description }}</p>
          </div>
          <button
            type="button" role="switch" :aria-checked="pref.enabled" @click="pref.enabled = !pref.enabled"
            :class="['relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200',
                      pref.enabled ? 'bg-red-600' : 'bg-gray-200']"
          >
            <span
              :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                        pref.enabled ? 'translate-x-6' : 'translate-x-1']"
            />
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'system'" class="space-y-6">
      <div class="bg-white rounded-2xl border border-gray-100 p-6">
        <div class="flex items-center gap-3 mb-6">
          <Clock class="w-7 h-7 text-gray-900" />
          <h3 class="text-lg font-semibold text-gray-900">Alert Thresholds</h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Critical Alert Threshold</label>
            <input v-model.number="thresholds.critical" type="number" step="0.01" min="0" max="1" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
            <p class="text-xs text-gray-400 mt-1.5">AI risk score above this triggers critical</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">High Alert Threshold</label>
            <input v-model.number="thresholds.high" type="number" step="0.01" min="0" max="1" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Min Reports for Alert</label>
            <input v-model.number="thresholds.minReports" type="number" min="1" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
            <p class="text-xs text-gray-400 mt-1.5">Minimum reports to generate alert</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900 mb-1.5">Alert Time Window (hours)</label>
            <input v-model.number="thresholds.timeWindow" type="number" min="1" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
          </div>
        </div>

        <div class="flex items-center gap-3">
          <button @click="saveThresholds" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">Update Thresholds</button>
          <span v-if="thresholdsSaved" class="text-sm text-green-600 font-medium">Thresholds updated</span>
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-gray-100 p-6">
        <div class="flex items-center gap-3 mb-2">
          <MapPin class="w-7 h-7 text-gray-900" />
          <h3 class="text-lg font-semibold text-gray-900">Active surveillance regions</h3>
        </div>

        <div class="divide-y divide-gray-100">
          <div v-for="region in surveillanceRegions" :key="region.name" class="flex items-center justify-between gap-6 py-4">
            <span class="border border-gray-200 rounded-2xl px-4 py-2 text-sm font-medium text-gray-900">{{ region.name }}</span>
            <button
              type="button" role="switch" :aria-checked="region.active" @click="region.active = !region.active"
              :class="['relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200',
                        region.active ? 'bg-red-600' : 'bg-gray-200']"
            >
              <span
                :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                          region.active ? 'translate-x-6' : 'translate-x-1']"
              />
            </button>
          </div>
        </div>

        <div v-if="addingRegion" class="flex items-center gap-3 mt-4">
          <input
            v-model="newRegionName" @keyup.enter="confirmAddRegion" placeholder="Region name" autofocus
            class="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
          >
          <button @click="confirmAddRegion" class="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2.5 text-sm font-semibold">Add</button>
          <button @click="cancelAddRegion" class="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-semibold text-gray-600">Cancel</button>
        </div>
        <button
          v-else @click="addingRegion = true"
          class="flex items-center gap-2 mt-4 border border-gray-200 bg-gray-50 rounded-md px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-100"
        >
          <Plus class="w-4 h-4" /> Add Region
        </button>
      </div>

      <div class="bg-white rounded-2xl border border-gray-100 p-6">
        <div class="flex items-center gap-3 mb-2">
          <Wrench class="w-7 h-7 text-gray-900" />
          <h3 class="text-lg font-semibold text-gray-900">System Maintenance</h3>
        </div>

        <div class="divide-y divide-gray-100">
          <div class="flex items-center justify-between gap-6 py-5">
            <div>
              <p class="text-sm font-medium text-gray-900">Auto-backup</p>
              <p class="text-sm text-gray-400 mt-0.5">Daily automated database backups</p>
            </div>
            <button
              type="button" role="switch" :aria-checked="maintenance.autoBackup" @click="maintenance.autoBackup = !maintenance.autoBackup"
              :class="['relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200',
                        maintenance.autoBackup ? 'bg-red-600' : 'bg-gray-200']"
            >
              <span
                :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                          maintenance.autoBackup ? 'translate-x-6' : 'translate-x-1']"
              />
            </button>
          </div>
          <div class="flex items-center justify-between gap-6 py-5">
            <div>
              <p class="text-sm font-medium text-gray-900">Maintenance mode</p>
              <p class="text-sm text-gray-400 mt-0.5">Show maintenance page to non-admin users</p>
            </div>
            <button
              type="button" role="switch" :aria-checked="maintenance.maintenanceMode" @click="maintenance.maintenanceMode = !maintenance.maintenanceMode"
              :class="['relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200',
                        maintenance.maintenanceMode ? 'bg-red-600' : 'bg-gray-200']"
            >
              <span
                :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                          maintenance.maintenanceMode ? 'translate-x-6' : 'translate-x-1']"
              />
            </button>
          </div>
        </div>

        <p class="text-sm text-gray-400 mt-4">Last backup: {{ maintenance.lastBackup }} · Size: {{ maintenance.lastBackupSize }}</p>
      </div>
    </div>

    <div v-else-if="activeTab === 'ai-config'" class="bg-white rounded-2xl border border-gray-100 p-6">
      <div class="flex items-center gap-3 mb-2">
        <Wand2 class="w-7 h-7 text-gray-900" />
        <h3 class="text-lg font-semibold text-gray-900">AI Capabilities (features)</h3>
      </div>

      <div class="divide-y divide-gray-100">
        <div v-for="feature in aiFeatures" :key="feature.key" class="flex items-center justify-between gap-6 py-5">
          <div>
            <p class="text-sm font-medium text-gray-900">{{ feature.label }}</p>
            <p class="text-sm text-gray-400 mt-0.5">{{ feature.description }}</p>
          </div>
          <button
            type="button" role="switch" :aria-checked="feature.enabled" @click="feature.enabled = !feature.enabled"
            :class="['relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200',
                      feature.enabled ? 'bg-red-600' : 'bg-gray-200']"
          >
            <span
              :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                        feature.enabled ? 'translate-x-6' : 'translate-x-1']"
            />
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'data'" class="space-y-6">
      <div class="bg-white rounded-2xl border border-gray-100 p-6">
        <div class="flex items-center gap-3 mb-6">
          <Database class="w-7 h-7 text-gray-900" />
          <h3 class="text-lg font-semibold text-gray-900">Data Management</h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <button
            @click="exportDatabase"
            class="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 py-8 text-sm text-gray-900 hover:border-red-200 hover:bg-red-50/40 transition-colors"
          >
            <Download class="w-6 h-6 text-gray-700" />
            Export Full Database
          </button>
          <button
            @click="triggerImport"
            class="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 py-8 text-sm text-gray-900 hover:border-red-200 hover:bg-red-50/40 transition-colors"
          >
            <Upload class="w-6 h-6 text-gray-700" />
            Import Data (CSV)
          </button>
          <input ref="importInput" type="file" accept=".csv" class="hidden" @change="handleImport">
        </div>

        <p v-if="importMessage" class="text-sm mt-4" :class="importError ? 'text-red-600' : 'text-green-600'">{{ importMessage }}</p>

        <div class="border-t border-gray-100 mt-6 pt-4">
          <p class="text-xs text-gray-400">Import, export, and manage surveillance data</p>
        </div>

        <div class="mt-6">
          <label class="block text-sm font-medium text-gray-900 mb-2">Data Retention</label>
          <select v-model="dataRetention" class="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
            <option value="6-months">6 months</option>
            <option value="1-year">1 year</option>
            <option value="2-years">2 years</option>
            <option value="forever">Forever</option>
          </select>
          <p class="text-xs text-gray-400 mt-1.5">Closed cases older than this will be archived</p>
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-gray-100 p-6">
        <div class="flex items-center gap-3 mb-6">
          <Database class="w-7 h-7 text-gray-900" />
          <h3 class="text-lg font-semibold text-gray-900">Database Statistics</h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-10">
          <div v-for="stat in databaseStats" :key="stat.label" class="flex items-center justify-between py-3 border-b border-gray-100">
            <span class="text-sm text-gray-500">{{ stat.label }}</span>
            <span class="text-sm font-semibold text-gray-900">{{ stat.value }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'security'" class="bg-white rounded-2xl border border-gray-100 p-6">
      <div class="flex items-center gap-3 mb-2">
        <Shield class="w-7 h-7 text-gray-900" />
        <h3 class="text-lg font-semibold text-gray-900">Security Settings</h3>
      </div>

      <div class="divide-y divide-gray-100">
        <div class="flex items-center justify-between gap-6 py-5">
          <div>
            <p class="text-sm font-medium text-gray-900">Two-Factor Authentication</p>
            <p class="text-sm text-gray-400 mt-0.5">Require 2FA for all admin users</p>
          </div>
          <button
            type="button" role="switch" :aria-checked="security.twoFactorAuth" @click="security.twoFactorAuth = !security.twoFactorAuth"
            :class="['relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200',
                      security.twoFactorAuth ? 'bg-red-600' : 'bg-gray-200']"
          >
            <span
              :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                        security.twoFactorAuth ? 'translate-x-6' : 'translate-x-1']"
            />
          </button>
        </div>

        <div class="flex items-center justify-between gap-6 py-5">
          <div>
            <p class="text-sm font-medium text-gray-900">Session Timeout</p>
            <p class="text-sm text-gray-400 mt-0.5">Auto-logout after inactivity</p>
          </div>
          <select v-model="security.sessionTimeout" class="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-200">
            <option v-for="opt in sessionTimeoutOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-6 py-5">
          <div>
            <p class="text-sm font-medium text-gray-900">Password Policy</p>
            <p class="text-sm text-gray-400 mt-0.5">Minimum password complexity</p>
          </div>
          <select v-model="security.passwordPolicy" class="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-200">
            <option v-for="opt in passwordPolicyOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-6 py-5">
          <div>
            <p class="text-sm font-medium text-gray-900">IP Whitelist</p>
            <p class="text-sm text-gray-400 mt-0.5">Restrict access to specific IP ranges</p>
          </div>
          <button
            type="button" role="switch" :aria-checked="security.ipWhitelist" @click="security.ipWhitelist = !security.ipWhitelist"
            :class="['relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200',
                      security.ipWhitelist ? 'bg-red-600' : 'bg-gray-200']"
          >
            <span
              :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                        security.ipWhitelist ? 'translate-x-6' : 'translate-x-1']"
            />
          </button>
        </div>

        <div class="flex items-center justify-between gap-6 py-5">
          <div>
            <p class="text-sm font-medium text-gray-900">Audit Logging</p>
            <p class="text-sm text-gray-400 mt-0.5">Log all user actions for compliance</p>
          </div>
          <button
            type="button" role="switch" :aria-checked="security.auditLogging" @click="security.auditLogging = !security.auditLogging"
            :class="['relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200',
                      security.auditLogging ? 'bg-red-600' : 'bg-gray-200']"
          >
            <span
              :class="['inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                        security.auditLogging ? 'translate-x-6' : 'translate-x-1']"
            />
          </button>
        </div>
      </div>
    </div>

    <div v-else class="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400">
      {{ TABS.find((t) => t.key === activeTab)?.label }} settings coming soon
    </div>
  </AppShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { UserCircle, ShieldCheck, Pencil, Bell, SlidersHorizontal, Wand2, Database, Shield, Clock, MapPin, Wrench, Plus, Download, Upload } from 'lucide-vue-next'
import AppShell from '@/components/layout/AppShell.vue'
import { getCurrentUser, getRegions, getRoles, updateDoc } from '@/api/frappe'

const TABS = [
  { key: 'profile', label: 'Profile', icon: UserCircle },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'system', label: 'System', icon: SlidersHorizontal },
  { key: 'ai-config', label: 'AI Config', icon: Wand2 },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'security', label: 'Security', icon: Shield },
]
const activeTab = ref('profile')
const thresholds = reactive({ critical: 0.85, high: 0.6, minReports: 3, timeWindow: 24 })
const thresholdsSaved = ref(false)

const surveillanceRegions = reactive([])
const addingRegion = ref(false)
const newRegionName = ref('')

const maintenance = reactive({
  autoBackup: true,
  maintenanceMode: false,
  lastBackup: 'Feb 17, 2026 02:00 AM',
  lastBackupSize: '248 MB',
})

const security = reactive({
  twoFactorAuth: true,
  sessionTimeout: '30-min',
  passwordPolicy: 'strong',
  ipWhitelist: false,
  auditLogging: true,
})

const sessionTimeoutOptions = [
  { value: '15-min', label: '15 min' },
  { value: '30-min', label: '30 min' },
  { value: '1-hour', label: '1 hour' },
  { value: '4-hours', label: '4 hours' },
  { value: 'never', label: 'Never' },
]

const passwordPolicyOptions = [
  { value: 'basic', label: 'Basic (8+ characters)' },
  { value: 'medium', label: 'Medium (8+ mixed)' },
  { value: 'strong', label: 'Strong (12+ mixed)' },
]

const dataRetention = ref('1-year')
const importInput = ref(null)
const importMessage = ref('')
const importError = ref(false)

const databaseStats = reactive([
  { label: 'Total Alerts', value: 20 },
  { label: 'Total Reports', value: 50 },
  { label: 'Active Cases', value: 10 },
  { label: 'Registered Users', value: 8 },
  { label: 'Database Size', value: '12.4 MB' },
  { label: 'Last Backup', value: 'Today, 03:00 AM' },
])

function exportDatabase() {
  const payload = {
    exportedAt: new Date().toISOString(),
    dataRetention: dataRetention.value,
    stats: databaseStats,
    surveillanceRegions,
    aiFeatures,
    notificationPrefs,
    thresholds,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `kenya-red-cross-export-${Date.now()}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function triggerImport() {
  importMessage.value = ''
  importInput.value?.click()
}

function handleImport(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    const rows = String(reader.result).split(/\r?\n/).filter((line) => line.trim().length > 0)
    const rowCount = Math.max(rows.length - 1, 0)
    importError.value = false
    importMessage.value = `Imported ${rowCount} row${rowCount === 1 ? '' : 's'} from "${file.name}"`
  }
  reader.onerror = () => {
    importError.value = true
    importMessage.value = `Could not read "${file.name}"`
  }
  reader.readAsText(file)
}

const user = ref(null)
const regions = ref([])
const roles = ref([])
const editing = ref(false)
const profileError = ref('')
const password = reactive({ current: '', next: '', confirm: '' })
const emptyForm = () => ({ first_name: '', middle_name: '', last_name: '', mobile_no: '', assigned_region: '' })
const form = reactive(emptyForm())

const aiFeatures = reactive([
  { key: 'disease-trend-analysis', label: 'Disease trend analysis', description: 'Allow AI to analyze and summarize disease trends', enabled: true },
  { key: 'alert-risk-assessment', label: 'Alert risk assessment', description: 'AI generates risk assessments for new alerts', enabled: true },
  { key: 'anomaly-detection', label: 'Anomaly detection', description: 'Proactive detection of unusual patterns in data', enabled: true },
  { key: 'report-auto-classification', label: 'Report auto-classification', description: 'Automatically classify reports by ICD-11 codes', enabled: false },
  { key: 'outbreak-prediction', label: 'Outbreak prediction', description: 'Predictive modeling for potential outbreaks', enabled: true },
  { key: 'natural-language-queries', label: 'Natural language queries', description: 'Allow users to query data using natural language', enabled: false },
  { key: 'auto-generate-sops', label: 'Auto-generate SOPs', description: 'AI suggests response protocols based on alert type', enabled: false },
  { key: 'cross-region-correlation', label: 'Cross-region correlation', description: 'Detect patterns across multiple regions', enabled: true },
])

const notificationPrefs = reactive([
  { key: 'critical-alerts', label: 'Critical alerts', description: 'Get notified for critical severity alerts', enabled: true },
  { key: 'ai-keyword-matches', label: 'AI keyword matches', description: 'Immediate notification when watched keywords are detected', enabled: true },
  { key: 'new-reports-region', label: 'New reports in my region', description: 'Reports submitted from your assigned region', enabled: true },
  { key: 'verification-reminders', label: 'Verification reminders', description: 'Pending verification follow-ups', enabled: false },
  { key: 'case-status-changes', label: 'Case status changes', description: "Updates when cases you're involved with change status", enabled: true },
  { key: 'weekly-digest', label: 'Weekly digest', description: 'Weekly summary of surveillance activity', enabled: false },
  { key: 'system-maintenance', label: 'System maintenance', description: 'Scheduled downtime notifications', enabled: false },
  { key: 'ai-anomaly-reports', label: 'AI anomaly reports', description: 'When AI detects unusual patterns', enabled: true },
])

const roleLabel = computed(() => {
  const match = roles.value.find((r) => r.name === user.value?.primary_role)
  return match?.role || user.value?.primary_role || 'Member'
})

function syncForm() {
  Object.assign(form, {
    first_name: user.value?.first_name || '',
    middle_name: user.value?.middle_name || '',
    last_name: user.value?.last_name || '',
    mobile_no: user.value?.mobile_no || '',
    assigned_region: user.value?.assigned_region || '',
  })
}

function saveThresholds() {
  thresholdsSaved.value = true
  setTimeout(clearThresholdsSaved, 3000)
}

function clearThresholdsSaved() {
  thresholdsSaved.value = false
}

function confirmAddRegion() {
  const name = newRegionName.value.trim()
  if (name) surveillanceRegions.push({ name, active: true })
  newRegionName.value = ''
  addingRegion.value = false
}

function cancelAddRegion() {
  newRegionName.value = ''
  addingRegion.value = false
}

function startEdit() {
  profileError.value = ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  syncForm()
}

async function saveProfile() {
  profileError.value = ''
  try {
    user.value = await updateDoc('User', user.value.name, { ...form })
    syncForm()
    editing.value = false
  } catch (e) {
    profileError.value = e.message || 'Could not update your profile.'
  }
}

onMounted(async () => {
  const [me, regionList, roleList] = await Promise.all([getCurrentUser(), getRegions(), getRoles()])
  user.value = me
  regions.value = regionList
  roles.value = roleList
  surveillanceRegions.push(...regionList.map((r) => ({ name: r.region_name, active: true })))
  syncForm()
})
</script>
