import { useState, useMemo, useEffect, useRef } from 'react'
import { UserCircle, ShieldCheck, Pencil, Bell, SlidersHorizontal, Wand2, Database, Shield, Clock, MapPin, Wrench, Plus, Download, Upload } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getCurrentUser, getRegions, getRoles, updateDoc } from '../api/frappe'

const TABS = [
  { key: 'profile', label: 'Profile', icon: UserCircle },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'system', label: 'System', icon: SlidersHorizontal },
  { key: 'ai-config', label: 'AI Config', icon: Wand2 },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'security', label: 'Security', icon: Shield },
]

const SESSION_TIMEOUT_OPTIONS = [
  { value: '15-min', label: '15 min' },
  { value: '30-min', label: '30 min' },
  { value: '1-hour', label: '1 hour' },
  { value: '4-hours', label: '4 hours' },
  { value: 'never', label: 'Never' },
]

const PASSWORD_POLICY_OPTIONS = [
  { value: 'basic', label: 'Basic (8+ characters)' },
  { value: 'medium', label: 'Medium (8+ mixed)' },
  { value: 'strong', label: 'Strong (12+ mixed)' },
]

const DATABASE_STATS = [
  { label: 'Total Alerts', value: 20 },
  { label: 'Total Reports', value: 50 },
  { label: 'Active Cases', value: 10 },
  { label: 'Registered Users', value: 8 },
  { label: 'Database Size', value: '12.4 MB' },
  { label: 'Last Backup', value: 'Today, 03:00 AM' },
]

const INITIAL_AI_FEATURES = [
  { key: 'disease-trend-analysis', label: 'Disease trend analysis', description: 'Allow AI to analyze and summarize disease trends', enabled: true },
  { key: 'alert-risk-assessment', label: 'Alert risk assessment', description: 'AI generates risk assessments for new alerts', enabled: true },
  { key: 'anomaly-detection', label: 'Anomaly detection', description: 'Proactive detection of unusual patterns in data', enabled: true },
  { key: 'report-auto-classification', label: 'Report auto-classification', description: 'Automatically classify reports by ICD-11 codes', enabled: false },
  { key: 'outbreak-prediction', label: 'Outbreak prediction', description: 'Predictive modeling for potential outbreaks', enabled: true },
  { key: 'natural-language-queries', label: 'Natural language queries', description: 'Allow users to query data using natural language', enabled: false },
  { key: 'auto-generate-sops', label: 'Auto-generate SOPs', description: 'AI suggests response protocols based on alert type', enabled: false },
  { key: 'cross-region-correlation', label: 'Cross-region correlation', description: 'Detect patterns across multiple regions', enabled: true },
]

const INITIAL_NOTIFICATION_PREFS = [
  { key: 'critical-alerts', label: 'Critical alerts', description: 'Get notified for critical severity alerts', enabled: true },
  { key: 'ai-keyword-matches', label: 'AI keyword matches', description: 'Immediate notification when watched keywords are detected', enabled: true },
  { key: 'new-reports-region', label: 'New reports in my region', description: 'Reports submitted from your assigned region', enabled: true },
  { key: 'verification-reminders', label: 'Verification reminders', description: 'Pending verification follow-ups', enabled: false },
  { key: 'case-status-changes', label: 'Case status changes', description: "Updates when cases you're involved with change status", enabled: true },
  { key: 'weekly-digest', label: 'Weekly digest', description: 'Weekly summary of surveillance activity', enabled: false },
  { key: 'system-maintenance', label: 'System maintenance', description: 'Scheduled downtime notifications', enabled: false },
  { key: 'ai-anomaly-reports', label: 'AI anomaly reports', description: 'When AI detects unusual patterns', enabled: true },
]

function Toggle({ enabled, onClick }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onClick}
      className={['relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200', enabled ? 'bg-red-600' : 'bg-gray-200'].join(' ')}
    >
      <span className={['inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200', enabled ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
    </button>
  )
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile')
  const [thresholds, setThresholds] = useState({ critical: 0.85, high: 0.6, minReports: 3, timeWindow: 24 })
  const [thresholdsSaved, setThresholdsSaved] = useState(false)

  const [surveillanceRegions, setSurveillanceRegions] = useState([])
  const [addingRegion, setAddingRegion] = useState(false)
  const [newRegionName, setNewRegionName] = useState('')

  const [maintenance, setMaintenance] = useState({
    autoBackup: true,
    maintenanceMode: false,
    lastBackup: 'Feb 17, 2026 02:00 AM',
    lastBackupSize: '248 MB',
  })

  const [security, setSecurity] = useState({
    twoFactorAuth: true,
    sessionTimeout: '30-min',
    passwordPolicy: 'strong',
    ipWhitelist: false,
    auditLogging: true,
  })

  const [dataRetention, setDataRetention] = useState('1-year')
  const importInputRef = useRef(null)
  const [importMessage, setImportMessage] = useState('')
  const [importError, setImportError] = useState(false)

  const [user, setUser] = useState(null)
  const [regions, setRegions] = useState([])
  const [roles, setRoles] = useState([])
  const [editing, setEditing] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' })
  const emptyForm = () => ({ first_name: '', middle_name: '', last_name: '', mobile_no: '', assigned_region: '' })
  const [form, setForm] = useState(emptyForm)

  const [aiFeatures, setAiFeatures] = useState(INITIAL_AI_FEATURES)
  const [notificationPrefs, setNotificationPrefs] = useState(INITIAL_NOTIFICATION_PREFS)

  const roleLabel = useMemo(() => {
    const match = roles.find((r) => r.name === user?.primary_role)
    return match?.role || user?.primary_role || 'Member'
  }, [roles, user])

  function syncForm(u) {
    setForm({
      first_name: u?.first_name || '',
      middle_name: u?.middle_name || '',
      last_name: u?.last_name || '',
      mobile_no: u?.mobile_no || '',
      assigned_region: u?.assigned_region || '',
    })
  }

  function saveThresholds() {
    setThresholdsSaved(true)
    setTimeout(() => setThresholdsSaved(false), 3000)
  }

  function confirmAddRegion() {
    const name = newRegionName.trim()
    if (name) setSurveillanceRegions((prev) => [...prev, { name, active: true }])
    setNewRegionName('')
    setAddingRegion(false)
  }

  function cancelAddRegion() {
    setNewRegionName('')
    setAddingRegion(false)
  }

  function startEdit() {
    setProfileError('')
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    syncForm(user)
  }

  async function saveProfile() {
    setProfileError('')
    try {
      const updated = await updateDoc('User', user.name, { ...form })
      setUser(updated)
      syncForm(updated)
      setEditing(false)
    } catch (e) {
      setProfileError(e.message || 'Could not update your profile.')
    }
  }

  function exportDatabase() {
    const payload = {
      exportedAt: new Date().toISOString(),
      dataRetention,
      stats: DATABASE_STATS,
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
    setImportMessage('')
    importInputRef.current?.click()
  }

  function handleImport(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const rows = String(reader.result).split(/\r?\n/).filter((line) => line.trim().length > 0)
      const rowCount = Math.max(rows.length - 1, 0)
      setImportError(false)
      setImportMessage(`Imported ${rowCount} row${rowCount === 1 ? '' : 's'} from "${file.name}"`)
    }
    reader.onerror = () => {
      setImportError(true)
      setImportMessage(`Could not read "${file.name}"`)
    }
    reader.readAsText(file)
  }

  useEffect(() => {
    Promise.all([getCurrentUser(), getRegions(), getRoles()]).then(([me, regionList, roleList]) => {
      setUser(me)
      setRegions(regionList)
      setRoles(roleList)
      setSurveillanceRegions(regionList.map((r) => ({ name: r.region_name, active: true })))
      syncForm(me)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleAiFeature(key) {
    setAiFeatures((prev) => prev.map((f) => (f.key === key ? { ...f, enabled: !f.enabled } : f)))
  }

  function toggleNotificationPref(key) {
    setNotificationPrefs((prev) => prev.map((p) => (p.key === key ? { ...p, enabled: !p.enabled } : p)))
  }

  function toggleRegion(name) {
    setSurveillanceRegions((prev) => prev.map((r) => (r.name === name ? { ...r, active: !r.active } : r)))
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-400">Manage the system settings and preferences</p>
      </div>

      <div className="flex w-full gap-1 bg-white border border-gray-100 rounded-2xl p-1.5 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={['flex flex-1 items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap',
              activeTab === tab.key ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-gray-50'].join(' ')}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <UserCircle className="w-7 h-7 text-gray-900" />
                <h3 className="text-lg font-semibold text-gray-900">Profile Information</h3>
              </div>
              <span className="bg-gray-100 text-gray-900 text-xs font-semibold rounded-full px-4 py-1.5">{roleLabel}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">First Name</label>
                <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} disabled={!editing} className="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Middle Name</label>
                <input value={form.middle_name} onChange={(e) => setForm({ ...form, middle_name: e.target.value })} disabled={!editing} className="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Last Name</label>
                <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} disabled={!editing} className="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Phone Number</label>
                <input value={form.mobile_no} onChange={(e) => setForm({ ...form, mobile_no: e.target.value })} disabled={!editing} className="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Email Address</label>
                <input value={user?.name || ''} disabled className="w-full rounded-lg border border-gray-200 bg-gray-50 text-gray-500 px-4 py-3 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Region</label>
                <select value={form.assigned_region} onChange={(e) => setForm({ ...form, assigned_region: e.target.value })} disabled={!editing} className="w-full rounded-lg border border-gray-200 bg-gray-50 disabled:text-gray-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
                  <option value="">Unassigned</option>
                  {regions.map((r) => (
                    <option key={r.name} value={r.name}>{r.region_name}</option>
                  ))}
                </select>
              </div>
            </div>

            {profileError && <p className="text-red-600 text-sm mb-4">{profileError}</p>}

            <div className="flex gap-3">
              {!editing ? (
                <button onClick={startEdit} className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">
                  <Pencil className="w-4 h-4" /> Edit Profile
                </button>
              ) : (
                <>
                  <button onClick={saveProfile} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">Save Changes</button>
                  <button onClick={cancelEdit} className="border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold text-gray-600">Cancel</button>
                </>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <ShieldCheck className="w-7 h-7 text-gray-900" />
              <h3 className="text-lg font-semibold text-gray-900">Change Password</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Current Password</label>
                <input value={password.current} onChange={(e) => setPassword({ ...password, current: e.target.value })} type="password" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">New Password</label>
                <input value={password.next} onChange={(e) => setPassword({ ...password, next: e.target.value })} type="password" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Confirm Password</label>
                <input value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} type="password" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
            </div>

            <button disabled className="bg-red-600/20 text-white rounded-lg px-5 py-2.5 text-sm font-semibold cursor-not-allowed">Update Password</button>
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Bell className="w-7 h-7 text-gray-900" />
            <h3 className="text-lg font-semibold text-gray-900">Notification Preferences</h3>
          </div>

          <div className="divide-y divide-gray-100">
            {notificationPrefs.map((pref) => (
              <div key={pref.key} className="flex items-center justify-between gap-6 py-5">
                <div>
                  <p className="text-sm font-medium text-gray-900">{pref.label}</p>
                  <p className="text-sm text-gray-400 mt-0.5">{pref.description}</p>
                </div>
                <Toggle enabled={pref.enabled} onClick={() => toggleNotificationPref(pref.key)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'system' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <Clock className="w-7 h-7 text-gray-900" />
              <h3 className="text-lg font-semibold text-gray-900">Alert Thresholds</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Critical Alert Threshold</label>
                <input value={thresholds.critical} onChange={(e) => setThresholds({ ...thresholds, critical: Number(e.target.value) })} type="number" step="0.01" min="0" max="1" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
                <p className="text-xs text-gray-400 mt-1.5">AI risk score above this triggers critical</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">High Alert Threshold</label>
                <input value={thresholds.high} onChange={(e) => setThresholds({ ...thresholds, high: Number(e.target.value) })} type="number" step="0.01" min="0" max="1" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Min Reports for Alert</label>
                <input value={thresholds.minReports} onChange={(e) => setThresholds({ ...thresholds, minReports: Number(e.target.value) })} type="number" min="1" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
                <p className="text-xs text-gray-400 mt-1.5">Minimum reports to generate alert</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">Alert Time Window (hours)</label>
                <input value={thresholds.timeWindow} onChange={(e) => setThresholds({ ...thresholds, timeWindow: Number(e.target.value) })} type="number" min="1" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={saveThresholds} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold">Update Thresholds</button>
              {thresholdsSaved && <span className="text-sm text-green-600 font-medium">Thresholds updated</span>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-2">
              <MapPin className="w-7 h-7 text-gray-900" />
              <h3 className="text-lg font-semibold text-gray-900">Active surveillance regions</h3>
            </div>

            <div className="divide-y divide-gray-100">
              {surveillanceRegions.map((region) => (
                <div key={region.name} className="flex items-center justify-between gap-6 py-4">
                  <span className="border border-gray-200 rounded-2xl px-4 py-2 text-sm font-medium text-gray-900">{region.name}</span>
                  <Toggle enabled={region.active} onClick={() => toggleRegion(region.name)} />
                </div>
              ))}
            </div>

            {addingRegion ? (
              <div className="flex items-center gap-3 mt-4">
                <input
                  value={newRegionName}
                  onChange={(e) => setNewRegionName(e.target.value)}
                  onKeyUp={(e) => { if (e.key === 'Enter') confirmAddRegion() }}
                  placeholder="Region name"
                  autoFocus
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                />
                <button onClick={confirmAddRegion} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2.5 text-sm font-semibold">Add</button>
                <button onClick={cancelAddRegion} className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-semibold text-gray-600">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setAddingRegion(true)}
                className="flex items-center gap-2 mt-4 border border-gray-200 bg-gray-50 rounded-md px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-100"
              >
                <Plus className="w-4 h-4" /> Add Region
              </button>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-2">
              <Wrench className="w-7 h-7 text-gray-900" />
              <h3 className="text-lg font-semibold text-gray-900">System Maintenance</h3>
            </div>

            <div className="divide-y divide-gray-100">
              <div className="flex items-center justify-between gap-6 py-5">
                <div>
                  <p className="text-sm font-medium text-gray-900">Auto-backup</p>
                  <p className="text-sm text-gray-400 mt-0.5">Daily automated database backups</p>
                </div>
                <Toggle enabled={maintenance.autoBackup} onClick={() => setMaintenance({ ...maintenance, autoBackup: !maintenance.autoBackup })} />
              </div>
              <div className="flex items-center justify-between gap-6 py-5">
                <div>
                  <p className="text-sm font-medium text-gray-900">Maintenance mode</p>
                  <p className="text-sm text-gray-400 mt-0.5">Show maintenance page to non-admin users</p>
                </div>
                <Toggle enabled={maintenance.maintenanceMode} onClick={() => setMaintenance({ ...maintenance, maintenanceMode: !maintenance.maintenanceMode })} />
              </div>
            </div>

            <p className="text-sm text-gray-400 mt-4">Last backup: {maintenance.lastBackup} · Size: {maintenance.lastBackupSize}</p>
          </div>
        </div>
      )}

      {activeTab === 'ai-config' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Wand2 className="w-7 h-7 text-gray-900" />
            <h3 className="text-lg font-semibold text-gray-900">AI Capabilities (features)</h3>
          </div>

          <div className="divide-y divide-gray-100">
            {aiFeatures.map((feature) => (
              <div key={feature.key} className="flex items-center justify-between gap-6 py-5">
                <div>
                  <p className="text-sm font-medium text-gray-900">{feature.label}</p>
                  <p className="text-sm text-gray-400 mt-0.5">{feature.description}</p>
                </div>
                <Toggle enabled={feature.enabled} onClick={() => toggleAiFeature(feature.key)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <Database className="w-7 h-7 text-gray-900" />
              <h3 className="text-lg font-semibold text-gray-900">Data Management</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <button
                onClick={exportDatabase}
                className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 py-8 text-sm text-gray-900 hover:border-red-200 hover:bg-red-50/40 transition-colors"
              >
                <Download className="w-6 h-6 text-gray-700" />
                Export Full Database
              </button>
              <button
                onClick={triggerImport}
                className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 py-8 text-sm text-gray-900 hover:border-red-200 hover:bg-red-50/40 transition-colors"
              >
                <Upload className="w-6 h-6 text-gray-700" />
                Import Data (CSV)
              </button>
              <input ref={importInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
            </div>

            {importMessage && <p className={['text-sm mt-4', importError ? 'text-red-600' : 'text-green-600'].join(' ')}>{importMessage}</p>}

            <div className="border-t border-gray-100 mt-6 pt-4">
              <p className="text-xs text-gray-400">Import, export, and manage surveillance data</p>
            </div>

            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-900 mb-2">Data Retention</label>
              <select value={dataRetention} onChange={(e) => setDataRetention(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200">
                <option value="6-months">6 months</option>
                <option value="1-year">1 year</option>
                <option value="2-years">2 years</option>
                <option value="forever">Forever</option>
              </select>
              <p className="text-xs text-gray-400 mt-1.5">Closed cases older than this will be archived</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <Database className="w-7 h-7 text-gray-900" />
              <h3 className="text-lg font-semibold text-gray-900">Database Statistics</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10">
              {DATABASE_STATS.map((stat) => (
                <div key={stat.label} className="flex items-center justify-between py-3 border-b border-gray-100">
                  <span className="text-sm text-gray-500">{stat.label}</span>
                  <span className="text-sm font-semibold text-gray-900">{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-7 h-7 text-gray-900" />
            <h3 className="text-lg font-semibold text-gray-900">Security Settings</h3>
          </div>

          <div className="divide-y divide-gray-100">
            <div className="flex items-center justify-between gap-6 py-5">
              <div>
                <p className="text-sm font-medium text-gray-900">Two-Factor Authentication</p>
                <p className="text-sm text-gray-400 mt-0.5">Require 2FA for all admin users</p>
              </div>
              <Toggle enabled={security.twoFactorAuth} onClick={() => setSecurity({ ...security, twoFactorAuth: !security.twoFactorAuth })} />
            </div>

            <div className="flex items-center justify-between gap-6 py-5">
              <div>
                <p className="text-sm font-medium text-gray-900">Session Timeout</p>
                <p className="text-sm text-gray-400 mt-0.5">Auto-logout after inactivity</p>
              </div>
              <select value={security.sessionTimeout} onChange={(e) => setSecurity({ ...security, sessionTimeout: e.target.value })} className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-200">
                {SESSION_TIMEOUT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-6 py-5">
              <div>
                <p className="text-sm font-medium text-gray-900">Password Policy</p>
                <p className="text-sm text-gray-400 mt-0.5">Minimum password complexity</p>
              </div>
              <select value={security.passwordPolicy} onChange={(e) => setSecurity({ ...security, passwordPolicy: e.target.value })} className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-200">
                {PASSWORD_POLICY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-6 py-5">
              <div>
                <p className="text-sm font-medium text-gray-900">IP Whitelist</p>
                <p className="text-sm text-gray-400 mt-0.5">Restrict access to specific IP ranges</p>
              </div>
              <Toggle enabled={security.ipWhitelist} onClick={() => setSecurity({ ...security, ipWhitelist: !security.ipWhitelist })} />
            </div>

            <div className="flex items-center justify-between gap-6 py-5">
              <div>
                <p className="text-sm font-medium text-gray-900">Audit Logging</p>
                <p className="text-sm text-gray-400 mt-0.5">Log all user actions for compliance</p>
              </div>
              <Toggle enabled={security.auditLogging} onClick={() => setSecurity({ ...security, auditLogging: !security.auditLogging })} />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
