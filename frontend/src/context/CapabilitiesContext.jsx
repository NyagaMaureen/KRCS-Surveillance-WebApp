import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getMyCapabilities } from '../api/frappe'

const CapabilitiesContext = createContext(null)

export function CapabilitiesProvider({ children }) {
  const [capabilities, setCapabilities] = useState([])
  const [primaryRole, setPrimaryRole] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { capabilities: caps, primary_role } = await getMyCapabilities()
      setCapabilities(caps)
      setPrimaryRole(primary_role)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const has = useCallback((key) => capabilities.includes(key), [capabilities])

  const value = useMemo(
    () => ({ capabilities, primaryRole, loading, has, refresh }),
    [capabilities, primaryRole, loading, has, refresh]
  )

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>
}

export function useCapabilities() {
  const ctx = useContext(CapabilitiesContext)
  if (!ctx) throw new Error('useCapabilities must be used within a CapabilitiesProvider')
  return ctx
}
