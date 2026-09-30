import Sidebar from './Sidebar'
import Header from './Header'

export default function AppShell({ children }) {
  return (
    <div className="flex bg-white min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0 bg-white">
        <Header />
        <main className="p-8 bg-white">
          {children}
        </main>
      </div>
    </div>
  )
}
