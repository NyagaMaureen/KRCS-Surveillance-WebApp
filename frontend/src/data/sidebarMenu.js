export const SIDEBAR_MENU = [
  { section: 'OVERVIEW', items: [
    { label: 'Dashboard', icon: 'LayoutGrid', page: 'dashboard' },
  ]},
  { section: 'FIELD ACTIVITIES', items: [
    { label: 'Case Management', icon: 'Folder', page: 'case-management' },
    { label: 'Reports', icon: 'FileText', page: 'reports' },
    { label: 'Response Protocols', icon: 'Layers', page: 'response-protocols' },
  ]},
  { section: 'LIVE MONITORING', items: [
    { label: 'Surveillance Map', icon: 'Map', page: 'surveillance-map' },
    { label: 'Alerts & Signals', icon: 'Radio', page: 'alerts-signals' },
  ]},
  { section: 'DATA & INTELLIGENCE', items: [
    { label: 'Data Explorer', icon: 'FileSearch', page: 'data-explorer' },
    { label: 'Analytics', icon: 'TrendingUp', page: 'analytics' },
    { label: 'AI Data Assistant', icon: 'Sparkles', page: 'ai-data-assistant' },
  ]},
  { section: 'COMMUNICATION', items: [
    { label: 'Channels', icon: 'Radar', page: 'channels' },
  ]},
  { section: 'GOVERNANCE & CONTROL', items: [
    { label: 'User Management', icon: 'Users', page: 'user-management' },
    { label: 'Audit Log', icon: 'ClipboardList', page: 'audit-log' },
  ]},
  { section: 'SYSTEM', items: [
    { label: 'Settings', icon: 'Settings', page: 'settings' },
    { label: 'Help Center', icon: 'HelpCircle', page: 'help-center' },
  ]},
]