import { MessagesSquare } from 'lucide-react'
import AppShell from '../components/layout/AppShell'

export default function Response() {
  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Response</h2>
        <p className="text-sm text-gray-400">Coordinate and track outbreak response actions</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-12 flex flex-col items-center justify-center text-center gap-3">
        <span className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
          <MessagesSquare className="w-6 h-6 text-gray-400" />
        </span>
        <p className="text-sm font-medium text-gray-900">Response coming soon</p>
        <p className="text-sm text-gray-400 max-w-sm">This page will coordinate response actions and teams.</p>
      </div>
    </AppShell>
  )
}
