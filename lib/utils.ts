import { type ClassValue, clsx } from 'clsx'
import { format, parseISO } from 'date-fns'
import type { TicketStatus } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatDate(dateStr: string | null | undefined, fmt = 'MMM d, yyyy, h:mm a'): string {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), fmt)
  } catch {
    return dateStr
  }
}

export function formatDateShort(dateStr: string | null | undefined): string {
  return formatDate(dateStr, 'MM/dd/yyyy hh:mm a')
}

export const STATUS_EMOJI: Record<string, string> = {
  'Open':           '🟢',
  'Backlogged':     '🟡',
  'In Progress':    '🟣',
  'Awaiting Cost':  '⚫',
  'Closed':         '🔴',
}

export const STATUS_COLORS: Record<TicketStatus, { dot: string; label: string }> = {
  Open:           { dot: 'bg-green-500',  label: 'text-gray-700' },
  Closed:         { dot: 'bg-red-500',    label: 'text-gray-700' },
  'In Progress':  { dot: 'bg-purple-500', label: 'text-gray-700' },
  Backlogged:     { dot: 'bg-yellow-400', label: 'text-gray-700' },
  'Awaiting Cost':{ dot: 'bg-gray-500',   label: 'text-gray-700' },
}

export const DEPARTMENTS = [
  '🏭 Production Operations',
  '🦺 HSE',
  '🛠️ Repair and Maintenance',
  '⚡ Electrical',
  '🔁 Automation',
  '📊 Measurement',
  '⚙️ Compression',
  '🧪 Chemical',
  '📒 Engineering',
]

export const LOCATION_TYPES = ['Well', 'Facility']

export const TICKET_STATUSES: TicketStatus[] = [
  'Open', 'Closed', 'In Progress', 'Backlogged', 'Awaiting Cost'
]

export const WORK_ORDER_DECISIONS = [
  'Proceed with Repair',
  'Monitor',
  'No Action Required',
  'Parts on Order',
  'Waiting on Vendor',
]

export const FINAL_STATUSES = [
  'Repaired – Returned to Service',
  'Replaced – Returned to Service',
  'Monitoring – No Repair Needed',
  'Parts Ordered – Pending Repair',
  'Deferred – Scheduled for Later',
  'Unable to Repair – Escalated',
]

export const PRIORITY_OPTIONS = ['Low', 'Medium', 'High', 'Urgent / Critical']

// Cross-filter helper — same logic as the Retool dropdowns
export function filterOptions(
  data: Record<string, string[]>,
  targetKey: string,
  filters: Record<string, string | null>
): string[] {
  const keys = Object.keys(data)
  const len = (data[keys[0]] ?? []).length
  const out: string[] = []

  for (let i = 0; i < len; i++) {
    let match = true
    for (const [key, val] of Object.entries(filters)) {
      if (val && data[key]?.[i] !== val) {
        match = false
        break
      }
    }
    if (match) {
      const v = data[targetKey]?.[i]
      if (v != null && String(v).trim() !== '' && String(v).toLowerCase() !== 'null') {
        out.push(v)
      }
    }
  }

  return [...new Set(out)].sort()
}
