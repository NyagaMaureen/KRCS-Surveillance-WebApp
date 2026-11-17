import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react'

export default function StatCard({ icon: Icon, label, value, changePct = null, trend = 'down', sentiment = 'positive' }) {
  const TrendIcon = trend === 'down' ? ArrowDownCircle : ArrowUpCircle

  return (
    <div className="relative bg-red-600 rounded-2xl p-5 min-w-0 text-center text-white">
      <div className="absolute right-3 top-3 bg-white/20 rounded-full p-2">
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0 px-7">
        <div className="text-xs font-semibold leading-tight text-white">{label}</div>
        <div className="flex items-baseline justify-center gap-2 flex-wrap">
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
