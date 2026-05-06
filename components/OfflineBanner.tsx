'use client'
import { WifiOff } from 'lucide-react'
import { useOnline } from '@/lib/use-online'

export default function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs px-4 py-2 flex items-center justify-center gap-2">
      <WifiOff size={14} />
      <span>You&apos;re offline — showing cached data. New tickets and edits are paused until you&apos;re back online.</span>
    </div>
  )
}
