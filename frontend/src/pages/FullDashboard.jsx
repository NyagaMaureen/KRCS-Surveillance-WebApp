import { useCapabilities } from '../context/CapabilitiesContext'
import HqDashboard from './HqDashboard'
import Dashboard from './Dashboard'

// System Administrator sees the dashboard in tabs (KRCS, Nov 2026); other roles on the full menu keep the current dashboard.
// To give another role the tabbed dashboard, add it here.
const TABBED_DASHBOARD_ROLES = ['System Administrator', 'Administrator', 'System Manager', 'MOH DDSR']

export default function FullDashboard() {
  const { primaryRole, loading } = useCapabilities()
  if (loading) return null   // wait for the role, so the other dashboard does not flash and load first
  return TABBED_DASHBOARD_ROLES.includes(primaryRole) ? <HqDashboard /> : <Dashboard />
}
