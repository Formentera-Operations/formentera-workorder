import { WifiOff } from 'lucide-react'

export const metadata = { title: 'Offline — Formentera' }

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <WifiOff size={28} className="text-amber-700" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">You&apos;re offline</h1>
        <p className="text-sm text-gray-600 mb-4">
          This page hasn&apos;t been visited yet, so it isn&apos;t available offline.
          Open the pages you need while you have signal — they&apos;ll be cached for next time.
        </p>
        <p className="text-xs text-gray-400">
          Edits you make on cached pages will be queued and synced automatically when you&apos;re back online.
        </p>
      </div>
    </div>
  )
}
