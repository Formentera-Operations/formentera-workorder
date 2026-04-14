import { Home, Ticket, Wrench, BarChart2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  roles: string[] | null
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: Home, roles: null },
  { href: '/my-tickets', label: 'My Tickets', icon: Ticket, roles: ['field_user', 'foreman', 'admin'] },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench, roles: null },
  { href: '/analysis', label: 'Analysis', icon: BarChart2, roles: ['analyst', 'admin', 'foreman'] },
]

export const ROLE_PERMISSIONS: Record<string, { label: string; perms: string[] }> = {
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
