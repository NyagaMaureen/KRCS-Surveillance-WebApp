import { EmbedContext } from './embedContext'

export default function Embedded({ children }) {
  return <EmbedContext.Provider value={true}>{children}</EmbedContext.Provider>
}
