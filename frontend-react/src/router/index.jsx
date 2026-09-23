import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getMyCapabilities } from '../api/frappe'
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
import SurveillanceDashboard from '../pages/SurveillanceDashboard'
import Investigations from '../pages/Investigations'
import Response from '../pages/Response'
import EventLifecycle from '../pages/EventLifecycle'

export const routes = [
  { path: '/login', name: 'login', element: Login },
  { path: '/dashboard', name: 'dashboard', element: Dashboard },
  { path: '/surveillance-dashboard', name: 'surveillance-dashboard', element: SurveillanceDashboard },
  { path: '/investigations', name: 'investigations', element: Investigations },
  { path: '/response', name: 'response', element: Response },
  { path: '/event-lifecycle', name: 'event-lifecycle', element: EventLifecycle },
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
]

const MENU_ITEMS = SIDEBAR_MENU.flatMap((group) => group.items)

let capabilitiesPromise = null
function loadCapabilities() {
  if (!capabilitiesPromise) {
    capabilitiesPromise = getMyCapabilities()
  }
  return capabilitiesPromise
}

export function CapabilityGuard({ children }) {
  const location = useLocation()
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let cancelled = false
    setStatus('checking')

    if (location.pathname === '/login') {
      setStatus('allowed')
      return
    }

    const page = location.pathname.replace(/^\//, '')
    const menuItem = MENU_ITEMS.find((item) => item.page === page)

    if (!menuItem || !menuItem.requiresCapability) {
      setStatus('allowed')
      return
    }

    loadCapabilities().then(({ capabilities }) => {
      if (cancelled) return
      setStatus(capabilities.includes(menuItem.requiresCapability) ? 'allowed' : 'denied')
    })

    return () => {
      cancelled = true
    }
  }, [location.pathname])

  if (status === 'checking') return null
  if (status === 'denied') return <Navigate to="/dashboard" replace />
  return children
}
