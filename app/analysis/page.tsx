'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Search, ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import BottomNav from '@/components/layout/BottomNav'

const STATUSES = ['Open', 'In Progress', 'Backlogged', 'Awaiting Cost', 'Closed']

const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  'Open':          { bg: 'bg-blue-50',   text: 'text-[#1B2E6B]', dot: 'bg-[#1B2E6B]' },
  'In Progress':   { bg: 'bg-amber-50',  text: 'text-amber-800', dot: 'bg-amber-400' },
  'Backlogged':    { bg: 'bg-gray-100',  text: 'text-gray-700',  dot: 'bg-gray-400' },
  'Awaiting Cost': { bg: 'bg-orange-50', text: 'text-orange-800', dot: 'bg-orange-400' },
  'Closed':        { bg: 'bg-green-50',  text: 'text-green-800', dot: 'bg-emerald-500' },
}

const CHART_COLORS = ['#1B2E6B', '#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6']

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

function fmtSavings(n: number): string {
  const abs = Math.abs(n)
  return (n >= 0 ? '+' : '-') + fmt(abs)
}

interface AggData {
  statusTables: Record<string, { asset: string; field: string; dept: string; count: number; estCost: number; repairCost: number; savings: number }[]>
  fieldEquipChart: { field: string; equip: string; dept: string; count: number }[]
  costByDept: { dept: string; estCost: number; repairCost: number }[]
  backlogHealth: { status: string; count: number; avgDays: number }[]
  monthlyTrend: { month: string; label: string; count: number }[]
  departments: string[]
}

interface TableRow {
  ticket_id: number
  asset: string
  field: string
  department: string
  work_order_type: string | null
  location_type: string
  well: string | null
  facility: string | null
  equipment_name: string
  issue_description: string
  ticket_status: string
  issue_date: string
  repair_date_closed: string | null
  Estimate_Cost: number | null
  repair_cost: number | null
}

export default function AnalysisPage() {
  const router = useRouter()
  const { role, assets, loading } = useAuth()

  const [tab, setTab] = useState<'overview' | 'tables' | 'tickets'>('overview')
  const [aggData, setAggData] = useState<AggData | null>(null)
  const [deptFilter, setDeptFilter] = useState('All')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['Open']))

  // Ticket table state
  const [tableRows, setTableRows] = useState<TableRow[]>([])
  const [tableCount, setTableCount] = useState(0)
  const [tablePage, setTablePage] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [tableDeptFilter, setTableDeptFilter] = useState('All')
  const [tableLoading, setTableLoading] = useState(false)

  // Redirect field_user (analyst, admin, foreman all have access)
  useEffect(() => {
    if (!loading && role === 'field_user') {
      router.replace('/')
    }
  }, [role, loading, router])

  // Fetch aggregated data
  useEffect(() => {
    if (loading) return
    const params = new URLSearchParams()
    if (assets.length > 0) params.set('userAssets', assets.join(','))
    params.set('_t', Date.now().toString())
    fetch(`/api/analysis?${params}`)
      .then(r => r.json())
      .then(setAggData)
      .catch(() => {})
  }, [assets, loading])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  // Reset table page on filter change
  useEffect(() => {
    setTablePage(0)
    setTableRows([])
  }, [debouncedSearch, statusFilter, tableDeptFilter])

  // Fetch ticket table
  useEffect(() => {
    if (tab !== 'tickets' || loading) return
    const params = new URLSearchParams({ mode: 'table', page: String(tablePage), pageSize: '25' })
    if (assets.length > 0) params.set('userAssets', assets.join(','))
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (statusFilter !== 'All') params.set('status', statusFilter)
    if (tableDeptFilter !== 'All') params.set('department', tableDeptFilter)
    setTableLoading(true)
    fetch(`/api/analysis?${params}`)
      .then(r => r.json())
      .then(d => {
        setTableRows(prev => tablePage === 0 ? (d.data || []) : [...prev, ...(d.data || [])])
        setTableCount(d.count || 0)
      })
      .catch(() => {})
      .finally(() => setTableLoading(false))
  }, [tab, tablePage, debouncedSearch, statusFilter, tableDeptFilter, assets, loading])

  // Pivot fieldEquipChart for stacked bar chart
  const { equipBreakdownData, topEquipTypes } = useMemo(() => {
    if (!aggData) return { equipBreakdownData: [], topEquipTypes: [] as string[] }
    const filtered = deptFilter === 'All'
      ? aggData.fieldEquipChart
      : aggData.fieldEquipChart.filter(r => r.dept === deptFilter)

    const equipTotals: Record<string, number> = {}
    for (const r of filtered) equipTotals[r.equip] = (equipTotals[r.equip] || 0) + r.count
    const topEquip = Object.entries(equipTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e]) => e)

    const fieldMap: Record<string, Record<string, number>> = {}
    for (const r of filtered) {
      const equip = topEquip.includes(r.equip) ? r.equip : null
      if (!equip) continue
      if (!fieldMap[r.field]) fieldMap[r.field] = {}
      fieldMap[r.field][equip] = (fieldMap[r.field][equip] || 0) + r.count
    }

    const data = Object.entries(fieldMap)
      .map(([field, equips]) => ({ field, ...equips }))
      .sort((a, b) => {
        const sum = (x: Record<string, unknown>) => topEquip.reduce((s, e) => s + ((x[e] as number) || 0), 0)
        return sum(b as Record<string, unknown>) - sum(a as Record<string, unknown>)
      })

    return { equipBreakdownData: data, topEquipTypes: topEquip }
  }, [aggData, deptFilter])

  if (loading || !aggData) {
    return (
      <div className="flex flex-col min-h-screen pb-16">
        <div className="page-header"><h1 className="page-title">Analysis</h1></div>
        <div className="p-4 space-y-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
        <BottomNav />
      </div>
    )
  }

  if (!aggData) return null

  const { statusTables, costByDept, backlogHealth, monthlyTrend, departments } = aggData

  function toggleSection(key: string) {
    setExpandedSections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col min-h-screen pb-16">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Analysis</h1>
      </div>

      {/* Tab bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="flex">
          {(['overview', 'tables', 'tickets'] as const).map(t => (
            <button
              key={t}
              className={`flex-1 py-2.5 text-sm font-medium capitalize transition-colors ${tab === t ? 'text-[#1B2E6B] border-b-2 border-[#1B2E6B]' : 'text-gray-500'}`}
              onClick={() => setTab(t)}
            >
              {t === 'overview' ? 'Overview' : t === 'tables' ? 'Tables' : 'Tickets'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* ── OVERVIEW TAB ── */}
        {tab === 'overview' && (
          <>
            {/* Backlog Health */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Backlog Health</h3>
              <div className="grid grid-cols-3 gap-2">
                {backlogHealth.map(({ status, count, avgDays }) => {
                  const c = STATUS_STYLE[status]
                  return (
                    <div key={status} className={`${c.bg} rounded-xl p-3`}>
                      <div className="flex items-center gap-1 mb-1">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                        <span className={`text-[10px] font-medium ${c.text} opacity-70 leading-tight`}>{status}</span>
                      </div>
                      <div className={`text-2xl font-bold ${c.text}`}>{avgDays}</div>
                      <div className={`text-[10px] ${c.text} opacity-60`}>avg days</div>
                      <div className={`text-[10px] ${c.text} opacity-50`}>{count} tickets</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Monthly Trend */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly Trend</h3>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={monthlyTrend} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: '#F3F4F6' }} formatter={(v) => [v, 'Tickets']} />
                  <Bar dataKey="count" fill="#1B2E6B" radius={[4, 4, 0, 0]} activeBar={{ fill: '#2B3E8B', stroke: 'none' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Ticket Breakdown by Field + Equipment */}
            {equipBreakdownData.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Tickets by Field & Equipment</h3>
                <div className="flex gap-1.5 flex-wrap mb-3">
                  {['All', ...departments].map(d => (
                    <button
                      key={d}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${deptFilter === d ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      onClick={() => setDeptFilter(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={equipBreakdownData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis dataKey="field" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip cursor={{ fill: '#F3F4F6' }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {topEquipTypes.map((equip, i) => (
                      <Bar key={equip} dataKey={equip} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Cost by Department */}
            {costByDept.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Cost by Department</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={costByDept} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis dataKey="dept" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={fmt} />
                    <Tooltip formatter={(v: unknown) => [fmt(v as number), '']} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="estCost" name="Est. Cost" fill="#1B2E6B" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="repairCost" name="Repair Cost" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}

        {/* ── TABLES TAB ── */}
        {tab === 'tables' && (
          <div className="space-y-3">
            {STATUSES.map(status => {
              const rows = statusTables[status] || []
              const isOpen = expandedSections.has(status)
              const c = STATUS_STYLE[status]
              const totalCount = rows.reduce((s, r) => s + r.count, 0)
              const totalEst = rows.reduce((s, r) => s + r.estCost, 0)
              const totalRepair = rows.reduce((s, r) => s + r.repairCost, 0)
              const totalSavings = totalEst - totalRepair

              return (
                <div key={status} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-4"
                    onClick={() => toggleSection(status)}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                      <span className={`font-semibold text-sm ${c.text}`}>{status}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.bg} ${c.text} font-medium`}>{totalCount}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {totalEst > 0 && <span className="text-xs text-gray-500">{fmt(totalEst)}</span>}
                      {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    </div>
                  </button>

                  {isOpen && rows.length > 0 && (
                    <div className="overflow-x-auto border-t border-gray-100">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Asset</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Field</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Department</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Count</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Est. Cost</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Repair Cost</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Savings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.asset || '—'}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.field || '—'}</td>
                              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.dept || '—'}</td>
                              <td className="px-3 py-2 text-right font-semibold text-gray-800">{r.count}</td>
                              <td className="px-3 py-2 text-right text-gray-700">{r.estCost > 0 ? fmt(r.estCost) : '—'}</td>
                              <td className="px-3 py-2 text-right text-gray-700">{r.repairCost > 0 ? fmt(r.repairCost) : '—'}</td>
                              <td className={`px-3 py-2 text-right font-medium ${r.savings >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                {r.estCost > 0 || r.repairCost > 0 ? fmtSavings(r.savings) : '—'}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-gray-100 font-semibold border-t border-gray-200">
                            <td className="px-3 py-2 text-gray-800" colSpan={3}>Total</td>
                            <td className="px-3 py-2 text-right text-gray-800">{totalCount}</td>
                            <td className="px-3 py-2 text-right text-gray-800">{totalEst > 0 ? fmt(totalEst) : '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-800">{totalRepair > 0 ? fmt(totalRepair) : '—'}</td>
                            <td className={`px-3 py-2 text-right ${totalSavings >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {totalEst > 0 || totalRepair > 0 ? fmtSavings(totalSavings) : '—'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                  {isOpen && rows.length === 0 && (
                    <p className="px-4 pb-4 text-xs text-gray-400">No tickets with this status.</p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── TICKETS TAB ── */}
        {tab === 'tickets' && (
          <div className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]/20 focus:border-[#1B2E6B]"
                placeholder="Search tickets…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch('')}>
                  <X size={14} className="text-gray-400" />
                </button>
              )}
            </div>

            {/* Status filter */}
            <div className="flex gap-1.5 flex-wrap">
              <span className="text-xs text-gray-400 self-center">Status:</span>
              {['All', ...STATUSES].map(s => (
                <button
                  key={s}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${statusFilter === s ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Department filter */}
            {departments.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                <span className="text-xs text-gray-400 self-center">Dept:</span>
                {['All', ...departments].map(d => (
                  <button
                    key={d}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${tableDeptFilter === d ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    onClick={() => setTableDeptFilter(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}

            <p className="text-xs text-gray-400">{tableCount.toLocaleString()} tickets</p>

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">#</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Asset</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Dept</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Work Order Type</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Location</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Equipment</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Description</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Status</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Submitted</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Closed</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Est. Cost</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Repair Cost</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-500 whitespace-nowrap">Savings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((r, i) => {
                      const location = r.location_type === 'Well' ? (r.well || '—') : (r.facility || '—')
                      const estCost = r.Estimate_Cost || 0
                      const repairCost = r.repair_cost || 0
                      const savings = estCost - repairCost
                      const c = STATUS_STYLE[r.ticket_status] || STATUS_STYLE['Open']
                      return (
                        <tr
                          key={r.ticket_id}
                          className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                          onClick={() => router.push(`/maintenance/${r.ticket_id}`)}
                        >
                          <td className="px-3 py-2.5 font-medium text-[#1B2E6B] whitespace-nowrap">#{r.ticket_id}</td>
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{r.asset || '—'}</td>
                          <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.department || '—'}</td>
                          <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.work_order_type || '—'}</td>
                          <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{location}</td>
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{r.equipment_name || '—'}</td>
                          <td className="px-3 py-2.5 text-gray-600 max-w-[160px] truncate">{r.issue_description || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${c.bg} ${c.text}`}>
                              <span className={`w-1 h-1 rounded-full shrink-0 ${c.dot}`} />
                              {r.ticket_status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                            {r.issue_date ? new Date(r.issue_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                            {r.repair_date_closed ? new Date(r.repair_date_closed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{estCost > 0 ? fmt(estCost) : '—'}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{repairCost > 0 ? fmt(repairCost) : '—'}</td>
                          <td className={`px-3 py-2.5 text-right font-medium whitespace-nowrap ${savings >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {estCost > 0 || repairCost > 0 ? fmtSavings(savings) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {tableRows.length === 0 && !tableLoading && (
                  <p className="text-center text-xs text-gray-400 py-8">No tickets found.</p>
                )}
              </div>
            </div>

            {/* Load more */}
            {tableRows.length < tableCount && (
              <button
                className="w-full py-2.5 text-sm text-[#1B2E6B] font-medium bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors disabled:opacity-50"
                onClick={() => setTablePage(p => p + 1)}
                disabled={tableLoading}
              >
                {tableLoading ? 'Loading…' : `Load more (${(tableCount - tableRows.length).toLocaleString()} remaining)`}
              </button>
            )}
          </div>
        )}

      </div>

      <BottomNav />
    </div>
  )
}
