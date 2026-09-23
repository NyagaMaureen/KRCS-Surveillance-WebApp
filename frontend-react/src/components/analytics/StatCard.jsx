import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react'

export default function StatCard({ icon: Icon, label, value, changePct = null, trend = 'down', sentiment = 'positive' }) {
  const TrendIcon = trend === 'down' ? ArrowDownCircle : ArrowUpCircle

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4 min-w-0">
      <div className="bg-gray-100 rounded-full p-3.5 shrink-0">
        <Icon className="w-5 h-5 text-gray-500" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-400 truncate">{label}</div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xl sm:text-2xl font-semibold text-gray-900">{value}</span>
          {changePct != null && (
            <span className={['inline-flex items-center gap-0.5 text-xs font-medium', sentiment === 'positive' ? 'text-emerald-400' : 'text-rose-400'].join(' ')}>
              <TrendIcon className="w-3 h-3" />
              {changePct}%
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
