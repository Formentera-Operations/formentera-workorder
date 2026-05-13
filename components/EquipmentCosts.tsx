'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { usePlotArea } from 'recharts'
import { Download, X } from 'lucide-react'

type CostType = 'estimate_cost' | 'repair_cost'
const COST_LABEL: Record<CostType, string> = {
  estimate_cost: 'Estimate Cost',
  repair_cost: 'Repair Cost',
}

const SERIES_COLORS = ['#1B2E6B', '#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6']

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type DatePreset =
  | 'all' | 'thisweek' | 'lastweek' | 'thismonth' | 'lastmonth' | 'thisyear' | 'lastyear' | 'custom'

interface PivotResponse {
  rows: string[]
  columns: string | null
  series: { key: string; label: string; valueKey: string; columnGroup: string | null }[]
  data: Record<string, string | number>[]
  total_row_groups: number
  total_col_groups: number
  error?: string
}

interface TicketRow {
  ticket_id: number
  department: string | null
  work_order_type: string | null
  location_type: string | null
  field: string | null
  well: string | null
  facility: string | null
  equipment_name: string | null
  issue_description: string | null
  ticket_status: string | null
  issue_date: string | null
  repair_date_closed: string | null
  Estimate_Cost: number | null
  repair_cost: number | null
}

// Match filter-pill / KPI palette (STATUS_COLORS in lib/utils.ts):
// green Open / purple In Progress / yellow Backlogged / gray Awaiting / red Closed.
const STATUS_COLORS: Record<string, string> = {
  Open:            'bg-green-50 text-green-700',
  'In Progress':   'bg-purple-50 text-purple-700',
  Backlogged:      'bg-yellow-50 text-yellow-700',
  'Awaiting Cost': 'bg-gray-100 text-gray-700',
  Closed:          'bg-red-50 text-red-700',
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const slice = d.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slice)) return slice
  const [y, m, day] = slice.split('-')
  return `${parseInt(m, 10)}/${parseInt(day, 10)}/${y.slice(2)}`
}
function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '—'
  return `$${Math.round(n).toLocaleString()}`
}
function fmtSavings(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

function YearDividers({ data }: { data: Array<Record<string, string | number | boolean>> }) {
  const plot = usePlotArea()
  if (!plot || data.length === 0) return null
  const { x, y, width, height } = plot
  const band = width / data.length
  const lines: number[] = []
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i]._dateBoundary) lines.push(x + (i + 1) * band)
  }
  if (lines.length === 0) return null
  return (
    <g>
      {lines.map((lx, idx) => (
        <line key={idx} x1={lx} y1={y} x2={lx} y2={y + height + 30} stroke="#6B7280" strokeWidth={1} />
      ))}
    </g>
  )
}

function HierarchyTick(props: Record<string, unknown>) {
  const x = typeof props.x === 'number' ? props.x : Number(props.x) || 0
  const y = typeof props.y === 'number' ? props.y : Number(props.y) || 0
  const index = typeof props.index === 'number' ? props.index : 0
  const data = (props.data as Array<Record<string, string | number | boolean>>) || []
  const datum = data[index]
  if (!datum) return null
  const innerRaw = String(datum._innerLabel ?? '')
  const m = /^(\d{4})-(\d{2})$/.exec(innerRaw)
  const inner = m ? (MONTH_NAMES[parseInt(m[2], 10) - 1] || innerRaw) : innerRaw
  const showOuter = Boolean(datum._showOuter)
  const outer = String(datum._outerLabel ?? '')
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={10} fill="#9CA3AF">{inner}</text>
      {showOuter && (
        <>
          <line x1={-12} x2={12} y1={20} y2={20} stroke="#D1D5DB" strokeWidth={1} />
          <text dy={36} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151">{outer}</text>
        </>
      )}
    </g>
  )
}

function MultiCheckSelect({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string
  allLabel: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const node = ref.current
      if (!node) return
      if (e.composedPath().includes(node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const summary =
    selected.length === 0 ? allLabel
    : selected.length === 1 ? selected[0]
    : `${selected.length} ${label}s`
  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt])
  }
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white hover:border-[#1B2E6B] focus:outline-none focus:ring-2 focus:ring-[#1B2E6B] text-left"
      >
        <span className={selected.length === 0 ? 'text-gray-400' : 'text-gray-900'}>{summary}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-gray-400 flex-shrink-0">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg text-xs max-h-64 overflow-y-auto">
          {selected.length > 0 && (
            <button
              onMouseDown={(e) => { e.preventDefault(); onChange([]) }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-[#1B2E6B] hover:bg-gray-50 border-b border-gray-100"
            >
              Clear all
            </button>
          )}
          {options.length === 0 ? (
            <p className="px-3 py-2 text-gray-400">No values found</p>
          ) : (
            options.map(opt => {
              const checked = selected.includes(opt)
              return (
                <button
                  key={opt}
                  onMouseDown={(e) => { e.preventDefault(); toggle(opt) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-gray-700"
                >
                  <span className={`w-3 h-3 border rounded flex items-center justify-center ${checked ? 'bg-[#1B2E6B] border-[#1B2E6B]' : 'border-gray-300'}`}>
                    {checked && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l1.5 1.5L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </span>
                  <span className="flex-1 text-left">{opt}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: string | number
}) {
  if (!active || !payload || payload.length === 0) return null
  const sorted = [...payload]
    .map(p => ({ name: p.name ?? '', value: typeof p.value === 'number' ? p.value : 0, color: p.color }))
    .sort((a, b) => b.value - a.value)
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs" style={{ minWidth: 180 }}>
      {label != null && (
        <div className="font-semibold text-gray-900 mb-1.5 border-b border-gray-100 pb-1">{label}</div>
      )}
      <div className="flex flex-col gap-1">
        {sorted.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color || '#1B2E6B' }} />
              <span className="truncate text-gray-700">{p.name}</span>
            </div>
            <span className="font-medium text-gray-900 tabular-nums">{fmtCurrency(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function EquipmentCosts({ userAssets }: { userAssets: string[] }) {
  const router = useRouter()
  const [costType, setCostType] = useState<CostType>('estimate_cost')
  const [equipCategoryFilter, setEquipCategoryFilter] = useState<string[]>([])
  const [fieldFilter, setFieldFilter] = useState<string[]>([])
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')

  const [equipCategoryOptions, setEquipCategoryOptions] = useState<string[]>([])
  const [fieldOptions, setFieldOptions] = useState<string[]>([])

  const [result, setResult] = useState<PivotResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [ticketsCapped, setTicketsCapped] = useState(false)

  // Derive start/end date from preset (Mon–Sun weeks).
  const { startDate, endDate } = useMemo(() => {
    function ymd(d: Date) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
    const today = new Date()
    const todayStr = ymd(today)
    const dom = today.getDay() === 0 ? 6 : today.getDay() - 1
    if (datePreset === 'thisweek') {
      const s = new Date(today); s.setDate(s.getDate() - dom)
      return { startDate: ymd(s), endDate: todayStr }
    }
    if (datePreset === 'lastweek') {
      const s = new Date(today); s.setDate(s.getDate() - dom - 7)
      const e = new Date(s); e.setDate(e.getDate() + 6)
      return { startDate: ymd(s), endDate: ymd(e) }
    }
    if (datePreset === 'thismonth') {
      return { startDate: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: todayStr }
    }
    if (datePreset === 'lastmonth') {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const e = new Date(today.getFullYear(), today.getMonth(), 0)
      return { startDate: ymd(s), endDate: ymd(e) }
    }
    if (datePreset === 'thisyear') return { startDate: `${today.getFullYear()}-01-01`, endDate: todayStr }
    if (datePreset === 'lastyear') {
      const y = today.getFullYear() - 1
      return { startDate: `${y}-01-01`, endDate: `${y}-12-31` }
    }
    if (datePreset === 'custom') {
      return { startDate: customStart, endDate: customEnd }
    }
    return { startDate: '', endDate: '' }
  }, [datePreset, customStart, customEnd])

  // Preload filter options. Self-exclusion only matters when both filters are
  // active — the dim being queried is excluded so its dropdown stays usable.
  useEffect(() => {
    let cancelled = false
    async function load(dim: string, otherDim: string, otherValues: string[]) {
      const filters = otherValues.length > 0 ? [{ dim: otherDim, values: otherValues }] : []
      const res = await fetch('/api/analysis/pivot/values', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dim,
          userAssets,
          filters,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        }),
      })
      const json = await res.json()
      if (cancelled || !res.ok || json.error) return [] as string[]
      return (json.values || []) as string[]
    }
    Promise.all([
      load('equipment_type', 'field', fieldFilter),
      load('field', 'equipment_type', equipCategoryFilter),
    ]).then(([cats, fields]) => {
      if (cancelled) return
      setEquipCategoryOptions(cats)
      setFieldOptions(fields)
    })
    return () => { cancelled = true }
  }, [userAssets, startDate, endDate, fieldFilter, equipCategoryFilter])

  // Run the pivot.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch('/api/analysis/pivot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        rows: ['submitted_month', 'submitted_year'],
        columns: 'equipment',
        values: [costType],
        max_rows: 200,
        max_columns: 50,
        filters: [
          ...(equipCategoryFilter.length > 0 ? [{ dim: 'equipment_type', values: equipCategoryFilter }] : []),
          ...(fieldFilter.length > 0 ? [{ dim: 'field', values: fieldFilter }] : []),
        ],
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        userAssets,
      }),
    })
      .then(async r => {
        const json = await r.json()
        if (!r.ok || json.error) throw new Error(json.error || `HTTP ${r.status}`)
        setResult(json)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [costType, equipCategoryFilter, fieldFilter, startDate, endDate, userAssets])

  // Fetch ticket-level rows for the table below the chart.
  useEffect(() => {
    const controller = new AbortController()
    setTicketsLoading(true)
    fetch('/api/analysis/equipment-costs/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        userAssets,
        equipCategories: equipCategoryFilter,
        fields: fieldFilter,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      }),
    })
      .then(async r => {
        const json = await r.json()
        if (!r.ok || json.error) throw new Error(json.error || `HTTP ${r.status}`)
        setTickets(json.rows || [])
        setTicketsCapped(!!json.capped)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setTickets([])
      })
      .finally(() => setTicketsLoading(false))
    return () => controller.abort()
  }, [equipCategoryFilter, fieldFilter, startDate, endDate, userAssets])

  // Enrich chart data with two-tier x-axis labels and year boundaries.
  const enhancedData = useMemo(() => {
    if (!result || result.data.length === 0) return [] as Record<string, string | number | boolean>[]
    const outerKey = 'submitted_year'
    const innerKey = 'submitted_month'
    type Group = { startIdx: number; endIdx: number; value: string }
    const groups: Group[] = []
    let curr = ''
    for (let i = 0; i < result.data.length; i++) {
      const v = String(result.data[i][outerKey] ?? '')
      if (v !== curr) { groups.push({ startIdx: i, endIdx: i, value: v }); curr = v }
      else groups[groups.length - 1].endIdx = i
    }
    const center = new Map<number, { value: string; span: number }>()
    for (const g of groups) {
      const c = Math.floor((g.startIdx + g.endIdx) / 2)
      center.set(c, { value: g.value, span: g.endIdx - g.startIdx + 1 })
    }
    return result.data.map((row, i) => {
      const c = center.get(i)
      const next = i < result.data.length - 1 ? result.data[i + 1] : null
      return {
        ...row,
        _innerLabel: String(row[innerKey] ?? ''),
        _outerLabel: c?.value ?? '',
        _showOuter: !!c,
        _dateBoundary: !!(next && row[outerKey] !== next[outerKey]),
      }
    })
  }, [result])

  function exportCsv() {
    if (!result) return
    const seriesHeaders = result.series.map(s => s.label)
    const header = ['Submitted Month', 'Submitted Year', ...seriesHeaders]
    const lines = [header.join(',')]
    for (const row of result.data) {
      const cells: string[] = [String(row.submitted_month ?? ''), String(row.submitted_year ?? '')]
      for (const s of result.series) cells.push(String(row[s.key] ?? 0))
      lines.push(cells.map(c => /[,"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `equipment_costs_${costType}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasAnySelection = equipCategoryFilter.length > 0 || fieldFilter.length > 0 || datePreset !== 'all' || costType !== 'estimate_cost'
  function clearAll() {
    setCostType('estimate_cost')
    setEquipCategoryFilter([])
    setFieldFilter([])
    setDatePreset('all')
    setCustomStart('')
    setCustomEnd('')
  }

  return (
    <div className="space-y-3">
      {/* Filters bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Filters</p>
          <button
            onClick={clearAll}
            disabled={!hasAnySelection}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 hover:border-red-300 disabled:bg-gray-50 disabled:border-gray-200 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
            title="Reset all filters"
          >
            <X size={14} /> Clear
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {/* Cost type toggle */}
          <div className="inline-flex items-center bg-gray-100 rounded-lg p-0.5 h-[34px]">
            {(['estimate_cost', 'repair_cost'] as CostType[]).map(t => {
              const active = costType === t
              return (
                <button
                  key={t}
                  onClick={() => setCostType(t)}
                  className={`flex-1 text-xs font-medium px-3 py-1 rounded-md transition-colors ${
                    active ? 'bg-white text-[#1B2E6B] shadow-sm' : 'text-gray-500 hover:text-[#1B2E6B]'
                  }`}
                >
                  {COST_LABEL[t]}
                </button>
              )
            })}
          </div>
          <MultiCheckSelect
            label="Equipment Category"
            allLabel="All Equipment Categories"
            options={equipCategoryOptions}
            selected={equipCategoryFilter}
            onChange={setEquipCategoryFilter}
          />
          <MultiCheckSelect
            label="Field"
            allLabel="All Fields"
            options={fieldOptions}
            selected={fieldFilter}
            onChange={setFieldFilter}
          />
          <div className="flex flex-col gap-1.5">
            <select
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]"
              value={datePreset}
              onChange={e => setDatePreset(e.target.value as DatePreset)}
            >
              <option value="all">All Time</option>
              <option value="thisweek">This Week</option>
              <option value="lastweek">Last Week</option>
              <option value="thismonth">This Month</option>
              <option value="lastmonth">Last Month</option>
              <option value="thisyear">This Year</option>
              <option value="lastyear">Last Year</option>
              <option value="custom">Custom Range…</option>
            </select>
            {datePreset === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                  value={customStart}
                  max={customEnd || undefined}
                  onChange={e => setCustomStart(e.target.value)}
                />
                <span className="text-[10px] text-gray-400">to</span>
                <input
                  type="date"
                  className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                  value={customEnd}
                  min={customStart || undefined}
                  onChange={e => setCustomEnd(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className="text-xs font-semibold text-gray-700 truncate">
            {COST_LABEL[costType]} by Submitted Month › Submitted Year by Equipment
          </p>
          {result && result.data.length > 0 && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-[#1B2E6B] transition-colors flex-shrink-0"
            >
              <Download size={12} /> Export CSV
            </button>
          )}
        </div>

        {loading && !result ? (
          <div className="h-[280px] flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : error ? (
          <div className="h-[280px] flex items-center justify-center text-xs text-red-600">{error}</div>
        ) : !result || result.data.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-xs text-gray-400">No tickets match these filters.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={enhancedData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="_rowLabel"
                interval={0}
                height={56}
                tick={(props) => <HierarchyTick {...props} data={enhancedData} />}
              />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtCurrency(v)} />
              <YearDividers data={enhancedData} />
              <Tooltip
                cursor={{ fill: '#F3F4F6' }}
                content={<ChartTooltip />}
                wrapperStyle={{ outline: 'none', zIndex: 50 }}
              />
              {result.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {result.series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.columnGroup === 'Other' ? '#9CA3AF' : SERIES_COLORS[i % SERIES_COLORS.length]}
                  radius={[3, 3, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Ticket detail table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-700">
            Tickets {ticketsLoading ? '' : `(${tickets.length}${ticketsCapped ? '+' : ''})`}
          </p>
        </div>
        {ticketsLoading && tickets.length === 0 ? (
          <div className="h-[120px] flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : tickets.length === 0 ? (
          <div className="h-[120px] flex items-center justify-center text-xs text-gray-400">No tickets match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  {[
                    'Ticket #', 'Department', 'Work Type', 'Location Type', 'Field',
                    'Location', 'Equipment', 'Description', 'Status',
                    'Submitted', 'Closed', 'Est. Cost', 'Repair Cost', 'Savings',
                  ].map(h => (
                    <th
                      key={h}
                      className={`px-2 py-2 font-medium text-gray-500 whitespace-nowrap ${
                        h === 'Est. Cost' || h === 'Repair Cost' || h === 'Savings' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => {
                  const isFacility = (t.location_type || '').toLowerCase().includes('facility')
                  const location = isFacility ? (t.facility || '—') : (t.well || t.facility || '—')
                  const est = t.Estimate_Cost || 0
                  const rep = t.repair_cost || 0
                  const savings = est - rep
                  const showSavings = est > 0 || rep > 0
                  const statusClass = t.ticket_status ? STATUS_COLORS[t.ticket_status] || 'bg-gray-100 text-gray-700' : 'bg-gray-100 text-gray-700'
                  return (
                    <tr
                      key={t.ticket_id}
                      className="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer transition-colors"
                      onClick={() => router.push(`/maintenance/${t.ticket_id}`)}
                    >
                      <td className="px-2 py-2 font-medium text-[#1B2E6B] whitespace-nowrap">#{t.ticket_id}</td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{t.department || '—'}</td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{t.work_order_type || '—'}</td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{t.location_type || '—'}</td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{t.field || '—'}</td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{location}</td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{t.equipment_name || '—'}</td>
                      <td className="px-2 py-2 text-gray-700 max-w-[260px] truncate" title={t.issue_description || ''}>
                        {t.issue_description || '—'}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusClass}`}>
                          {t.ticket_status || '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap tabular-nums">{fmtDate(t.issue_date)}</td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap tabular-nums">{fmtDate(t.repair_date_closed)}</td>
                      <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap tabular-nums">{fmtMoney(t.Estimate_Cost)}</td>
                      <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap tabular-nums">{fmtMoney(t.repair_cost)}</td>
                      <td className={`px-2 py-2 text-right font-medium whitespace-nowrap tabular-nums ${
                        !showSavings ? 'text-gray-400' : savings >= 0 ? 'text-green-700' : 'text-red-600'
                      }`}>
                        {showSavings ? fmtSavings(savings) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {ticketsCapped && (
              <p className="mt-2 text-[10px] text-gray-400 italic">Showing first 10,000 tickets — narrow your filters to see more.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
