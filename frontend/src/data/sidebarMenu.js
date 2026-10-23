export const SIDEBAR_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
  ]},
  { section: 'FIELD ACTIVITIES', items: [
    { label: 'Reports', icon: 'FileText', page: 'reports', requiresCapability: 'view_reports' },
    { label: 'Alerts & Signals', icon: 'BellRing', page: 'alerts-signals', requiresCapability: 'view_review_queue' },
    { label: 'Epi Trends', icon: 'TrendingUp', page: 'epi-trends', requiresCapability: 'view_alerts' },
    { label: 'Surveillance Map', icon: 'Map', page: 'surveillance-map', requiresCapability: 'view_surveillance_map' },
  ]},
  { section: 'DATA & INTELLIGENCE', items: [
    { label: 'Response Protocols', icon: 'Layers', page: 'response-protocols', requiresCapability: 'view_response_protocols' },
    { label: 'Data Explorer', icon: 'FileSearch', page: 'data-explorer', requiresCapability: null },
    { label: 'Analytics', icon: 'TrendingUp', page: 'analytics', requiresCapability: 'view_analytics' },
    { label: 'AI Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: null },
    { label: 'Knowledge Base', icon: 'BookOpen', page: 'knowledge-base', requiresCapability: null },
    { label: 'Facility Data', icon: 'FileSpreadsheet', page: 'facility-data', requiresCapability: 'upload_facility_data' },

  ]},
  { section: 'COMMUNICATION', items: [
    { label: 'Channels', icon: 'Radar', page: 'channels', requiresCapability: null },
  ]},
  { section: 'GOVERNANCE & CONTROL', items: [
    { label: 'User Management', icon: 'Users', page: 'user-management', requiresCapability: 'view_users' },
    { label: 'Audit Log', icon: 'ClipboardList', page: 'audit-log', requiresCapability: 'view_audit_log' },
  ]},
  { section: 'SYSTEM', items: [
    { label: 'Settings', icon: 'Settings', page: 'settings', requiresCapability: null },
    { label: 'Help Center', icon: 'HelpCircle', page: 'help-center', requiresCapability: null },
  ]},
]
