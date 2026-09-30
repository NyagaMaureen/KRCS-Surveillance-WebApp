export const SIDEBAR_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
  ]},
  { section: 'FIELD ACTIVITIES', items: [
    { label: 'Case Management', icon: 'Folder', page: 'case-management', requiresCapability: null },
    { label: 'Reports', icon: 'FileText', page: 'reports', requiresCapability: 'view_reports' },
    { label: 'Response Protocols', icon: 'Layers', page: 'response-protocols', requiresCapability: 'view_response_protocols' },
  ]},
  { section: 'LIVE MONITORING', items: [
    { label: 'Surveillance Map', icon: 'Map', page: 'surveillance-map', requiresCapability: 'view_surveillance_map' },
    { label: 'Alerts & Signals', icon: 'Radio', page: 'alerts-signals', requiresCapability: 'view_alerts' },
  ]},
  { section: 'DATA & INTELLIGENCE', items: [
    { label: 'Data Explorer', icon: 'FileSearch', page: 'data-explorer', requiresCapability: null },
    { label: 'Analytics', icon: 'TrendingUp', page: 'analytics', requiresCapability: 'view_analytics' },
    { label: 'AI Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: null },
    { label: 'Knowledge Base', icon: 'BookOpen', page: 'knowledge-base', requiresCapability: null },
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
