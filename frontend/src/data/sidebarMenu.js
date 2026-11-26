// Full app menu (System Administrator and other admins): "KRCS Main Menu Re-Organization" (13 Nov 2026), as a flat list with
// the document's groups as headings (flat list, KRCS 16 Nov 2026). soon: shown as "Soon" with no link (not built yet).
// query / hash open one tab or section of a page. Items may also have children (a group that opens and closes).
export const SIDEBAR_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
    { label: 'My Tasks', icon: 'ClipboardCheck', page: 'my-tasks', requiresCapability: 'receive_tasks' },
  ]},
  { section: 'SURVEILLANCE AND RESPONSE', items: [
    { label: 'Signals Captured', icon: 'FileText', page: 'reports', requiresCapability: ['view_reports', 'view_own_reports'] },
    { label: 'Review Queue', icon: 'BellRing', page: 'alerts-signals', requiresCapability: 'view_review_queue' },
    // every referral in the user's area, ongoing or done; cases ready to close are closed here (KRCS 17 Nov 2026)
    { label: 'Referrals', icon: 'ArrowRightLeft', page: 'referrals-overview', requiresCapability: 'view_review_queue' },
  ]},
  { section: 'DATA AND INSIGHTS', items: [
    { label: 'KRCS Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: ['use_knowledge_base', 'manage_knowledge_base', 'ask_surveillance_data'] },
    // back in the menu, for the user's own area from CHA up (KRCS 26 Nov 2026)
    { label: 'Data Explorer', icon: 'TableProperties', page: 'data-explorer', requiresCapability: 'view_data_explorer' },
    { label: 'Monitoring Reports', icon: 'FileBarChart', page: 'monitoring-reports', requiresCapability: ['monitoring_r34', 'monitoring_r35', 'monitoring_r36', 'monitoring_r37', 'monitoring_r38', 'monitoring_r39', 'monitoring_r40', 'monitoring_r40b'] },
    { label: 'Data Quality Monitoring', icon: 'CircleDashed', page: 'data-quality', requiresCapability: 'view_data_quality' },
  ]},
  { section: 'DATA MANAGEMENT', items: [
    { label: 'Response Protocols', icon: 'Layers', page: 'response-protocols', requiresCapability: 'view_response_protocols' },
    { label: 'MOH 505 Facility Reports', icon: 'FileSpreadsheet', page: 'facility-data', requiresCapability: 'upload_facility_data' },
    { label: 'Context Data', icon: 'CloudSun', page: 'context-data', requiresCapability: ['view_context_data', 'manage_context_data'] },
  ]},
  { section: 'SYSTEM SETTINGS', items: [
    { label: 'AI Risk Engine', icon: 'Wand2', page: 'settings', query: 'tab=ai-config', requiresCapability: 'settings_ai_config' },
    { label: 'AI Performance', icon: 'Gauge', page: 'ai-performance', requiresCapability: 'view_ai_performance' },   // KRCS 26 Nov 2026
    { label: 'AI Knowledge Base', icon: 'BookOpen', page: 'knowledge-base', requiresCapability: ['view_knowledge_base', 'manage_knowledge_base', 'approve_knowledge_base'] },
    { label: 'AI Assistant Query Log', icon: 'MessagesSquare', page: 'chatbot-query-log', requiresCapability: 'view_chatbot_logs' },
    { label: 'Alert Thresholds', icon: 'Clock', page: 'settings', query: 'tab=alert-thresholds', requiresCapability: 'settings_alert_thresholds' },
    { label: 'Reporting Channels', icon: 'Radar', page: 'channels', requiresCapability: 'view_reporting_channels' },
    { label: 'Data and Database', icon: 'HardDrive', page: 'settings', query: 'tab=data', requiresCapability: 'settings_data' },
  ]},
  { section: 'SECURITY', items: [
    { label: 'Users', icon: 'Users', page: 'user-management', query: 'tab=users', requiresCapability: 'view_users' },
    { label: 'Roles & Permissions', icon: 'KeyRound', page: 'user-management', query: 'tab=roles', requiresCapability: 'view_users' },
    { label: 'CHPs in my CHU', icon: 'UsersRound', page: 'my-chps', requiresCapability: 'view_my_chps' },   // CHAs (KRCS 18 Nov 2026)
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

// CHP: the main menu like everyone else (KRCS 18 Nov 2026). Their own Referrals page takes the place of Referrals,
// with Follow-ups under it; the rest (Signals Captured, Data Assistant, Help Center) comes from the main
// menu and their permissions. Profile and password are in the account menu, top right.
export const CHP_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
  ]},
  { section: 'SURVEILLANCE AND RESPONSE', items: [
    { label: 'Referrals', icon: 'ArrowRightLeft', page: 'referrals', requiresCapability: 'receive_tasks' },
    { label: 'Follow-ups', icon: 'ClipboardList', page: 'follow-ups', requiresCapability: 'receive_tasks' },   // under Referrals (KRCS 18 Nov 2026)
  ]},
]

// Surveillance Officer workspace menu (Figma "Surveillance Officer" screens)
export const OFFICER_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
    { label: 'My Tasks', icon: 'ClipboardCheck', page: 'my-tasks', requiresCapability: 'receive_tasks' },
  ]},
]

// Facility Health Worker and CHA: their dashboard, Referrals and My Tasks. Everything else comes from their
// permissions (Roles & Permissions) and appears in the same section as in the full menu (KRCS, 16 Nov 2026).
export const FHW_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
    { label: 'Referrals', icon: 'ArrowRightLeft', page: 'referrals', requiresCapability: 'receive_referrals' },
    { label: 'My Tasks', icon: 'ClipboardCheck', page: 'my-tasks', requiresCapability: 'receive_tasks' },
  ]},
]

export const CHA_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
    { label: 'Referrals', icon: 'ArrowRightLeft', page: 'referrals-overview', requiresCapability: 'receive_tasks' },   // their unit(s)
    { label: 'My Tasks', icon: 'ClipboardCheck', page: 'my-tasks', requiresCapability: 'receive_tasks' },
  ]},
]

// Data & AI Admin (KRCS 18 Nov 2026) has no menu of its own: the main menu, filtered by its permissions
export const MENUS = { full: SIDEBAR_MENU, chp: CHP_MENU, officer: OFFICER_MENU, fhw: FHW_MENU, cha: CHA_MENU }

// Pages each workspace may open (menu pages plus their detail pages). 'full' = no restriction.
export const WORKSPACE_PAGES = {
  cha: ['login', 'dashboard', 'referrals', 'referrals-overview', 'my-tasks', 'epi-trends', 'alert-detail', 'ai-data-assistant', 'feedback',
    'help-center', 'settings'],
  fhw: ['login', 'dashboard', 'epi-trends', 'alert-detail', 'reports', 'report-detail', 'record-health-signal', 'referrals', 'my-tasks',
    'ai-data-assistant', 'feedback', 'help-center', 'settings'],
  chp: ['login', 'dashboard', 'reports', 'report-detail', 'record-health-signal', 'follow-ups', 'referrals',
    'ai-data-assistant', 'feedback', 'help-center', 'settings', 'my-tasks'],
  dataai: ['login', 'dashboard', 'settings', 'help-center', 'feedback', 'ai-data-assistant'],
  officer: ['login', 'dashboard', 'alerts-signals', 'alerts-signals-detail', 'epi-trends', 'alert-detail', 'surveillance-map',
    'response', 'event-lifecycle', 'data-quality', 'analytics', 'ai-data-assistant', 'feedback', 'help-center', 'settings',
    'reports', 'report-detail', 'response-protocols', 'my-tasks', 'chatbot-query-log', 'referrals-overview'],
}

// ---------- menus follow permissions ----------
// Every workspace shows the main menu's sections in the main menu's order (KRCS 18 Nov 2026). When an admin gives a
// user an extra permission in Roles & Permissions (e.g. Knowledge Base for an officer), the page it opens appears in
// its usual place and becomes reachable, so the menu always matches what the user is allowed to do.

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
const NOT_ADDED = { chp: ['my-tasks'] }

// Every linkable item of a menu, children included (groups themselves have no page)
export const flatItems = (menu) => menu.flatMap((g) => g.items.flatMap((i) => i.children || [i])).filter((i) => i.page)

function visibleItems(items, has) {
  return items.flatMap((item) => {
    if (item.children) {
      const children = visibleItems(item.children, has)
      return children.some((c) => !c.soon) ? [{ ...item, children }] : []   // hide a group with nothing to open
    }
    return item.soon || !item.requiresCapability || has(item.requiresCapability) ? [item] : []
  })
}

/** The menu this user sees.
 * full: the whole menu, filtered by permission.
 * chp, officer, fhw, cha: the main menu filtered by permission, with their own items in place of the main-menu ones
 * (same name, or the one named in replaces), e.g. a CHP's Follow-ups where My Tasks is. */
export function menuFor(workspace, has) {
  const base = MENUS[workspace] || SIDEBAR_MENU
  const menu = base.map((g) => ({ ...g, items: visibleItems(g.items, has) })).filter((g) => g.items.length > 0)
  if (base === SIDEBAR_MENU) return menu
  const own = new Set(flatItems(base).map((i) => i.page))
  const skip = NOT_ADDED[workspace] || []
  // Same sections and order as the main menu for everyone (KRCS 18 Nov 2026): a workspace's own item takes the place
  // of the main-menu item with the same name (e.g. a CHA's Referrals); items the permissions do not allow are left
  // out, and a section with nothing left is dropped.
  const ownByLabel = new Map(flatItems(base).map((i) => [i.replaces || i.label, i]))   // replaces: takes another item's place
  const ownItems = new Set(ownByLabel.values())
  const used = new Set()
  const out = SIDEBAR_MENU.map((g) => ({
    ...g,
    items: visibleItems(g.items.map((i) => {
      const mine = ownByLabel.get(i.label)
      if (mine) used.add(i.label)
      return mine || i
    }).filter((i) => !skip.includes(i.page) && (ownItems.has(i) || !own.has(i.page))), has),
  }))
  // own items with no main-menu counterpart stay in their own section
  menu.forEach((g) => {
    const extra = g.items.filter((i) => !used.has(i.replaces || i.label))
    if (!extra.length) return
    const same = out.find((x) => x.section === g.section)
    if (same) same.items = [...same.items, ...extra]
    else out.push({ ...g, items: extra })
  })
  return out.filter((g) => g.items.some((i) => !i.soon))
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
