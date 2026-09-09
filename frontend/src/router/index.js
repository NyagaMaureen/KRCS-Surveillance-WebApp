import { createRouter, createWebHashHistory } from 'vue-router'
import Login from '../pages/Login.vue'
import Dashboard from '../pages/Dashboard.vue'
import Analytics from '../pages/Analytics.vue'
import DataExplorer from '../pages/DataExplorer.vue'
import Reports from '../pages/Reports.vue'
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
  history: createWebHashHistory(),
  routes,
})

export default router
