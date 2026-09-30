import AppShell from './layout/AppShell'
import { useCapabilities } from '../context/CapabilitiesContext'

export default function RequireCapability({ capability, children }) {
  const { has, loading } = useCapabilities()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-red-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (!has(capability)) {
    return (
      <AppShell>
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Access restricted</h3>
          <p className="text-sm text-gray-400">You don't have access to this page.</p>
        </div>
      </AppShell>
    )
  }

  return children
}
