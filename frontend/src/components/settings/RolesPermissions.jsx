import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Lock } from 'lucide-react'
import { getRoleCapabilities, setRoleCapability } from '../../api/frappe'

// Roles & Permissions as a table: one permission group at a time, a row per role, a column per permission.
// Ticking a box saves straight away. System roles (full access) are shown ticked and locked.
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400'

// short column heading: "Settings: Notifications" -> "Notifications"
const shortName = (name) => String(name || '').replace(/^[^:]{2,20}:\s*/, '')

// roles grouped by level, field to national, so similar roles sit together; anything else goes under Other
const LEVELS = [
  ['Field', ['CHP', 'Facility Health Worker']],
  ['Facility', ['Public Health Officer', 'HIS Officer']],
  ['Sub-county and county', ['Surveillance Officer', 'SCDSC', 'CDSC']],
  ['National', ['Public Health HQ', 'MOH DDSR']],
  ['System', ['Data & AI Administrator', 'HQ Admin']],
]

export default function RolesPermissions({ roles = [], users = [], initialRole = '', onRoleChange }) {
  const [caps, setCaps] = useState([])               // every permission (key, name, category, description)
  const [enabled, setEnabled] = useState({})         // role -> { key: true }
  const [locked, setLocked] = useState({})           // role -> true for system roles
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState('')
  const [query, setQuery] = useState('')            // find a permission across every group
  const [hoverCol, setHoverCol] = useState(null)
  const [busy, setBusy] = useState({})               // "role|key" being saved
  const [toast, setToast] = useState({ show: false, message: '', error: false })
  const toastTimer = useRef(null)

  function showToast(message, error = false) {
    setToast({ show: true, message, error })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2000)
  }

  // load every role's permissions once (one request per role)
  useEffect(() => {
    if (!roles.length) return undefined
    let live = true
    setLoading(true)
    Promise.all(roles.map((r) => getRoleCapabilities(r.role).then((res) => [r.role, res]).catch(() => [r.role, null])))
      .then((rows) => {
        if (!live) return
        const first = rows.find(([, res]) => res?.capabilities?.length)
        setCaps(first ? first[1].capabilities.map(({ key, name, category, description }) => ({ key, name, category, description })) : [])
        setEnabled(Object.fromEntries(rows.map(([role, res]) => [role, Object.fromEntries((res?.capabilities || []).filter((c) => c.enabled).map((c) => [c.key, true]))])))
        setLocked(Object.fromEntries(rows.map(([role, res]) => [role, !!res?.locked])))
      })
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [roles])

  const groups = useMemo(() => {
    const m = new Map()
    caps.forEach((c) => { if (!m.has(c.category)) m.set(c.category, []); m.get(c.category).push(c) })
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => ({ name, caps: list }))
  }, [caps])
  const q = query.trim().toLowerCase()
  const current = q
    ? { name: 'Search results', caps: caps.filter((c) => `${c.name} ${c.description || ''} ${c.category}`.toLowerCase().includes(q)) }
    : groups.find((g) => g.name === group) || groups[0]

  const levels = useMemo(() => {
    const placed = new Set()
    const out = LEVELS.map(([label, names]) => {
      const rs = names.map((n) => roles.find((r) => r.role === n)).filter(Boolean)
      rs.forEach((r) => placed.add(r.role))
      return { label, roles: rs }
    })
    out.push({ label: 'Other', roles: roles.filter((r) => !placed.has(r.role)) })
    return out.filter((l) => l.roles.length)
  }, [roles])

  const userCounts = useMemo(() => {
    const n = {}
    users.forEach((u) => { if (u.primary_role) n[u.primary_role] = (n[u.primary_role] || 0) + 1 })
    return n
  }, [users])

  async function toggle(role, cap) {
    const id = `${role}|${cap.key}`
    const next = !enabled[role]?.[cap.key]
    setEnabled((e) => ({ ...e, [role]: { ...e[role], [cap.key]: next } }))
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      const res = await setRoleCapability(role, cap.key, next ? 1 : 0)
      if (res?.capabilities) {   // the server may switch on related permissions too
        setEnabled((e) => ({ ...e, [role]: Object.fromEntries(res.capabilities.filter((c) => c.enabled).map((c) => [c.key, true])) }))
      }
      showToast(`${role}: ${shortName(cap.name)} ${next ? 'on' : 'off'}`)
    } catch (err) {
      setEnabled((e) => ({ ...e, [role]: { ...e[role], [cap.key]: !next } }))
      showToast(err.message || 'Could not save', true)
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[id]; return c })
    }
  }

  // tick or untick every permission of the open group for one role
  async function toggleRow(role) {
    const all = current.caps.every((c) => enabled[role]?.[c.key])
    for (const c of current.caps) {
      if (!!enabled[role]?.[c.key] === all) await toggle(role, c)   // eslint-disable-line no-await-in-loop
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      {/* permission groups */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-4">
        {groups.map((g) => {
          const on = !q && current && g.name === current.name
          return (
            <button key={g.name} type="button" onClick={() => { setGroup(g.name); setQuery('') }} aria-pressed={on}
              className={['rounded-full border px-3 py-1.5 text-sm', on ? 'border-red-600 bg-red-600 font-semibold text-white' : 'border-gray-200 bg-white text-gray-900 hover:border-red-200', FOCUS].join(' ')}>
              {g.name} <span className={on ? 'text-white' : 'text-gray-500'}>{g.caps.length}</span>
            </button>
          )
        })}
        <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" placeholder="Find a permission" aria-label="Find a permission"
          className={`ml-auto h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm sm:w-56 ${FOCUS}`} />
      </div>

      <p className="border-b border-gray-200 px-4 py-2 text-xs text-gray-600">Tick a box to give a role that permission; it saves straight away. Hover a heading to see what it allows.</p>
      {loading ? (
        <p className="p-10 text-center text-sm text-gray-500">Loading permissions…</p>
      ) : !current || !current.caps.length ? (
        <p className="p-10 text-center text-sm text-gray-500">{q ? 'No permission matches your search.' : 'No permissions found.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" onMouseLeave={() => setHoverCol(null)}>
            <thead className="sticky top-0 z-20 bg-white">
              <tr className="border-b-2 border-red-600">
                <th scope="col" className="sticky left-0 z-10 min-w-[200px] bg-white px-4 py-3 text-left text-sm font-bold text-gray-900">{current.name}</th>
                {current.caps.map((c) => (
                  <th key={c.key} scope="col" title={c.description} onMouseEnter={() => setHoverCol(c.key)}
                    className={['w-28 min-w-[7rem] px-2 py-3 text-center align-bottom text-xs font-bold leading-tight text-gray-900', hoverCol === c.key ? 'bg-red-50' : ''].join(' ')}>
                    {q && <span className="mb-0.5 block font-normal text-gray-500">{c.category}</span>}
                    {shortName(c.name)}
                  </th>
                ))}
                {!q && <th scope="col" className="w-20 px-2 py-3 text-center align-bottom text-xs font-bold text-gray-900">All</th>}
              </tr>
            </thead>
            {levels.map((lvl) => (
            <tbody key={lvl.label}>
              <tr className="bg-gray-50">
                <th scope="colgroup" colSpan={current.caps.length + 2} className="sticky left-0 px-4 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-red-700">{lvl.label}</th>
              </tr>
              {lvl.roles.map((r) => {
                const isLocked = !!locked[r.role]
                const selected = initialRole && (initialRole === r.role || initialRole === r.name)
                return (
                  <tr key={r.name} className={['border-b border-gray-200 hover:bg-red-50/40', selected ? 'bg-red-50/40' : ''].join(' ')}>
                    <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-normal">
                      <button type="button" onClick={() => onRoleChange?.(r.role)} className={`rounded text-left ${FOCUS}`}>
                        <span className="block text-sm font-medium text-gray-900">{r.role}</span>
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          {userCounts[r.role] || 0} user{userCounts[r.role] === 1 ? '' : 's'}
                          {isLocked && <><span aria-hidden="true">·</span><Lock className="h-3 w-3" aria-hidden="true" /> full access</>}
                        </span>
                      </button>
                    </th>
                    {current.caps.map((c) => {
                      const on = isLocked || !!enabled[r.role]?.[c.key]
                      return (
                        <td key={c.key} onMouseEnter={() => setHoverCol(c.key)} className={['px-2 py-3 text-center', hoverCol === c.key ? 'bg-red-50/60' : ''].join(' ')}>
                          <input type="checkbox" checked={on} disabled={isLocked || !!busy[`${r.role}|${c.key}`]} onChange={() => toggle(r.role, c)}
                            aria-label={`${r.role}: ${c.name}`} title={c.description}
                            className={`h-4 w-4 cursor-pointer accent-red-600 disabled:cursor-not-allowed ${FOCUS}`} />
                        </td>
                      )
                    })}
                    {!q && (
                      <td className="px-2 py-3 text-center">
                        {!isLocked && (
                          <button type="button" onClick={() => toggleRow(r.role)} className={`rounded text-xs font-semibold text-red-700 hover:underline ${FOCUS}`}>
                            {current.caps.every((c) => enabled[r.role]?.[c.key]) ? 'None' : 'All'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            ))}
          </table>
        </div>
      )}

      {toast.show && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {!toast.error && <Check className="h-4 w-4 text-green-400" aria-hidden="true" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  )
}
