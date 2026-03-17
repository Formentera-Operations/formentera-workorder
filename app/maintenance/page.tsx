'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Search, Calendar, Wrench } from 'lucide-react'
import TicketCard from '@/components/ui/TicketCard'
import BottomNav from '@/components/layout/BottomNav'
import { TICKET_STATUSES } from '@/lib/utils'
import type { TicketStatus } from '@/types'

export default function MaintenancePage() {
  const router = useRouter()
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
  const [foremanFilter, setForemanFilter] = useState('All')
  const [submittedByFilter, setSubmittedByFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'All'>('All')
  const [finalCostPending, setFinalCostPending] = useState(false)

  const [assets, setAssets] = useState<string[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [equipments, setEquipments] = useState<string[]>([])
  const [foremans, setForemans] = useState<string[]>([])
  const [submitters, setSubmitters] = useState<string[]>([])

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      mode: 'all',
      search, startDate, endDate,
      asset: assetFilter, department: deptFilter,
      equipment: equipFilter, status: statusFilter,
      foreman: foremanFilter, submittedBy: submittedByFilter,
      finalCostPending: String(finalCostPending),
    })
    try {
      const res = await fetch(`/api/tickets?${params}`)
      const json = await res.json()
      setTickets(json.data || [])

      const data = json.data || []
      setAssets([...new Set(data.map((t: Record<string, unknown>) => t.Asset as string))].sort() as string[])
      setDepartments([...new Set(data.map((t: Record<string, unknown>) => t.Department as string))].sort() as string[])
      setEquipments([...new Set(data.map((t: Record<string, unknown>) => t.Equipment as string))].sort() as string[])
      setForemans([...new Set(data.map((t: Record<string, unknown>) => t.assigned_foreman as string).filter(Boolean))].sort() as string[])
      setSubmitters([...new Set(data.map((t: Record<string, unknown>) => t.Created_by_Name as string))].sort() as string[])
    } finally {
      setLoading(false)
    }
  }, [search, startDate, endDate, assetFilter, deptFilter, equipFilter, statusFilter, foremanFilter, submittedByFilter, finalCostPending])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  useEffect(() => { setPage(1) }, [search, startDate, endDate, assetFilter, deptFilter, equipFilter, statusFilter, foremanFilter, submittedByFilter, finalCostPending])

  function resetFilters() {
    setSearch(''); setStartDate(''); setEndDate('')
    setAssetFilter('All'); setDeptFilter('All'); setEquipFilter('All')
    setForemanFilter('All'); setSubmittedByFilter('All')
    setStatusFilter('All'); setFinalCostPending(false)
  }

  const totalPages = Math.ceil(tickets.length / PAGE_SIZE)
  const visibleTickets = tickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const SelectFilter = ({ label, value, onChange, options }: {
    label: string; value: string; onChange: (v: string) => void; options: string[]
  }) => (
    <div>
      <label className="form-label">{label}</label>
      <div className="relative">
        <select className="form-select" value={value} onChange={e => onChange(e.target.value)}>
          <option value="All">All</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  )

  return (
    <div className="flex flex-col min-h-screen pb-16">
      <div className="px-4 py-3 border-b border-gray-200">
        <h1 className="text-base font-semibold text-gray-900">Maintenance</h1>
        <div className="h-0.5 w-16 bg-[#1B2E6B] mt-1" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4">
          <button className="btn-primary mb-4" onClick={() => router.push('/maintenance/new')}>
            <Wrench size={18} /> Maintenance Ticket
          </button>

          {/* Filters toggle */}
          <div
            className="flex items-center justify-between cursor-pointer mb-3"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <span className="text-sm font-semibold text-gray-700">Ticket Filters</span>
            <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center">
              {filtersOpen ? <ChevronUp size={14} className="text-white" /> : <ChevronDown size={14} className="text-white" />}
            </div>
          </div>

          {filtersOpen && (
            <div className="space-y-3 mb-4">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" className="form-input pl-9" placeholder="Search ID, Well, Facility, Route, Foreman, Submitted by..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>

              <button className="btn-primary" onClick={resetFilters}>Reset Filters</button>

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

              <SelectFilter label="Asset" value={assetFilter} onChange={setAssetFilter} options={assets} />
              <SelectFilter label="Department" value={deptFilter} onChange={setDeptFilter} options={departments} />
              <SelectFilter label="Equipment" value={equipFilter} onChange={setEquipFilter} options={equipments} />
              <SelectFilter label="Assigned Foreman" value={foremanFilter} onChange={setForemanFilter} options={foremans} />
              <SelectFilter label="Submitted By" value={submittedByFilter} onChange={setSubmittedByFilter} options={submitters} />

              {/* Status pills */}
              <div>
                <label className="form-label">Ticket Status</label>
                <div className="flex gap-2 flex-wrap">
                  {(['All', ...TICKET_STATUSES] as (TicketStatus | 'All')[]).map(s => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${statusFilter === s ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Final Cost Pending toggle */}
              <div className="flex items-center justify-between">
                <label className="form-label mb-0 text-sm">Final Cost Pending</label>
                <button
                  type="button"
                  onClick={() => setFinalCostPending(!finalCostPending)}
                  className={`w-12 h-6 rounded-full transition-colors ${finalCostPending ? 'bg-[#1B2E6B]' : 'bg-gray-300'}`}
                >
                  <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${finalCostPending ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
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
