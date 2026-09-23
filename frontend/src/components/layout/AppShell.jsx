import Sidebar from './Sidebar'
import Header from './Header'

export default function AppShell({ children }) {
  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <Header />
        <main className="p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
