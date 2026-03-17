'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Search, Calendar } from 'lucide-react'
import TicketCard from '@/components/ui/TicketCard'
import BottomNav from '@/components/layout/BottomNav'
import { useAuth } from '@/components/AuthProvider'
import { TICKET_STATUSES } from '@/lib/utils'
import type { TicketStatus } from '@/types'

export default function MyTicketsPage() {
  const router = useRouter()
  const { userEmail, userName } = useAuth()
  const [tickets, setTickets] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [assetFilter, setAssetFilter] = useState('All')
  const [deptFilter, setDeptFilter] = useState('All')
  const [equipFilter, setEquipFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'All'>('All')

  // For filter dropdown options
  const [assets, setAssets] = useState<string[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [equipments, setEquipments] = useState<string[]>([])

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      mode: 'mine',
      userEmail,
      userName,
      search, startDate, endDate,
      asset: assetFilter, department: deptFilter,
      equipment: equipFilter, status: statusFilter,
    })
    try {
      const res = await fetch(`/api/tickets?${params}`)
      const json = await res.json()
      setTickets(json.data || [])

      // Build filter options from results
      const uniqueAssets = [...new Set((json.data || []).map((t: Record<string, unknown>) => t.Asset as string))].sort() as string[]
      const uniqueDepts = [...new Set((json.data || []).map((t: Record<string, unknown>) => t.Department as string))].sort() as string[]
      const uniqueEquip = [...new Set((json.data || []).map((t: Record<string, unknown>) => t.Equipment as string))].sort() as string[]
      setAssets(uniqueAssets)
      setDepartments(uniqueDepts)
      setEquipments(uniqueEquip)
    } finally {
      setLoading(false)
    }
  }, [search, startDate, endDate, assetFilter, deptFilter, equipFilter, statusFilter])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [search, startDate, endDate, assetFilter, deptFilter, equipFilter, statusFilter])

  function resetFilters() {
    setSearch(''); setStartDate(''); setEndDate('')
    setAssetFilter('All'); setDeptFilter('All'); setEquipFilter('All'); setStatusFilter('All')
  }

  const totalPages = Math.ceil(tickets.length / PAGE_SIZE)
  const visibleTickets = tickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col min-h-screen pb-16">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h1 className="text-base font-semibold text-gray-900">My Tickets</h1>
        <div className="h-0.5 w-16 bg-[#1B2E6B] mt-1" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Filter section */}
        <div className="px-4 pt-4 pb-2">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <span className="text-sm font-semibold text-gray-700">Ticket Filters</span>
            <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center">
              {filtersOpen
                ? <ChevronUp size={14} className="text-white" />
                : <ChevronDown size={14} className="text-white" />
              }
            </div>
          </div>

          {filtersOpen && (
            <div className="mt-3 space-y-3">
              {/* Search */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  className="form-input pl-9"
                  placeholder="Search ID, Well, Facility, Route..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              <button className="btn-primary" onClick={resetFilters}>Reset Filters</button>

              {/* Date Range */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Date Range</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label text-xs">Start Date</label>
                    <div className="relative">
                      <input type="date" className="form-input pr-8 text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} />
                      <Calendar size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="form-label text-xs">End Date</label>
                    <div className="relative">
                      <input type="date" className="form-input pr-8 text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} />
                      <Calendar size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Asset */}
              <div>
                <label className="form-label">Asset</label>
                <div className="relative">
                  <select className="form-select" value={assetFilter} onChange={e => setAssetFilter(e.target.value)}>
                    <option value="All">All</option>
                    {assets.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Department */}
              <div>
                <label className="form-label">Department</label>
                <div className="relative">
                  <select className="form-select" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                    <option value="All">All</option>
                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Equipment */}
              <div>
                <label className="form-label">Equipment</label>
                <div className="relative">
                  <select className="form-select" value={equipFilter} onChange={e => setEquipFilter(e.target.value)}>
                    <option value="All">All</option>
                    {equipments.map(eq => <option key={eq} value={eq}>{eq}</option>)}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Status pills */}
              <div>
                <label className="form-label">Ticket Status</label>
                <div className="flex gap-2 flex-wrap">
                  {(['All', ...TICKET_STATUSES] as (TicketStatus | 'All')[]).map(s => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        statusFilter === s ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Ticket list */}
        <div className="px-4 pb-4 space-y-3">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading tickets…</div>
          ) : tickets.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">No tickets found.</div>
          ) : (
            visibleTickets.map((t) => {
              const ticket = t as Record<string, unknown>
              const locationLabel = ticket.Facility
                ? `Facility: ${ticket.Facility}`
                : ticket.Well
                ? `Well: ${ticket.Well}`
                : ticket.Field as string || ''
              return (
                <TicketCard
                  key={ticket.id as number}
                  id={ticket.id as number}
                  Asset={ticket.Asset as string}
                  locationLabel={locationLabel}
                  Equipment={ticket.Equipment as string}
                  Ticket_Status={ticket.Ticket_Status as TicketStatus}
                  Issue_Photos={ticket.Issue_Photos as string[]}
                  onClick={() => router.push(`/maintenance/${ticket.id}`)}
                />
              )
            })
          )}

          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 pb-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-600 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-600 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
