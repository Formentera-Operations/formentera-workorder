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

                {isConflict && (
                  <div className="rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs">
                    <div className="font-semibold text-gray-900">
                      Latest version of #{conflict.ticketId}
                      {conflict.current.Ticket_Status ? ` · ${String(conflict.current.Ticket_Status)}` : ''}
                    </div>
                    <div className="text-gray-500 mt-0.5">
                      {conflict.current.assigned_foreman ? `Assigned to ${String(conflict.current.assigned_foreman)}` : '—'}
                    </div>
                    {meaningfulDescription(conflict.current.Issue_Description as string | undefined) && (
                      <div className="text-gray-700 mt-1 line-clamp-2">
                        {meaningfulDescription(conflict.current.Issue_Description as string | undefined)}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {isDup ? (
                    <button
                      onClick={() => void submitAnyway(a)}
                      className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#1B2E6B] text-white hover:bg-[#162456] transition-colors"
                    >
                      Submit anyway
                    </button>
                  ) : isConflict ? (
                    <button
                      onClick={() => setPreviewTicketId(conflict.ticketId)}
                      className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#1B2E6B] text-white hover:bg-[#162456] transition-colors"
                    >
                      View latest
                    </button>
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
