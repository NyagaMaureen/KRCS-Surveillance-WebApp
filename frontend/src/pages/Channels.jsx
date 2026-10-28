import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Doughnut } from 'react-chartjs-2'
import { Smartphone, MessageCircle, Globe, Users, Building2, Info } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getChannelStats, getSourceStats } from '../api/frappe'
import { CHART_FONT } from '../charts/chartSetup'
import { useCapabilities } from '../context/CapabilitiesContext'

// Fixed list of supported channels. Values match the Case Report "channel" field.
const CHANNELS = [
  { value: 'WhatsApp', label: 'WhatsApp', icon: MessageCircle, color: '#27AE60', description: 'Health reports and outbreak alerts through WhatsApp.' },
  { value: 'Mobile', label: 'Mobile App', icon: Smartphone, color: '#D62728', description: 'Mobile application for structured health signal reporting.' },
  { value: 'Web', label: 'Web App', icon: Globe, color: '#F2C94C', description: 'Browser-based reporting and review.' },
]
const SOURCES = [
  { value: 'CBS', label: 'Community-Based Surveillance (CBS)', icon: Users, color: '#2563EB', description: 'Weekly signal counts from the KRCS CBS system, loaded in batches.' },
  { value: 'IDSR', label: 'Facility weekly reports (MOH 505)', icon: Building2, color: '#7C3AED', description: 'Weekly IDSR cases from facility exports in KHIS.' },
]
const PERIODS = [7, 30, 90]

function formatWeek(value) {
  if (!value) return null
  const d = new Date(String(value).replace(' ', 'T'))
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function hoursSince(value) {
  if (!value) return null
  const t = new Date(String(value).replace(' ', 'T').slice(0, 19)).getTime()
  return isNaN(t) ? null : (Date.now() - t) / 36e5
}
function updatedAgo(hours) {
  if (hours === null) return 'never'
  if (hours < 1) return 'under an hour ago'
  if (hours < 24) return `${Math.floor(hours / 1)}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function timeAgo(value) {
  if (!value) return 'No reports yet'
  const diff = (Date.now() - new Date(value.replace(' ', 'T')).getTime()) / 36e5
  if (diff < 1) return 'Last report under an hour ago'
  if (diff < 24) return `Last report ${Math.floor(diff)}h ago`
  return `Last report ${Math.floor(diff / 24)}d ago`
}

export default function Channels() {
  const { has } = useCapabilities()
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState({ channels: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sourceStats, setSourceStats] = useState({ sources: [] })
  const [sourceError, setSourceError] = useState(false)

  useEffect(() => {
    setLoading(true)
    getChannelStats(days)
      .then((s) => { setStats(s); setError('') })
      .catch((e) => setError(e.message || 'Could not load channel statistics'))
      .finally(() => setLoading(false))
  }, [days])

  useEffect(() => {
    getSourceStats(days)
      .then((s) => { setSourceStats(s || { sources: [] }); setSourceError(false) })
      .catch(() => { setSourceStats({ sources: [] }); setSourceError(true) })
  }, [days])

  const channels = useMemo(() => {
    const mapped = CHANNELS.map((c) => {
      const s = stats.channels.find((x) => x.channel === c.value) || {}
      return { ...c, total: s.total || 0, today: s.today || 0, last7: s.last7 || 0, share: s.share || 0, lastReport: s.last_report }
    })
    return mapped.sort((a, b) => b.share - a.share)
  }, [stats])

  const pieData = useMemo(() => {
    const active = channels.filter((c) => c.share > 0)
    const source = active.length ? active : channels
    return {
      labels: source.map((c) => c.label),
      datasets: [
        {
          data: active.length ? source.map((c) => c.share) : source.map(() => 1),
          backgroundColor: active.length ? source.map((c) => c.color) : source.map(() => '#E5E7EB'),
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    }
  }, [channels])

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '55%',
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: !!stats.total,
        titleFont: { family: CHART_FONT.family, size: 12 },
        bodyFont: { family: CHART_FONT.family, size: 12 },
        callbacks: {
          label: (ctx) => `${ctx.label}: ${ctx.parsed}%`,
        },
      },
    },
  }

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-brand-navy">Reporting Channels</h2>
          <p className="text-sm text-gray-400">How health signals are reaching the system, from submitted reports and connected data sources</p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-1 flex gap-1">
          {PERIODS.map((p) => (
            <button key={p} onClick={() => setDays(p)}
              className={['px-4 py-2 rounded-md text-sm font-medium transition-colors', days === p ? 'bg-red-600 text-white' : 'text-gray-900'].join(' ')}>
              {p} days
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">{error}</p>
      ) : loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400">Loading reporting channels...</div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Reporting Channels Distribution</h3>
            <p className="text-xs text-gray-400 mb-6">{stats.total} report{stats.total === 1 ? '' : 's'} in the last {days} days</p>
            <div className="flex flex-col md:flex-row items-center justify-center gap-10">
              <div className="w-48 h-48 shrink-0">
                <Doughnut data={pieData} options={pieOptions} />
              </div>
              <div className="flex flex-wrap md:flex-col gap-3">
                {channels.map((c) => (
                  <div key={c.value} className="flex items-center gap-2 text-xs font-medium text-gray-700">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }}></span>
                    {c.label}
                    <span className="font-semibold">{c.share}%</span>
                    <span className="text-gray-400">({c.total})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {channels.map((c) => {
              const Icon = c.icon
              const active = c.last7 > 0
              return (
                <div key={c.value} className="bg-white rounded-2xl border border-gray-200 p-6">
                  <div className="flex items-start justify-between mb-6">
                    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                      <Icon className="w-6 h-6 text-gray-400" />
                    </div>
                    <span className={['text-[10px] font-medium px-3 py-1 rounded-full text-white', active ? 'bg-green-500' : 'bg-gray-400'].join(' ')}>
                      {active ? 'Active' : 'No recent reports'}
                    </span>
                  </div>
                  <h4 className="text-lg font-medium text-gray-900 mb-1">{c.label}</h4>
                  <p className="text-xs text-gray-400 mb-6 leading-relaxed">{c.description}</p>
                  <div className="grid grid-cols-3 gap-2 text-xs border-t border-gray-100 pt-4 mb-2">
                    <div><div className="text-gray-400">Today</div><div className="font-semibold text-gray-900">{c.today}</div></div>
                    <div><div className="text-gray-400">7 days</div><div className="font-semibold text-gray-900">{c.last7}</div></div>
                    <div><div className="text-gray-400">{days} days</div><div className="font-semibold text-gray-900">{c.total}</div></div>
                  </div>
                  <p className="text-xs text-gray-400">{timeAgo(c.lastReport)}</p>
                </div>
              )
            })}
          </div>

          <div className="mt-10">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Other data sources</h3>
            <p className="text-xs text-gray-400 mb-6">Weekly counts loaded from existing systems. Not included in the channel distribution above.</p>
            {sourceError ? (
              <p className="text-xs text-gray-400">Data sources unavailable</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {SOURCES.map((src) => {
                  const Icon = src.icon
                  const s = (sourceStats.sources || []).find((x) => x.source === src.value) || {}
                  const signals = s.signals || 0
                  const pilot = s.pilot_signals || 0
                  const weeks = s.weeks_loaded || 0
                  const lastWeek = formatWeek(s.last_week)
                  const updatedHours = hoursSince(s.last_updated)
                  const stale = src.value === 'CBS' && updatedHours !== null && updatedHours > 3
                  const loaded = weeks > 0
                  return (
                    <div key={src.value} className="bg-white rounded-2xl border border-gray-200 p-6">
                      <div className="flex items-start justify-between mb-6">
                        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                          <Icon className="w-6 h-6" style={{ color: src.color }} />
                        </div>
                        <span className={['text-[10px] font-medium px-3 py-1 rounded-full text-white', loaded ? 'bg-green-500' : 'bg-gray-400'].join(' ')}>
                          {loaded ? 'Loaded' : 'Not loaded'}
                        </span>
                      </div>
                      <h4 className="text-lg font-medium text-gray-900 mb-1">{src.label}</h4>
                      <p className="text-xs text-gray-400 mb-6 leading-relaxed">{src.description}</p>
                      <div className="grid grid-cols-3 gap-2 text-xs border-t border-gray-100 pt-4 mb-2">
                        <div><div className="text-gray-400">Pilot sites</div><div className="font-semibold text-gray-900">{pilot}</div><div className="text-gray-400">signals · last {days} days</div></div>
                        <div><div className="text-gray-400">All areas</div><div className="font-semibold text-gray-900">{signals}</div><div className="text-gray-400">signals · last {days} days</div></div>
                        <div><div className="text-gray-400">Weeks loaded</div><div className="font-semibold text-gray-900">{weeks}</div></div>
                      </div>
                      <p className={['text-xs', stale ? 'text-amber-600' : 'text-gray-400'].join(' ')}>
                        Last updated {updatedAgo(updatedHours)}{stale ? ` · ${src.value} sync may be failing` : ''}
                      </p>
                      <p className="text-xs text-gray-400">
                        Latest week with signals: {lastWeek ? `week of ${lastWeek}` : 'None'}
                      </p>
                      {src.value === 'IDSR' && has('upload_facility_data') && (
                        <Link to="/facility-data" className="text-xs font-semibold text-red-700 hover:underline">Upload files →</Link>
                      )}
                      {signals > 0 && pilot === 0 && (
                        <div className="flex items-start gap-2 bg-blue-50 text-blue-700 text-xs rounded-lg px-3 py-2 mt-4">
                          <Info className="w-4 h-4 shrink-0" />
                          <span>No reports from Dadaab or Kalobeyei in this period. These counts are from other areas.</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  )
}
