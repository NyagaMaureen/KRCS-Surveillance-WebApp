import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { routes } from './router'
import { CapabilitiesProvider, useCapabilities } from './context/CapabilitiesContext'
import RequireCapability from './components/RequireCapability'
import { WORKSPACE_PAGES } from './data/sidebarMenu'

function ReviewRedirect() {
  const { id } = useParams()
  const { search } = useLocation()
  return <Navigate to={{ pathname: id ? `/alerts-signals/${id}` : '/alerts-signals', search }} replace />
}

/** Keeps users in their workspace: a CHP opening an officer page is sent to their dashboard. */
function WorkspaceGuard({ name, children }) {
  const { workspace, loading } = useCapabilities()
  const { search } = useLocation()
  if (loading) return children
  const allowed = WORKSPACE_PAGES[workspace]
  if (!allowed) return children
  if (workspace === 'chp' && name === 'my-tasks') return <Navigate to={{ pathname: '/follow-ups', search }} replace />
  if (!allowed.includes(name)) return <Navigate to="/dashboard" replace />
  return children
}

function App() {
  return (
    <CapabilitiesProvider>
      <BrowserRouter basename="/surveillance/">
        <Routes>
          {routes.map(({ path, name, element: Element, requiresCapability }) => (
            <Route
              key={path}
              path={path}
              element={
                <WorkspaceGuard name={name}>
                  {requiresCapability ? (
                    <RequireCapability capability={requiresCapability}>
                      <Element />
                    </RequireCapability>
                  ) : (
                    <Element />
                  )}
                </WorkspaceGuard>
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
