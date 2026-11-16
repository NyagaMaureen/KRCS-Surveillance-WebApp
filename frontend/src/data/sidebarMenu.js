// Full app menu (HQ Admin and other admins): "KRCS Main Menu Re-Organization" (13 Nov 2026), as a flat list with
// the document's groups as headings (flat list, KRCS 16 Nov 2026). soon: shown as "Soon" with no link (not built yet).
// query / hash open one tab or section of a page. Items may also have children (a group that opens and closes).
export const SIDEBAR_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
    { label: 'My Tasks', icon: 'ClipboardCheck', page: 'my-tasks', requiresCapability: 'receive_tasks' },
  ]},
  { section: 'SURVEILLANCE AND RESPONSE', items: [
    { label: 'Signals Captured', icon: 'FileText', page: 'reports', requiresCapability: 'view_reports' },
    { label: 'Review Queue', icon: 'BellRing', page: 'alerts-signals', requiresCapability: 'view_review_queue' },
  ]},
  { section: 'DATA AND INSIGHTS', items: [
    { label: 'KRCS Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: null },
    { label: 'Monitoring Reports', icon: 'FileBarChart', soon: true },
    { label: 'Data Quality', icon: 'CircleDashed', page: 'data-quality', requiresCapability: 'view_data_quality' },
  ]},
  { section: 'DATA MANAGEMENT', items: [
    { label: 'Response Protocols', icon: 'Layers', page: 'response-protocols', requiresCapability: 'view_response_protocols' },
    { label: 'MOH 505 Facility Reports', icon: 'FileSpreadsheet', page: 'facility-data', requiresCapability: 'upload_facility_data' },
    { label: 'Context Data', icon: 'CloudSun', page: 'context-data', requiresCapability: ['view_context_data', 'manage_context_data'] },
  ]},
  { section: 'SYSTEM SETTINGS', items: [
    { label: 'AI Risk Engine', icon: 'Wand2', page: 'settings', query: 'tab=ai-config', requiresCapability: 'settings_ai_config' },
    { label: 'AI Knowledge Base', icon: 'BookOpen', page: 'knowledge-base', requiresCapability: ['manage_knowledge_base', 'approve_knowledge_base'] },
    { label: 'AI Assistant Query Log', icon: 'MessagesSquare', page: 'chatbot-query-log', requiresCapability: 'view_chatbot_logs' },
    { label: 'Alert Thresholds', icon: 'Clock', page: 'settings', query: 'tab=alert-thresholds', requiresCapability: 'settings_alert_thresholds' },
    { label: 'Reporting Channels', icon: 'Radar', page: 'channels', requiresCapability: 'view_reporting_channels' },
    { label: 'Data and Database', icon: 'HardDrive', page: 'settings', query: 'tab=data', requiresCapability: 'settings_data' },
  ]},
  { section: 'SECURITY', items: [
    { label: 'Users', icon: 'Users', page: 'user-management', query: 'tab=users', requiresCapability: 'view_users' },
    { label: 'User Groups', icon: 'UsersRound', soon: true },
    { label: 'Roles & Permissions', icon: 'KeyRound', page: 'user-management', query: 'tab=roles', requiresCapability: 'view_users' },
    { label: 'Audit Log', icon: 'ClipboardList', page: 'audit-log', requiresCapability: 'view_audit_log' },
    { label: 'Security Settings', icon: 'Lock', page: 'settings', query: 'tab=security', requiresCapability: 'settings_security' },
  ]},
  { section: 'HELP CENTER', items: [
    { label: 'Contact Us', icon: 'Phone', page: 'help-center', hash: 'contact', requiresCapability: null },
    { label: 'FAQs', icon: 'MessageCircleQuestion', page: 'help-center', hash: 'faqs', requiresCapability: null },
    { label: 'Guides', icon: 'BookOpenText', page: 'help-center', hash: 'guides', requiresCapability: null },
    { label: 'Video Tutorials', icon: 'PlaySquare', page: 'help-center', hash: 'videos', requiresCapability: null },
    { label: 'Feedback', icon: 'MessageSquareWarning', page: 'feedback', requiresCapability: null },
    { label: 'Feedback Received', icon: 'Inbox', page: 'settings', query: 'tab=feedback', requiresCapability: 'view_feedback' },
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

// Every linkable item of a menu, children included (groups themselves have no page)
export const flatItems = (menu) => menu.flatMap((g) => g.items.flatMap((i) => i.children || [i])).filter((i) => i.page)

const itemKey = (i) => `${i.page}?${i.query || ''}#${i.hash || ''}`

function visibleItems(items, has) {
  return items.flatMap((item) => {
    if (item.children) {
      const children = visibleItems(item.children, has)
      return children.some((c) => !c.soon) ? [{ ...item, children }] : []   // hide a group with nothing to open
    }
    return item.soon || !item.requiresCapability || has(item.requiresCapability) ? [item] : []
  })
}

/** The menu this user sees: their workspace menu plus any page their permissions add. */
export function menuFor(workspace, has) {
  const base = MENUS[workspace] || SIDEBAR_MENU
  const menu = base.map((g) => ({ ...g, items: visibleItems(g.items, has) })).filter((g) => g.items.length > 0)
  if (base === SIDEBAR_MENU) return menu
  const inMenu = new Set(flatItems(base).map((i) => i.page))
  const seen = new Set()
  const extra = flatItems(SIDEBAR_MENU)
    .filter((i) => i.requiresCapability && !inMenu.has(i.page) && !(NOT_ADDED[workspace] || []).includes(i.page) && has(i.requiresCapability))
    .filter((i) => !seen.has(itemKey(i)) && seen.add(itemKey(i)))
  return extra.length ? [...menu, { section: 'MORE', items: extra }] : menu
}

/** Pages this user may open, or null for no restriction (full menu). */
export function pagesFor(workspace, has) {
  const fixed = WORKSPACE_PAGES[workspace]
  if (!fixed) return null
  const pages = new Set([...fixed, 'profile', 'change-password', 'notifications'])   // account menu, top right
  flatItems(menuFor(workspace, has)).forEach((i) => {
    pages.add(i.page)
    ;(LINKED_PAGES[i.page] || []).forEach((p) => pages.add(p))
  })
  Object.entries(CAPABILITY_PAGES).forEach(([cap, list]) => { if (has(cap)) list.forEach((p) => pages.add(p)) })
  return pages
}
