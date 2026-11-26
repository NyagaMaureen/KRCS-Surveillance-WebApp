import { MENUS, flatItems } from '../data/sidebarMenu'

import Login from '../pages/Login'
import ResetPassword from '../pages/ResetPassword'
import KbDocumentView from '../pages/KbDocumentView'
import Analytics from '../pages/Analytics'
import DataExplorer from '../pages/DataExplorer'
import AiPerformance from '../pages/AiPerformance'
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
import ChatbotQueryLog from '../pages/ChatbotQueryLog'
import SurveillanceDashboard from '../pages/SurveillanceDashboard'
import AiGovernanceDashboard from '../pages/AiGovernanceDashboard'
import Investigations from '../pages/Investigations'
import Response from '../pages/Response'
import ResponseProtocols from '../pages/ResponseProtocols'
import EventLifecycle from '../pages/EventLifecycle'
import EpiTrends from '../pages/EpiTrends'
import AlertDetail from '../pages/AlertDetail'
import AlertsSignalsQueue from '../pages/AlertsSignalsQueue'
import EventDetail from '../pages/EventDetail'
import SurveillanceMap from '../pages/SurveillanceMap'
import FacilityData from '../pages/FacilityData'
import ContextData from '../pages/ContextData'
import MyTasks from '../pages/MyTasks'
import FollowUps from '../pages/FollowUps'
import Referrals from '../pages/Referrals'
import Feedback from '../pages/Feedback'
import FeedbackInbox from '../pages/FeedbackInbox'
import ChpDashboard from '../pages/ChpDashboard'
import ChpSettings from '../pages/ChpSettings'
import DataAiDashboard from '../pages/DataAiDashboard'
import MyChps from '../pages/MyChps'
import FacilityReferrals from '../pages/FacilityReferrals'
import ReferralsOverview from '../pages/ReferralsOverview'
import DataQuality from '../pages/DataQuality'
import FullDashboard from '../pages/FullDashboard'
import HqDashboard from '../pages/HqDashboard'
import NotificationSettings from '../pages/NotificationSettings'
import MonitoringReports from '../pages/MonitoringReports'
import { useCapabilities } from '../context/CapabilitiesContext'

// One URL, a different page per workspace (CHP gets the simple version)
function byWorkspace(pages) {
  return function WorkspacePage() {
    const { workspace } = useCapabilities()
    const Page = pages[workspace] || pages.full
    return <Page />
  }
}

const rawRoutes = [
  { path: '/login', name: 'login', element: Login },
  { path: '/reset-password', name: 'reset-password', element: ResetPassword },   // public: the link in the reset email
  { path: '/kb-document/:id', name: 'kb-document', element: KbDocumentView },   // Knowledge Base View (Word), own tab
  { path: '/dashboard', name: 'dashboard', element: byWorkspace({ full: FullDashboard, chp: ChpDashboard, officer: HqDashboard, fhw: HqDashboard, cha: HqDashboard, dataai: DataAiDashboard }) },
  { path: '/surveillance-dashboard', name: 'surveillance-dashboard', element: SurveillanceDashboard },
  { path: '/ai-governance-dashboard', name: 'ai-governance-dashboard', element: AiGovernanceDashboard },
  { path: '/investigations', name: 'investigations', element: Investigations },
  { path: '/response', name: 'response', element: Response },
  { path: '/response-protocols', name: 'response-protocols', element: ResponseProtocols },
  { path: '/event-lifecycle', name: 'event-lifecycle', element: EventLifecycle },
  { path: '/epi-trends', name: 'epi-trends', element: EpiTrends },
  { path: '/epi-trends/:id', name: 'alert-detail', element: AlertDetail },
  { path: '/alerts-signals', name: 'alerts-signals', element: AlertsSignalsQueue },
  { path: '/alerts-signals/:id', name: 'alerts-signals-detail', element: EventDetail },
  { path: '/surveillance-map', name: 'surveillance-map', element: SurveillanceMap },
  { path: '/analytics', name: 'analytics', element: Analytics },
  { path: '/data-explorer', name: 'data-explorer', element: DataExplorer },
  { path: '/ai-performance', name: 'ai-performance', element: AiPerformance },
  { path: '/reports', name: 'reports', element: Reports },
  { path: '/reports/:id', name: 'report-detail', element: ReportDetail },
  { path: '/record-health-signal', name: 'record-health-signal', element: RecordHealthSignal },
  { path: '/user-management', name: 'user-management', element: UserManagement },
  { path: '/channels', name: 'channels', element: Channels },
  { path: '/facility-data', name: 'facility-data', element: FacilityData },
  { path: '/context-data', name: 'context-data', element: ContextData },
  { path: '/settings', name: 'settings', element: byWorkspace({ full: Settings, chp: ChpSettings }) },   // others: Settings, showing only what their permissions allow
  { path: '/help-center', name: 'help-center', element: HelpCenter },
  // one profile page for everyone (KRCS 18 Nov 2026); Change Password opens its password section
  { path: '/profile', name: 'profile', element: ChpSettings },
  { path: '/change-password', name: 'change-password', element: ChpSettings },
  { path: '/notifications', name: 'notifications', element: NotificationSettings },
  { path: '/audit-log', name: 'audit-log', element: AuditLog },
  { path: '/ai-data-assistant', name: 'ai-data-assistant', element: AiDataAssistant },
  { path: '/knowledge-base', name: 'knowledge-base', element: KnowledgeBase },
  { path: '/chatbot-query-log', name: 'chatbot-query-log', element: ChatbotQueryLog },
  { path: '/my-tasks', name: 'my-tasks', element: MyTasks },
  { path: '/data-quality', name: 'data-quality', element: DataQuality },
  { path: '/monitoring-reports', name: 'monitoring-reports', element: MonitoringReports },
  { path: '/follow-ups', name: 'follow-ups', element: FollowUps },
  { path: '/referrals', name: 'referrals', element: byWorkspace({ full: Referrals, fhw: FacilityReferrals }) },
  { path: '/referrals-overview', name: 'referrals-overview', element: ReferralsOverview },
  { path: '/my-chps', name: 'my-chps', element: MyChps },
  { path: '/feedback', name: 'feedback', element: Feedback },
  { path: '/feedback-inbox', name: 'feedback-inbox', element: FeedbackInbox },
]

// A page is open to anyone holding the capability it needs in ANY menu (e.g. Reports: view_reports or view_own_reports).
// A page listed without a capability in some menu stays open to everyone.
const CAPABILITY_BY_PAGE = {}
const OPEN_PAGES = new Set()
Object.values(MENUS).flatMap((menu) => flatItems(menu)).forEach((item) => {
  if (!item.requiresCapability) OPEN_PAGES.add(item.page)
  else [].concat(item.requiresCapability).forEach((c) => (CAPABILITY_BY_PAGE[item.page] = CAPABILITY_BY_PAGE[item.page] || new Set()).add(c))
})
CAPABILITY_BY_PAGE['report-detail'] = CAPABILITY_BY_PAGE.reports
// pages no longer in the main menu (now dashboard tabs, or removed for now) keep needing their permission
const OFF_MENU = { analytics: 'view_analytics', 'surveillance-map': 'view_surveillance_map',
  'epi-trends': 'view_alerts', response: 'view_review_queue', 'event-lifecycle': 'view_review_queue' }
Object.entries(OFF_MENU).forEach(([page, cap]) => {
  if (!OPEN_PAGES.has(page) && !CAPABILITY_BY_PAGE[page]) CAPABILITY_BY_PAGE[page] = new Set([cap])
})

export const routes = rawRoutes.map((route) => ({
  ...route,
  requiresCapability: !OPEN_PAGES.has(route.name) && CAPABILITY_BY_PAGE[route.name] ? [...CAPABILITY_BY_PAGE[route.name]] : null,
}))
