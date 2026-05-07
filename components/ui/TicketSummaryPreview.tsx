'use client'
import { useEffect, useState } from 'react'
import { X, Camera } from 'lucide-react'
import PhotoImg from './PhotoImg'

interface TicketSummaryPreviewProps {
  ticketId: number
  onClose: () => void
}

// Inline ticket preview overlay. Used by:
//   - the new-ticket form's duplicate warning ("View ticket" → preview)
//   - the failed-sync review modal's queued duplicate ("View ticket" → preview)
// Both render the same compact summary instead of navigating away from the
// active form / review surface.
export default function TicketSummaryPreview({ ticketId, onClose }: TicketSummaryPreviewProps) {
  const [data, setData] = useState<{ ticket: Record<string, unknown>; dispatch: Record<string, unknown>[]; repairs: Record<string, unknown> | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/tickets/${ticketId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [ticketId])

  const t = data?.ticket || {}
  const dispatch = (data?.dispatch?.[0] as Record<string, unknown>) || {}
  const photos = (t.Issue_Photos as string[]) || []
  const fmtDate = (s: unknown) => s ? new Date(s as string).toLocaleString() : '—'
  const display = (v: unknown) => (v == null || v === '' ? '—' : String(v))

  const rows: Array<[string, unknown]> = [
    ['Status', t.Ticket_Status],
    ['Submitted', fmtDate(t.Issue_Date)],
    ['Submitted by', t.Created_by_Name],
    ['Department', t.Department],
    ['Asset', t.Asset],
    ['Field', t.Field],
    t.Location_Type === 'Well' ? ['Well', t.Well] : ['Facility', t.Facility],
    ['Equipment Type', t.Equipment_Type],
    ['Equipment', t.Equipment],
  ]

  const hasDispatch = !!dispatch.ticket_id
  const dispatchRows: Array<[string, unknown]> = []
  if (hasDispatch) {
    if (dispatch.work_order_decision) dispatchRows.push(['Work Order Decision', dispatch.work_order_decision])
    const estCost = (dispatch.Estimate_Cost ?? t.Estimate_Cost)
    if (estCost != null) dispatchRows.push(['Estimated Cost', `$${estCost}`])
    if (dispatch.self_dispatch_assignee) {
      dispatchRows.push(['Self Dispatch Assignee', dispatch.self_dispatch_assignee])
    } else if (dispatch.maintenance_foreman) {
      dispatchRows.push(['Assigned Foreman', dispatch.maintenance_foreman])
      if (dispatch.production_foreman) dispatchRows.push(['Additional Assignee', dispatch.production_foreman])
    }
    if (dispatch.date_assigned) dispatchRows.push(['Date Assigned', fmtDate(dispatch.date_assigned)])
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
      onClick={e => { e.stopPropagation(); onClose() }}
    >
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">Ticket #{ticketId}</h3>
          <button type="button" onClick={onClose} className="p-1 -mr-1">
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-center text-sm text-gray-400 py-8">Loading…</div>
          ) : !data?.ticket ? (
            <div className="text-center text-sm text-gray-400 py-8">Ticket not found.</div>
          ) : (
            <div className="space-y-4">
              {photos.length > 0 && (
                <div
                  className="relative w-full h-44 rounded-xl overflow-hidden cursor-pointer bg-gray-100"
                  onClick={() => setPhotoUrl(photos[0])}
                >
                  <PhotoImg url={photos[0]} alt="Issue" className="w-full h-full object-cover" />
                  {photos.length > 1 && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-black/60 text-white text-xs font-medium rounded-full backdrop-blur-sm">
                      <Camera size={12} />
                      <span>{photos.length}</span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-gray-700 mb-1">Maintenance Details</div>
                <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {rows.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3 px-3 py-2 text-xs">
                      <span className="text-gray-500">{label}</span>
                      <span className="text-gray-900 font-medium text-right">{display(value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {dispatchRows.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-1">Dispatch Details</div>
                  <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {dispatchRows.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-3 px-3 py-2 text-xs">
                        <span className="text-gray-500">{label}</span>
                        <span className="text-gray-900 font-medium text-right">{display(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!!t.Issue_Description && (
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-1">Issue Description</div>
                  <div className="text-sm text-gray-800 whitespace-pre-wrap">{t.Issue_Description as string}</div>
                </div>
              )}

              {!!t.Troubleshooting_Conducted && (
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-1">Troubleshooting Conducted</div>
                  <div className="text-sm text-gray-800 whitespace-pre-wrap">{t.Troubleshooting_Conducted as string}</div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
      {photoUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4"
          onClick={e => { e.stopPropagation(); setPhotoUrl(null) }}
        >
          <PhotoImg url={photoUrl} alt="Preview" className="max-w-full max-h-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}
