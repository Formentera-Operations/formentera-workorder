import { STATUS_EMOJI } from '@/lib/utils'
import type { TicketStatus } from '@/types'

export default function StatusBadge({ status }: { status: TicketStatus }) {
  const emoji = STATUS_EMOJI[status] ?? '⚪'
  return (
    <span className="status-pill">
      {status} {emoji}
    </span>
  )
}
