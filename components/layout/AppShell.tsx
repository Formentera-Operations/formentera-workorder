'use client'
import { useState } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'
import OfflineBanner from '../OfflineBanner'

export default function AppShell({ children }: { children: React.ReactNode }) {
  // Sidebar starts visible on every page load; collapsing it only persists
  // for the current session.
  const [sidebarHidden, setSidebarHidden] = useState(false)
  function toggleSidebar() {
    setSidebarHidden(prev => !prev)
  }
  return (
    <div className="flex min-h-screen">
      {/* Sidebar — desktop only */}
      <Sidebar hidden={sidebarHidden} onToggle={toggleSidebar} />

      {/* Floating "open" button — desktop only, when sidebar is hidden */}
      {sidebarHidden && (
        <button
          onClick={toggleSidebar}
          className="hidden lg:flex fixed top-3 left-3 z-40 items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1.5 shadow-sm hover:bg-gray-50 text-gray-600 hover:text-[#1B2E6B] transition-colors"
          title="Show sidebar"
          aria-label="Show sidebar"
        >
          <PanelLeftOpen size={16} />
        </button>
      )}

      {/* Main content area */}
      <div className={`flex-1 flex flex-col min-w-0 ${sidebarHidden ? 'lg:pl-14' : 'lg:pl-64'}`}>
        <OfflineBanner />
        <div className="flex-1 max-w-lg lg:max-w-none mx-auto lg:mx-0 w-full bg-white shadow-sm lg:shadow-none">
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
