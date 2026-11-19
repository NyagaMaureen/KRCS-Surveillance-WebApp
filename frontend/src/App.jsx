import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { routes } from './router'
import { CapabilitiesProvider, useCapabilities } from './context/CapabilitiesContext'
import RequireCapability from './components/RequireCapability'
import { pagesFor } from './data/sidebarMenu'
import { currentUserId } from './api/frappe'

// Pages open without signing in. Every other page sends a signed-out person to the login page: the app never runs
// as "Guest" (KRCS 18 Nov 2026).
export const PUBLIC_PAGES = new Set(['login', 'reset-password'])

/** Not signed in (e.g. opened a link from an alert email): go to the login page, then back to this page (KRCS 18 Nov 2026). */
function RequireLogin({ name, children }) {
  const { pathname, search } = useLocation()
  const user = currentUserId()
  if (!PUBLIC_PAGES.has(name) && (!user || user === 'Guest')) {
    return <Navigate to={{ pathname: '/login', search: `?next=${encodeURIComponent(pathname + search)}` }} replace />
  }
  return children
}

function ReviewRedirect() {
  const { id } = useParams()
  const { search } = useLocation()
  return <Navigate to={{ pathname: id ? `/alerts-signals/${id}` : '/alerts-signals', search }} replace />
}

/** Keeps users in their workspace: a CHP opening an officer page is sent to their dashboard. */
function WorkspaceGuard({ name, children }) {
  const { workspace, loading, has } = useCapabilities()
  const { search } = useLocation()
  if (loading || PUBLIC_PAGES.has(name) || name === 'kb-document') return children   // the server decides who may open a document
  const allowed = pagesFor(workspace, has)   // the workspace's pages plus those its permissions add
  if (!allowed) return children
  if (workspace === 'chp' && name === 'my-tasks') return <Navigate to={{ pathname: '/follow-ups', search }} replace />
  if (!allowed.has(name)) return <Navigate to="/dashboard" replace />
  return children
}

/** A session that ends while a page is open (session length reached, signed out elsewhere, password reset) sends the
 *  person to the login page instead of leaving the app running as "Guest" (KRCS 18 Nov 2026). Checked when the
 *  server refuses a request, when the window gets focus, and every minute. */
function SessionWatch() {
  useEffect(() => {
    const check = () => {
      const path = window.location.pathname.replace(/^\/surveillance/, '') || '/'
      if (path.startsWith('/login') || path.startsWith('/reset-password')) return
      const user = currentUserId()
      if (!user || user === 'Guest') {
        window.location.assign(`/surveillance/login?next=${encodeURIComponent(path + window.location.search)}`)
      }
    }
    const original = window.fetch
    window.fetch = async (...args) => {
      const res = await original(...args)
      if (res.status === 401 || res.status === 403) check()
      return res
    }
    const timer = setInterval(check, 60 * 1000)
    window.addEventListener('focus', check)
    return () => { window.fetch = original; clearInterval(timer); window.removeEventListener('focus', check) }
  }, [])
  return null
}

function App() {
  return (
    <CapabilitiesProvider>
      <BrowserRouter basename="/surveillance/">
        <SessionWatch />
        <Routes>
          {routes.map(({ path, name, element: Element, requiresCapability }) => (
            <Route
              key={path}
              path={path}
              element={
                <RequireLogin name={name}>
                <WorkspaceGuard name={name}>
                  {requiresCapability ? (
                    <RequireCapability capability={requiresCapability}>
                      <Element />
                    </RequireCapability>
                  ) : (
                    <Element />
                  )}
                </WorkspaceGuard>
                </RequireLogin>
              }
            />
          ))}
          <Route path="/review" element={<ReviewRedirect />} />
          <Route path="/review/:id" element={<ReviewRedirect />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </CapabilitiesProvider>
  )
}

export default App
