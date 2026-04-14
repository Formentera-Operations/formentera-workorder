'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Search, ChevronDown, ChevronUp, X, BarChart2, Table2, List, Download, ChevronRight, MessageSquare, Send } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts'

const STATUSES = ['Open', 'In Progress', 'Backlogged', 'Awaiting Cost', 'Closed']
const WORK_TYPES = ['LOE', 'AFE - Workover', 'AFE - Capital', 'Unspecified']

const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  'Open':          { bg: 'bg-blue-50',   text: 'text-[#1B2E6B]', dot: 'bg-[#1B2E6B]',   border: 'border-blue-100' },
  'In Progress':   { bg: 'bg-amber-50',  text: 'text-amber-800', dot: 'bg-amber-400',   border: 'border-amber-100' },
  'Backlogged':    { bg: 'bg-gray-100',  text: 'text-gray-700',  dot: 'bg-gray-400',    border: 'border-gray-200' },
  'Awaiting Cost': { bg: 'bg-orange-50', text: 'text-orange-800', dot: 'bg-orange-400', border: 'border-orange-100' },
  'Closed':        { bg: 'bg-green-50',  text: 'text-green-800', dot: 'bg-emerald-500', border: 'border-green-100' },
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
  topEquipment: { name: string; count: number }[]
  costTrend: { month: string; label: string; estCost: number; repairCost: number }[]
  agedTickets: { ticket_id: number; field: string; equipment: string; status: string; issue_date: string; days_open: number }[]
  workTypeBreakdown: { type: string; count: number }[]
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

const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart2 },
  { key: 'tables',   label: 'Tables',   icon: Table2 },
  { key: 'tickets',  label: 'Tickets',  icon: List },
  { key: 'chat',     label: 'Ask AI',   icon: MessageSquare },
] as const

const CHART_COLORS_LIST = ['#1B2E6B', '#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6']

interface ChartSpec {
  chartType: 'bar' | 'line' | 'pie'
  title: string
  data: Record<string, unknown>[]
  xKey: string
  series: { key: string; label: string; color: string }[]
  insight?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text?: string
  chart?: ChartSpec
  error?: boolean
}

export default function AnalysisPage() {
  const router = useRouter()
  const { role, assets, loading, userName } = useAuth()

  const [tab, setTab] = useState<'overview' | 'tables' | 'tickets' | 'chat'>('overview')
  const [aggData, setAggData] = useState<AggData | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [deptFilter, setDeptFilter] = useState('All')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  // Ticket table state
  const [tableRows, setTableRows] = useState<TableRow[]>([])
  const [tableCount, setTableCount] = useState(0)
  const [tablePage, setTablePage] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [tableDeptFilter, setTableDeptFilter] = useState('All')
  const [workTypeFilter, setWorkTypeFilter] = useState('All')
  const [tableLoading, setTableLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Date range filter
  const [datePreset, setDatePreset] = useState<'all' | 'week' | 'month' | 'lastmonth' | 'ytd' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const { effectiveStart, effectiveEnd } = useMemo(() => {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    if (datePreset === 'week') {
      const d = new Date(today)
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday of current week
      return { effectiveStart: d.toISOString().slice(0, 10), effectiveEnd: todayStr }
    }
    if (datePreset === 'month') {
      const d = new Date(today.getFullYear(), today.getMonth(), 1)
      return { effectiveStart: d.toISOString().slice(0, 10), effectiveEnd: todayStr }
    }
    if (datePreset === 'lastmonth') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 0)
      return { effectiveStart: start.toISOString().slice(0, 10), effectiveEnd: end.toISOString().slice(0, 10) }
    }
    if (datePreset === 'ytd') {
      return { effectiveStart: `${today.getFullYear()}-01-01`, effectiveEnd: todayStr }
    }
    if (datePreset === 'custom') {
      return { effectiveStart: customStart, effectiveEnd: customEnd }
    }
    return { effectiveStart: '', effectiveEnd: '' }
  }, [datePreset, customStart, customEnd])

  // Redirect field_user
  useEffect(() => {
    if (!loading && role === 'field_user') router.replace('/')
  }, [role, loading, router])

  // Fetch aggregated data
  useEffect(() => {
    if (loading) return
    const params = new URLSearchParams()
    if (assets.length > 0) params.set('userAssets', assets.join(','))
    if (effectiveStart) params.set('startDate', effectiveStart)
    if (effectiveEnd) params.set('endDate', effectiveEnd)
    params.set('_t', Date.now().toString())
    setIsRefreshing(true)
    fetch(`/api/analysis?${params}`)
      .then(r => r.json())
      .then(d => { setAggData(d); setLastRefreshed(new Date()) })
      .catch(() => {})
      .finally(() => setIsRefreshing(false))
  }, [assets, loading, effectiveStart, effectiveEnd])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  // Reset table page on filter change
  useEffect(() => {
    setTablePage(0)
    setTableRows([])
  }, [debouncedSearch, statusFilter, tableDeptFilter, workTypeFilter, effectiveStart, effectiveEnd])

  // Fetch ticket table
  useEffect(() => {
    if (tab !== 'tickets' || loading) return
    const params = new URLSearchParams({ mode: 'table', page: String(tablePage), pageSize: '25' })
    if (assets.length > 0) params.set('userAssets', assets.join(','))
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (statusFilter !== 'All') params.set('status', statusFilter)
    if (tableDeptFilter !== 'All') params.set('department', tableDeptFilter)
    if (workTypeFilter && workTypeFilter !== 'All') params.set('workType', workTypeFilter)
    if (effectiveStart) params.set('startDate', effectiveStart)
    if (effectiveEnd) params.set('endDate', effectiveEnd)
    setTableLoading(true)
    fetch(`/api/analysis?${params}`)
      .then(r => r.json())
      .then(d => {
        setTableRows(prev => tablePage === 0 ? (d.data || []) : [...prev, ...(d.data || [])])
        setTableCount(d.count || 0)
      })
      .catch(() => {})
      .finally(() => setTableLoading(false))
  }, [tab, tablePage, debouncedSearch, statusFilter, tableDeptFilter, workTypeFilter, assets, loading, effectiveStart, effectiveEnd])

  // Auto-scroll chat to latest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

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

  async function sendChat(overrideQuestion?: string) {
    const question = (overrideQuestion || chatInput).trim()
    if (!question || chatLoading) return
    setChatInput('')
    const updatedMessages = [...chatMessages, { role: 'user' as const, text: question }]
    setChatMessages(updatedMessages)
    setChatLoading(true)
    try {
      // Send text-only history for multi-turn context
      const history = updatedMessages.map(m => ({
        role: m.role,
        text: m.text || (m.chart ? `[Chart: ${m.chart.title}]${m.chart.insight ? ' ' + m.chart.insight : ''}` : ''),
      }))
      const res = await fetch('/api/analysis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          messages: history.slice(0, -1),
          userAssets: assets,
          startDate: effectiveStart,
          endDate: effectiveEnd,
          userName,
          role,
        }),
      })
      const json = await res.json()
      if (json.type === 'chart') {
        setChatMessages(prev => [...prev, { role: 'assistant', chart: json as ChartSpec }])
      } else if (json.type === 'text') {
        setChatMessages(prev => [...prev, { role: 'assistant', text: json.text }])
      } else if (json.error) {
        setChatMessages(prev => [...prev, { role: 'assistant', text: json.error, error: true }])
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', text: 'Sorry, I could not process that.', error: true }])
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', text: 'Something went wrong. Please try again.', error: true }])
    } finally {
      setChatLoading(false)
    }
  }

  if (loading || !aggData) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="page-header"><h1 className="page-title">Analysis</h1></div>
        <div className="p-4 space-y-4">
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    )
  }

  const { statusTables, costByDept, backlogHealth, monthlyTrend, departments } = aggData

  // Derive status totals for the KPI summary row
  const statusTotals = STATUSES.reduce((acc, s) => {
    acc[s] = (statusTables[s] || []).reduce((sum, r) => sum + r.count, 0)
    return acc
  }, {} as Record<string, number>)
  const grandTotal = Object.values(statusTotals).reduce((s, n) => s + n, 0)

  function toggleSection(key: string) {
    setExpandedSections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function handleExport() {
    const params = new URLSearchParams({ mode: 'export' })
    if (assets.length > 0) params.set('userAssets', assets.join(','))
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (statusFilter !== 'All') params.set('status', statusFilter)
    if (tableDeptFilter !== 'All') params.set('department', tableDeptFilter)
    if (workTypeFilter && workTypeFilter !== 'All') params.set('workType', workTypeFilter)
    if (effectiveStart) params.set('startDate', effectiveStart)
    if (effectiveEnd) params.set('endDate', effectiveEnd)
    const a = document.createElement('a')
    a.href = `/api/analysis?${params}`
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Analysis</h1>
        {lastRefreshed && (
          <span className="text-xs text-gray-400 ml-auto">
            {isRefreshing ? 'Refreshing…' : `Updated ${lastRefreshed.toLocaleTimeString()}`}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="flex">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${tab === key ? 'text-[#1B2E6B] border-b-2 border-[#1B2E6B]' : 'text-gray-400'}`}
              onClick={() => setTab(key)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* ── DATE RANGE FILTER ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Date Range</p>
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'week', 'month', 'lastmonth', 'ytd', 'custom'] as const).map(p => (
              <button
                key={p}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${datePreset === p ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                onClick={() => setDatePreset(p)}
              >
                {p === 'all' ? 'All Time' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : p === 'lastmonth' ? 'Last Month' : p === 'ytd' ? 'YTD' : 'Custom'}
              </button>
            ))}
          </div>
          {datePreset === 'custom' && (
            <div className="flex gap-2 mt-2">
              <div className="flex-1">
                <label className="text-[10px] text-gray-400 block mb-0.5">From</label>
                <input
                  type="date"
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-gray-400 block mb-0.5">To</label>
                <input
                  type="date"
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                />
              </div>
            </div>
          )}
          {(effectiveStart || effectiveEnd) && datePreset !== 'custom' && (
            <p className="text-[10px] text-gray-400 mt-1.5">{effectiveStart} – {effectiveEnd}</p>
          )}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {tab === 'overview' && (
          <>
            {/* KPI Summary Row */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ticket Summary</span>
                <span className="text-xs text-gray-400">{grandTotal.toLocaleString()} total</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {STATUSES.filter(s => s !== 'Closed').map(status => {
                  const c = STATUS_STYLE[status]
                  const count = statusTotals[status] || 0
                  return (
                    <button
                      key={status}
                      className={`${c.bg} border ${c.border} rounded-xl p-3 text-left transition-all hover:shadow-sm active:scale-[0.98]`}
                      onClick={() => { setTab('tables'); setExpandedSections(new Set([status])) }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        <span className={`text-[10px] font-medium ${c.text} opacity-70`}>{status}</span>
                      </div>
                      <span className={`text-2xl font-bold ${c.text}`}>{count}</span>
                    </button>
                  )
                })}
              </div>
              {/* Closed — full width */}
              {(() => {
                const c = STATUS_STYLE['Closed']
                const count = statusTotals['Closed'] || 0
                return (
                  <button
                    className={`w-full ${c.bg} border ${c.border} rounded-xl p-3 flex items-center justify-between transition-all hover:shadow-sm active:scale-[0.99]`}
                    onClick={() => { setTab('tables'); setExpandedSections(new Set(['Closed'])) }}
                  >
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        <span className={`text-[10px] font-medium ${c.text} opacity-70`}>Closed</span>
                      </div>
                      <span className={`text-2xl font-bold ${c.text}`}>{count}</span>
                    </div>
                    <span className={`text-xs ${c.text} opacity-40`}>View →</span>
                  </button>
                )
              })()}
            </div>

            {/* Needs Attention — Aged Tickets */}
            {aggData.agedTickets && aggData.agedTickets.length > 0 && (
              <div className="bg-white rounded-xl border border-red-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">Needs Attention</h3>
                  <span className="text-[10px] font-medium bg-red-50 text-red-700 px-2 py-0.5 rounded-full">
                    {aggData.agedTickets.length} oldest open
                  </span>
                </div>
                <div className="space-y-2">
                  {aggData.agedTickets.map(t => {
                    const daysColor = t.days_open > 30 ? 'bg-red-50 text-red-700' : t.days_open > 14 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
                    const c = STATUS_STYLE[t.status] || STATUS_STYLE['Open']
                    return (
                      <div
                        key={t.ticket_id}
                        className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-100 bg-gray-50/50 cursor-pointer hover:bg-blue-50/50 transition-colors active:scale-[0.99]"
                        onClick={() => router.push(`/maintenance/${t.ticket_id}`)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-xs font-bold text-[#1B2E6B]">#{t.ticket_id}</span>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${c.bg} ${c.text}`}>
                              <span className={`w-1 h-1 rounded-full shrink-0 ${c.dot}`} />
                              {t.status}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-gray-700 truncate">{t.equipment || '—'}</p>
                          {t.field && <p className="text-[10px] text-gray-400 truncate">{t.field}</p>}
                        </div>
                        <div className={`shrink-0 px-2 py-1 rounded-lg text-center ${daysColor}`}>
                          <p className="text-sm font-bold leading-tight">{t.days_open}</p>
                          <p className="text-[9px] leading-tight">days</p>
                        </div>
                        <ChevronRight size={14} className="text-gray-300 shrink-0" />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Backlog Health */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Backlog Health</h3>
              <div className="space-y-2.5">
                {backlogHealth.map(({ status, count, avgDays }) => {
                  const c = STATUS_STYLE[status]
                  const maxDays = Math.max(...backlogHealth.map(b => b.avgDays), 1)
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 w-24 shrink-0">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                        <span className={`text-xs font-medium ${c.text} truncate`}>{status}</span>
                      </div>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${c.dot}`}
                          style={{ width: `${Math.round((avgDays / maxDays) * 100)}%` }}
                        />
                      </div>
                      <div className="text-right w-20 shrink-0">
                        <span className="text-sm font-bold text-gray-800">{avgDays}</span>
                        <span className="text-xs text-gray-400"> days</span>
                      </div>
                      <span className="text-xs text-gray-400 w-14 text-right shrink-0">{count} tickets</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Work Type Breakdown */}
            {aggData.workTypeBreakdown && aggData.workTypeBreakdown.length > 0 && (() => {
              const total = aggData.workTypeBreakdown.reduce((s, w) => s + w.count, 0)
              const maxCount = aggData.workTypeBreakdown[0]?.count || 1
              const WORK_TYPE_COLORS: Record<string, string> = {
                'LOE': 'bg-[#1B2E6B]',
                'AFE - Workover': 'bg-amber-500',
                'AFE - Capital': 'bg-emerald-500',
              }
              return (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700">Work Type <span className="text-[10px] font-normal text-gray-400">(closed)</span></h3>
                    <span className="text-xs text-gray-400">{total.toLocaleString()} closed</span>
                  </div>
                  <div className="space-y-1.5">
                    {aggData.workTypeBreakdown.map(w => {
                      const barColor = WORK_TYPE_COLORS[w.type] || 'bg-gray-400'
                      const pct = Math.round((w.count / total) * 100)
                      return (
                        <div
                          key={w.type}
                          className="flex items-center gap-3 -mx-1 px-1 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors active:scale-[0.99]"
                          onClick={() => { setWorkTypeFilter(w.type === 'Unspecified' ? 'Unspecified' : w.type); setStatusFilter('Closed'); setTab('tickets') }}
                        >
                          <span className="text-xs text-gray-600 w-28 shrink-0 truncate">{w.type}</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${barColor}`}
                              style={{ width: `${Math.round((w.count / maxCount) * 100)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-end gap-1.5 w-16 shrink-0">
                            <span className="text-sm font-bold text-gray-800">{w.count}</span>
                            <span className="text-[10px] text-gray-400">{pct}%</span>
                          </div>
                          <ChevronRight size={12} className="text-gray-300 shrink-0" />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Monthly Trend */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly Trend (12 months)</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={monthlyTrend} margin={{ top: 4, right: 4, left: -24, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#9CA3AF' }}
                    axisLine={false}
                    tickLine={false}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: '#F3F4F6' }} formatter={(v) => [v, 'Tickets']} />
                  <Bar dataKey="count" fill="#1B2E6B" radius={[4, 4, 0, 0]} activeBar={{ fill: '#2B3E8B', stroke: 'none' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Cost Trend Over Time */}
            {aggData.costTrend && aggData.costTrend.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Cost Trend</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={aggData.costTrend} margin={{ top: 4, right: 4, left: -8, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: '#9CA3AF' }}
                      axisLine={false}
                      tickLine={false}
                      angle={-45}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={fmt} />
                    <Tooltip formatter={(v: unknown) => [fmt(v as number), '']} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 55 }} />
                    <Bar dataKey="estCost" name="Est. Cost" fill="#1B2E6B" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="repairCost" name="Repair Cost" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

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
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={equipBreakdownData} margin={{ top: 4, right: 4, left: -24, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis
                      dataKey="field"
                      tick={{ fontSize: 10, fill: '#9CA3AF' }}
                      axisLine={false}
                      tickLine={false}
                      angle={-45}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip cursor={{ fill: '#F3F4F6' }} wrapperStyle={{ transform: 'translateY(-80px)' }} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 24 }} />
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
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={costByDept} margin={{ top: 4, right: 4, left: -8, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis
                      dataKey="dept"
                      tick={{ fontSize: 10, fill: '#9CA3AF' }}
                      axisLine={false}
                      tickLine={false}
                      angle={-45}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={fmt} />
                    <Tooltip formatter={(v: unknown) => [fmt(v as number), '']} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 70 }} />
                    <Bar dataKey="estCost" name="Est. Cost" fill="#1B2E6B" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="repairCost" name="Repair Cost" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {/* Top Repeat Equipment */}
            {aggData.topEquipment && aggData.topEquipment.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">Top Repeat Equipment</h3>
                  <span className="text-[10px] text-gray-400">tap to filter</span>
                </div>
                <div className="space-y-1.5">
                  {aggData.topEquipment.map((eq, i) => {
                    const maxCount = aggData.topEquipment[0].count
                    return (
                      <div
                        key={eq.name}
                        className="flex items-center gap-2.5 -mx-1 px-1 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors active:scale-[0.99]"
                        onClick={() => { setSearch(eq.name); setTab('tickets') }}
                      >
                        <span className="text-xs text-gray-400 w-4 text-right shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-medium text-gray-700 truncate">{eq.name}</span>
                            <span className="text-xs font-bold text-gray-800 shrink-0 ml-2">{eq.count}</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#1B2E6B] rounded-full"
                              style={{ width: `${Math.round((eq.count / maxCount) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <ChevronRight size={12} className="text-gray-300 shrink-0" />
                      </div>
                    )
                  })}
                </div>
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
                      {totalEst > 0 && <span className="text-xs text-gray-500">Est. {fmt(totalEst)}</span>}
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
            {/* Filter card */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 space-y-3">

              {/* Search */}
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]/20 focus:border-[#1B2E6B] transition-colors"
                  placeholder="Search tickets…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch('')}>
                    <X size={13} className="text-gray-400" />
                  </button>
                )}
              </div>

              {/* Status */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Status</p>
                <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-thin-pills">
                  {['All', ...STATUSES].map(s => (
                    <button
                      key={s}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${statusFilter === s ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      onClick={() => setStatusFilter(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Department */}
              {departments.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Department</p>
                  <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-thin-pills">
                    {['All', ...departments].map(d => (
                      <button
                        key={d}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${tableDeptFilter === d ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        onClick={() => setTableDeptFilter(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Work Type */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Work Type</p>
                <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-thin-pills">
                  {['All', ...WORK_TYPES].map(w => (
                    <button
                      key={w}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${workTypeFilter === w ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      onClick={() => { setWorkTypeFilter(w); if (w !== 'All') setStatusFilter('Closed') }}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reset */}
              {(search || statusFilter !== 'All' || tableDeptFilter !== 'All' || workTypeFilter !== 'All') && (
                <button
                  className="w-full py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-200"
                  onClick={() => { setSearch(''); setStatusFilter('All'); setTableDeptFilter('All'); setWorkTypeFilter('All') }}
                >
                  ✕ Reset Filters
                </button>
              )}
            </div>

            {/* Count + Export */}
            <div className="flex items-center justify-between px-0.5">
              <p className="text-xs text-gray-400">{tableCount.toLocaleString()} tickets</p>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1B2E6B] bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                onClick={handleExport}
              >
                <Download size={13} />
                Export CSV
              </button>
            </div>

            {/* Mobile: card list */}
            <div className="md:hidden space-y-2">
              {tableRows.map(r => {
                const location = r.location_type === 'Well' ? (r.well || '—') : (r.facility || '—')
                const estCost = r.Estimate_Cost || 0
                const repairCost = r.repair_cost || 0
                const savings = estCost - repairCost
                const c = STATUS_STYLE[r.ticket_status] || STATUS_STYLE['Open']
                return (
                  <div
                    key={r.ticket_id}
                    className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5 cursor-pointer active:opacity-80 transition-opacity"
                    onClick={() => router.push(`/maintenance/${r.ticket_id}`)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="text-xs font-bold text-[#1B2E6B]">#{r.ticket_id}</span>
                        <span className="text-xs text-gray-400 ml-1.5">{r.issue_date ? new Date(r.issue_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : ''}</span>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${c.bg} ${c.text}`}>
                        <span className={`w-1 h-1 rounded-full shrink-0 ${c.dot}`} />
                        {r.ticket_status}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 truncate mb-1">{r.equipment_name || '—'}</p>
                    <p className="text-xs text-gray-500 truncate mb-2">{r.issue_description || '—'}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                      {r.department && <span>{r.department}</span>}
                      {location !== '—' && <span>{location}</span>}
                      {estCost > 0 && <span className="text-gray-700">Est: {fmt(estCost)}</span>}
                      {repairCost > 0 && <span className="text-gray-700">Repair: {fmt(repairCost)}</span>}
                      {(estCost > 0 || repairCost > 0) && (
                        <span className={`font-medium ${savings >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {fmtSavings(savings)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
              {tableRows.length === 0 && !tableLoading && (
                <p className="text-center text-xs text-gray-400 py-8">No tickets found.</p>
              )}
            </div>

            {/* Desktop: full table */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
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

        {/* ── Chat Tab ── */}
        {tab === 'chat' && (
          <div className="flex flex-col h-full">
            {/* Message list */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 space-y-3">
              {chatMessages.length === 0 && (
                <div className="pt-8 text-center">
                  <div className="w-12 h-12 rounded-full bg-[#1B2E6B]/10 flex items-center justify-center mx-auto mb-3">
                    <MessageSquare size={22} className="text-[#1B2E6B]" />
                  </div>
                  <p className="text-sm font-semibold text-gray-700 mb-1">Ask anything about your work orders</p>
                  <p className="text-xs text-gray-400">Try: "Show repair costs by department" or "Which equipment breaks down most?"</p>
                  <div className="mt-4 grid grid-cols-1 gap-2">
                    {[
                      'Show ticket counts by status',
                      'What are the top 5 equipment failures?',
                      'Compare est. cost vs repair cost by department',
                      'How has ticket volume trended this year?',
                    ].map(q => (
                      <button
                        key={q}
                        className="text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-[#1B2E6B] transition-colors"
                        onClick={() => sendChat(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm bg-[#1B2E6B] text-white text-sm">
                      {msg.text}
                    </div>
                  ) : msg.chart ? (
                    <div className="w-full bg-white rounded-xl border border-gray-100 shadow-sm p-3">
                      <p className="text-xs font-semibold text-gray-700 mb-2">{msg.chart.title}</p>
                      <ResponsiveContainer width="100%" height={200}>
                        {msg.chart.chartType === 'pie' ? (
                          <PieChart>
                            <Pie data={msg.chart.data as { label: string; value: number }[]} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={70} label={(props) => `${props.name} ${((props.percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                              {msg.chart.data.map((_, idx) => (
                                <Cell key={idx} fill={CHART_COLORS_LIST[idx % CHART_COLORS_LIST.length]} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        ) : msg.chart.chartType === 'line' ? (
                          <LineChart data={msg.chart.data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey={msg.chart.xKey} tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            {msg.chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
                            {msg.chart.series.map(s => (
                              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
                            ))}
                          </LineChart>
                        ) : (
                          <BarChart data={msg.chart.data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey={msg.chart.xKey} tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            {msg.chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
                            {msg.chart.series.map(s => (
                              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
                            ))}
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                      {msg.chart.insight && (
                        <p className="mt-2 text-xs text-gray-500 border-t border-gray-100 pt-2">{msg.chart.insight}</p>
                      )}
                    </div>
                  ) : (
                    <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-tl-sm text-sm ${msg.error ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-800'}`}>
                      {msg.text}
                    </div>
                  )}
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start">
                  <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-gray-100">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input bar */}
            <div className="px-4 py-3 border-t border-gray-100 bg-white">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2E6B] focus:bg-white transition-colors"
                  placeholder="Ask about your work orders…"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                  disabled={chatLoading}
                />
                <button
                  className="w-9 h-9 rounded-full bg-[#1B2E6B] flex items-center justify-center shrink-0 disabled:opacity-40 transition-opacity"
                  onClick={() => sendChat()}
                  disabled={chatLoading || !chatInput.trim()}
                >
                  <Send size={15} className="text-white" />
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

    </div>
  )
}
