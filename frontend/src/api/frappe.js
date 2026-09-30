const BASE = ''


function getCookie(name) {
  const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)')
  return match ? decodeURIComponent(match.pop()) : null
}


export const csrfToken = () => window.FRAPPE_CSRF_TOKEN || ''
export const currentUserFullName = () => (getCookie('full_name') || 'User').replace(/^"|"$/g, '')
export const currentUserId = () => (getCookie('user_id') || '').replace(/^"|"$/g, '')

function extractErrorMessage(data) {
  if (data && typeof data._server_messages === 'string') {
    try {
      const messages = JSON.parse(data._server_messages)
      for (const raw of messages) {
        try {
          const parsed = JSON.parse(raw)
          if (parsed && parsed.message) return parsed.message
        } catch (e) {
          if (raw) return raw
        }
      }
    } catch (e) {
      // ignore malformed _server_messages
    }
  }
  return (data && data.exception) || 'Request failed'
}

async function callMethod(path) {
  const res = await fetch(`${BASE}${path}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(extractErrorMessage(data))
  }
  return data.message
}

async function callMethodPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken(),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(extractErrorMessage(data))
  }
  return data.message
}

export async function getCurrentUser() {
  const email = currentUserId()
  if (!email || email === 'Guest') return null
  return getDoc('User', email)
}

export async function getMySurveillanceRole() {
  const user = await getCurrentUser()

  if (!user || !user.roles) {
    return null
  }

  const roles = user.roles
    .map(r => r.role)
    .filter(Boolean)

  // Get roles that are defined as Surveillance roles
  const surveillanceRoles = await getRoles()

  const surveillanceRoleNames = surveillanceRoles.map(r => r.role)

  return roles.find(role =>
    surveillanceRoleNames.includes(role)
  ) || null
}

export async function getMyCapabilities() {
  const message = (await callMethod('/api/method/surveillance.capabilities.get_my_capabilities')) || {}
  return {
    capabilities: message.capabilities || [],
    primary_role: message.primary_role || '',
  }
}

export async function getCapabilityCatalog() {
  return (await callMethod('/api/method/surveillance.capabilities.get_capability_catalog')) || []
}

export async function getAlertThresholds() {
  return callMethod('/api/method/surveillance.alert_thresholds.get_alert_thresholds')
}

export async function addDisease({ disease_name, threshold, category }) {
  return callMethodPost('/api/method/surveillance.alert_thresholds.add_disease', { disease_name, threshold, category })
}

export async function saveAlertThresholds(thresholds, outbreakMultiplier) {
  return callMethodPost('/api/method/surveillance.alert_thresholds.save_alert_thresholds', {
    thresholds,
    outbreak_multiplier: outbreakMultiplier,
  })
}

export async function login(usr, pwd) {
  const res = await fetch(`${BASE}/api/method/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `usr=${encodeURIComponent(usr)}&pwd=${encodeURIComponent(pwd)}`,
  })
  return res.ok
}


export async function logout() {
  await fetch(`${BASE}/api/method/logout`, {
    method: 'POST',
    headers: { 'X-Frappe-CSRF-Token': csrfToken() },
  })
}


export async function getList(doctype, fields, opts = {}) {
  const params = new URLSearchParams({
    fields: JSON.stringify(fields),
    limit_page_length: opts.limit || 200,
    limit_start: opts.start || 0,
  })
  if (opts.orderBy) params.set('order_by', opts.orderBy)
  if (opts.filters && Object.keys(opts.filters).length) {
    params.set('filters', JSON.stringify(Object.entries(opts.filters).map(([k, v]) => [k, '=', v])))
  }
  const res = await fetch(`${BASE}/api/resource/${encodeURIComponent(doctype)}?${params}`)
  const data = await res.json()
  return data.data || []
}


export async function getCount(doctype, filtersObj = {}) {
  const filters = Object.entries(filtersObj).map(([k, v]) => [k, '=', v])
  const res = await fetch(`${BASE}/api/method/frappe.client.get_count?doctype=${encodeURIComponent(doctype)}&filters=${encodeURIComponent(JSON.stringify(filters))}`)
  const data = await res.json()
  return data.message || 0
}


export async function insertDoc(doc) {
  const res = await fetch(`${BASE}/api/method/frappe.client.insert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': csrfToken() },
    body: JSON.stringify({ doc }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.exception || 'Request failed')
  }
  return res.json()
}


export function exportExcel(doctype, fields) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/api/method/frappe.desk.reportview.export_query'
  form.target = '_blank'
  const data = { doctype, file_format_type: 'Excel', fields: JSON.stringify(fields) }
  Object.entries(data).forEach(([k, v]) => {
    const input = document.createElement('input')
    input.type = 'hidden'; input.name = k; input.value = v
    form.appendChild(input)
  })
  document.body.appendChild(form)
  form.submit()
  form.remove()
}

export async function getDoc(doctype, name) {
  const res = await fetch(
    `${BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
  )

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.exception || data._server_messages || 'Failed to fetch document')
  }

  return data.data
}


export async function createDoc(doctype, fields) {
  const res = await fetch(
    `${BASE}/api/resource/${encodeURIComponent(doctype)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Frappe-CSRF-Token': csrfToken(),
      },
      body: JSON.stringify(fields),
    }
  )

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(
      data.exception ||
      data.message ||
      data._server_messages ||
      'Failed to create document'
    )
  }

  return data.data
}


export async function createUser(userData) {
  return createDoc('User', {
    doctype: 'User',
    email: userData.email,
    first_name: userData.first_name,
    last_name: userData.last_name || '',
    user_type: 'System User',

    roles: userData.primary_role
      ? [{ role: userData.primary_role }]
      : [],

    assigned_region: userData.assigned_region || '',
    account_status: userData.account_status || 'Active',

    enabled:
      userData.account_status !== 'Inactive' &&
      userData.account_status !== 'Suspended',

    new_password: userData.password,
    send_welcome_email: 0,
  })
}

export async function updateDoc(doctype, name, fields) {
  const res = await fetch(
    `${BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Frappe-CSRF-Token': csrfToken(),
      },
      body: JSON.stringify(fields),
    }
  )

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(
      data.exception ||
      data.message ||
      data._server_messages ||
      'Update failed'
    )
  }

  return data.data
}


export async function updateUser(name, userData) {
  return updateDoc('User', name, {
    first_name: userData.first_name,
    last_name: userData.last_name || '',

    primary_role: userData.primary_role || '',
    assigned_region: userData.assigned_region || '',
    account_status: userData.account_status || 'Active',

    enabled: userData.account_status !== 'Inactive' &&
             userData.account_status !== 'Suspended',
  })
}


export async function deleteDoc(doctype, name) {
  const res = await fetch(
    `${BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: {
        'X-Frappe-CSRF-Token': csrfToken(),
      },
    }
  )

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(
      data.exception ||
      data.message ||
      data._server_messages ||
      'Delete failed'
    )
  }

  return true
}


export async function deleteUser(name) {
  return deleteDoc('User', name)
}


export async function getUsers(opts = {}) {
  return getList(
    'User',
    [
      'name',
      'first_name',
      'last_name',
      'full_name',
      'user_image',
      'primary_role',
      'assigned_region',
      'account_status',
      'last_login',
      'enabled'
    ],
    {
      limit: opts.limit || 50,
      start: opts.start || 0,
      orderBy: 'creation desc'
    }
  )
}

export async function getRoles() {
  return getList(
    'Surveillance Role',
    ['name', 'role'],
    { limit: 200, start: 0, orderBy: 'role asc' }
  )
}

export async function getRegions() {
  return getList(
    'Region',
    ['name', 'region_name'],
    {
      limit: 200,
      start: 0,
      orderBy: 'region_name asc'
    }
  )
}


export async function createRole(roleName) {
  await createDoc('Role', {
    doctype: 'Role',
    role_name: roleName,
    name: roleName,
  })
  return createDoc('Surveillance Role', {
    doctype: 'Surveillance Role',
    role: roleName,
  })
}
export async function createRegion(regionData) {
  return createDoc('Region', {
    doctype: 'Region',
    ...regionData,
  })
}

export async function getRoleCapabilities(role) {
  return callMethod('/api/method/surveillance.capabilities.get_role_capabilities?role=' + encodeURIComponent(role))
}

export async function setRoleCapability(role, capability, enabled) {
  return callMethodPost('/api/method/surveillance.capabilities.set_role_capability', { role, capability, enabled })
}

export function exportCsv(filename, rows, columns) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = columns.map((c) => escape(c.label)).join(',')
  const lines = rows.map((row) => columns.map((c) => escape(c.value(row))).join(','))
  const csv = [header, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const AI_MOCK_RESPONSES = [
  {
    match: /cholera/i,
    answer: 'Here is the latest cholera case breakdown by region based on current surveillance data.',
    table: {
      columns: ['Region', 'Confirmed Cases', 'Suspected Cases', 'Trend'],
      rows: [
        ['Garissa', 42, 15, 'Rising'],
        ['Dadaab', 31, 9, 'Rising'],
        ['Wajir', 12, 6, 'Stable'],
        ['Mombasa', 5, 2, 'Falling'],
      ],
    },
  },
  {
    match: /alert/i,
    answer: 'Found 4 active alerts matching your query, sorted by severity.',
    table: {
      columns: ['Alert ID', 'Signal', 'Location', 'Severity', 'Status'],
      rows: [
        ['ALT-021', 'Cholera Cluster', 'Dadaab', 'Critical', 'Open'],
        ['ALT-018', 'Measles Spike', 'Garissa', 'High', 'Investigating'],
        ['ALT-014', 'AWD Increase', 'Wajir', 'Medium', 'Open'],
        ['ALT-009', 'Malnutrition Rise', 'Turkana', 'Medium', 'Closed'],
      ],
    },
  },
  {
    match: /case|report/i,
    answer: 'Here is a summary of recent case reports across all channels.',
    table: {
      columns: ['Status', 'Count'],
      rows: [
        ['Submitted', 28],
        ['Reviewed', 54],
        ['Linked', 12],
        ['Investigating', 7],
      ],
    },
  },
]

function buildMockAiAnswer(question) {
  const hit = AI_MOCK_RESPONSES.find((r) => r.match.test(question))
  if (hit) return { answer: hit.answer, table: hit.table }
  const fallback = 'I looked into "' + question + '" but no matching data source is wired up yet. Try asking about cholera cases, alerts, or reports.'
  return { answer: fallback }
}

/*
|--------------------------------------------------------------------------
| AI Data Assistant
|--------------------------------------------------------------------------
|
| Backed by mock data for now. Once the backend AI/NL-to-query endpoint
| exists, swap the body of queryAiAssistant() for a real API call that
| resolves the same shape: { answer: string, table?: { columns, rows } }.
| The page consuming this function only depends on that return shape.
*/
export async function queryAiAssistant(question) {
  await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 500))
  return buildMockAiAnswer(question)
}

/*
|--------------------------------------------------------------------------
| Analytics Dashboard
|--------------------------------------------------------------------------
|
| Backed by mock data for now. Each function returns the exact shape the
| Analytics page charts expect (labels/datasets), so swapping in real data
| later just means replacing the function body with a fetch/getList call
| that resolves to the same shape - no changes needed in Analytics.jsx.
*/

const MOCK_ANALYTICS_SUMMARY = [
  { key: 'time_to_alert', label: 'Average Time-to-Alert', value: '2.4 hrs', icon: 'Clock', changePct: 12.5, trend: 'down', sentiment: 'positive' },
  { key: 'ai_precision', label: 'AI Alert Precision', value: '87.3%', icon: 'Sparkles', changePct: 8.3, trend: 'down', sentiment: 'negative' },
  { key: 'active_cases', label: 'Active Cases', value: '23', icon: 'AlertTriangle', changePct: 15.2, trend: 'down', sentiment: 'positive' },
  { key: 'surveillance_coverage', label: 'Surveillance Coverage', value: '94.8%', icon: 'Map', changePct: 5.2, trend: 'down', sentiment: 'negative' },
]

const MOCK_DISEASE_TRENDS = {
  labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'],
  series: [
    { name: 'Acute Watery Diarrhea', color: '#D62728', data: [4, 6, 3, 5, 3, 8] },
    { name: 'Malaria', color: '#F2C94C', data: [9, 7, 15, 5, 10, 8] },
    { name: 'Measles', color: '#2F80ED', data: [2, 1, 3, 4, 3, 5] },
    { name: 'Respiratory', color: '#27AE60', data: [10, 12, 8, 14, 15, 20] },
  ],
}

const MOCK_REPORTING_CHANNELS = {
  labels: ['Mobile App', 'USSD', 'SMS', 'WhatsApp'],
  colors: ['#D62728', '#F2C94C', '#2F80ED', '#27AE60'],
  data: [45, 28, 18, 9],
}

const MOCK_FACILITY_RESPONSE_TIME = {
  labels: ['Dagahaley Health Center', 'Ifo Hospital', 'Kalobeyei Clinic', 'Hagadera Dispensary'],
  data: [2.6, 2.15, 3.3, 2.95],
}

const MOCK_AI_FORECAST = {
  labels: ['W-3', 'W-2', 'W-1', 'Current', 'W+1', 'W+2', 'W+3'],
  actual: [18, 24, 29, 34, null, null, null],
  predicted: [null, null, null, 34, 37, 39, 38],
  upperBand: [null, null, null, 34, 42, 46, 47],
  lowerBand: [null, null, null, 34, 33, 32, 29],
}

const MOCK_MONTH_OVER_MONTH = {
  labels: ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'],
  current: [150, 175, 195, 205, 190, 170],
  previous: [130, 145, 160, 180, 175, 160],
  target: 185,
}

const MOCK_RESPONSE_TIME_IMPROVEMENT = {
  labels: ['W1', 'W2', 'W3', 'W4', 'W5'],
  avgResponseTime: [3.2, 2.9, 2.6, 2.5, 2.3],
  target: 2.5,
}

const MOCK_AGE_GENDER_DISTRIBUTION = {
  labels: ['<5', '5-14', '15-49', '50+'],
  male: [38, 22, 30, 10],
  female: [45, 18, 38, 8],
}

const MOCK_ALERT_REPORTING_PATTERN = {
  labels: ['00-06', '06-09', '09-12', '12-15', '15-18', '18-21', '21-24'],
  data: [7, 20, 26, 24, 22, 14, 10],
}

const MOCK_RESPONSE_EFFECTIVENESS = {
  labels: ['Detection', 'Verification', 'Response', 'Tracing', 'Treatment', 'Data Quality'],
  data: [88, 62, 58, 92, 68, 64],
}

export async function getAnalyticsSummary() {
  return MOCK_ANALYTICS_SUMMARY
}

export async function getDiseaseTrends() {
  return MOCK_DISEASE_TRENDS
}

export async function getReportingChannelsDistribution() {
  return MOCK_REPORTING_CHANNELS
}

export async function getFacilityResponseTime() {
  return MOCK_FACILITY_RESPONSE_TIME
}

export async function getAiPredictiveForecast() {
  return MOCK_AI_FORECAST
}

export async function getMonthOverMonthComparison() {
  return MOCK_MONTH_OVER_MONTH
}

export async function getResponseTimeImprovement() {
  return MOCK_RESPONSE_TIME_IMPROVEMENT
}

export async function getAgeGenderDistribution() {
  return MOCK_AGE_GENDER_DISTRIBUTION
}

export async function getAlertReportingPattern() {
  return MOCK_ALERT_REPORTING_PATTERN
}

export async function getResponseEffectivenessScore() {
  return MOCK_RESPONSE_EFFECTIVENESS
}

/*
|--------------------------------------------------------------------------
| Dashboard Overview
|--------------------------------------------------------------------------
|
| Backed by mock data for now. Each function resolves the exact shape the
| Dashboard page expects, so swapping in real data later just means
| replacing the function body with a fetch/getList call that resolves to
| the same shape - no changes needed in Dashboard.jsx.
*/

const MOCK_DASHBOARD_STATS = [
  { key: 'active_alerts', label: 'Active Alerts', value: '9', icon: 'MapPin', changePct: 12.5, trend: 'down', sentiment: 'positive' },
  { key: 'reports_today', label: 'Reports Today', value: '7', icon: 'AlertTriangle', changePct: 8.3, trend: 'down', sentiment: 'negative' },
  { key: 'pending_verifications', label: 'Pending Verifications', value: '3', icon: 'Radio', changePct: 15.2, trend: 'down', sentiment: 'positive' },
  { key: 'system_uptime', label: 'System Uptime', value: '93.1%', icon: 'CheckCheck', changePct: 6.8, trend: 'down', sentiment: 'negative' },
]

const MOCK_DASHBOARD_DISEASE_TRENDS = {
  labels: ['W-4', 'W-3', 'W-2', 'W-1', 'Current'],
  series: [
    { name: 'AWD', color: '#EF4444', data: [8, 10, 14, 16, 18] },
    { name: 'Malaria', color: '#F59E0B', data: [20, 25, 29, 32, 34] },
    { name: 'Measles', color: '#10B981', data: [8, 7, 6, 4, 3] },
    { name: 'Respiratory', color: '#3B82F6', data: [12, 16, 21, 24, 27] },
  ],
}

const MOCK_DASHBOARD_ALERTS = [
  { id: 'ALT-101', title: 'Acute Watery Diarrhea Cluster', location: 'Dagahaley, Dadaab', date: '2/12/2026', affected: 12, source: 'CHP Ahmed Abdi', aiScore: 94, severity: 'critical' },
  { id: 'ALT-102', title: 'Measles Suspected Cases', location: 'Kalobeyei Zone 1', date: '2/12/2026', affected: 5, source: 'Facility Nurse Mary Wanjiru', aiScore: 87, severity: 'high' },
  { id: 'ALT-103', title: 'Malaria Outbreak - Resolved', location: 'Ifo Camp', date: '2/8/2026', affected: 8, source: 'Dr. James Kimani', aiScore: 76, severity: 'medium' },
  { id: 'ALT-104', title: 'Respiratory Illness Increase', location: 'Dagahaley, Dadaab', date: '2/12/2026', affected: 12, source: 'CHP Fatuma Noor', aiScore: 94, severity: 'low' },
]

const MOCK_DAILY_ALERT_VOLUME = {
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  data: [3, 5, 3, 7, 6, 3, 5],
}

const MOCK_DISEASE_DISTRIBUTION = {
  labels: ['AWD (Acute Watery Diarrhea)', 'Malaria', 'Measles', 'Respiratory Infections', 'Malnutrition'],
  colors: ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'],
  data: [18, 34, 3, 27, 12],
  changePct: [12, 2, -5, 8, 0],
}

const MOCK_ENVIRONMENTAL_RISK_FACTORS = {
  labels: ['Temperature', 'Humidity', 'Rainfall (mm)'],
  colors: ['#EF4444', '#3B82F6', '#06B6D4'],
  data: [29, 65, 58],
}

export async function getDashboardStats() {
  return MOCK_DASHBOARD_STATS
}

export async function getDashboardDiseaseTrends() {
  return MOCK_DASHBOARD_DISEASE_TRENDS
}

export async function getDashboardAlerts() {
  return MOCK_DASHBOARD_ALERTS
}

export async function getDailyAlertVolume() {
  return MOCK_DAILY_ALERT_VOLUME
}

export async function getDiseaseDistribution() {
  return MOCK_DISEASE_DISTRIBUTION
}

export async function getEnvironmentalRiskFactors() {
  return MOCK_ENVIRONMENTAL_RISK_FACTORS
}

/*
|--------------------------------------------------------------------------
| Surveillance Officer Dashboard
|--------------------------------------------------------------------------
|
| Backed by mock data for now. Each function resolves the exact shape the
| SurveillanceDashboard page expects, so swapping in real data later just
| means replacing the function body with a fetch/getList call that
| resolves to the same shape - no changes needed in the page.
*/

const MOCK_SURVEILLANCE_OFFICER_STATS = [
  { key: 'new_signals', label: 'New signals', value: '18', icon: 'FileText', changePct: 12.5, trend: 'down', sentiment: 'positive' },
  { key: 'priority_alerts', label: 'Priority alerts', value: '3', icon: 'CheckCircle', changePct: 8.3, trend: 'down', sentiment: 'negative' },
  { key: 'awaiting_verification', label: 'Awaiting verification', value: '2', icon: 'ArrowLeftRight', changePct: 15.2, trend: 'down', sentiment: 'positive' },
  { key: 'active_investigations', label: 'Active investigations', value: '3', icon: 'CheckCheck', changePct: 6.8, trend: 'down', sentiment: 'negative' },
]

const MOCK_SIGNAL_TREND = {
  labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'],
  data: [4, 5, 3, 7, 12, 18],
}

const MOCK_PRIORITY_ALERT_QUEUE = [
  { id: 'PAQ-001', title: 'Suspected acute watery diarrhea cluster', location: 'Dagahaley, Dadaab - Block B4', status: 'pending', affected: 14, risk: 87 },
  { id: 'PAQ-002', title: 'Acute Watery Diarrhea Cluster', location: 'Dagahaley, Dadaab', status: 'critical', affected: 12, risk: 94 },
  { id: 'PAQ-003', title: 'Measles Suspected Cases', location: 'Kalobeyei Zone 1', status: 'pending', affected: 5, risk: 90 },
]

export async function getSurveillanceOfficerStats() {
  return MOCK_SURVEILLANCE_OFFICER_STATS
}

export async function getSignalTrend() {
  return MOCK_SIGNAL_TREND
}

export async function getPriorityAlertQueue() {
  return MOCK_PRIORITY_ALERT_QUEUE
}

/*
|--------------------------------------------------------------------------
| Alerts & Signals
|--------------------------------------------------------------------------
|
| Backed by mock data for now. Once a "Signal Alert" DocType exists on the
| Frappe side, swap the body of getAlertsSignals() for a getList() call
| returning the same field shape - the Alerts & Signals page does its
| search/filter/pagination client-side, so no changes needed there.
*/

const ALERT_TEMPLATES = [
  {
    title: 'Acute Watery Diarrhea Cluster', description: '12 cases of AWD reported in Dagahaley section over 48 hours. AI anomaly detection flagged 3.2x baseline.', location: 'Dagahaley, Dadaab', region: 'Dadaab', severity: 'critical', status: 'Pending', affected: 12, aiScore: 94,
    reportedBy: 'CHP Ahmed Abdi', tags: ['Diarrhea', 'Vomiting', 'Dehydration'],
    insights: ['Symptom cluster matches ICD-11: A09 (Infectious gastroenteritis)', '3.2x baseline incidence for this location and timeframe', 'Correlation with water quality reports from last week', 'Recommended action: Immediate verification & water testing'],
    relatedAlerts: [{ title: 'AWD Cluster - Ifo', subtitle: '5 cases, 3 days ago' }, { title: 'Water Quality Alert', subtitle: 'Dagahaley, 1 week ago' }],
  },
  {
    title: 'Measles Suspected Cases', description: '5 children with fever and rash in Kalobeyei Zone 1. Requires urgent verification.', location: 'Kalobeyei Zone 1', region: 'Kalobeyei', severity: 'high', status: 'Resolved', affected: 5, aiScore: 87,
    reportedBy: 'CHP Grace Wanjiru', tags: ['Fever', 'Rash', 'Cough'],
    insights: ['Symptom cluster matches ICD-11: 1F03 (Measles)', 'Vaccination coverage in area below 80% threshold', 'No prior measles cases in this zone in past 6 months', 'Recommended action: Case isolation & vaccination campaign'],
    relatedAlerts: [{ title: 'Measles Cluster - Zone 2', subtitle: '3 cases, 2 weeks ago' }],
  },
  {
    title: 'Malaria Outbreak - Resolved', description: 'Confirmed malaria cases successfully contained. All patients treated.', location: 'Ifo Camp', region: 'Ifo', severity: 'medium', status: 'Investigating', affected: 8, aiScore: 76,
    reportedBy: 'Dr. Peter Otieno', tags: ['Fever', 'Chills', 'Headache'],
    insights: ['Symptom cluster matches ICD-11: 1F40 (Malaria)', 'Seasonal increase consistent with rainy season pattern', 'All confirmed cases responded to first-line treatment', 'Recommended action: Continue bed net distribution'],
    relatedAlerts: [{ title: 'Malaria Cluster - Ifo Block A', subtitle: '4 cases, 1 month ago' }],
  },
  {
    title: 'Respiratory Illness Increase', description: 'Elevated reports of cough and breathing difficulty. Monitoring for COVID-19/TB.', location: 'Dagahaley, Dadaab', region: 'Dadaab', severity: 'low', status: 'Rejected', affected: 12, aiScore: 94,
    reportedBy: 'CHP Ahmed Abdi', tags: ['Cough', 'Breathing Difficulty'],
    insights: ['Symptom cluster inconsistent with outbreak thresholds', 'Seasonal dust levels likely contributing factor', 'No epidemiological link between reported cases found', 'Recommended action: Continue routine monitoring'],
    relatedAlerts: [{ title: 'Respiratory Alert - Ifo', subtitle: '6 cases, 2 months ago' }],
  },
  {
    title: 'Cholera Suspected Cluster', description: 'Reports of severe dehydration and vomiting in Hagadera block C2. Verification pending.', location: 'Hagadera, Dadaab', region: 'Dadaab', severity: 'critical', status: 'Pending', affected: 9, aiScore: 91,
    reportedBy: 'CHP Fatuma Noor', tags: ['Dehydration', 'Vomiting', 'Diarrhea'],
    insights: ['Symptom cluster matches ICD-11: 1A00 (Cholera)', '2.8x baseline incidence for this location and timeframe', 'Correlation with recent latrine overflow reports', 'Recommended action: Immediate verification & water testing'],
    relatedAlerts: [{ title: 'AWD Cluster - Dagahaley', subtitle: '12 cases, 5 days ago' }],
  },
  {
    title: 'Malnutrition Spike', description: 'Rising MUAC screening failures among under-5 children this week.', location: 'Kalobeyei Zone 2', region: 'Kalobeyei', severity: 'medium', status: 'Investigating', affected: 15, aiScore: 68,
    reportedBy: 'Nutritionist Sarah Lokuru', tags: ['Wasting', 'Low MUAC', 'Appetite Loss'],
    insights: ['MUAC failure rate up 40% versus monthly average', 'Correlated with recent reduction in food ration size', 'Concentrated among children aged 6-24 months', 'Recommended action: Targeted supplementary feeding'],
    relatedAlerts: [{ title: 'Malnutrition Spike - Zone 1', subtitle: '9 cases, 3 weeks ago' }],
  },
]

const ALERT_DATES = ['2/12/2026', '2/11/2026', '2/10/2026', '2/9/2026', '2/8/2026', '2/7/2026']

function buildMockAlertsSignals(count = 50) {
  return Array.from({ length: count }, (_, i) => {
    const template = ALERT_TEMPLATES[i % ALERT_TEMPLATES.length]
    return {
      id: `ALT-${String(i + 1).padStart(3, '0')}`,
      ...template,
      date: ALERT_DATES[i % ALERT_DATES.length],
      notes: [],
    }
  })
}

const MOCK_ALERTS_SIGNALS = buildMockAlertsSignals(50)

export async function getAlertsSignals(opts = {}) {
  return MOCK_ALERTS_SIGNALS.slice(opts.start || 0, (opts.start || 0) + (opts.limit || MOCK_ALERTS_SIGNALS.length))
}

export async function getAlertRegions() {
  return [...new Set(MOCK_ALERTS_SIGNALS.map((a) => a.region))].sort()
}

export async function getAlertSignal(id) {
  const alert = MOCK_ALERTS_SIGNALS.find((a) => a.id === id)
  if (!alert) throw new Error('Alert not found')
  return alert
}

export async function updateAlertStatus(id, status) {
  const alert = MOCK_ALERTS_SIGNALS.find((a) => a.id === id)
  if (!alert) throw new Error('Alert not found')
  alert.status = status
  return alert
}

export async function addAlertNote(id, note) {
  const alert = MOCK_ALERTS_SIGNALS.find((a) => a.id === id)
  if (!alert) throw new Error('Alert not found')
  const entry = { text: note, createdAt: new Date().toISOString() }
  alert.notes = [...(alert.notes || []), entry]
  return entry
}

/*
|--------------------------------------------------------------------------
| Data Explorer
|--------------------------------------------------------------------------
|
| Backed by mock data for now. Once a searchable "Surveillance Record"
| DocType exists on the Frappe side, swap the body of getDataExplorerRecords()
| for a getList() call, e.g.
|
|   return getList('Surveillance Record',
|     ['name', 'title', 'disease', 'region', 'severity', 'status', 'risk_score'],
|     { limit: opts.limit || 500, start: opts.start || 0, orderBy: 'creation desc' })
|
| The Data Explorer page does all of its search/filter/pagination/charting
| client-side, so the return shape (an array of the fields below) is all
| that needs to stay the same.
*/

const DATA_EXPLORER_TEMPLATES = [
  { title: 'Cholera cluster', disease: 'Cholera', region: 'Dadaab', severity: 'critical', status: 'unverified' },
  { title: 'Measles cluster', disease: 'Measles', region: 'Kalobeyei', severity: 'high', status: 'investigating' },
  { title: 'Malaria cluster', disease: 'Malaria', region: 'Garissa', severity: 'medium', status: 'verified' },
  { title: 'Watery Diarrhea', disease: 'Diarrhea', region: 'Turkana', severity: 'low', status: 'closed' },
  { title: 'Dengue cluster', disease: 'Dengue', region: 'Wajir', severity: 'critical', status: 'unverified' },
  { title: 'Cholera cluster', disease: 'Cholera', region: 'Dadaab', severity: 'medium', status: 'investigating' },
  { title: 'Respiratory outbreak', disease: 'Respiratory', region: 'Mombasa', severity: 'high', status: 'verified' },
  { title: 'Fever cluster', disease: 'Fever', region: 'Nairobi', severity: 'low', status: 'unverified' },
  { title: 'AWD cluster', disease: 'AWD', region: 'Garissa', severity: 'critical', status: 'investigating' },
  { title: 'Malaria cluster', disease: 'Malaria', region: 'Turkana', severity: 'medium', status: 'closed' },
]

function buildMockDataExplorerRecords(count = 50) {
  return Array.from({ length: count }, (_, i) => {
    const template = DATA_EXPLORER_TEMPLATES[i % DATA_EXPLORER_TEMPLATES.length]
    return {
      name: `RPT-${String(i + 1).padStart(3, '0')}`,
      ...template,
      riskScore: 30 + ((i * 17) % 70),
    }
  })
}

const MOCK_DATA_EXPLORER_RECORDS = buildMockDataExplorerRecords(50)

export async function getDataExplorerRecords(opts = {}) {
  return MOCK_DATA_EXPLORER_RECORDS.slice(opts.start || 0, (opts.start || 0) + (opts.limit || MOCK_DATA_EXPLORER_RECORDS.length))
}

/*
|--------------------------------------------------------------------------
| AI Governance & Monitoring Dashboard (Data & AI Administrator)
|--------------------------------------------------------------------------
|
| Backed by mock data for now. Each function resolves the exact shape the
| AiGovernanceDashboard page expects, so swapping in real data later just
| means replacing the function body with a fetch/getList call that
| resolves to the same shape - no changes needed in the page.
*/

const MOCK_AI_GOVERNANCE_STATS = [
  { key: 'models_in_service', label: 'Models in service', value: '4', icon: 'Sparkles' },
  { key: 'avg_accuracy', label: 'Avg. accuracy', value: '88%', icon: 'LineChart' },
  { key: 'human_override_rate', label: 'Human override rate', value: '12%', icon: 'ThumbsDown' },
  { key: 'since_last_retrain', label: 'Since last retrain', value: '9 Days', icon: 'RefreshCw' },
]

const MOCK_MODEL_REGISTRY = [
  { name: 'Signal Extraction (NLP/NER)', version: 'v2.3', status: 'Production', accuracy: 91, precision: 0.89, recall: 0.86, drift: 'Low', lastRetrained: '2026-06-14' },
  { name: 'Alert Risk Scoring', version: 'v1.8', status: 'Production', accuracy: 88, precision: 0.85, recall: 0.90, drift: 'Low', lastRetrained: '2026-05-30' },
  { name: 'Anomaly Detection', version: 'v3.1', status: 'Production', accuracy: 84, precision: 0.80, recall: 0.87, drift: 'Moderate', lastRetrained: '2026-07-02' },
  { name: 'Outbreak Forecasting', version: 'v1.9', status: 'Shadow', accuracy: 79, precision: 0.76, recall: 0.82, drift: 'Monitoring', lastRetrained: '2026-07-18' },
]

const MOCK_CONFIDENCE_DISTRIBUTION = {
  labels: ['50-60%', '60-70%', '70-80%', '80-90%', '90-100%'],
  data: [12, 24, 41, 58, 33],
}

const MOCK_COMPOSITE_PERFORMANCE = {
  labels: ['Accuracy', 'Precision', 'Recall', 'Timeliness', 'Explainability'],
  data: [88, 85, 87, 90, 72],
}

export async function getAiGovernanceStats() {
  return MOCK_AI_GOVERNANCE_STATS
}

export async function getModelRegistry() {
  return MOCK_MODEL_REGISTRY
}

export async function getConfidenceDistribution() {
  return MOCK_CONFIDENCE_DISTRIBUTION
}

export async function getCompositePerformance() {
  return MOCK_COMPOSITE_PERFORMANCE
}

// --- Reference data lookups (Region, Symptom) — always readable regardless of role ---
let referenceLabelsCache = null
export async function getReferenceLabels() {
  if (referenceLabelsCache) return referenceLabelsCache
  const res = await fetch('/api/method/surveillance.surveillance.api.get_reference_labels')
  const data = await res.json()
  referenceLabelsCache = data.message || { regions: {}, symptoms: {} }
  return referenceLabelsCache
}

export async function getAuditLogs(opts = {}) {
  const res = await fetch(`/api/method/surveillance.surveillance.api.get_audit_logs?limit=${opts.limit || 500}`)
  const data = await res.json()
  return data.message || []
}

// --- Case Report (health signal) CRUD ---
export async function getReport(name) {
  return getDoc('Case Report', name)
}

export async function createReport(fields) {
  return insertDoc({ doctype: 'Case Report', ...fields })
}

export async function updateReport(name, fields) {
  return updateDoc('Case Report', name, fields)
}

export async function deleteReport(name) {
  return deleteDoc('Case Report', name)
}

export async function getMyProfile() {
  const res = await fetch('/api/method/surveillance.surveillance.api.get_my_profile')
  const data = await res.json()
  return data.message || { name: '', full_name: '', phone_number: '' }
}

export async function uploadFile(file, isPrivate = 1) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('is_private', isPrivate)

  const res = await fetch('/api/method/upload_file', {
    method: 'POST',
    headers: { 'X-Frappe-CSRF-Token': window.FRAPPE_CSRF_TOKEN || '' },
    body: formData,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.exception || 'File upload failed')
  }
  const data = await res.json()
  return data.message.file_url
}
