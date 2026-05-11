// Derives an "optimistic" view of a ticket's state by overlaying any queued
// (pending/syncing — not failed) actions in the outbox on top of the server
// data. Without this, a foreman who dispatches or comments offline would
// reload the ticket and see "Open" + missing comments and think their work
// didn't go through.
//
// Failed actions are NOT overlaid — those surface in the Failed Sync modal
// and shouldn't pollute the optimistic view.

import type { OutboxAction } from './outbox'

export interface OptimisticView {
  // Status the ticket will end up with once queued actions sync. May differ
  // from the server's Ticket_Status when a dispatch or closeout is queued.
  resultingStatus: string | null
  pendingDispatch: OutboxAction | null
  pendingRepairs: OutboxAction | null
  // Comments queued for this ticket that haven't synced yet. Caller appends
  // these to the server-side comments list with a Syncing pill.
  pendingComments: Array<{
    outboxId: string
    body: string
    author_name: string
    created_at: string
    parent_id: number | null
  }>
  // Pending DELETE actions on existing comments — caller filters these out
  // of the displayed list (or marks them as Removing).
  pendingCommentDeletes: Set<number>
  // True if any queued action is actively syncing/pending for this ticket.
  hasPending: boolean
}

function isActive(a: OutboxAction): boolean {
  return a.status === 'pending' || a.status === 'syncing'
}

function getTicketIdFromBody(a: OutboxAction): number | null {
  const body = (a.body && typeof a.body === 'object' ? a.body : {}) as Record<string, unknown>
  const raw = body.ticket_id
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function matchesTicket(a: OutboxAction, ticketId: number): boolean {
  if (a.url === '/api/dispatch' || a.url === '/api/repairs' || a.url === '/api/comments') {
    return getTicketIdFromBody(a) === ticketId
  }
  const m = /^\/api\/tickets\/(\d+)/.exec(a.url)
  if (m) return parseInt(m[1], 10) === ticketId
  return false
}

function deriveStatusFromDispatch(body: Record<string, unknown>): string | null {
  const d = String(body.work_order_decision || '')
  if (!d) return null
  if (d.toLowerCase().startsWith('backlog')) return 'Backlogged'
  if (d === 'Close Ticket - No Action Required') return 'Closed'
  return 'In Progress'
}

function deriveStatusFromRepairs(body: Record<string, unknown>): string | null {
  const f = String(body.final_status || '')
  if (!f) return null
  if (f === 'Backlog - Awaiting Parts' || f === 'Backlog - Not Economical') return 'Backlogged'
  if (f === 'Repaired - Awaiting Final Cost') return 'Awaiting Cost'
  return 'Closed'
}

// Lightweight per-ticket lookup used by the list pages (My Tickets,
// Maintenance) so each TicketCard can show a Syncing pill + the
// optimistic resulting status without each row re-walking the entire
// outbox. Callers compute it once and look up by ticket id.
export interface OptimisticListEntry {
  syncing: boolean
  resultingStatus: string | null
}

export function buildOptimisticListMap(actions: OutboxAction[]): Map<number, OptimisticListEntry> {
  const out = new Map<number, OptimisticListEntry>()
  const active = actions.filter(isActive)
  for (const a of active) {
    let ticketId: number | null = null
    let status: string | null = null
    if (a.url === '/api/dispatch' && a.method === 'POST') {
      ticketId = getTicketIdFromBody(a)
      status = deriveStatusFromDispatch((a.body || {}) as Record<string, unknown>)
    } else if (a.url === '/api/repairs' && a.method === 'POST') {
      ticketId = getTicketIdFromBody(a)
      status = deriveStatusFromRepairs((a.body || {}) as Record<string, unknown>)
    } else if (a.url === '/api/comments') {
      ticketId = getTicketIdFromBody(a)
    } else {
      const m = /^\/api\/tickets\/(\d+)/.exec(a.url)
      if (m) ticketId = parseInt(m[1], 10)
    }
    if (ticketId === null) continue
    const prev = out.get(ticketId)
    out.set(ticketId, {
      syncing: true,
      // Last-write-wins for status — a later dispatch/closeout supersedes
      // an earlier one. Null status (e.g. from a comment) doesn't clear a
      // prior derived status.
      resultingStatus: status ?? prev?.resultingStatus ?? null,
    })
  }
  return out
}

export function buildOptimisticView(
  actions: OutboxAction[],
  ticketId: number,
  currentUserName: string | null | undefined,
): OptimisticView {
  const active = actions.filter(isActive).filter(a => matchesTicket(a, ticketId))

  // Newest queued action of each kind wins — the foreman might have
  // re-dispatched after their first attempt failed and was retried.
  const sorted = [...active].sort((a, b) => a.createdAt - b.createdAt)

  let pendingDispatch: OutboxAction | null = null
  let pendingRepairs: OutboxAction | null = null
  let resultingStatus: string | null = null
  const pendingComments: OptimisticView['pendingComments'] = []
  const pendingCommentDeletes = new Set<number>()

  for (const a of sorted) {
    if (a.url === '/api/dispatch' && a.method === 'POST') {
      pendingDispatch = a
      const body = (a.body || {}) as Record<string, unknown>
      const status = deriveStatusFromDispatch(body)
      if (status) resultingStatus = status
    } else if (a.url === '/api/repairs' && a.method === 'POST') {
      pendingRepairs = a
      const body = (a.body || {}) as Record<string, unknown>
      const status = deriveStatusFromRepairs(body)
      if (status) resultingStatus = status
    } else if (a.url === '/api/comments') {
      const body = (a.body || {}) as Record<string, unknown>
      if (a.method === 'POST' && typeof body.body === 'string' && body.body.trim()) {
        pendingComments.push({
          outboxId: a.id,
          body: body.body,
          author_name: (body.author_name as string) || currentUserName || 'You',
          created_at: new Date(a.createdAt).toISOString(),
          parent_id: typeof body.parent_id === 'number' ? body.parent_id : null,
        })
      } else if (a.method === 'DELETE' && typeof body.id === 'number') {
        pendingCommentDeletes.add(body.id)
      }
    }
  }

  return {
    resultingStatus,
    pendingDispatch,
    pendingRepairs,
    pendingComments,
    pendingCommentDeletes,
    hasPending: active.length > 0,
  }
}
