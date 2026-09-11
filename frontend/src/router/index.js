import { createRouter, createWebHistory } from 'vue-router'
import { getMyCapabilities } from '../api/frappe'
import { SIDEBAR_MENU } from '../data/sidebarMenu'
import Login from '../pages/Login.vue'
import Dashboard from '../pages/Dashboard.vue'
import Analytics from '../pages/Analytics.vue'
import DataExplorer from '../pages/DataExplorer.vue'
import Reports from '../pages/Reports.vue'
import ReportDetail from '../pages/ReportDetail.vue'
import RecordHealthSignal from '../pages/RecordHealthSignal.vue'
import UserManagement from '../pages/UserManagement.vue'
import Channels from '../pages/Channels.vue'
import Settings from '../pages/Settings.vue'
import HelpCenter from '../pages/HelpCenter.vue'
import AuditLog from '../pages/AuditLog.vue'
import AiDataAssistant from '../pages/AiDataAssistant.vue'

const routes = [
  { path: '/login', name: 'login', component: Login },
  { path: '/dashboard', name: 'dashboard', component: Dashboard },
  { path: '/analytics', name: 'analytics', component: Analytics },
  { path: '/data-explorer', name: 'data-explorer', component: DataExplorer },
  { path: '/reports', name: 'reports', component: Reports },
  { path: '/reports/:id', name: 'report-detail', component: ReportDetail },
  { path: '/record-health-signal', name: 'record-health-signal', component: RecordHealthSignal },
  { path: '/user-management', name: 'user-management', component: UserManagement },
  { path: '/channels', name: 'channels', component: Channels },
  { path: '/settings', name: 'settings', component: Settings },
  { path: '/help-center', name: 'help-center', component: HelpCenter },
  { path: '/audit-log', name: 'audit-log', component: AuditLog },
  { path: '/ai-data-assistant', name: 'ai-data-assistant', component: AiDataAssistant },
  { path: '/', redirect: '/dashboard' },
]

const router = createRouter({
  history: createWebHistory('/surveillance/'),
  routes,
})

const MENU_ITEMS = SIDEBAR_MENU.flatMap((group) => group.items)

let capabilitiesPromise = null
function loadCapabilities() {
  if (!capabilitiesPromise) {
    capabilitiesPromise = getMyCapabilities()
  }
  return capabilitiesPromise
}

router.beforeEach(async (to) => {
  const page = to.path.replace(/^\//, '')
  const menuItem = MENU_ITEMS.find((item) => item.page === page)

  if (!menuItem || !menuItem.requiresCapability) return true

  const { capabilities } = await loadCapabilities()

  if (!capabilities.includes(menuItem.requiresCapability)) {
    return '/dashboard'
  }

  return true
})

export default router
