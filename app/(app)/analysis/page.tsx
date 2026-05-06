'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import SearchableSelect from '@/components/ui/SearchableSelect'
import PivotBuilder from '@/components/PivotBuilder'
import EquipmentCosts from '@/components/EquipmentCosts'
import { Search, ChevronDown, ChevronUp, X, BarChart2, Table2, List, Download, ChevronRight, MessageSquare, Send, LayoutGrid, DollarSign } from 'lucide-react'
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

function ChartTooltip({ active, payload, label, valueFormatter }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: string | number
  valueFormatter: (v: number) => string
}) {
  if (!active || !payload || payload.length === 0) return null
  const items = payload.filter(p => typeof p.value === 'number' && p.value !== 0)
  if (items.length === 0) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs" style={{ minWidth: 180, maxWidth: 260 }}>
      {label !== undefined && label !== '' && (
        <div className="font-semibold text-gray-900 mb-1.5 border-b border-gray-100 pb-1">{label}</div>
      )}
      <div className="flex flex-col gap-1">
        {items.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
              <span className="text-gray-600 truncate">{p.name}</span>
            </div>
            <span className="font-medium text-gray-900 flex-shrink-0">{valueFormatter(p.value as number)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Pick a nice step size for the y-axis. Minimum step is $1K so small charts
// tick every thousand; the step grows with the max value so a $400K chart
// doesn't render 400 tick marks.
function niceTicks(max: number): number[] {
  if (max <= 0) return [0]
  let step = 1000
  if (max > 10_000) step = 5_000
  if (max > 50_000) step = 10_000
  if (max > 100_000) step = 50_000
  if (max > 500_000) step = 100_000
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  return ticks
}

interface AggData {
  statusTables: Record<string, { asset: string; field: string; dept: string; count: number; estCost: number; repairCost: number; savings: number; avgAge: number | null }[]>
  fieldEquipChart: { field: string; equip: string; dept: string; count: number }[]
  costByDept: { dept: string; estCost: number; repairCost: number }[]
  monthlyTrend: { month: string; label: string; count: number }[]
  departments: string[]
  equipmentList: string[]
  fieldList: string[]
  topEquipment: { name: string; count: number }[]
  costTrend: { month: string; label: string; estCost: number; repairCost: number }[]
  workTypeBreakdown: { type: string; count: number }[]
  costMatrix: {
    month: string
    asset: string
    field: string
    ticket_status: string
    equipment_type: string
    equipment: string
    est_cost: number
  }[]
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
  { key: 'overview',     label: 'Overview',        icon: BarChart2 },
  { key: 'tables',       label: 'Tables',          icon: Table2 },
  { key: 'tickets',      label: 'Tickets',         icon: List },
  { key: 'equipCosts',   label: 'Equipment Costs', icon: DollarSign },
  { key: 'pivot',        label: 'Pivot',           icon: LayoutGrid },
  { key: 'chat',         label: 'Ask AI',          icon: MessageSquare },
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

const COST_WORDS_RE = /\b(cost|spend|savings|repair|estimate|expense|budget|amount|revenue|payment|invoice|\$)\b/i
function isCostChart(chart: ChartSpec): boolean {
  if (COST_WORDS_RE.test(chart.title)) return true
  return chart.series.some(s => COST_WORDS_RE.test(s.key) || COST_WORDS_RE.test(s.label))
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

  const [tab, setTab] = useState<'overview' | 'tables' | 'tickets' | 'equipCosts' | 'pivot' | 'chat'>('overview')
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
  const [equipmentFilter, setEquipmentFilter] = useState('All')
  const [fieldFilter, setFieldFilter] = useState('All')
  const [workTypeFilter, setWorkTypeFilter] = useState('All')
  const [tableLoading, setTableLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Slicer state for the Cost by Equipment chart (mirrors the pivot in Excel)
  const [equipChartAsset, setEquipChartAsset] = useState('All')
  const [equipChartField, setEquipChartField] = useState('All')
  const [equipChartStatus, setEquipChartStatus] = useState('Closed')
  const [equipChartCategory, setEquipChartCategory] = useState('All')
  const [equipChartYear, setEquipChartYear] = useState('All')
  const [equipChartMonth, setEquipChartMonth] = useState('All')
  // Slicer state for the Cost by Ticket Status chart
  const [statusChartAsset, setStatusChartAsset] = useState('All')
  const [statusChartYear, setStatusChartYear] = useState('All')
  const [statusChartMonth, setStatusChartMonth] = useState('All')

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
  }, [debouncedSearch, statusFilter, tableDeptFilter, equipmentFilter, fieldFilter, workTypeFilter, effectiveStart, effectiveEnd])

  // Fetch ticket table
  useEffect(() => {
    if (tab !== 'tickets' || loading) return
    const params = new URLSearchParams({ mode: 'table', page: String(tablePage), pageSize: '25' })
    if (assets.length > 0) params.set('userAssets', assets.join(','))
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (statusFilter !== 'All') params.set('status', statusFilter)
    if (tableDeptFilter !== 'All') params.set('department', tableDeptFilter)
    if (equipmentFilter !== 'All') params.set('equipment', equipmentFilter)
    if (fieldFilter !== 'All') params.set('field', fieldFilter)
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
  }, [tab, tablePage, debouncedSearch, statusFilter, tableDeptFilter, equipmentFilter, fieldFilter, workTypeFilter, assets, loading, effectiveStart, effectiveEnd])

  // Auto-scroll chat to latest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  // Departments sorted by total ticket count, descending — used by heatmap filter
  const departmentsByCount = useMemo(() => {
    if (!aggData) return [] as string[]
    const totals: Record<string, number> = {}
    for (const r of aggData.fieldEquipChart) totals[r.dept] = (totals[r.dept] || 0) + r.count
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([d]) => d)
  }, [aggData])

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
          startDate: '',
          endDate: '',
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

  const { statusTables, costByDept, monthlyTrend, departments } = aggData

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

  function buildExportParams(mode: 'export' | 'excel') {
    const params = new URLSearchParams({ mode })
    if (assets.length > 0) params.set('userAssets', assets.join(','))
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (statusFilter !== 'All') params.set('status', statusFilter)
    if (tableDeptFilter !== 'All') params.set('department', tableDeptFilter)
    if (equipmentFilter !== 'All') params.set('equipment', equipmentFilter)
    if (fieldFilter !== 'All') params.set('field', fieldFilter)
    if (workTypeFilter && workTypeFilter !== 'All') params.set('workType', workTypeFilter)
    if (effectiveStart) params.set('startDate', effectiveStart)
    if (effectiveEnd) params.set('endDate', effectiveEnd)
    return params
  }

  function handleExport() {
    const a = document.createElement('a')
    a.href = `/api/analysis?${buildExportParams('export')}`
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  function handleExportExcel() {
    const a = document.createElement('a')
    a.href = `/api/analysis?${buildExportParams('excel')}`
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.xlsx`
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

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 lg:px-32">

        {/* ── DATE RANGE FILTER ── */}
        {tab !== 'chat' && tab !== 'pivot' && tab !== 'equipCosts' && (
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
        )}

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
                      className={`${c.bg} border ${c.border} rounded-xl p-3 text-left transition-all hover:shadow-md hover:scale-[1.02] hover:border-gray-300 active:scale-[0.98]`}
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
                    className={`w-full ${c.bg} border ${c.border} rounded-xl p-3 flex items-center justify-between transition-all hover:shadow-md hover:scale-[1.01] hover:border-gray-300 active:scale-[0.99]`}
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

            {/* Cost by Equipment — slicer-driven (Asset / Field / Status / Equipment Category / Year / Month) */}
            {aggData.costMatrix && aggData.costMatrix.length > 0 && (() => {
              const matrix = aggData.costMatrix
              const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
              const monthOptsAll = ['All', ...Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))]

              const assetOpts = ['All', ...Array.from(new Set(matrix.map(r => r.asset).filter(Boolean))).sort()]
              const fieldOpts = ['All', ...Array.from(new Set(matrix.filter(r => equipChartAsset === 'All' || r.asset === equipChartAsset).map(r => r.field).filter(Boolean))).sort()]
              const statusOpts = ['All', ...STATUSES]
              const categoryOpts = ['All', ...Array.from(new Set(matrix.map(r => r.equipment_type).filter(Boolean))).sort()]
              const yearOpts = ['All', ...Array.from(new Set(matrix.map(r => r.month.slice(0, 4)).filter(Boolean))).sort()]

              const filtered = matrix.filter(r =>
                (equipChartAsset === 'All' || r.asset === equipChartAsset) &&
                (equipChartField === 'All' || r.field === equipChartField) &&
                (equipChartStatus === 'All' || r.ticket_status === equipChartStatus) &&
                (equipChartCategory === 'All' || r.equipment_type === equipChartCategory) &&
                (equipChartYear === 'All' || r.month.slice(0, 4) === equipChartYear) &&
                (equipChartMonth === 'All' || r.month.slice(5, 7) === equipChartMonth)
              )

              const monthMap = new Map<string, Record<string, number>>()
              const equipTotals = new Map<string, number>()
              for (const r of filtered) {
                const eq = r.equipment || 'Unknown'
                const bucket = monthMap.get(r.month) || {}
                bucket[eq] = (bucket[eq] || 0) + r.est_cost
                monthMap.set(r.month, bucket)
                equipTotals.set(eq, (equipTotals.get(eq) || 0) + r.est_cost)
              }
              const series = Array.from(equipTotals.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([name], i) => ({ key: name, color: CHART_COLORS_LIST[i % CHART_COLORS_LIST.length] }))
              const truncated = equipTotals.size > 8

              const data = Array.from(monthMap.keys()).sort().map(month => {
                const row: Record<string, string | number> = {
                  month,
                  label: new Date(month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                }
                for (const s of series) row[s.key] = Math.round(monthMap.get(month)?.[s.key] || 0)
                return row
              })
              const equipMax = data.reduce((m, row) => Math.max(m, ...series.map(s => Number(row[s.key]) || 0)), 0)
              const equipTicks = niceTicks(equipMax)

              const Slicer = ({ label, value, options, optionLabel, onChange }: { label: string; value: string; options: string[]; optionLabel?: (v: string) => string; onChange: (v: string) => void }) => (
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{label}</span>
                  <select
                    className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-[#1B2E6B] truncate"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                  >
                    {options.map(o => <option key={o} value={o}>{optionLabel ? optionLabel(o) : o}</option>)}
                  </select>
                </div>
              )

              return (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Cost by Equipment</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
                    {assets.length !== 1 && (
                      <Slicer label="Asset" value={equipChartAsset} options={assetOpts} onChange={v => { setEquipChartAsset(v); setEquipChartField('All') }} />
                    )}
                    <Slicer label="Field" value={equipChartField} options={fieldOpts} onChange={setEquipChartField} />
                    <Slicer label="Ticket Status" value={equipChartStatus} options={statusOpts} onChange={setEquipChartStatus} />
                    <Slicer label="Equipment Catg." value={equipChartCategory} options={categoryOpts} onChange={setEquipChartCategory} />
                    <Slicer label="Year (Issue Date)" value={equipChartYear} options={yearOpts} onChange={setEquipChartYear} />
                    <Slicer label="Month (Issue Date)" value={equipChartMonth} options={monthOptsAll} optionLabel={o => o === 'All' ? 'All' : MONTH_NAMES[parseInt(o, 10) - 1]} onChange={setEquipChartMonth} />
                  </div>
                  {data.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-8">No data for the selected filters</p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={data} margin={{ top: 4, right: 4, left: 12, bottom: 50 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" interval={0} />
                          <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={fmt} ticks={equipTicks} domain={[0, equipTicks[equipTicks.length - 1]]} label={{ value: 'Sum of Est. Cost', angle: -90, position: 'insideLeft', offset: 0, style: { textAnchor: 'middle', fill: '#6B7280', fontSize: 11 } }} />
                          <Tooltip cursor={{ fill: '#F3F4F6' }} content={<ChartTooltip valueFormatter={fmt} />} offset={40} wrapperStyle={{ outline: 'none', zIndex: 50, marginTop: -100 }} />
                          <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 10, paddingTop: 32 }} />
                          {series.map(s => (
                            <Bar key={s.key} dataKey={s.key} name={s.key} fill={s.color} radius={[4, 4, 0, 0]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                      {truncated && (
                        <p className="text-[10px] text-gray-400 text-center mt-1">
                          Showing top 8 equipment by cost. Pick an Equipment Catg. to narrow further.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )
            })()}

            {/* Cost by Ticket Status — slicer-driven (Asset / Year / Month) */}
            {aggData.costMatrix && aggData.costMatrix.length > 0 && (() => {
              const matrix = aggData.costMatrix
              const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
              const monthOptsAll = ['All', ...Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))]

              const assetOpts = ['All', ...Array.from(new Set(matrix.map(r => r.asset).filter(Boolean))).sort()]
              const yearOpts = ['All', ...Array.from(new Set(matrix.map(r => r.month.slice(0, 4)).filter(Boolean))).sort()]

              const filtered = matrix.filter(r =>
                (statusChartAsset === 'All' || r.asset === statusChartAsset) &&
                (statusChartYear === 'All' || r.month.slice(0, 4) === statusChartYear) &&
                (statusChartMonth === 'All' || r.month.slice(5, 7) === statusChartMonth)
              )

              const monthMap = new Map<string, Record<string, number>>()
              for (const r of filtered) {
                const status = r.ticket_status || 'Open'
                const bucket = monthMap.get(r.month) || {}
                bucket[status] = (bucket[status] || 0) + r.est_cost
                monthMap.set(r.month, bucket)
              }
              const STATUS_HEX: Record<string, string> = {
                'Open': '#1B2E6B',
                'In Progress': '#FBBF24',
                'Backlogged': '#9CA3AF',
                'Awaiting Cost': '#FB923C',
                'Closed': '#10B981',
              }

              const data = Array.from(monthMap.keys()).sort().map(month => {
                const row: Record<string, string | number> = {
                  month,
                  label: new Date(month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                }
                for (const s of STATUSES) row[s] = Math.round(monthMap.get(month)?.[s] || 0)
                return row
              })
              const statusMax = data.reduce((m, row) => Math.max(m, ...STATUSES.map(s => Number(row[s]) || 0)), 0)
              const statusTicks = niceTicks(statusMax)

              const Slicer = ({ label, value, options, optionLabel, onChange }: { label: string; value: string; options: string[]; optionLabel?: (v: string) => string; onChange: (v: string) => void }) => (
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{label}</span>
                  <select
                    className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-[#1B2E6B] truncate"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                  >
                    {options.map(o => <option key={o} value={o}>{optionLabel ? optionLabel(o) : o}</option>)}
                  </select>
                </div>
              )

              return (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Cost by Ticket Status</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
                    {assets.length !== 1 && (
                      <Slicer label="Asset" value={statusChartAsset} options={assetOpts} onChange={setStatusChartAsset} />
                    )}
                    <Slicer label="Year (Issue Date)" value={statusChartYear} options={yearOpts} onChange={setStatusChartYear} />
                    <Slicer label="Month (Issue Date)" value={statusChartMonth} options={monthOptsAll} optionLabel={o => o === 'All' ? 'All' : MONTH_NAMES[parseInt(o, 10) - 1]} onChange={setStatusChartMonth} />
                  </div>
                  {data.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-8">No data for the selected filters</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={data} margin={{ top: 4, right: 4, left: 12, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={fmt} ticks={statusTicks} domain={[0, statusTicks[statusTicks.length - 1]]} label={{ value: 'Sum of Est. Cost', angle: -90, position: 'insideLeft', offset: 0, style: { textAnchor: 'middle', fill: '#6B7280', fontSize: 11 } }} />
                        <Tooltip cursor={{ fill: '#F3F4F6' }} content={<ChartTooltip valueFormatter={fmt} />} offset={40} wrapperStyle={{ outline: 'none', zIndex: 50, marginTop: -100 }} />
                        <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 10, paddingTop: 32 }} />
                        {STATUSES.map(s => (
                          <Bar key={s} dataKey={s} name={s} fill={STATUS_HEX[s]} radius={[4, 4, 0, 0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )
            })()}

            {/* Monthly Trend */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700">Monthly Ticket Trend</h3>
              <p className="text-xs text-gray-400 mb-3">Tickets created each month over the last 12 months</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyTrend} margin={{ top: 4, right: 4, left: 12, bottom: 20 }}>
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
                  <YAxis
                    tick={{ fontSize: 10, fill: '#9CA3AF' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                    label={{ value: 'Tickets', angle: -90, position: 'insideLeft', offset: 0, fontSize: 11, fill: '#6B7280', style: { textAnchor: 'middle' } }}
                  />
                  <Tooltip cursor={{ fill: '#F3F4F6' }} content={<ChartTooltip valueFormatter={(v) => `${v} tickets`} />} offset={40} wrapperStyle={{ outline: 'none', zIndex: 50, marginTop: -100 }} />
                  <Bar dataKey="count" fill="#1B2E6B" radius={[4, 4, 0, 0]} activeBar={{ fill: '#2B3E8B', stroke: 'none' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Cost by Department */}
            {costByDept.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-700">Cost by Department</h3>
                <p className="text-xs text-gray-400 mb-3">Estimated cost vs. actual repair cost by department</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={costByDept} margin={{ top: 4, right: 4, left: 12, bottom: 60 }}>
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
                    <YAxis
                      tick={{ fontSize: 10, fill: '#9CA3AF' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={fmt}
                      label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft', offset: 0, fontSize: 11, fill: '#6B7280', style: { textAnchor: 'middle' } }}
                    />
                    <Tooltip cursor={{ fill: '#F3F4F6' }} content={<ChartTooltip valueFormatter={fmt} />} offset={40} wrapperStyle={{ outline: 'none', zIndex: 50, marginTop: -100 }} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 70 }} />
                    <Bar dataKey="estCost" name="Est. Cost" fill="#1B2E6B" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="repairCost" name="Repair Cost" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Cost Trend Over Time */}
            {aggData.costTrend && aggData.costTrend.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <h3 className="text-sm font-semibold text-gray-700">Monthly Cost Trend</h3>
                <p className="text-xs text-gray-400 mb-3">Estimated cost vs. actual repair cost by month</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={aggData.costTrend} margin={{ top: 4, right: 4, left: 12, bottom: 60 }}>
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
                    <YAxis
                      tick={{ fontSize: 10, fill: '#9CA3AF' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={fmt}
                      label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft', offset: 0, fontSize: 11, fill: '#6B7280', style: { textAnchor: 'middle' } }}
                    />
                    <Tooltip cursor={{ fill: '#F3F4F6' }} content={<ChartTooltip valueFormatter={fmt} />} offset={40} wrapperStyle={{ outline: 'none', zIndex: 50, marginTop: -100 }} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 55 }} />
                    <Bar dataKey="estCost" name="Est. Cost" fill="#1B2E6B" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="repairCost" name="Repair Cost" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Ticket Breakdown by Field + Equipment — heatmap */}
            {equipBreakdownData.length > 0 && (() => {
              const maxCount = Math.max(
                1,
                ...equipBreakdownData.flatMap(row => topEquipTypes.map(eq => (row as Record<string, unknown>)[eq] as number || 0))
              )
              return (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">Tickets by Field & Equipment</h3>
                    <span className="text-[10px] text-gray-400">tap a cell to filter</span>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">Hotspots across fields and equipment — darker cells mean more tickets</p>
                  <div className="flex gap-1.5 flex-wrap mb-3">
                    {['All', ...departmentsByCount].map(d => (
                      <button
                        key={d}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${deptFilter === d ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        onClick={() => setDeptFilter(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <div className="min-w-[560px]">
                      <div
                        className="grid gap-1 mb-1"
                        style={{ gridTemplateColumns: `110px repeat(${topEquipTypes.length}, minmax(0, 1fr))` }}
                      >
                        <div></div>
                        {topEquipTypes.map(eq => (
                          <div key={eq} className="text-[10px] text-gray-500 text-center px-1 leading-tight" title={eq}>
                            {eq}
                          </div>
                        ))}
                      </div>
                      {equipBreakdownData.map(row => {
                        const r = row as Record<string, unknown>
                        const fieldName = r.field as string
                        return (
                          <div
                            key={fieldName}
                            className="grid gap-1 mb-1"
                            style={{ gridTemplateColumns: `110px repeat(${topEquipTypes.length}, minmax(0, 1fr))` }}
                          >
                            <div className="text-xs text-gray-700 truncate self-center pr-2" title={fieldName}>
                              {fieldName}
                            </div>
                            {topEquipTypes.map(eq => {
                              const count = (r[eq] as number) || 0
                              const intensity = count / maxCount
                              const opacity = count === 0 ? 0.04 : 0.15 + intensity * 0.85
                              const textWhite = intensity > 0.5
                              const clickable = count > 0
                              return (
                                <div
                                  key={eq}
                                  className={`rounded-md text-xs font-semibold text-center py-2.5 transition-transform ${textWhite ? 'text-white' : 'text-gray-700'} ${clickable ? 'cursor-pointer hover:scale-[1.04] active:scale-[0.99]' : 'cursor-default'}`}
                                  style={{ backgroundColor: `rgba(27, 46, 107, ${opacity})` }}
                                  title={clickable ? `View ${count} ticket${count === 1 ? '' : 's'} for ${fieldName} • ${eq}` : `${fieldName} • ${eq}: 0 tickets`}
                                  onClick={() => {
                                    if (!clickable) return
                                    setFieldFilter(fieldName)
                                    setEquipmentFilter(eq)
                                    if (deptFilter !== 'All') setTableDeptFilter(deptFilter)
                                    setTab('tickets')
                                  }}
                                >
                                  {count || ''}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                      {/* Color scale legend */}
                      <div className="flex items-center justify-end gap-1.5 mt-3">
                        <span className="text-[10px] text-gray-400">Fewer</span>
                        {[0.15, 0.3, 0.5, 0.7, 0.9, 1].map(o => (
                          <div key={o} className="w-4 h-3 rounded-sm" style={{ backgroundColor: `rgba(27, 46, 107, ${o})` }} />
                        ))}
                        <span className="text-[10px] text-gray-400">More</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Work Type Breakdown */}
            {aggData.workTypeBreakdown && aggData.workTypeBreakdown.length > 0 && (() => {
              const visibleWorkTypes = aggData.workTypeBreakdown.filter(w => w.type !== 'Unspecified')
              const total = visibleWorkTypes.reduce((s, w) => s + w.count, 0)
              const maxCount = visibleWorkTypes[0]?.count || 1
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
                    {visibleWorkTypes.map(w => {
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
              const showAge = status !== 'Closed'
              const totalAvgAge = showAge && totalCount > 0
                ? Math.round(rows.reduce((s, r) => s + (r.avgAge ?? 0) * r.count, 0) / totalCount)
                : null
              const ageClass = (age: number) => age > 30 ? 'text-red-700' : age > 7 ? 'text-amber-700' : 'text-gray-700'

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
                            {showAge && <th className="text-right px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Avg. Days Open</th>}
                            <th className="text-right px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Est. Cost</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Repair Cost</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-500 whitespace-nowrap">Savings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr
                              key={i}
                              className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} cursor-pointer hover:bg-blue-50 transition-colors`}
                              title={`View ${r.count} ticket${r.count === 1 ? '' : 's'} in ${status}`}
                              onClick={() => {
                                setStatusFilter(status)
                                setTableDeptFilter(r.dept || 'All')
                                setFieldFilter(r.field || 'Unknown')
                                setEquipmentFilter('All')
                                setWorkTypeFilter('All')
                                setSearch('')
                                setTab('tickets')
                              }}
                            >
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.asset || '—'}</td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.field || '—'}</td>
                              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.dept || '—'}</td>
                              <td className="px-3 py-2 text-right font-semibold text-gray-800">{r.count}</td>
                              {showAge && (
                                <td className={`px-3 py-2 text-right font-medium ${r.avgAge !== null ? ageClass(r.avgAge) : 'text-gray-400'}`}>
                                  {r.avgAge !== null ? `${r.avgAge} ${r.avgAge === 1 ? 'day' : 'days'}` : '—'}
                                </td>
                              )}
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
                            {showAge && (
                              <td className={`px-3 py-2 text-right ${totalAvgAge !== null ? ageClass(totalAvgAge) : 'text-gray-500'}`}>
                                {totalAvgAge !== null ? `${totalAvgAge} ${totalAvgAge === 1 ? 'day' : 'days'}` : '—'}
                              </td>
                            )}
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

              {/* Department — sorted by total ticket count, descending */}
              {departmentsByCount.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Department</p>
                  <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-thin-pills">
                    {['All', ...departmentsByCount].map(d => (
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

              {/* Field */}
              {aggData?.fieldList && aggData.fieldList.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Field</p>
                  <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-thin-pills">
                    {['All', ...aggData.fieldList].map(f => (
                      <button
                        key={f}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${fieldFilter === f ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        onClick={() => setFieldFilter(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Work Type */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Work Type</p>
                <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-thin-pills">
                  {['All', ...WORK_TYPES.filter(w => w !== 'Unspecified')].map(w => (
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

              {/* Equipment */}
              {aggData?.equipmentList && aggData.equipmentList.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Equipment</p>
                  <SearchableSelect
                    value={equipmentFilter}
                    options={['All', ...aggData.equipmentList]}
                    placeholder="All Equipment"
                    onChange={v => setEquipmentFilter(v || 'All')}
                  />
                </div>
              )}

              {/* Reset */}
              {(search || statusFilter !== 'All' || tableDeptFilter !== 'All' || fieldFilter !== 'All' || equipmentFilter !== 'All' || workTypeFilter !== 'All') && (
                <button
                  className="w-full py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-200"
                  onClick={() => { setSearch(''); setStatusFilter('All'); setTableDeptFilter('All'); setFieldFilter('All'); setEquipmentFilter('All'); setWorkTypeFilter('All') }}
                >
                  ✕ Reset Filters
                </button>
              )}
            </div>

            {/* Count + Export */}
            <div className="flex items-center justify-between px-0.5">
              <p className="text-xs text-gray-400">{tableCount.toLocaleString()} tickets</p>
              <div className="flex items-center gap-2">
                {role === 'admin' && (
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    onClick={handleExport}
                  >
                    <Download size={13} />
                    Export CSV
                  </button>
                )}
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1B2E6B] bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                  onClick={handleExportExcel}
                >
                  <Download size={13} />
                  Export
                </button>
              </div>
            </div>

            {/* Mobile: card list — hidden, use table on all screens */}
            <div className="hidden space-y-2">
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

            {/* Full table — all screens */}
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

        {/* ── Equipment Costs Tab ── */}
        {tab === 'equipCosts' && (
          <EquipmentCosts userAssets={assets} />
        )}

        {/* ── Pivot Tab ── */}
        {tab === 'pivot' && (
          <PivotBuilder userAssets={assets} />
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
                    (() => {
                      const costy = isCostChart(msg.chart)
                      const valueFormatter = costy ? fmt : (v: number) => v.toLocaleString()
                      return (
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
                            <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} wrapperStyle={{ outline: 'none', zIndex: 50 }} />
                          </PieChart>
                        ) : msg.chart.chartType === 'line' ? (
                          <LineChart data={msg.chart.data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey={msg.chart.xKey} tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={valueFormatter} />
                            <Tooltip cursor={{ fill: '#F3F4F6' }} content={<ChartTooltip valueFormatter={valueFormatter} />} wrapperStyle={{ outline: 'none', zIndex: 50 }} />
                            {msg.chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
                            {msg.chart.series.map(s => (
                              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
                            ))}
                          </LineChart>
                        ) : (
                          <BarChart data={msg.chart.data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey={msg.chart.xKey} tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={valueFormatter} />
                            <Tooltip cursor={{ fill: '#F3F4F6' }} content={<ChartTooltip valueFormatter={valueFormatter} />} wrapperStyle={{ outline: 'none', zIndex: 50 }} />
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
                      )
                    })()
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
