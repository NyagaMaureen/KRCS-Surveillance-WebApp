export const SIDEBAR_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard', requiresCapability: null },
  ]},
  { section: 'FIELD ACTIVITIES', items: [
    { label: 'Case Management', icon: 'Folder', page: 'case-management', requiresCapability: null },
    { label: 'Reports', icon: 'FileText', page: 'reports', requiresCapability: 'View Reports' },
    { label: 'Response Protocols', icon: 'Layers', page: 'response-protocols', requiresCapability: null },
  ]},
  { section: 'LIVE MONITORING', items: [
    { label: 'Surveillance Map', icon: 'Map', page: 'surveillance-map', requiresCapability: null },
    { label: 'Alerts & Signals', icon: 'Radio', page: 'alerts-signals', requiresCapability: null },
  ]},
  { section: 'DATA & INTELLIGENCE', items: [
    { label: 'Data Explorer', icon: 'FileSearch', page: 'data-explorer', requiresCapability: null },
    { label: 'Analytics', icon: 'TrendingUp', page: 'analytics', requiresCapability: null },
    { label: 'AI Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant', requiresCapability: null },
  ]},
  { section: 'COMMUNICATION', items: [
    { label: 'Channels', icon: 'Radar', page: 'channels', requiresCapability: null },
  ]},
  { section: 'GOVERNANCE & CONTROL', items: [
    { label: 'User Management', icon: 'Users', page: 'user-management', requiresCapability: null },
    { label: 'Audit Log', icon: 'ClipboardList', page: 'audit-log', requiresCapability: null },
  ]},
  { section: 'SYSTEM', items: [
    { label: 'Settings', icon: 'Settings', page: 'settings', requiresCapability: null },
    { label: 'Help Center', icon: 'HelpCircle', page: 'help-center', requiresCapability: null },
  ]},
]