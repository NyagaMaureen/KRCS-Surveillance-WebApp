import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { routes } from './router'
import { CapabilitiesProvider, useCapabilities } from './context/CapabilitiesContext'
import RequireCapability from './components/RequireCapability'
import { pagesFor } from './data/sidebarMenu'

function ReviewRedirect() {
  const { id } = useParams()
  const { search } = useLocation()
  return <Navigate to={{ pathname: id ? `/alerts-signals/${id}` : '/alerts-signals', search }} replace />
}

/** Keeps users in their workspace: a CHP opening an officer page is sent to their dashboard. */
function WorkspaceGuard({ name, children }) {
  const { workspace, loading, has } = useCapabilities()
  const { search } = useLocation()
  if (loading) return children
  const allowed = pagesFor(workspace, has)   // the workspace's pages plus those its permissions add
  if (!allowed) return children
  if (workspace === 'chp' && name === 'my-tasks') return <Navigate to={{ pathname: '/follow-ups', search }} replace />
  if (!allowed.has(name)) return <Navigate to="/dashboard" replace />
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
