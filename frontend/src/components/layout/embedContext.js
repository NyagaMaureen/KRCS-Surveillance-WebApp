import { createContext, useContext } from 'react'

// A page shown inside another page (e.g. Epi Trends inside a dashboard tab) renders without its own sidebar and
// header: AppShell checks this and only renders the page content. Wrap the page in <Embedded> (Embedded.jsx).
export const EmbedContext = createContext(false)

export function useEmbedded() {
  return useContext(EmbedContext)
}
