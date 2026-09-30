import { SIDEBAR_MENU } from '../data/sidebarMenu'

import Login from '../pages/Login'
import Dashboard from '../pages/Dashboard'
import Analytics from '../pages/Analytics'
import DataExplorer from '../pages/DataExplorer'
import Reports from '../pages/Reports'
import ReportDetail from '../pages/ReportDetail'
import RecordHealthSignal from '../pages/RecordHealthSignal'
import UserManagement from '../pages/UserManagement'
import Channels from '../pages/Channels'
import Settings from '../pages/Settings'
import HelpCenter from '../pages/HelpCenter'
import AuditLog from '../pages/AuditLog'
import AiDataAssistant from '../pages/AiDataAssistant'
import KnowledgeBase from '../pages/KnowledgeBase'
import SurveillanceDashboard from '../pages/SurveillanceDashboard'
import AiGovernanceDashboard from '../pages/AiGovernanceDashboard'
import Investigations from '../pages/Investigations'
import Response from '../pages/Response'
import EventLifecycle from '../pages/EventLifecycle'
import AlertsSignals from '../pages/AlertsSignals'
import AlertDetail from '../pages/AlertDetail'

const rawRoutes = [
  { path: '/login', name: 'login', element: Login },
  { path: '/dashboard', name: 'dashboard', element: Dashboard },
  { path: '/surveillance-dashboard', name: 'surveillance-dashboard', element: SurveillanceDashboard },
  { path: '/ai-governance-dashboard', name: 'ai-governance-dashboard', element: AiGovernanceDashboard },
  { path: '/investigations', name: 'investigations', element: Investigations },
  { path: '/response', name: 'response', element: Response },
  { path: '/event-lifecycle', name: 'event-lifecycle', element: EventLifecycle },
  { path: '/alerts-signals', name: 'alerts-signals', element: AlertsSignals },
  { path: '/alerts-signals/:id', name: 'alert-detail', element: AlertDetail },
  { path: '/analytics', name: 'analytics', element: Analytics },
  { path: '/data-explorer', name: 'data-explorer', element: DataExplorer },
  { path: '/reports', name: 'reports', element: Reports },
  { path: '/reports/:id', name: 'report-detail', element: ReportDetail },
  { path: '/record-health-signal', name: 'record-health-signal', element: RecordHealthSignal },
  { path: '/user-management', name: 'user-management', element: UserManagement },
  { path: '/channels', name: 'channels', element: Channels },
  { path: '/settings', name: 'settings', element: Settings },
  { path: '/help-center', name: 'help-center', element: HelpCenter },
  { path: '/audit-log', name: 'audit-log', element: AuditLog },
  { path: '/ai-data-assistant', name: 'ai-data-assistant', element: AiDataAssistant },
  { path: '/knowledge-base', name: 'knowledge-base', element: KnowledgeBase },
]

const MENU_ITEMS = SIDEBAR_MENU.flatMap((group) => group.items)
const CAPABILITY_BY_PAGE = Object.fromEntries(
  MENU_ITEMS.filter((item) => item.requiresCapability).map((item) => [item.page, item.requiresCapability])
)

export const routes = rawRoutes.map((route) => ({
  ...route,
  requiresCapability: CAPABILITY_BY_PAGE[route.name] || null,
}))
