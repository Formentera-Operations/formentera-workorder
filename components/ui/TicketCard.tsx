import { ImageIcon } from 'lucide-react'
import StatusBadge from './StatusBadge'
import PhotoImg from './PhotoImg'
import type { TicketStatus } from '@/types'

const STATUS_BG: Record<string, string> = {
  'Open':           'bg-green-50  border-green-100',
  'In Progress':    'bg-purple-50 border-purple-100',
  'Backlogged':     'bg-yellow-50 border-yellow-100',
  'Awaiting Cost':  'bg-gray-50   border-gray-200',
  'Closed':         'bg-red-50    border-red-100',
}

interface TicketCardProps {
  id: number
  Asset: string
  locationLabel: string // "Facility: X" or "Well: X"
  Equipment: string
  Ticket_Status: TicketStatus
  Issue_Photos?: string[]
  onClick?: () => void
}

export default function TicketCard({
  Asset,
  locationLabel,
  Equipment,
  Ticket_Status,
  Issue_Photos,
  onClick,
}: TicketCardProps) {
  const hasPhoto = Issue_Photos && Issue_Photos.length > 0
  const bgClass = STATUS_BG[Ticket_Status] ?? 'bg-white border-gray-100'

  return (
    <div className={`ticket-card ${bgClass}`} onClick={onClick}>
      {/* Thumbnail */}
      <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {hasPhoto ? (
          <PhotoImg url={Issue_Photos[0]} alt="Issue" className="w-full h-full object-cover rounded-lg" />
        ) : (
          <ImageIcon size={24} className="text-gray-300" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">Asset: {Asset}</p>
        <p className="text-xs text-gray-500 truncate mt-0.5">{locationLabel}</p>
        <p className="text-xs text-gray-500 truncate">Equipment: {Equipment}</p>
      </div>

      {/* Status */}
      <div className="flex-shrink-0">
        <StatusBadge status={Ticket_Status} />
      </div>
    </div>
  )
}
