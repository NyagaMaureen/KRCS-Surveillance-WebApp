import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { routes } from './router'
import { CapabilitiesProvider } from './context/CapabilitiesContext'
import RequireCapability from './components/RequireCapability'

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
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </CapabilitiesProvider>
  )
}

export default App
