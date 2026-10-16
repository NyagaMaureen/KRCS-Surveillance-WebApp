import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { routes } from './router'
import { CapabilitiesProvider } from './context/CapabilitiesContext'
import RequireCapability from './components/RequireCapability'

function ReviewRedirect() {
  const { id } = useParams()
  const { search } = useLocation()
  return <Navigate to={{ pathname: id ? `/alerts-signals/${id}` : '/alerts-signals', search }} replace />
}

function App() {
  return (
    <CapabilitiesProvider>
      <BrowserRouter basename="/surveillance/">
        <Routes>
          {routes.map(({ path, element: Element, requiresCapability }) => (
            <Route
              key={path}
              path={path}
              element={
                requiresCapability ? (
                  <RequireCapability capability={requiresCapability}>
                    <Element />
                  </RequireCapability>
                ) : (
                  <Element />
                )
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
