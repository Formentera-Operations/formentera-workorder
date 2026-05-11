import { type ClassValue, clsx } from 'clsx'
import { format, parseISO } from 'date-fns'
import type { TicketStatus } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

// Stable per-submit identifier used as the server-side idempotency key
// for ticket inserts. crypto.randomUUID is widely supported on the
// platforms we target; the fallback covers anything missing it.
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// Convert a UTC ISO timestamp to the "YYYY-MM-DDTHH:MM" shape that
// <input type="datetime-local"> expects, rendered in the user's local
// time. Returns '' for nullish input so it slots straight into a
// controlled input's `value`.
export function utcToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Reverse of utcToLocalInput — takes the local "YYYY-MM-DDTHH:MM" value
// the datetime-local input produces and returns a UTC ISO string so the
// server stores a properly-anchored timestamptz.
export function localInputToUtc(local: string | null | undefined): string | null {
  if (!local) return null
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
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
  'Backlog - Uneconomic / Awaiting Part',
  'Close Ticket - No Action Required',
]

export const FINAL_STATUSES = [
  'Repaired - Returned to Service',
  'No Action - Returned to Service',
  'Repaired - Awaiting Final Cost',
  'Backlog - Awaiting Parts',
  'Backlog - Not Economical',
  'Decommissioned / Retired',
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
