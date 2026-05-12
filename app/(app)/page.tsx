'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Wrench } from 'lucide-react'
import KPIDashboard from '@/components/home/KPIDashboard'
import { useAuth } from '@/components/AuthProvider'
import { warmFormCaches } from '@/lib/warm-form-caches'

export default function HomePage() {
  const { role, assets: userAssets } = useAuth()
  const isAnalyst = role === 'analyst'

  // Pre-warm the new-ticket form's reference data (well/facility tree,
  // equipment types + names, employees, active tickets) while the user
  // reads the KPI cards. Without this, a foreman who taps "Submit a
  // Ticket" straight from the home page races the form-mount warm and
  // ends up waiting on the Equipment Type / Equipment dropdowns the
  // first time around. Analysts can't submit tickets so skip them.
  useEffect(() => {
    if (isAnalyst) return
    void warmFormCaches(userAssets)
    const onOnline = () => { void warmFormCaches(userAssets) }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [isAnalyst, userAssets])

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h1 className="text-base font-semibold text-gray-900">Work Order App</h1>
        <div className="h-0.5 w-16 bg-[#1B2E6B] mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4 lg:px-32">
        {/* Logo Banner */}
        <div className="relative w-full rounded-lg overflow-hidden mb-6 aspect-[5/1] lg:hidden">
          <Image
            src="/Formentera Workorder Banner.webp"
            alt="Formentera"
            fill
            className="object-cover object-center"
            priority
          />
        </div>

        {/* Submit section — hidden for analysts */}
        {!isAnalyst && (
          <>
            <h2 className="text-lg font-bold text-gray-900 text-center mb-4">Submit a Ticket</h2>
            <Link href="/maintenance/new" className="btn-primary">
              <Wrench size={18} />
              Maintenance Ticket
            </Link>
          </>
        )}

        {/* KPI Dashboard */}
        <KPIDashboard />
      </div>

    </div>
  )
}
