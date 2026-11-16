import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import * as icons from 'lucide-react'
import { menuFor } from '../../data/sidebarMenu'
import { useCapabilities } from '../../context/CapabilitiesContext'
import { getReviewEvents } from '../../api/frappe'

function iconFor(name) {
  return icons[name] || icons.Circle
}

// a menu item can open a tab (query) or a section (hash) of a page
function linkTo(item) {
  return { pathname: `/${item.page}`, search: item.query ? `?${item.query}` : '', hash: item.hash ? `#${item.hash}` : '' }
}

function isActive(item, currentPage, location) {
  if (item.page !== currentPage) return false
  if (item.hash) return location.hash === `#${item.hash}`
  if (!item.query) return true
  const want = new URLSearchParams(item.query)
  const have = new URLSearchParams(location.search)
  const first = item.query.startsWith('tab=users') && !have.get('tab')   // Users is the page's first tab
  return first || [...want.entries()].every(([k, v]) => have.get(k) === v)
}

function readOpenGroups() {
  try { return JSON.parse(localStorage.getItem('sidebarGroups') || '{}') || {} } catch { return {} }
}

export default function Sidebar({ open = false, onClose }) {
  const location = useLocation()
  const currentPage = location.pathname.replace('/', '').split('/')[0]

  const { capabilities, workspace, has } = useCapabilities()
  const canSeeQueue = capabilities.includes('view_review_queue')

  const visibleMenu = useMemo(() => menuFor(workspace, has), [has, workspace])

  const [newCount, setNewCount] = useState(0)
  useEffect(() => {
    if (!canSeeQueue) return undefined
    let active = true
    const load = () => getReviewEvents({ limit: 1 })
      .then((res) => { if (active) setNewCount(res?.counts?.new || 0) })
      .catch(() => {})
    load()
    const timer = setInterval(load, 5 * 60 * 1000)
    return () => { active = false; clearInterval(timer) }
  }, [canSeeQueue])

  const [collapsed, setCollapsed] = useState(localStorage.getItem('sidebarCollapsed') === 'true')
  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebarCollapsed', next)
  }
  const [openGroups, setOpenGroups] = useState(readOpenGroups)   // menu groups opened by the user
  function setGroupOpen(label, value) {
    setOpenGroups((g) => {
      const next = { ...g, [label]: value }
      try { localStorage.setItem('sidebarGroups', JSON.stringify(next)) } catch { /* not remembered */ }
      return next
    })
  }

  return (
    <>
    {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={onClose} aria-hidden="true" />}
    <aside className={['bg-white border-r border-gray-100 h-screen fixed lg:sticky top-0 left-0 z-40 flex flex-col transition-all duration-300 shrink-0 w-64',
      open ? 'translate-x-0' : '-translate-x-full invisible lg:visible lg:translate-x-0',
      collapsed ? 'lg:w-20' : ''].join(' ')}>
      <div className={['flex items-center justify-between py-5', collapsed ? 'px-5 lg:flex-col lg:gap-3 lg:px-2' : 'px-4 gap-2'].join(' ')}>
        <div className="flex items-center overflow-hidden flex-1">
          {/* full logo across the sidebar; when collapsed, the crest only */}
          <img
            src="/assets/surveillance/images/logo2.png"
            alt="Kenya Red Cross"
            className={['w-full h-auto max-h-20 object-contain object-left', collapsed ? 'lg:hidden' : ''].join(' ')}
          />
          {collapsed && (
            <img src="/assets/surveillance/images/crest.png" alt="Kenya Red Cross" className="hidden lg:block h-11 w-auto mx-auto object-contain" />
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close menu" className="lg:hidden border border-gray-200 rounded-full p-1 text-gray-400 hover:bg-gray-50 shrink-0">
          <icons.X className="w-4 h-4" />
        </button>
        <button onClick={toggle} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} className="hidden lg:block border border-gray-200 rounded-full p-1 text-gray-400 hover:bg-gray-50 shrink-0">
          {!collapsed ? <icons.ChevronLeft className="w-4 h-4" /> : <icons.ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {visibleMenu.map((group) => (
          <div key={group.section}>
            <div className={['px-2 text-xs font-bold text-gray-900 tracking-wide mb-2 mt-5', collapsed ? 'lg:hidden' : ''].join(' ')}>{group.section}</div>
            {group.items.map((item) => {
              const Icon = iconFor(item.icon)
              if (item.children) {
                const active = item.children.some((c) => isActive(c, currentPage, location))
                const isOpen = active || !!openGroups[item.label]
                return (
                  <div key={item.label} className="mb-1">
                    <button type="button" aria-expanded={isOpen} aria-label={item.label}
                      onClick={() => { if (collapsed) toggle(); setGroupOpen(item.label, !isOpen || collapsed) }}
                      className={['w-full relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
                        active ? 'text-red-700' : 'text-gray-900 hover:bg-red-50 hover:text-red-700'].join(' ')}>
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className={['whitespace-nowrap truncate min-w-0 flex-1 text-left', collapsed ? 'lg:hidden' : ''].join(' ')}>{item.label}</span>
                      <icons.ChevronRight className={['w-4 h-4 shrink-0 transition-transform', isOpen ? 'rotate-90' : '', collapsed ? 'lg:hidden' : ''].join(' ')} />
                    </button>
                    {isOpen && (
                      <div className={['ml-5 border-l border-gray-200 pl-2 mt-0.5', collapsed ? 'lg:hidden' : ''].join(' ')}>
                        {item.children.map((child) => {
                          const ChildIcon = iconFor(child.icon)
                          if (child.soon) {
                            return (
                              <span key={child.label} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-900 opacity-60 cursor-default" title="Coming soon">
                                <ChildIcon className="w-4 h-4 shrink-0" />
                                <span className="whitespace-nowrap truncate min-w-0">{child.label}</span>
                                <span className="ml-auto rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold">Soon</span>
                              </span>
                            )
                          }
                          const on = isActive(child, currentPage, location)
                          return (
                            <Link key={`${child.page}${child.query || ''}${child.hash || ''}`} to={linkTo(child)} aria-label={child.label}
                              className={['relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium mb-0.5',
                                on ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-red-50 hover:text-red-700'].join(' ')}>
                              <ChildIcon className="w-4 h-4 shrink-0" />
                              <span className="whitespace-nowrap truncate min-w-0">{child.label}</span>
                              {child.page === 'alerts-signals' && newCount > 0 && (
                                <span className="ml-auto bg-red-600 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center ring-2 ring-white">
                                  {newCount > 99 ? '99+' : newCount}
                                </span>
                              )}
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              }
              if (item.soon) {   // flat soon item, not built yet
                return (
                  <span key={item.label} title="Coming soon" className="relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1 text-gray-900 opacity-60 cursor-default">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className={['whitespace-nowrap', collapsed ? 'lg:hidden' : ''].join(' ')}>{item.label}</span>
                    <span className={['ml-auto rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold', collapsed ? 'lg:hidden' : ''].join(' ')}>Soon</span>
                  </span>
                )
              }
              return (
                <Link
                  key={`${item.page}${item.query || ''}${item.hash || ''}`}
                  to={linkTo(item)}
                  aria-label={item.label}
                  className={['relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1',
                    isActive(item, currentPage, location) ? 'bg-red-600 text-white' : 'text-gray-900 hover:bg-red-50 hover:text-red-700'].join(' ')}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className={['whitespace-nowrap', collapsed ? 'lg:hidden' : ''].join(' ')}>{item.label}</span>
                  {item.page === 'alerts-signals' && newCount > 0 && (
                    <span className={['bg-red-600 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center', collapsed ? 'absolute top-1 right-1 ring-2 ring-white' : 'ml-auto'].join(' ')}>
                      {newCount > 99 ? '99+' : newCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
    </>
  )
}
