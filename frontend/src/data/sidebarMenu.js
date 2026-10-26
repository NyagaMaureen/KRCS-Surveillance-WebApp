export const SIDEBAR_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
  ]},
  { section: 'FIELD ACTIVITIES', items: [
    { label: 'Reports', icon: 'FileText', page: 'reports', requiresCapability: 'view_reports' },
    { label: 'Review Queue', icon: 'BellRing', page: 'alerts-signals', requiresCapability: 'view_review_queue' },
    { label: 'Epi Trends', icon: 'TrendingUp', page: 'epi-trends', requiresCapability: 'view_alerts' },
    { label: 'Surveillance Map', icon: 'Map', page: 'surveillance-map', requiresCapability: 'view_surveillance_map' },
  ]},
  { section: 'RESPONSE', items: [
    { label: 'Response Protocols', icon: 'Layers', page: 'response-protocols', requiresCapability: 'view_response_protocols' },
    { label: 'Knowledge Base', icon: 'BookOpen', page: 'knowledge-base', requiresCapability: null },
    { label: 'AI Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: null },
  ]},
  { section: 'DATA', items: [
    { label: 'Analytics', icon: 'BarChart3', page: 'analytics', requiresCapability: 'view_analytics' },
    { label: 'Data Explorer', icon: 'FileSearch', page: 'data-explorer', requiresCapability: null },
    { label: 'Reporting Channels', icon: 'Radar', page: 'channels', requiresCapability: null },
    { label: 'Facility Data', icon: 'FileSpreadsheet', page: 'facility-data', requiresCapability: 'upload_facility_data' },
    { label: 'Context Data', icon: 'CloudSun', page: 'context-data', requiresCapability: null },
  ]},
  { section: 'ADMINISTRATION', items: [
    { label: 'User Management', icon: 'Users', page: 'user-management', requiresCapability: 'view_users' },
    { label: 'Audit Log', icon: 'ClipboardList', page: 'audit-log', requiresCapability: 'view_audit_log' },
    { label: 'Settings', icon: 'Settings', page: 'settings', requiresCapability: null },
    { label: 'Help Center', icon: 'HelpCircle', page: 'help-center', requiresCapability: null },
  ]},
]
