'use client'
import Link from 'next/link'
import Image from 'next/image'
import { Wrench } from 'lucide-react'
import KPIDashboard from '@/components/home/KPIDashboard'
import { useAuth } from '@/components/AuthProvider'

export default function HomePage() {
  const { role } = useAuth()
  const isAnalyst = role === 'analyst'

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h1 className="text-base font-semibold text-gray-900">Work Order App</h1>
        <div className="h-0.5 w-16 bg-[#1B2E6B] mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4">
        {/* Logo Banner */}
        <div className="relative w-full h-28 rounded-lg overflow-hidden mb-6">
          <Image
            src="/Formentera Workorder Banner.webp"
            alt="Formentera"
            fill
            className="object-cover"
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
