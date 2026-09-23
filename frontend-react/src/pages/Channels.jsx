import { useState, useMemo } from 'react'
import { Plus, Settings, Smartphone, MessageSquare, Grid3x3, MessageCircle, Radio } from 'lucide-react'
import AppShell from '../components/layout/AppShell'

const ICONS = { Smartphone, MessageSquare, Grid3x3, MessageCircle }
const iconFor = (name) => ICONS[name] || Radio

const STATUS_COLORS = { operational: 'bg-green-500', degraded: 'bg-amber-500', down: 'bg-red-500' }
const statusColor = (status) => STATUS_COLORS[status] || 'bg-gray-400'

const INITIAL_CHANNELS = [
  {
    name: 'whatsapp',
    label: 'WhatsApp',
    description: 'Receive health reports and outbreak alerts through WhatsApp.',
    icon: 'MessageCircle',
    status: 'operational',
    uptime: 99.8,
    today: 126,
    share: 35,
    color: '#D62728',
  },
  {
    name: 'sms',
    label: 'SMS',
    description: 'SMS reporting channel for areas with limited internet connectivity.',
    icon: 'MessageSquare',
    status: 'operational',
    uptime: 98.7,
    today: 92,
    share: 26,
    color: '#2F80ED',
  },
  {
    name: 'ussd',
    label: 'USSD',
    description: 'USSD-based reporting for community health workers and facilities.',
    icon: 'Grid3x3',
    status: 'operational',
    uptime: 97.9,
    today: 74,
    share: 21,
    color: '#F2C94C',
  },
  {
    name: 'mobile-app',
    label: 'Mobile App',
    description: 'Mobile application for structured health signal reporting.',
    icon: 'Smartphone',
    status: 'degraded',
    uptime: 94.6,
    today: 63,
    share: 18,
    color: '#27AE60',
  },
]

export default function Channels() {
  const [channels] = useState(INITIAL_CHANNELS)
  const [error] = useState('')
  const [loading] = useState(false)

  const pieGradient = useMemo(() => {
    let start = 0
    const stops = channels.map((channel) => {
      const end = start + channel.share
      const stop = `${channel.color} ${start}% ${end}%`
      start = end
      return stop
    })
    return `conic-gradient(${stops.join(', ')})`
  }, [channels])

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Reporting Channels</h2>
          <p className="text-sm text-gray-400">Standard Operating Procedures for disease outbreak response</p>
        </div>
        <button className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Channel
        </button>
      </div>

      {error ? (
        <p className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-6">{error}</p>
      ) : loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400">
          Loading reporting channels...
        </div>
      ) : channels.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400">
          No reporting channels found.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-6">Reporting Channels Distribution</h3>

            <div className="flex flex-col md:flex-row items-center justify-center gap-10">
              <div className="w-48 h-48 rounded-full shrink-0" style={{ background: pieGradient }}></div>

              <div className="flex flex-wrap md:flex-col gap-3">
                {channels.map((c) => (
                  <div key={c.name} className="flex items-center gap-2 text-xs font-medium text-gray-700">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }}></span>
                    {c.label}
                    <span className="font-semibold">{c.share}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {channels.map((c) => {
              const Icon = iconFor(c.icon)
              return (
                <div key={c.name} className="bg-white rounded-2xl border border-gray-200 p-6">
                  <div className="flex items-start justify-between mb-6">
                    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                      <Icon className="w-6 h-6 text-gray-400" />
                    </div>
                    <span className={['text-[10px] font-medium px-3 py-1 rounded-full text-white capitalize', statusColor(c.status)].join(' ')}>
                      {c.status}
                    </span>
                  </div>

                  <h4 className="text-lg font-medium text-gray-900 mb-1">{c.label}</h4>
                  <p className="text-xs text-gray-400 mb-6 leading-relaxed">{c.description}</p>

                  <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-4 mb-4">
                    <span className="text-gray-900 font-medium">
                      Uptime: <span className="font-semibold">{c.uptime}%</span>
                    </span>
                    <span className="text-gray-900 font-medium">
                      Today: <span className="font-semibold">{c.today}</span>
                    </span>
                  </div>

                  <button className="w-full border border-gray-200 rounded-lg py-2.5 text-sm font-medium text-gray-900 flex items-center justify-center gap-2 hover:bg-gray-50">
                    <Settings className="w-4 h-4" />
                    Configure
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </AppShell>
  )
}
