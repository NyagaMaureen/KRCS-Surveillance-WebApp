import { useState, useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import * as icons from 'lucide-react'
import { SIDEBAR_MENU } from '../../data/sidebarMenu'
import { getMyCapabilities } from '../../api/frappe'

function iconFor(name) {
  return icons[name] || icons.Circle
}

export default function Sidebar() {
  const location = useLocation()
  const currentPage = location.pathname.replace('/', '')

  const [myCapabilities, setMyCapabilities] = useState([])
  useEffect(() => {
    getMyCapabilities().then(({ capabilities }) => {
      setMyCapabilities(capabilities)
    })
  }, [])

  const visibleMenu = useMemo(() =>
    SIDEBAR_MENU.map(group => ({
      ...group,
      items: group.items.filter(item => !item.requiresCapability || myCapabilities.includes(item.requiresCapability)),
    })).filter(group => group.items.length > 0),
    [myCapabilities]
  )

  const [collapsed, setCollapsed] = useState(localStorage.getItem('sidebarCollapsed') === 'true')
  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebarCollapsed', next)
  }

  return (
    <aside className={['bg-white border-r border-gray-100 h-screen sticky top-0 flex flex-col transition-all duration-300 shrink-0', collapsed ? 'w-20' : 'w-64'].join(' ')}>
      <div className="flex items-center justify-between px-5 py-6">
        <div className="flex items-center overflow-hidden flex-1">
          <img
            src="/assets/surveillance/images/newlogo.png"
            alt="Kenya Red Cross"
            className={[
              'object-contain object-left transition-all duration-300',
              collapsed ? 'h-8 w-8' : 'h-13 w-full'
            ].join(' ')}
          />
        </div>
        <button onClick={toggle} className="border border-gray-200 rounded-full p-1 text-gray-400 hover:bg-gray-50 shrink-0">
          {!collapsed ? <icons.ChevronLeft className="w-4 h-4" /> : <icons.ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {visibleMenu.map((group) => (
          <div key={group.section}>
            {!collapsed && (
              <div className="px-2 text-xs font-semibold text-gray-400 tracking-wide mb-2 mt-5">{group.section}</div>
            )}
            {group.items.map((item) => {
              const Icon = iconFor(item.icon)
              return (
                <Link
                  key={item.page}
                  to={`/${item.page}`}
                  className={['flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1',
                    currentPage === item.page ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-50'].join(' ')}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
