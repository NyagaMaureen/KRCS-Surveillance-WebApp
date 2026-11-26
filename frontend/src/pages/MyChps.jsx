import { useEffect, useMemo, useState } from 'react'
import { Search, Phone } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { getMyChps } from '../api/frappe'
import { CARD, PageTitle, Badge, Skeleton, GRID_TABLE, GRID_HEAD, FOCUS } from '../components/chp/ui'

// CHPs in my CHU (CHA, KRCS 18 Nov 2026): the CHPs in the Community Health Unit(s) the CHA heads, with their phone
// and what they did this month. View only; users are added and changed in Users. Data: surveillance.health_units.get_my_chps

function when(v) {
  if (!v) return 'Never'
  const d = new Date(String(v).replace(' ', 'T'))
  return isNaN(d) ? v : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function MyChps() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { getMyChps().then(setData).catch((e) => setError(e.message || 'Could not load your CHPs')) }, [])
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = data?.chps || []
    return t ? list.filter((c) => `${c.name} ${c.phone} ${c.units.join(' ')}`.toLowerCase().includes(t)) : list
  }, [data, q])

  return (
    <AppShell>
      <PageTitle title="CHPs in my CHU"
        subtitle={data?.units?.length ? `Community Health Promoters in ${data.units.join(', ')}. Ask your administrator to add or change a CHP.` : 'Community Health Promoters in the unit(s) you head.'} />

      <div className={`${CARD} p-3 mb-4 flex flex-wrap items-center gap-3`}>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone or unit" aria-label="Search"
            className={`w-full bg-gray-50 rounded-lg pl-9 pr-4 py-2 text-sm ${FOCUS}`} />
        </div>
        {data && <p className="text-sm text-gray-700">{rows.length} CHP{rows.length === 1 ? '' : 's'}</p>}
      </div>

      {error ? <div className={`${CARD} p-10 text-center text-sm text-gray-600`}>{error}</div>
        : !data ? <Skeleton />
          : !data.units.length ? <div className={`${CARD} p-12 text-center text-sm text-gray-600`}>You are not heading a Community Health Unit yet. Ask your administrator to add you to one.</div>
            : !rows.length ? <div className={`${CARD} p-12 text-center text-sm text-gray-600`}>No CHPs {q ? 'match your search' : 'in your unit yet'}.</div>
              : (
                <div className={`${CARD} overflow-x-auto`}>
                  <table className={GRID_TABLE}>
                    <thead>
                      <tr className={GRID_HEAD}>
                        <th className="px-4 py-3 w-10">#</th>
                        <th className="px-4 py-3">CHP</th>
                        <th className="px-4 py-3">Phone</th>
                        <th className="px-4 py-3">Community Health Unit</th>
                        <th className="px-4 py-3">Reports this month</th>
                        <th className="px-4 py-3">Referrals this month</th>
                        <th className="px-4 py-3">Open tasks</th>
                        <th className="px-4 py-3">Last sign-in</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c, i) => (
                        <tr key={c.id} className="align-top hover:bg-red-50/40">
                          <td className="px-4 py-3 text-gray-500 tabular-nums">{i + 1}</td>
                          <td className="px-4 py-3"><p className="font-medium text-gray-900">{c.name}</p><p className="text-xs text-gray-500">{c.id}</p></td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {c.phone ? <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 text-gray-900 hover:text-red-700"><Phone className="w-3.5 h-3.5" aria-hidden="true" />{c.phone}</a> : '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-900">{c.units.join(', ')}</td>
                          <td className="px-4 py-3 tabular-nums text-gray-900">{c.reportsThisMonth}</td>
                          <td className="px-4 py-3 tabular-nums text-gray-900">{c.referralsThisMonth ?? 0}</td>
                          <td className="px-4 py-3 tabular-nums text-gray-900">{c.openTasks}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-900">{when(c.lastLogin)}</td>
                          <td className="px-4 py-3"><Badge tone={c.active ? 'green' : 'gray'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
    </AppShell>
  )
}
