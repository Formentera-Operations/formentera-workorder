'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, Ticket, Wrench, LogOut, BarChart2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/AuthProvider'
import { useState } from 'react'

const ROLE_PERMISSIONS: Record<string, { label: string; perms: string[] }> = {
  field_user: {
    label: 'Field User',
    perms: ['Submit new tickets', 'View all tickets (read-only)'],
  },
  foreman: {
    label: 'Foreman',
    perms: ['Submit new tickets', 'Edit tickets in your asset', 'Dispatch and close tickets'],
  },
  admin: {
    label: 'Admin',
    perms: ['Full access to all tickets and settings'],
  },
  analyst: {
    label: 'Analyst',
    perms: ['View-only access', 'Access to Analytics dashboard'],
  },
}

const BASE_NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home, roles: null },
  { href: '/my-tickets', label: 'My Tickets', icon: Ticket, roles: ['field_user', 'foreman', 'admin'] },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench, roles: null },
  { href: '/analysis', label: 'Analysis', icon: BarChart2, roles: ['analyst', 'admin', 'foreman'] },
]

export default function BottomNav() {
  const pathname = usePathname()
  const { userName, role, signOut } = useAuth()

  const NAV_ITEMS = BASE_NAV_ITEMS.filter(item => !item.roles || item.roles.includes(role))
  const router = useRouter()
  const [showUserMenu, setShowUserMenu] = useState(false)

  const initials = userName
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  return (
    <>
      {showUserMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowUserMenu(false)} />
          <div className="fixed bottom-16 right-4 z-40 bg-white rounded-xl shadow-lg border border-gray-200 w-56 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs text-gray-400">Signed in as</p>
              <p className="text-sm font-semibold text-gray-900 truncate">{userName}</p>
              {ROLE_PERMISSIONS[role] && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-gray-500">{ROLE_PERMISSIONS[role].label}</p>
                  <ul className="mt-1 space-y-0.5">
                    {ROLE_PERMISSIONS[role].perms.map(p => (
                      <li key={p} className="text-xs text-gray-400">• {p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
              onClick={handleSignOut}
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        </>
      )}

      <nav className="nav-bar pb-safe">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link key={href} href={href} className={cn('nav-item', isActive && 'active')}>
              <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
              <span>{label}</span>
            </Link>
          )
        })}

        <button className="nav-item" onClick={() => setShowUserMenu(!showUserMenu)}>
          <div className="w-6 h-6 rounded-full bg-[#1B2E6B] flex items-center justify-center">
            <span className="text-white text-[9px] font-bold leading-none">{initials || '?'}</span>
          </div>
          <span className="truncate max-w-[50px]">{userName.split(' ')[0] || 'Me'}</span>
        </button>
      </nav>
    </>
  )
}
