'use client'
import { ImageIcon, Loader2 } from 'lucide-react'
import PhotoImg from './PhotoImg'

interface QueuedTicketCardProps {
  asset: string
  locationLabel: string
  equipment: string
  issuePhotos?: string[]
}

// Optimistic placeholder for tickets submitted offline that haven't synced
// yet. Renders the same shape as TicketCard so My Tickets feels coherent,
// but keyed off outbox state instead of a server row.
export default function QueuedTicketCard({
  asset, locationLabel, equipment, issuePhotos,
}: QueuedTicketCardProps) {
  const hasPhoto = issuePhotos && issuePhotos.length > 0
  return (
    <div className="ticket-card bg-blue-50 border-blue-100 cursor-default opacity-90">
      <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {hasPhoto ? (
          <PhotoImg url={issuePhotos[0]} alt="Issue" className="w-full h-full object-cover rounded-lg" />
        ) : (
          <ImageIcon size={24} className="text-gray-300" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">Asset: {asset}</p>
        <p className="text-xs text-gray-500 truncate mt-0.5">{locationLabel}</p>
        <p className="text-xs text-gray-500 truncate">Equipment: {equipment}</p>
      </div>

      <div className="flex-shrink-0">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[11px] font-medium">
          <Loader2 size={10} className="animate-spin" />
          Syncing
        </span>
      </div>
    </div>
  )
}
