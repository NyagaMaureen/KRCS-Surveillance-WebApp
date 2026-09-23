import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { routes, CapabilityGuard } from './router'

function App() {
  return (
    <BrowserRouter basename="/surveillance/">
      <Routes>
        {routes.map(({ path, element: Element }) => (
          <Route
            key={path}
            path={path}
            element={
              <CapabilityGuard>
                <Element />
              </CapabilityGuard>
            }
          />
        ))}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
