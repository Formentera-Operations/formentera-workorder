'use client'
import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'

// ─────────────────────────────────────────────────────────────────────────
// TEMPORARY cutover gate (Retool → Work Order App, 2026-06-10).
//
// Until 5:30 PM Central on cutover day, everyone except the cutover admin sees
// a holding page instead of the app, so field users don't start submitting in
// the new app before Retool is retired at 5:00 PM. The gate self-clears at the
// cutoff (re-checked every 10s), so no one needs to be told to refresh.
//
// SAFE TO DELETE after cutover: remove this file and its <CutoverGate> wrapper
// in app/(app)/layout.tsx.
// ─────────────────────────────────────────────────────────────────────────

// 5:30 PM CDT (UTC-5) on 2026-06-10. Pinned as a UTC instant so a device in
// the wrong timezone (or with a nonstandard clock setting) still flips at the
// same real-world moment.
const CUTOVER_AT = Date.parse('2026-06-10T22:30:00Z')

// Only these emails keep full access before the cutoff.
const BYPASS_EMAILS = ['alejandro.benavides@formenteraops.com']

function HoldingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <div className="max-w-sm w-full rounded-2xl bg-white shadow-sm border border-gray-100 px-6 py-10">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#1B2E6B]/10">
          <Clock size={26} className="text-[#1B2E6B]" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Almost there</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          The Work Order App goes live today at{' '}
          <span className="font-semibold text-gray-900">5:30 PM Central</span>.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Keep using Retool until 5:00 PM. Check back here after 5:30 to start
          submitting tickets in the new app.
        </p>
      </div>
      <p className="mt-6 text-xs text-gray-400">Formentera Work Order App</p>
    </div>
  )
}

export default function CutoverGate({ children }: { children: React.ReactNode }) {
  const { userEmail } = useAuth()
  // `now` stays null until the client mounts — keeps SSR and the first client
  // render identical (both render the holding page) so there's no hydration
  // mismatch, then the effect ticks it forward.
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  const pastCutoff = now != null && now >= CUTOVER_AT
  const bypass = !!userEmail && BYPASS_EMAILS.includes(userEmail.toLowerCase())

  // Show the app once we're past the cutoff (for everyone) or for a bypass
  // user. Until then — including while auth/time are still resolving — hold,
  // so the app never flashes to a gated field user.
  if (pastCutoff || bypass) return <>{children}</>
  return <HoldingPage />
}
