'use client'
import { useEffect, useState } from 'react'
import { WifiOff, CloudOff, CheckCircle2, AlertTriangle, ChevronRight } from 'lucide-react'
import { useOnline } from '@/lib/use-online'
import { useOutbox } from '@/lib/use-outbox'
import { startSyncWorker, flushOutbox } from '@/lib/sync-worker'
import FailedSyncModal from './FailedSyncModal'

export default function OfflineBanner() {
  const online = useOnline()
  const { pending, failed } = useOutbox()
  const [reviewOpen, setReviewOpen] = useState(false)

  // Boot the sync worker once on first mount of the shell.
  useEffect(() => {
    const stop = startSyncWorker()
    return () => { stop() }
  }, [])

  // Trigger a flush when we transition online.
  useEffect(() => {
    if (online) void flushOutbox()
  }, [online])

  if (online && pending === 0 && failed === 0) return null

  if (!online) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs px-4 py-2 flex items-center justify-center gap-2">
        <WifiOff size={14} />
        <span>
          You&apos;re offline — showing cached data.
          {pending > 0 ? ` ${pending} change${pending === 1 ? '' : 's'} will sync when you’re back online.` : ' Submissions are paused.'}
        </span>
      </div>
    )
  }

  if (failed > 0) {
    return (
      <>
        <button
          onClick={() => setReviewOpen(true)}
          className="w-full bg-red-50 border-b border-red-200 text-red-800 text-xs px-4 py-2 flex items-center justify-center gap-2 hover:bg-red-100 transition-colors"
        >
          <AlertTriangle size={14} />
          <span>{failed} change{failed === 1 ? '' : 's'} failed to sync. Tap to review.</span>
          <ChevronRight size={14} />
        </button>
        <FailedSyncModal open={reviewOpen} onClose={() => setReviewOpen(false)} />
      </>
    )
  }

  if (pending > 0) {
    return (
      <div className="bg-blue-50 border-b border-blue-200 text-blue-800 text-xs px-4 py-2 flex items-center justify-center gap-2">
        <CloudOff size={14} className="animate-pulse" />
        <span>Syncing {pending} change{pending === 1 ? '' : 's'}…</span>
      </div>
    )
  }

  return (
    <div className="bg-green-50 border-b border-green-200 text-green-800 text-xs px-4 py-2 flex items-center justify-center gap-2">
      <CheckCircle2 size={14} />
      <span>All changes synced.</span>
    </div>
  )
}
