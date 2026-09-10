const BASE = ''


function getCookie(name) {
  const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)')
  return match ? decodeURIComponent(match.pop()) : null
}


export const csrfToken = () => window.FRAPPE_CSRF_TOKEN || ''
export const currentUserFullName = () => (getCookie('full_name') || 'User').replace(/^"|"$/g, '')
export const currentUserId = () => (getCookie('user_id') || '').replace(/^"|"$/g, '')

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
  const res = await fetch('/api/method/get_my_capabilities')
  const data = await res.json()
  const message = data.message || {}
  return {
    capabilities: message.capabilities || [],
    primary_role: message.primary_role || '',
  }
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
  const url = BASE + '/api/method/get_role_capabilities?role=' + encodeURIComponent(role)
  const res = await fetch(url)
  let data
  try {
    data = await res.json()
  } catch (e) {
    data = null
  }
  if (!res.ok) {
    const msg = (data && (data.exception || data.message)) || 'Failed to load role capabilities'
    throw new Error(msg)
  }
  return (data && data.message) || null
}

export async function setRoleCapability(role, capability, enabled) {
  const res = await fetch(BASE + '/api/method/set_role_capability', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken(),
    },
    body: JSON.stringify({ role: role, capability: capability, enabled: enabled }),
  })
  let data
  try {
    data = await res.json()
  } catch (e) {
    data = null
  }
  if (!res.ok) {
    const msg = (data && (data.exception || data.message)) || 'Failed to update capability'
    throw new Error(msg)
  }
  return data && data.message
}

/*
|--------------------------------------------------------------------------
| Audit Log
|--------------------------------------------------------------------------
|
| Backed by mock data for now. Once an "Audit Log" DocType exists on the
| Frappe side, swap the body of getAuditLogs() for a getList() call, e.g.
|
|   return getList('Audit Log',
|     ['name', 'timestamp', 'category', 'action', 'user', 'role', 'details', 'ip_address'],
|     { limit: opts.limit || 500, start: opts.start || 0, orderBy: 'timestamp desc' })
|
| The page consuming this function does all of its search/filter/pagination
| client-side, so the return shape (an array of the fields below) is all
| that needs to stay the same.
*/

const AUDIT_LOG_TEMPLATES = [
  { category: 'Auth', action: 'User Login', user: 'Peter Mwangi', role: 'HQ Admin', details: 'Logged in from 192.168.1.100' },
  { category: 'Alert', action: 'Alert Created', user: 'System (AI)', role: 'System', details: 'Auto-generated alert ALT-021 for cholera cluster in Dadaab' },
  { category: 'Report', action: 'Report Submitted', user: 'Amina Hassan', role: 'CHP', details: 'Report RPT-0051 submitted via Mobile App' },
  { category: 'Case', action: 'Case Status Changed', user: 'James Ochieng', role: 'Surveillance Officer', details: "CASE-003 moved from 'open' to 'investigating'" },
  { category: 'Config', action: 'Alert Threshold Updated', user: 'Peter Mwangi', role: 'HQ Admin', details: 'Critical alert threshold changed from 0.85 to 0.80' },
  { category: 'User', action: 'User Role Modified', user: 'Peter Mwangi', role: 'HQ Admin', details: 'Changed James Ochieng role: added surveillance permissions' },
  { category: 'AI', action: 'Report Verified', user: 'James Ochieng', role: 'Surveillance Officer', details: 'Report RPT-0023 verified and linked to ALT-005' },
  { category: 'Auth', action: 'User Logout', user: 'Amina Hassan', role: 'CHP', details: 'Session ended from 192.168.1.114' },
  { category: 'Report', action: 'Report Approved', user: 'Peter Mwangi', role: 'HQ Admin', details: 'Report RPT-0048 approved and archived' },
  { category: 'Config', action: 'System Backup', user: 'System', role: 'System', details: 'Nightly database backup completed successfully' },
]

function buildMockAuditLogs(count = 50) {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => {
    const template = AUDIT_LOG_TEMPLATES[i % AUDIT_LOG_TEMPLATES.length]
    return {
      name: `LOG-${String(count - i).padStart(4, '0')}`,
      timestamp: new Date(now - i * 60 * 60 * 1000).toISOString(),
      ...template,
    }
  })
}

const MOCK_AUDIT_LOGS = buildMockAuditLogs(50)

export async function getAuditLogs(opts = {}) {
  return MOCK_AUDIT_LOGS.slice(opts.start || 0, (opts.start || 0) + (opts.limit || MOCK_AUDIT_LOGS.length))
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
| that resolves to the same shape - no changes needed in Analytics.vue.
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

// --- Reference data lookups (Region, Symptom) — always readable regardless of role ---
let referenceLabelsCache = null
export async function getReferenceLabels() {
  if (referenceLabelsCache) return referenceLabelsCache
  const res = await fetch('/api/method/surveillance.surveillance.api.get_reference_labels')
  const data = await res.json()
  referenceLabelsCache = data.message || { regions: {}, symptoms: {} }
  return referenceLabelsCache
}