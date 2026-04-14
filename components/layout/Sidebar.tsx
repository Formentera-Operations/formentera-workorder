'use client'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/AuthProvider'
import { NAV_ITEMS, ROLE_PERMISSIONS } from '@/lib/nav-config'

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { userName, role, signOut } = useAuth()

  const filteredItems = NAV_ITEMS.filter(item => !item.roles || item.roles.includes(role))

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
    <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-gray-200 z-30">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <Image
            src="/formentera_logo.jpg"
            alt="Formentera"
            width={36}
            height={36}
            className="rounded"
          />
          <span className="text-lg font-bold tracking-widest text-[#1B2E6B]">FORMENTERA</span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1 pl-0.5">Work Order App</p>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {filteredItems.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[#1B2E6B]/10 text-[#1B2E6B]'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* User section */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-[#1B2E6B] flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">{initials || '?'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{userName}</p>
            {ROLE_PERMISSIONS[role] && (
              <p className="text-xs text-gray-400">{ROLE_PERMISSIONS[role].label}</p>
            )}
          </div>
        </div>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          onClick={handleSignOut}
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
