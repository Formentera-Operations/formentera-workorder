'use client'
import { Sparkles } from 'lucide-react'
import { useServiceWorkerUpdate } from '@/lib/use-sw-update'

export default function UpdatePrompt() {
  const { updateReady, applyUpdate } = useServiceWorkerUpdate()
  if (!updateReady) return null
  return (
    <button
      onClick={applyUpdate}
      className="w-full bg-[#1B2E6B] border-b border-[#0f1d4d] text-white text-xs px-4 py-2 flex items-center justify-center gap-2 hover:bg-[#162456] transition-colors"
      title="Reload the app to pick up the latest version"
    >
      <Sparkles size={14} />
      <span>Update ready — tap to reload</span>
    </button>
  )
}
