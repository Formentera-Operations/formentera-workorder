'use client'
import { useState } from 'react'
import { X, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import { useOutbox } from '@/lib/use-outbox'
import { enqueue, remove, update, type OutboxAction } from '@/lib/outbox'
import { flushOutbox } from '@/lib/sync-worker'
import { newRequestId } from '@/lib/utils'
import TicketSummaryPreview from './ui/TicketSummaryPreview'

function meaningfulDescription(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null
  if (['none', 'n/a', 'na', '-', '--'].includes(trimmed.toLowerCase())) return null
  return trimmed
}

function isCreateTicketAction(a: OutboxAction): boolean {
  return a.method === 'POST' && a.url === '/api/tickets'
}

async function submitAnyway(action: OutboxAction) {
  if (!isCreateTicketAction(action)) return
  // Re-queue the same payload with force: true (skip the dup check) and a
  // fresh client_request_id (server idempotency would otherwise return the
  // already-conflicting row instead of inserting a new ticket).
  const body = (action.body && typeof action.body === 'object')
    ? { ...(action.body as Record<string, unknown>), force: true, client_request_id: newRequestId() }
    : action.body
  await enqueue({
    url: action.url,
    method: action.method,
    headers: action.headers,
    body,
    description: action.description,
  })
  await remove(action.id)
  void flushOutbox()
}

async function retry(action: OutboxAction) {
  await update(action.id, { status: 'pending', retries: 0, error: undefined, meta: undefined })
  void flushOutbox()
}

function isConflictGuardedAction(a: OutboxAction): boolean {
  // PATCH /api/tickets/{id} — Initial Report edit
  if (a.method === 'PATCH' && /^\/api\/tickets\/\d+$/.test(a.url)) return true
  // POST /api/dispatch and POST /api/repairs — both check the parent
  // ticket's updated_at server-side and can return 412.
  if (a.method === 'POST' && (a.url === '/api/dispatch' || a.url === '/api/repairs')) return true
  return false
}

async function applyAnyway(action: OutboxAction) {
  // For 412 conflicts: re-queue without the client_updated_at stamp so the
  // server skips the guard. PATCH /api/tickets/{id} is diff-only so it only
  // overwrites fields the foreman touched; POST /api/dispatch and
  // POST /api/repairs intentionally update the ticket's status because
  // that's the whole point of dispatching or closing out. Keep the same
  // client_request_id so a successful Apply anyway can't double-insert.
  if (!isConflictGuardedAction(action)) return
  const body = (action.body && typeof action.body === 'object')
    ? { ...(action.body as Record<string, unknown>) }
    : action.body
  if (body && typeof body === 'object') {
    delete (body as Record<string, unknown>).client_updated_at
  }
  await enqueue({
    url: action.url,
    method: action.method,
    headers: action.headers,
    body,
    description: action.description,
  })
  await remove(action.id)
  void flushOutbox()
}

async function discard(action: OutboxAction) {
  await remove(action.id)
}

export default function FailedSyncModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions } = useOutbox()
  const [previewTicketId, setPreviewTicketId] = useState<number | null>(null)
  const failed = actions.filter(a => a.status === 'failed')
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              {failed.length} change{failed.length === 1 ? '' : 's'} failed to sync
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
          {failed.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No failed changes.</p>
          ) : failed.map(a => {
            const dupes = a.meta?.duplicates || []
            const isDup = isCreateTicketAction(a) && dupes.length > 0
            const conflict = a.meta?.conflict
            const isConflict = !!conflict
            return (
              <div key={a.id} className="px-4 py-3 space-y-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{a.description}</p>
                  <p className="text-xs text-red-600">
                    {isDup
                      ? `Looks like a duplicate of ${dupes.map(d => `#${d.id}`).join(', ')}`
                      : isConflict
                      ? `Ticket #${conflict.ticketId} was changed by someone else after you saved`
                      : (a.error || 'Failed')}
                  </p>
                </div>

                {isDup && (
                  <div className="space-y-2">
                    {dupes.map(d => (
                      <div key={d.id} className="rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-gray-900">
                            #{d.id}{d.Ticket_Status ? ` · ${d.Ticket_Status}` : ''}
                          </div>
                          <button
                            type="button"
                            onClick={() => setPreviewTicketId(d.id)}
                            className="text-[#1B2E6B] font-medium hover:underline"
                          >
                            View ticket
                          </button>
                        </div>
                        <div className="text-gray-500 mt-0.5">
                          {d.Issue_Date ? `Opened ${new Date(d.Issue_Date).toLocaleDateString()}` : ''}
                          {d.Created_by_Name ? ` by ${d.Created_by_Name}` : ''}
                          {d.assigned_foreman ? ` · Assigned to ${d.assigned_foreman}` : ''}
                        </div>
                        {meaningfulDescription(d.Issue_Description) && (
                          <div className="text-gray-700 mt-1 line-clamp-2">
                            {meaningfulDescription(d.Issue_Description)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {isConflict && (() => {
                  const createdBy = conflict.current.Created_by_Name ? String(conflict.current.Created_by_Name) : ''
                  const foreman = conflict.current.assigned_foreman ? String(conflict.current.assigned_foreman) : ''
                  const subtitleParts = [
                    createdBy ? `Submitted by ${createdBy}` : '',
                    foreman ? `Assigned to ${foreman}` : '',
                  ].filter(Boolean)

                  // Surface what the foreman is trying to change (from the
                  // queued body) alongside the current value on the server.
                  // PATCH bodies are diff-only so only touched fields show
                  // up; dispatch/repairs POSTs carry the whole submission
                  // and we extend the label map to cover their fields too.
                  const FIELD_LABELS: Record<string, string> = {
                    // Initial Report (PATCH /api/tickets/{id})
                    Issue_Description: 'Description',
                    Troubleshooting_Conducted: 'Troubleshooting',
                    Department: 'Department',
                    Location_Type: 'Location Type',
                    Asset: 'Asset',
                    Field: 'Field',
                    Well: 'Well',
                    Facility: 'Facility',
                    Area: 'Area',
                    Route: 'Route',
                    Equipment_Type: 'Equipment Type',
                    Equipment: 'Equipment',
                    assigned_foreman: 'Assigned Foreman',
                    Estimate_Cost: 'Estimated Cost',
                    Issue_Photos: 'Photos',
                    // Dispatch (POST /api/dispatch)
                    work_order_decision: 'Work Order Decision',
                    maintenance_foreman: 'Maintenance Foreman',
                    production_foreman: 'Production Foreman',
                    // Repairs / Closeout (POST /api/repairs)
                    final_status: 'Final Status',
                    repair_details: 'Repair Details',
                    start_date: 'Start Date',
                    date_completed: 'Date Completed',
                    repair_images: 'Repair Photos',
                  }
                  const body = (a.body && typeof a.body === 'object' ? a.body : {}) as Record<string, unknown>
                  const displayValue = (v: unknown, key?: string): string => {
                    if (v === null || v === undefined || v === '') return '(blank)'
                    if (Array.isArray(v)) {
                      const noun = key === 'repair_images' ? 'photo' : key === 'Issue_Photos' ? 'photo' : 'item'
                      return `${v.length} ${noun}${v.length === 1 ? '' : 's'}`
                    }
                    if (typeof v === 'number') return String(v)
                    return String(v)
                  }
                  // For dispatch/repairs, the action is intentionally going to
                  // change Ticket_Status — derive the new status from the body
                  // and show it as a synthetic comparison row so the foreman
                  // sees the actual collision (their proposed status vs the
                  // status sitting on the server right now).
                  const derivedStatus: string | null = (() => {
                    if (a.url === '/api/dispatch') {
                      const d = String(body.work_order_decision || '')
                      if (d.toLowerCase().startsWith('backlog')) return 'Backlogged'
                      if (d === 'Close Ticket - No Action Required') return 'Closed'
                      if (d) return 'In Progress'
                      return null
                    }
                    if (a.url === '/api/repairs') {
                      const f = String(body.final_status || '')
                      if (f === 'Backlog - Awaiting Parts' || f === 'Backlog - Not Economical') return 'Backlogged'
                      if (f === 'Repaired - Awaiting Final Cost') return 'Awaiting Cost'
                      if (f) return 'Closed'
                      return null
                    }
                    return null
                  })()
                  const pendingEdits: Array<{ key: string; label: string; mine: string; current: string }> = []
                  if (derivedStatus) {
                    pendingEdits.push({
                      key: '__resulting_status',
                      label: 'Resulting Status',
                      mine: derivedStatus,
                      current: displayValue(conflict.current.Ticket_Status),
                    })
                  }
                  for (const [k, v] of Object.entries(body)) {
                    if (!(k in FIELD_LABELS)) continue
                    pendingEdits.push({
                      key: k,
                      label: FIELD_LABELS[k],
                      mine: displayValue(v, k),
                      current: displayValue(conflict.current[k], k),
                    })
                  }

                  return (
                    <div className="space-y-2">
                      {pendingEdits.length > 0 && (
                        <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs">
                          <div className="font-semibold text-blue-900 mb-1">Your offline edit{pendingEdits.length === 1 ? '' : 's'}</div>
                          <div className="space-y-1">
                            {pendingEdits.map(p => (
                              <div key={p.key}>
                                <span className="font-medium text-blue-900">{p.label}:</span>{' '}
                                <span className="text-blue-900">{p.mine}</span>
                                {p.mine !== p.current && (
                                  <span className="text-blue-700"> (online now: {p.current})</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs">
                        <div className="font-semibold text-gray-900">
                          Latest version of #{conflict.ticketId}
                          {conflict.current.Ticket_Status ? ` · ${String(conflict.current.Ticket_Status)}` : ''}
                        </div>
                        <div className="text-gray-500 mt-0.5">
                          {subtitleParts.length > 0 ? subtitleParts.join(' · ') : '—'}
                        </div>
                        {meaningfulDescription(conflict.current.Issue_Description as string | undefined) && (
                          <div className="text-gray-700 mt-1 line-clamp-2">
                            {meaningfulDescription(conflict.current.Issue_Description as string | undefined)}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

                <div className="flex items-center gap-2">
                  {isDup ? (
                    <button
                      onClick={() => void submitAnyway(a)}
                      className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#1B2E6B] text-white hover:bg-[#162456] transition-colors"
                    >
                      Submit anyway
                    </button>
                  ) : isConflict ? (
                    <>
                      <button
                        onClick={() => setPreviewTicketId(conflict.ticketId)}
                        className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        View latest
                      </button>
                      <button
                        onClick={() => void applyAnyway(a)}
                        className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#1B2E6B] text-white hover:bg-[#162456] transition-colors"
                      >
                        Apply anyway
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => void retry(a)}
                      className="flex-1 flex items-center justify-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <RotateCcw size={12} /> Retry
                    </button>
                  )}
                  <button
                    onClick={() => void discard(a)}
                    className="flex items-center justify-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={12} /> Discard
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {previewTicketId !== null && (
        <TicketSummaryPreview
          ticketId={previewTicketId}
          onClose={() => setPreviewTicketId(null)}
        />
      )}
    </div>
  )
}
