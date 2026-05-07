'use client'
import { X, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import { useOutbox } from '@/lib/use-outbox'
import { enqueue, remove, update, type OutboxAction } from '@/lib/outbox'
import { flushOutbox } from '@/lib/sync-worker'

function isCreateTicketAction(a: OutboxAction): boolean {
  return a.method === 'POST' && a.url === '/api/tickets'
}

async function submitAnyway(action: OutboxAction) {
  if (!isCreateTicketAction(action)) return
  // Re-queue the same payload with force: true so the server skips the
  // duplicate check this time.
  const body = (action.body && typeof action.body === 'object')
    ? { ...(action.body as Record<string, unknown>), force: true }
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
            return (
              <div key={a.id} className="px-4 py-3 space-y-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{a.description}</p>
                  <p className="text-xs text-red-600">
                    {isDup ? `Looks like a duplicate of ${dupes.map(d => `#${d.id}`).join(', ')}` : (a.error || 'Failed')}
                  </p>
                </div>

                {isDup && (
                  <div className="bg-gray-50 rounded-lg p-2 space-y-1">
                    {dupes.map(d => (
                      <p key={d.id} className="text-[11px] text-gray-700">
                        <span className="font-medium">#{d.id}</span>
                        {d.well || d.facility ? ` · ${d.well || d.facility}` : ''}
                        {d.equipment ? ` · ${d.equipment}` : ''}
                        {d.issue_date ? ` · ${String(d.issue_date).slice(0, 10)}` : ''}
                      </p>
                    ))}
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
    </div>
  )
}
