import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Bell,
  Sparkles,
  ChevronDown,
  Settings,
  LogOut
} from 'lucide-react'

import {
  currentUserFullName,
  getMyCapabilities,
  logout
} from '../../api/frappe'

export default function Header() {
  const navigate = useNavigate()

  const [fullName] = useState(currentUserFullName())
  const [userRole, setUserRole] = useState('')

  const firstName = useMemo(() => fullName.split(' ')[0], [fullName])

  const initials = useMemo(() =>
    fullName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0].toUpperCase())
      .join(''),
    [fullName]
  )

  const [now, setNow] = useState(new Date())

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef(null)

  useEffect(() => {
    getMyCapabilities()
      .then(({ primary_role }) => {
        setUserRole(primary_role)
      })
      .catch((error) => {
        console.error('Failed to fetch user role:', error)
      })

    const timer = setInterval(() => {
      setNow(new Date())
    }, 30000)

    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false)
      }
    }

    document.addEventListener('click', onClickOutside)

    return () => {
      clearInterval(timer)
      document.removeEventListener('click', onClickOutside)
    }
  }, [])

  const timeOfDay = useMemo(() => {
    const h = now.getHours()
    return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'
  }, [now])

  const dateTimeLabel = useMemo(() =>
    now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) +
    ' • ' +
    now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }),
    [now]
  )

  function goToSettings() {
    setMenuOpen(false)
    navigate('/settings')
  }

  function goToAiAssistant() {
    navigate('/ai-data-assistant')
  }

  async function handleLogout() {
    setMenuOpen(false)
    await logout()
    navigate('/login')
  }

  return (
    <header className="bg-white px-8 py-4 h-20 flex items-center justify-between border-b border-gray-100">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 leading-tight">Good {timeOfDay}, {firstName}!</h1>
        <p className="text-xs text-gray-400 mt-0.5">{dateTimeLabel}</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="bg-gray-100 rounded-full h-11 flex items-center gap-2 pl-1 pr-4 w-64">
          <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center shrink-0">
            <Search className="w-4 h-4 text-gray-600" />
          </span>
          <input
            type="text"
            placeholder="Search..."
            className="bg-transparent flex-1 text-sm text-gray-900 placeholder-gray-500 focus:outline-none"
          />
        </div>

        <div className="bg-gray-100 rounded-full h-11 flex items-center gap-1.5 px-1.5">
          <div ref={notifRef} className="relative">
            <button
              className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => setNotifOpen(!notifOpen)}
            >
              <Bell className="w-4 h-4 text-gray-600" />
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] w-64 bg-white rounded-xl shadow-lg border border-gray-100 py-3 z-50">
                <p className="px-4 pb-2 text-sm font-semibold text-gray-900">Notifications</p>
                <p className="px-4 py-3 text-sm text-gray-400">You're all caught up. No new notifications.</p>
              </div>
            )}
          </div>

          <button
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors cursor-pointer"
            onClick={goToAiAssistant}
          >
            <Sparkles className="w-4 h-4 text-gray-900" />
          </button>
        </div>

        <div ref={menuRef} className="relative">
          <button
            className="bg-gray-100 rounded-full h-11 flex items-center gap-2 pl-1.5 pr-3 hover:bg-gray-200 transition-colors cursor-pointer"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {initials}
            </span>
            <span className="text-left leading-tight">
              <span className="block text-sm font-semibold text-gray-900">{fullName}</span>
              <span className="block text-xs text-gray-500">
                {userRole}
              </span>
            </span>
            <ChevronDown className={['w-4 h-4 text-gray-500 transition-transform', menuOpen ? 'rotate-180' : ''].join(' ')} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
              <button
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={goToSettings}
              >
                <Settings className="w-4 h-4 text-gray-500" />
                Settings
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4" />
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
