// Full app menu (officers, admins). Items are filtered by capability.
export const SIDEBAR_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
    { label: 'My Tasks', icon: 'ClipboardCheck', page: 'my-tasks', requiresCapability: 'receive_tasks' },
  ]},
  { section: 'FIELD ACTIVITIES', items: [
    { label: 'Signals Captured', icon: 'FileText', page: 'reports', requiresCapability: 'view_reports' },
    { label: 'Review Queue', icon: 'BellRing', page: 'alerts-signals', requiresCapability: 'view_review_queue' },
    { label: 'Epi Trends', icon: 'TrendingUp', page: 'epi-trends', requiresCapability: 'view_alerts' },
    { label: 'Surveillance Map', icon: 'Map', page: 'surveillance-map', requiresCapability: 'view_surveillance_map' },
  ]},
  { section: 'RESPONSE', items: [
    { label: 'Response Protocols', icon: 'Layers', page: 'response-protocols', requiresCapability: 'view_response_protocols' },
    { label: 'Response', icon: 'MessageSquareShare', page: 'response', requiresCapability: 'view_review_queue' },
    { label: 'Event Lifecycle', icon: 'LifeBuoy', page: 'event-lifecycle', requiresCapability: 'view_review_queue' },
    { label: 'Knowledge Base', icon: 'BookOpen', page: 'knowledge-base', requiresCapability: ['manage_knowledge_base', 'approve_knowledge_base'] },
    { label: 'KRCS Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: null },
    { label: 'Chatbot Query Log', icon: 'MessagesSquare', page: 'chatbot-query-log', requiresCapability: 'view_chatbot_logs' },
  ]},
  { section: 'DATA', items: [
    { label: 'Analytics', icon: 'BarChart3', page: 'analytics', requiresCapability: 'view_analytics' },
    { label: 'Data Explorer', icon: 'FileSearch', page: 'data-explorer', requiresCapability: 'view_analytics' },
    { label: 'Reporting Channels', icon: 'Radar', page: 'channels', requiresCapability: 'view_reporting_channels' },
    { label: 'MOH 505 Facility Reports', icon: 'FileSpreadsheet', page: 'facility-data', requiresCapability: 'upload_facility_data' },
    { label: 'Context Data', icon: 'CloudSun', page: 'context-data', requiresCapability: ['view_context_data', 'manage_context_data'] },
  ]},
  { section: 'ADMINISTRATION', items: [
    { label: 'User Management', icon: 'Users', page: 'user-management', requiresCapability: 'view_users' },
    { label: 'Data Quality', icon: 'CircleDashed', page: 'data-quality', requiresCapability: 'view_data_quality' },
    { label: 'Audit Log', icon: 'ClipboardList', page: 'audit-log', requiresCapability: 'view_audit_log' },
    { label: 'Settings', icon: 'Settings', page: 'settings', requiresCapability: null },
    { label: 'Help Center', icon: 'HelpCircle', page: 'help-center', requiresCapability: null },
  ]},
]

// CHP workspace menu (Figma "CHP" screens). Only these pages are reachable for CHPs.
export const CHP_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
  ]},
  { section: 'REPORTING', items: [
    { label: 'Signals Captured', icon: 'FileText', page: 'reports', requiresCapability: 'view_own_reports' },
  ]},
  { section: 'MY WORK', items: [
    { label: 'Follow-ups', icon: 'ClipboardList', page: 'follow-ups', requiresCapability: 'receive_tasks' },
    { label: 'Referrals', icon: 'ArrowRightLeft', page: 'referrals', requiresCapability: 'receive_tasks' },
  ]},
  { section: 'KNOWLEDGE ASSISTANT', items: [
    { label: 'KRCS Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: null },
  ]},
  { section: 'SUPPORT', items: [
    { label: 'Feedback', icon: 'MessageSquareWarning', page: 'feedback', requiresCapability: null },
    { label: 'Help Center', icon: 'HelpCircle', page: 'help-center', requiresCapability: null },
  ]},
  { section: 'SYSTEM', items: [
    { label: 'Settings', icon: 'Settings', page: 'settings', requiresCapability: null },
  ]},
]

// Surveillance Officer workspace menu (Figma "Surveillance Officer" screens)
export const OFFICER_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
  ]},
  { section: 'FIELD ACTIVITIES', items: [
    { label: 'Signals Captured', icon: 'FileText', page: 'reports', requiresCapability: ['create_reports', 'view_reports', 'view_own_reports'] },
  ]},
  { section: 'LIVE MONITORING', items: [
    { label: 'Review Queue', icon: 'BellRing', page: 'alerts-signals', requiresCapability: 'view_review_queue' },
    { label: 'Epi Trends', icon: 'TrendingUp', page: 'epi-trends', requiresCapability: 'view_alerts' },
    { label: 'Surveillance Map', icon: 'Map', page: 'surveillance-map', requiresCapability: 'view_surveillance_map' },
  ]},
  { section: 'OPERATIONS', items: [
    { label: 'Response', icon: 'MessageSquareShare', page: 'response', requiresCapability: 'view_review_queue' },
    { label: 'Event Lifecycle', icon: 'LifeBuoy', page: 'event-lifecycle', requiresCapability: 'view_review_queue' },
    { label: 'Chatbot Query Log', icon: 'MessagesSquare', page: 'chatbot-query-log', requiresCapability: 'view_chatbot_logs' },
  ]},
  { section: 'ANALYTICS', items: [
    { label: 'Data Quality', icon: 'CircleDashed', page: 'data-quality', requiresCapability: 'view_data_quality' },
    { label: 'Trends', icon: 'Activity', page: 'analytics', requiresCapability: 'view_analytics' },
  ]},
  { section: 'KNOWLEDGE ASSISTANT', items: [
    { label: 'KRCS Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: null },
  ]},
  { section: 'SUPPORT', items: [
    { label: 'Feedback', icon: 'MessageSquareWarning', page: 'feedback', requiresCapability: null },
    { label: 'Help Center', icon: 'HelpCircle', page: 'help-center', requiresCapability: null },
  ]},
  { section: 'SYSTEM', items: [
    { label: 'Settings', icon: 'Settings', page: 'settings', requiresCapability: null },
  ]},
]

// Facility Health Worker workspace: report when the EMR is down, referrals to my facility, alerts nearby
export const FHW_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
  ]},
  { section: 'LIVE MONITORING', items: [
    { label: 'Epi Trends', icon: 'TrendingUp', page: 'epi-trends', requiresCapability: 'view_alerts' },
  ]},
  { section: 'REPORTING', items: [
    { label: 'Signals Captured', icon: 'FileText', page: 'reports', requiresCapability: ['create_reports', 'view_own_reports'] },
  ]},
  { section: 'MY WORK', items: [
    { label: 'Referrals', icon: 'ArrowRightLeft', page: 'referrals', requiresCapability: 'receive_referrals' },
    { label: 'My Tasks', icon: 'ClipboardCheck', page: 'my-tasks', requiresCapability: 'receive_tasks' },
  ]},
  { section: 'KNOWLEDGE ASSISTANT', items: [
    { label: 'KRCS Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: null },
  ]},
  { section: 'SUPPORT', items: [
    { label: 'Feedback', icon: 'MessageSquareWarning', page: 'feedback', requiresCapability: null },
    { label: 'Help Center', icon: 'HelpCircle', page: 'help-center', requiresCapability: null },
  ]},
  { section: 'SYSTEM', items: [
    { label: 'Settings', icon: 'Settings', page: 'settings', requiresCapability: null },
  ]},
]

export const MENUS = { full: SIDEBAR_MENU, chp: CHP_MENU, officer: OFFICER_MENU, fhw: FHW_MENU }

// Pages each workspace may open (menu pages plus their detail pages). 'full' = no restriction.
export const WORKSPACE_PAGES = {
  fhw: ['login', 'dashboard', 'epi-trends', 'alert-detail', 'reports', 'report-detail', 'record-health-signal', 'referrals', 'my-tasks',
    'ai-data-assistant', 'feedback', 'help-center', 'settings'],
  chp: ['login', 'dashboard', 'reports', 'report-detail', 'record-health-signal', 'follow-ups', 'referrals',
    'ai-data-assistant', 'feedback', 'help-center', 'settings', 'my-tasks'],
  officer: ['login', 'dashboard', 'alerts-signals', 'alerts-signals-detail', 'epi-trends', 'alert-detail', 'surveillance-map',
    'response', 'event-lifecycle', 'data-quality', 'analytics', 'ai-data-assistant', 'feedback', 'help-center', 'settings',
    'reports', 'report-detail', 'response-protocols', 'my-tasks', 'chatbot-query-log'],
}

// ---------- menus follow permissions ----------
// A workspace (CHP, officer) has its own short menu. When an admin gives a user an extra permission in Roles &
// Permissions (e.g. Knowledge Base for an officer), the page it opens is added to their menu under "MORE" and the
// page becomes reachable, so the menu always matches what the user is allowed to do.

// pages that open from a menu page (details, forms)
const LINKED_PAGES = {
  reports: ['report-detail'],
  'alerts-signals': ['alerts-signals-detail'],
  'epi-trends': ['alert-detail'],
}
// pages a permission opens on its own
const CAPABILITY_PAGES = {
  create_reports: ['reports', 'report-detail', 'record-health-signal'],
}

// pages a workspace covers in its own way (CHPs see their tasks as Follow-ups and Referrals)
const NOT_ADDED = { chp: ['my-tasks'], officer: ['data-explorer'] }   // officers have Data Explorer as Trends

const visibleItems = (items, has) => items.filter((item) => !item.requiresCapability || has(item.requiresCapability))

/** The menu this user sees: their workspace menu plus any page their permissions add. */
export function menuFor(workspace, has) {
  const base = MENUS[workspace] || SIDEBAR_MENU
  const menu = base.map((g) => ({ ...g, items: visibleItems(g.items, has) })).filter((g) => g.items.length > 0)
  if (base === SIDEBAR_MENU) return menu
  const inMenu = new Set(base.flatMap((g) => g.items.map((i) => i.page)))
  const extra = SIDEBAR_MENU.flatMap((g) => g.items)
    .filter((i) => i.requiresCapability && !inMenu.has(i.page) && !(NOT_ADDED[workspace] || []).includes(i.page) && has(i.requiresCapability))
  return extra.length ? [...menu, { section: 'MORE', items: extra }] : menu
}

/** Pages this user may open, or null for no restriction (full menu). */
export function pagesFor(workspace, has) {
  const fixed = WORKSPACE_PAGES[workspace]
  if (!fixed) return null
  const pages = new Set(fixed)
  menuFor(workspace, has).forEach((g) => g.items.forEach((i) => {
    pages.add(i.page)
    ;(LINKED_PAGES[i.page] || []).forEach((p) => pages.add(p))
  }))
  Object.entries(CAPABILITY_PAGES).forEach(([cap, list]) => { if (has(cap)) list.forEach((p) => pages.add(p)) })
  return pages
}
