import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react'

export default function StatCard({ icon: Icon, label, value, changePct = null, trend = 'down', sentiment = 'positive' }) {
  const TrendIcon = trend === 'down' ? ArrowDownCircle : ArrowUpCircle

  return (
    <div className="bg-red-600 rounded-2xl p-5 flex items-center gap-4 min-w-0 text-white">
      <div className="bg-white/20 rounded-full p-3.5 shrink-0">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-white truncate">{label}</div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xl sm:text-2xl font-bold text-white">{value}</span>
          {changePct != null && (
            <span className={['inline-flex items-center gap-0.5 text-xs font-semibold text-white', sentiment === 'positive' ? '' : 'underline'].join(' ')}>
              <TrendIcon className="w-3 h-3" />
              {changePct}%
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
