'use client'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen overflow-x-hidden">
      {/* Sidebar — desktop only */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex-1 flex flex-col lg:pl-64">
        <div className="flex-1 max-w-lg lg:max-w-none mx-auto lg:mx-0 w-full bg-white shadow-sm lg:shadow-none overflow-x-hidden">
          <div className="pb-16 lg:pb-0">
            {children}
          </div>
        </div>

        {/* Bottom nav — mobile only */}
        <BottomNav />
      </div>
    </div>
  )
}
