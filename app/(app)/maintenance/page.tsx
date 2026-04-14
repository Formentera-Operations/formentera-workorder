'use client'
import { Suspense } from 'react'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp, Search, Calendar, Wrench, SlidersHorizontal } from 'lucide-react'
import TicketCard from '@/components/ui/TicketCard'
import { useAuth } from '@/components/AuthProvider'
import { TICKET_STATUSES, STATUS_EMOJI } from '@/lib/utils'
import type { TicketStatus } from '@/types'

const PAGE_SIZE = 20

function MaintenancePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { assets: userAssets, role } = useAuth()
  const [tickets, setTickets] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(() => !!(searchParams.get('equipment') || searchParams.get('startDate') || searchParams.get('status') || searchParams.get('department')))
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  const [ticketId, setTicketId] = useState('')
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState(() => searchParams.get('startDate') || '')
  const [endDate, setEndDate] = useState(() => searchParams.get('endDate') || '')
  const [assetFilter, setAssetFilter] = useState('All')
  const [deptFilter, setDeptFilter] = useState(() => searchParams.get('department') || 'All')
  const [equipFilter, setEquipFilter] = useState(() => searchParams.get('equipment') || 'All')
  const [foremanFilter, setForemanFilter] = useState('All')
  const [submittedByFilter, setSubmittedByFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'All'>(() => (searchParams.get('status') as TicketStatus) || 'All')
  const [assets, setAssets] = useState<string[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [equipments, setEquipments] = useState<string[]>([])
  const [foremans, setForemans] = useState<string[]>([])
  const [submitters, setSubmitters] = useState<string[]>([])

  useEffect(() => {
    const params = new URLSearchParams({ mode: 'all' })
    if (userAssets.length > 0) params.set('userAssets', userAssets.join(','))
    fetch(`/api/tickets/options?${params}`)
      .then(r => r.json())
      .then(json => {
        setAssets(json.assets || [])
        setDepartments(json.departments || [])
        setEquipments(json.equipments || [])
        setForemans(json.foremans || [])
        setSubmitters(json.submitters || [])
      })
  }, [userAssets])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({
      mode: 'all',
      ticketId,
      search, startDate, endDate,
      asset: assetFilter, department: deptFilter,
      equipment: equipFilter, status: statusFilter,
      foreman: foremanFilter, submittedBy: submittedByFilter,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (userAssets.length > 0) params.set('userAssets', userAssets.join(','))
    fetch(`/api/tickets?${params}`)
      .then(res => res.json())
      .then(json => {
        if (!cancelled) {
          setTickets(json.data || [])
          setTotalCount(json.count ?? 0)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page, ticketId, search, startDate, endDate, assetFilter, deptFilter, equipFilter, statusFilter, foremanFilter, submittedByFilter, userAssets])

  useEffect(() => { setPage(0) }, [ticketId, search, startDate, endDate, assetFilter, deptFilter, equipFilter, statusFilter, foremanFilter, submittedByFilter])

  function resetFilters() {
    setTicketId(''); setSearch(''); setStartDate(''); setEndDate('')
    setAssetFilter('All'); setDeptFilter('All'); setEquipFilter('All')
    setForemanFilter('All'); setSubmittedByFilter('All')
    setStatusFilter('All')
    setPage(0)
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const SearchableSelectFilter = ({ label, value, onChange, options }: {
    label: string; value: string; onChange: (v: string) => void; options: string[]
  }) => {
    const [open, setOpen] = useState(false)
    const [q, setQ] = useState('')
    const filtered = q ? options.filter(o => o.toLowerCase().includes(q.toLowerCase())) : options
    return (
      <div className="relative">
        <label className="form-label">{label}</label>
        <button
          type="button"
          className="form-select text-left w-full flex items-center justify-between"
          onClick={() => setOpen(v => !v)}
        >
          <span className={value === 'All' ? 'text-gray-400' : 'text-gray-900'}>
            {value === 'All' ? `All` : value}
          </span>
          <ChevronDown size={16} className="text-gray-400 shrink-0" />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setQ('') }} />
            <div className="absolute left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl">
              <div className="p-2 border-b border-gray-100">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    autoFocus
                    type="text"
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                    placeholder="Search..."
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              </div>
              <ul className="max-h-64 overflow-y-auto py-1">
                <li
                  className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 ${value === 'All' ? 'font-medium text-[#1B2E6B]' : 'text-gray-700'}`}
                  onClick={() => { onChange('All'); setOpen(false); setQ('') }}
                >
                  All
                </li>
                {filtered.map(o => (
                  <li
                    key={o}
                    className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 ${value === o ? 'font-medium text-[#1B2E6B]' : 'text-gray-700'}`}
                    onClick={() => { onChange(o); setOpen(false); setQ('') }}
                  >
                    {o}
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-4 py-2 text-sm text-gray-400">No results</li>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h1 className="text-base font-semibold text-gray-900">Maintenance</h1>
        <div className="h-0.5 w-16 bg-[#1B2E6B] mt-1" />
      </div>

      {/* Action bar + filter trigger — outside scroll so dropdown isn't clipped */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 relative z-20">
        {role !== 'analyst' && (
          <button className="btn-primary mb-3" onClick={() => router.push('/maintenance/new')}>
            <Wrench size={18} /> Maintenance Ticket
          </button>
        )}

        {/* Filter trigger */}
        <button
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 bg-white"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <SlidersHorizontal size={15} className="text-gray-500" />
            Ticket Filters
          </div>
          <div className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center">
            {filtersOpen
              ? <ChevronUp size={12} className="text-white" />
              : <ChevronDown size={12} className="text-white" />}
          </div>
        </button>

        {/* Floating dropdown panel */}
        {filtersOpen && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-30" onClick={() => setFiltersOpen(false)} />

            {/* Panel */}
            <div className="absolute left-4 right-4 top-full z-40 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-[70vh] overflow-y-auto">
              <div className="p-4 space-y-3">
                <div>
                  <label className="form-label">Ticket ID</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" className="form-input" placeholder="e.g. 1042" value={ticketId} onChange={e => setTicketId(e.target.value.replace(/\D/g, ''))} />
                </div>

                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" className="form-input pl-9" placeholder="Search Well, Facility, Route, Foreman, Submitted by..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>

                <button className="btn-primary" onClick={() => { resetFilters(); setFiltersOpen(false) }}>Reset Filters</button>

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

                {userAssets.length !== 1 && (
                  <SearchableSelectFilter label="Asset" value={assetFilter} onChange={setAssetFilter} options={assets} />
                )}
                <SearchableSelectFilter label="Department" value={deptFilter} onChange={setDeptFilter} options={departments} />
                <SearchableSelectFilter label="Equipment" value={equipFilter} onChange={setEquipFilter} options={equipments} />
                <SearchableSelectFilter label="Assigned Foreman" value={foremanFilter} onChange={setForemanFilter} options={foremans} />
                <SearchableSelectFilter label="Submitted By" value={submittedByFilter} onChange={setSubmittedByFilter} options={submitters} />

                <div>
                  <label className="form-label">Ticket Status</label>
                  <div className="flex gap-2 flex-wrap">
                    {(['All', ...TICKET_STATUSES] as (TicketStatus | 'All')[]).map(s => (
                      <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${statusFilter === s ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {s}{s !== 'All' ? ` ${STATUS_EMOJI[s] ?? '⚪'}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 space-y-3">
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading tickets…</div>
        ) : tickets.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">No tickets found.</div>
        ) : (
          tickets.map((t) => {
            const ticket = t as Record<string, unknown>
            const type = String(ticket.Location_Type ?? '').trim()
            const fac  = String(ticket.Facility ?? '').trim()
            const well = String(ticket.Well ?? '').trim()
            const blank = (v: string) => !v || v.toLowerCase() === 'null'
            const locationLabel =
              type === 'Facility' ? `Facility: ${blank(fac) ? '—' : fac}` :
              type === 'Well'     ? `Well: ${blank(well) ? '—' : well}` :
              !blank(fac)         ? `Facility: ${fac}` :
              !blank(well)        ? `Well: ${well}` : '—'
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

        {!loading && totalCount > 0 && (
          <div className="flex items-center justify-between pt-3 pb-2 border-t border-gray-100 mt-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-4 py-2 text-xs font-medium rounded-md bg-gray-100 text-gray-600 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-4 py-2 text-xs font-medium rounded-md bg-gray-100 text-gray-600 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

    </div>
  )
}

export default function MaintenancePage() {
  return (
    <Suspense>
      <MaintenancePageContent />
    </Suspense>
  )
}
