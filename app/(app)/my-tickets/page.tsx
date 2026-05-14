'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Search, Calendar, SlidersHorizontal } from 'lucide-react'
import TicketCard from '@/components/ui/TicketCard'
import QueuedTicketCard from '@/components/ui/QueuedTicketCard'
import { useAuth } from '@/components/AuthProvider'
import { TICKET_STATUSES, STATUS_EMOJI } from '@/lib/utils'
import { cachedFetch } from '@/lib/cached-fetch'
import { prefetchForOffline } from '@/lib/prefetch-for-offline'
import { warmFormCaches } from '@/lib/warm-form-caches'
import { useOutbox } from '@/lib/use-outbox'
import { buildOptimisticListMap } from '@/lib/optimistic-ticket'
import type { TicketStatus } from '@/types'

const PAGE_SIZE = 20

export default function MyTicketsPage() {
  const router = useRouter()
  const { userEmail, userName, assets: userAssets } = useAuth()
  const { actions: outboxActions } = useOutbox()
  const [tickets, setTickets] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // Bumped when the outbox drains so the list re-fetches and shows the
  // freshly-synced server state (without this, the Syncing pill clears
  // but the ticket's old Ticket_Status sticks around until manual refresh).
  const [refreshNonce, setRefreshNonce] = useState(0)
  useEffect(() => {
    const onSyncSuccess = () => setRefreshNonce(n => n + 1)
    window.addEventListener('formentera:sync-success', onSyncSuccess)
    return () => window.removeEventListener('formentera:sync-success', onSyncSuccess)
  }, [])

  // Optimistically prepend a ticket the user just submitted online — see
  // /maintenance/new for the matching stash. Covers the case where the SW's
  // NetworkFirst strategy serves a brief stale cached list (or any other
  // cache-layer lag) and the just-submitted row would otherwise be invisible
  // until the user manually refreshes.
  const [recentSubmit, setRecentSubmit] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = sessionStorage.getItem('formentera:recent-submit')
      if (!raw) return
      sessionStorage.removeItem('formentera:recent-submit')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') setRecentSubmit(parsed)
    } catch { /* ignore */ }
  }, [])

  const [ticketId, setTicketId] = useState('')
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [assetFilter, setAssetFilter] = useState('All')
  const [deptFilter, setDeptFilter] = useState('All')
  const [equipFilter, setEquipFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'All'>('All')

  const [assets, setAssets] = useState<string[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [equipments, setEquipments] = useState<string[]>([])

  useEffect(() => {
    if (!userEmail && !userName) return
    const params = new URLSearchParams({
      mode: 'mine',
      userEmail,
      userName,
    })
    if (userAssets.length > 0) params.set('userAssets', userAssets.join(','))
    cachedFetch<{ assets?: string[]; departments?: string[]; equipments?: string[] }>(
      `/api/tickets/options?${params}`,
      { cacheKey: `my-tickets:options:${userEmail || userName}:${userAssets.join(',')}` }
    )
      .then(({ data }) => {
        setAssets(data.assets || [])
        setDepartments(data.departments || [])
        setEquipments(data.equipments || [])
      })
      .catch(() => {})
  }, [userEmail, userName, userAssets])

  // Pre-warm the new-ticket form's reference data so it works offline the
  // first time a foreman opens it. Also re-warm whenever connectivity
  // returns — covers the case where the foreman went offline mid-prefetch
  // and missed one of the parallel fetches.
  useEffect(() => {
    if (userAssets.length === 0) return
    void warmFormCaches(userAssets)
    const onOnline = () => { void warmFormCaches(userAssets) }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [userAssets])

  useEffect(() => {
    if (!userEmail && !userName) return
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({
      mode: 'mine',
      ticketId,
      userEmail,
      userName,
      search, startDate, endDate,
      asset: assetFilter, department: deptFilter,
      equipment: equipFilter, status: statusFilter,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    })
    if (userAssets.length > 0) params.set('userAssets', userAssets.join(','))
    // Cache key intentionally excludes the search/filter state — the cache
    // covers the unfiltered "my tickets" view so it's available offline.
    // When online, we still fetch with the current filters; on offline cache
    // hit, the user sees their last-seen list.
    const cacheKey = `my-tickets:list:${userEmail || userName}:${userAssets.join(',')}:${page}:${ticketId}:${search}:${startDate}:${endDate}:${assetFilter}:${deptFilter}:${equipFilter}:${statusFilter}`
    cachedFetch<{ data?: Record<string, unknown>[]; count?: number }>(
      `/api/tickets?${params}`,
      { cacheKey }
    )
      .then(({ data, fromCache }) => {
        if (cancelled) return
        const rows = data.data || []
        setTickets(rows)
        setTotalCount(data.count ?? 0)
        // Silent offline prefetch: when we got a fresh network response,
        // warm the SW cache for active tickets so navigating to them
        // works offline without the user having to tap each one first.
        if (!fromCache && typeof navigator !== 'undefined' && navigator.onLine) {
          const ACTIVE = new Set(['Open', 'In Progress', 'Backlogged', 'Awaiting Cost'])
          const urls = rows
            .filter(r => {
              const s = String((r as { Ticket_Status?: string }).Ticket_Status || '')
              return ACTIVE.has(s)
            })
            .map(r => `/maintenance/${(r as { id: string | number }).id}`)
            .filter(Boolean)
          if (urls.length > 0) void prefetchForOffline(urls, { concurrency: 4 })
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page, ticketId, search, startDate, endDate, assetFilter, deptFilter, equipFilter, statusFilter, userEmail, userName, userAssets, refreshNonce])

  useEffect(() => { setPage(0) }, [ticketId, search, startDate, endDate, assetFilter, deptFilter, equipFilter, statusFilter])

  function resetFilters() {
    setTicketId(''); setSearch(''); setStartDate(''); setEndDate('')
    setAssetFilter('All'); setDeptFilter('All'); setEquipFilter('All'); setStatusFilter('All')
    setPage(0)
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h1 className="text-base font-semibold text-gray-900">My Tickets</h1>
        <div className="h-0.5 w-16 bg-[#1B2E6B] mt-1" />
      </div>

      {/* Filter trigger — outside scroll so dropdown isn't clipped */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 relative z-20 lg:px-32">
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

            {/* Panel — overflow-x-hidden stops iOS Safari from letting you
                touch-pan the contents sideways when an input's intrinsic
                width is ~a pixel wider than its container. */}
            <div className="absolute left-4 right-4 lg:left-32 lg:right-32 top-full z-40 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-[70vh] overflow-y-auto overflow-x-hidden">
              <div className="p-4 space-y-3">
                <div>
                  <label className="form-label">Ticket ID</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" className="form-input" placeholder="e.g. 1042" value={ticketId} onChange={e => setTicketId(e.target.value.replace(/\D/g, ''))} />
                </div>

                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    className="form-input pl-9"
                    placeholder="Search Well, Facility…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
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
                )}

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

                <div>
                  <label className="form-label">Ticket Status</label>
                  <div className="flex gap-2 flex-wrap">
                    {(['All', ...TICKET_STATUSES] as (TicketStatus | 'All')[]).map(s => (
                      <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                          statusFilter === s ? 'bg-[#1B2E6B] text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:shadow-sm hover:scale-105'
                        }`}
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
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 space-y-3 lg:px-32">
        {/* Optimistic placeholders for tickets queued offline. Show only on
            page 0 (don't repeat across pagination), and hide failed actions
            since they're already surfaced via the failed-sync banner. */}
        {page === 0 && outboxActions
          .filter(a => a.method === 'POST' && a.url === '/api/tickets' && a.status !== 'failed')
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(a => {
            const body = (a.body && typeof a.body === 'object' ? a.body : {}) as Record<string, unknown>
            const type = String(body.Location_Type ?? '').trim()
            const fac  = String(body.Facility ?? '').trim()
            const well = String(body.Well ?? '').trim()
            const blank = (v: string) => !v || v.toLowerCase() === 'null'
            const locationLabel =
              type === 'Facility' ? `Facility: ${blank(fac) ? '—' : fac}` :
              type === 'Well'     ? `Well: ${blank(well) ? '—' : well}` :
              !blank(fac)         ? `Facility: ${fac}` :
              !blank(well)        ? `Well: ${well}` : '—'
            return (
              <QueuedTicketCard
                key={a.id}
                asset={(body.Asset as string) || '—'}
                locationLabel={locationLabel}
                equipment={(body.Equipment as string) || '—'}
                issuePhotos={body.Issue_Photos as string[] | undefined}
              />
            )
          })}
        {(() => {
          // Prepend the just-submitted ticket (if any) when it's not yet in
          // the fetched list — covers the brief window where the SW or
          // browser HTTP cache hasn't refreshed yet. De-dupes by id once
          // the network response catches up.
          const recentId = (recentSubmit as { id?: number } | null)?.id
          const recentInList = typeof recentId === 'number' && tickets.some(t => (t as { id?: number }).id === recentId)
          const displayedTickets = recentSubmit && !recentInList && page === 0
            ? [recentSubmit, ...tickets]
            : tickets
          const hasOptimisticQueued = page === 0 && outboxActions.some(a => a.method === 'POST' && a.url === '/api/tickets' && a.status !== 'failed')
          const hasOptimisticRecent = !!recentSubmit && !recentInList && page === 0
          if (loading && !hasOptimisticRecent) {
            return <div className="py-8 text-center text-sm text-gray-400">Loading tickets…</div>
          }
          if (displayedTickets.length === 0 && !hasOptimisticQueued) {
            return <div className="py-8 text-center text-sm text-gray-400">No tickets found.</div>
          }
          const optimisticMap = buildOptimisticListMap(outboxActions)
          return displayedTickets.map((t) => {
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
            const tid = ticket.id as number
            const opt = typeof tid === 'number' ? optimisticMap.get(tid) : undefined
            const displayedStatus = (opt?.resultingStatus ?? ticket.Ticket_Status) as TicketStatus
            return (
              <TicketCard
                key={tid}
                id={tid}
                Asset={ticket.Asset as string}
                locationLabel={locationLabel}
                Equipment={ticket.Equipment as string}
                Ticket_Status={displayedStatus}
                Issue_Photos={ticket.Issue_Photos as string[]}
                onClick={() => router.push(`/maintenance/${tid}`)}
                isSyncing={!!opt?.syncing}
              />
            )
          })
        })()}

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
