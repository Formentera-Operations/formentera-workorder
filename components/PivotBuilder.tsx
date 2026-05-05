'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Customized,
} from 'recharts'
import { Download, X, Plus, ChevronRight, ChevronDown } from 'lucide-react'

type ValueKey = 'count' | 'repair_cost' | 'estimate_cost' | 'savings'

const DIM_OPTIONS: { key: string; label: string }[] = [
  { key: 'equipment',       label: 'Equipment' },
  { key: 'equipment_type',  label: 'Equipment Category' },
  { key: 'department',      label: 'Department' },
  { key: 'foreman',         label: 'Foreman' },
  { key: 'vendor',          label: 'Vendor' },
  { key: 'well',            label: 'Well' },
  { key: 'facility',        label: 'Facility' },
  { key: 'field',           label: 'Field' },
  { key: 'asset',           label: 'Asset' },
  { key: 'job_category',    label: 'Job Category' },
  { key: 'priority',        label: 'Priority' },
  { key: 'work_order_type', label: 'Work Order Type' },
  { key: 'status',          label: 'Ticket Status' },
  { key: 'description',     label: 'Description' },
  { key: 'ticket_id',       label: 'Ticket #' },
]

const DATE_HIERARCHY_OPTIONS: { key: string; label: string }[] = [
  { key: 'submitted_year',    label: 'Submitted Year' },
  { key: 'submitted_quarter', label: 'Submitted Quarter' },
  { key: 'submitted_month',   label: 'Submitted Month' },
  { key: 'submitted_day',     label: 'Submitted Day' },
]

const ALL_DIM_OPTIONS = [...DIM_OPTIONS, ...DATE_HIERARCHY_OPTIONS]
const DIM_LABEL = Object.fromEntries(ALL_DIM_OPTIONS.map(d => [d.key, d.label]))

const VALUE_OPTIONS: { key: ValueKey; label: string }[] = [
  { key: 'count',         label: 'Ticket Count' },
  { key: 'estimate_cost', label: 'Estimate Cost' },
  { key: 'repair_cost',   label: 'Repair Cost' },
  { key: 'savings',       label: 'Savings' },
]
const VALUE_LABEL: Record<ValueKey, string> = Object.fromEntries(
  VALUE_OPTIONS.map(v => [v.key, v.label])
) as Record<ValueKey, string>

const STATUSES = ['Open', 'In Progress', 'Backlogged', 'Awaiting Cost', 'Closed']
const SERIES_COLORS = ['#1B2E6B', '#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6']

interface PivotSeriesMeta {
  key: string
  label: string
  valueKey: ValueKey
  columnGroup: string | null
}

interface PivotResponse {
  rows: string[]
  columns: string | null
  values: { key: ValueKey; label: string }[]
  series: PivotSeriesMeta[]
  data: Record<string, string | number>[]
  total_row_groups: number
  total_col_groups: number
  error?: string
}

function fmt(n: number, isCurrency: boolean): string {
  if (!isCurrency) return n.toLocaleString()
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatHierarchyLabel(s: string): string {
  // YYYY-MM-DD → "Oct 15"
  const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (md) return `${MONTH_NAMES[parseInt(md[2], 10) - 1] || md[2]} ${parseInt(md[3], 10)}`
  // YYYY-MM → "Oct"
  const m = /^(\d{4})-(\d{2})$/.exec(s)
  if (m) return MONTH_NAMES[parseInt(m[2], 10) - 1] || s
  return s
}

function HierarchyTick(props: Record<string, unknown>) {
  const x = typeof props.x === 'number' ? props.x : Number(props.x) || 0
  const y = typeof props.y === 'number' ? props.y : Number(props.y) || 0
  const index = typeof props.index === 'number' ? props.index : 0
  const data = (props.data as Array<Record<string, string | number | boolean>>) || []
  const datum = data[index]
  if (!datum) return null
  const inner = formatHierarchyLabel(String(datum._innerLabel ?? ''))
  const showOuter = Boolean(datum._showOuter)
  const outerRaw = String(datum._outerLabel ?? '')
  const outer = formatHierarchyLabel(outerRaw)
  const span = Number(datum._outerSpan ?? 1) || 1
  // ~7px per char at fontSize 11; budget per tick ~70px shrinks with screen width.
  const maxChars = Math.max(8, span * 10)
  const outerDisplay = outer.length > maxChars ? outer.slice(0, Math.max(1, maxChars - 1)) + '…' : outer
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={10} fill="#9CA3AF">{inner}</text>
      {showOuter && (
        <>
          <line x1={-12} x2={12} y1={20} y2={20} stroke="#D1D5DB" strokeWidth={1} />
          <text dy={36} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151">
            {outerDisplay}
            <title>{outerRaw}</title>
          </text>
        </>
      )}
    </g>
  )
}

function ChartTooltip({ active, payload, label, currencyByKey }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>
  label?: string | number
  currencyByKey: Record<string, boolean>
}) {
  if (!active || !payload || payload.length === 0) return null
  const items = payload.filter(p => typeof p.value === 'number' && p.value !== 0)
  if (items.length === 0) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs" style={{ minWidth: 180, maxWidth: 320 }}>
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
            <span className="font-medium text-gray-900 flex-shrink-0">
              {fmt(p.value as number, !!currencyByKey[p.dataKey || ''])}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PivotBuilder({ userAssets }: { userAssets: string[] }) {
  const [rowsDims, setRowsDims] = useState<string[]>([])
  const [colsDim, setColsDim] = useState<string>('')
  const [valueKeys, setValueKeys] = useState<ValueKey[]>([])
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [fieldFilter, setFieldFilter] = useState<string[]>([])
  type DatePreset =
    | 'all'
    | 'thisweek'
    | 'lastweek'
    | 'thismonth'
    | 'lastmonth'
    | 'thisyear'
    | 'lastyear'
    | 'custom'
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  // Free-form filters: dim → selected values (empty list = no filter applied yet)
  const [dimFilters, setDimFilters] = useState<Record<string, string[]>>({})
  // Filter applied to the column dimension (constrains which series appear)
  const [colsFilter, setColsFilter] = useState<string[]>([])
  // Per-row-dim filter values (constrains rows to those values)
  const [rowFilters, setRowFilters] = useState<Record<string, string[]>>({})
  // Per-dim cache of distinct values + loading state
  const [dimValues, setDimValues] = useState<Record<string, { values?: string[]; loading?: boolean; error?: string }>>({})

  const [result, setResult] = useState<PivotResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Whenever the row dim list changes, dump any collapse state — group keys
  // from a prior layout aren't meaningful in the new shape.
  useEffect(() => {
    setCollapsedGroups(new Set())
  }, [rowsDims.join('|')])

  // Hide the Asset dim for single-asset users — there's nothing to pivot on.
  const showAssetDim = userAssets.length !== 1
  const dimOptions = useMemo(
    () => showAssetDim ? DIM_OPTIONS : DIM_OPTIONS.filter(d => d.key !== 'asset'),
    [showAssetDim]
  )
  const allDimOptions = useMemo(
    () => showAssetDim ? ALL_DIM_OPTIONS : ALL_DIM_OPTIONS.filter(d => d.key !== 'asset'),
    [showAssetDim]
  )

  const filterDimList = useMemo(() => Object.keys(dimFilters), [dimFilters])
  const usedDims = useMemo(
    () => new Set([...rowsDims, ...(colsDim ? [colsDim] : []), ...filterDimList]),
    [rowsDims, colsDim, filterDimList]
  )
  const usedValues = useMemo(() => new Set(valueKeys), [valueKeys])

  const { startDate, endDate } = useMemo(() => {
    function ymd(d: Date) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
    const today = new Date()
    const todayStr = ymd(today)
    // Week starts on Monday — getDay() returns 0=Sun..6=Sat.
    const daysFromMonday = today.getDay() === 0 ? 6 : today.getDay() - 1
    if (datePreset === 'thisweek') {
      const start = new Date(today); start.setDate(start.getDate() - daysFromMonday)
      return { startDate: ymd(start), endDate: todayStr }
    }
    if (datePreset === 'lastweek') {
      const start = new Date(today); start.setDate(start.getDate() - daysFromMonday - 7)
      const end = new Date(start); end.setDate(end.getDate() + 6)
      return { startDate: ymd(start), endDate: ymd(end) }
    }
    if (datePreset === 'thismonth') {
      return { startDate: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: todayStr }
    }
    if (datePreset === 'lastmonth') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 0)
      return { startDate: ymd(start), endDate: ymd(end) }
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

  useEffect(() => {
    if (rowsDims.length === 0 || valueKeys.length === 0) {
      setResult(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch('/api/analysis/pivot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        rows: rowsDims,
        columns: colsDim || null,
        values: valueKeys,
        status: statusFilter.length > 0 ? statusFilter : undefined,
        filters: [
          ...Object.entries(dimFilters)
            .filter(([, vs]) => vs.length > 0)
            .map(([dim, vs]) => ({ dim, values: vs })),
          ...Object.entries(rowFilters)
            .filter(([d, vs]) => rowsDims.includes(d) && vs.length > 0)
            .map(([dim, vs]) => ({ dim, values: vs })),
          ...(colsDim && colsFilter.length > 0 ? [{ dim: colsDim, values: colsFilter }] : []),
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
  }, [rowsDims, colsDim, valueKeys, statusFilter, fieldFilter, dimFilters, rowFilters, colsFilter, startDate, endDate, userAssets])

  // ── Helpers for zone manipulation ──
  function addToRows(dim: string) {
    if (rowsDims.includes(dim)) return
    if (rowsDims.length >= 4) return
    setRowsDims([...rowsDims, dim])
    if (colsDim === dim) clearColumns()
    ensureDimValues(dim)
  }
  function removeFromRows(dim: string) {
    setRowsDims(rowsDims.filter(d => d !== dim))
    setRowFilters(prev => {
      if (!(dim in prev)) return prev
      const next = { ...prev }; delete next[dim]; return next
    })
  }
  function setRowFilterValues(dim: string, values: string[]) {
    setRowFilters(prev => ({ ...prev, [dim]: values }))
  }
  function setColumns(dim: string) {
    if (rowsDims.includes(dim)) return
    setColsDim(dim)
    setColsFilter([])
    ensureDimValues(dim)
  }
  function clearColumns() {
    setColsDim('')
    setColsFilter([])
  }
  function addValue(v: ValueKey) {
    if (valueKeys.includes(v)) return
    if (valueKeys.length >= 3) return
    setValueKeys([...valueKeys, v])
  }
  function removeValue(v: ValueKey) {
    setValueKeys(valueKeys.filter(x => x !== v))
  }
  function moveDim(dim: string, target: 'rows' | 'columns' | 'filters') {
    if (target === 'rows') {
      if (colsDim === dim) clearColumns()
      removeFilterDim(dim)
      addToRows(dim)
    } else if (target === 'columns') {
      removeFromRows(dim)
      removeFilterDim(dim)
      setColumns(dim)
    } else {
      removeFromRows(dim)
      if (colsDim === dim) clearColumns()
      addFilterDim(dim)
    }
  }

  function addFilterDim(dim: string) {
    if (dim in dimFilters) return
    setDimFilters({ ...dimFilters, [dim]: [] })
    ensureDimValues(dim)
  }
  function removeFilterDim(dim: string) {
    if (!(dim in dimFilters)) return
    const next = { ...dimFilters }
    delete next[dim]
    setDimFilters(next)
  }
  function setFilterValues(dim: string, values: string[]) {
    setDimFilters({ ...dimFilters, [dim]: values })
  }

  // Build the cross-filter context to send when fetching distinct values.
  // Each filter applies to other filters' option lists EXCEPT the one being
  // queried — that's what lets the user add/remove values within the filter.
  const filterCtx = useMemo(() => ({
    userAssets,
    statusFilter,
    fieldFilter,
    colsDim,
    colsFilter,
    dimFilters,
    rowFilters,
    rowsDims,
    startDate,
    endDate,
  }), [userAssets, statusFilter, fieldFilter, colsDim, colsFilter, dimFilters, rowFilters, rowsDims, startDate, endDate])
  const filterCtxKey = useMemo(() => JSON.stringify(filterCtx), [filterCtx])

  function fetchDimValues(dim: string) {
    setDimValues(prev => ({ ...prev, [dim]: { ...prev[dim], loading: true } }))
    const filters = [
      ...Object.entries(filterCtx.dimFilters)
        .filter(([d, vs]) => d !== dim && vs.length > 0)
        .map(([d, vs]) => ({ dim: d, values: vs })),
      ...Object.entries(filterCtx.rowFilters)
        .filter(([d, vs]) => d !== dim && filterCtx.rowsDims.includes(d) && vs.length > 0)
        .map(([d, vs]) => ({ dim: d, values: vs })),
      ...(filterCtx.colsDim && filterCtx.colsDim !== dim && filterCtx.colsFilter.length > 0
        ? [{ dim: filterCtx.colsDim, values: filterCtx.colsFilter }] : []),
      ...(dim !== 'field' && filterCtx.fieldFilter.length > 0
        ? [{ dim: 'field', values: filterCtx.fieldFilter }] : []),
    ]
    fetch('/api/analysis/pivot/values', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dim,
        userAssets: filterCtx.userAssets,
        status: dim !== 'status' && filterCtx.statusFilter.length > 0 ? filterCtx.statusFilter : undefined,
        filters,
        start_date: filterCtx.startDate || undefined,
        end_date: filterCtx.endDate || undefined,
      }),
    })
      .then(async r => {
        const json = await r.json()
        if (!r.ok || json.error) throw new Error(json.error || `HTTP ${r.status}`)
        setDimValues(prev => ({ ...prev, [dim]: { values: json.values || [] } }))
      })
      .catch((e: Error) => {
        setDimValues(prev => ({ ...prev, [dim]: { error: e.message } }))
      })
  }

  function ensureDimValues(dim: string) {
    if (dimValues[dim]?.values || dimValues[dim]?.loading) return
    fetchDimValues(dim)
  }

  // When the cross-filter context changes, refresh option lists for every
  // already-loaded dim so dropdowns stay consistent with active selections.
  useEffect(() => {
    const loaded = Object.keys(dimValues)
    const dims = loaded.includes('field') ? loaded : [...loaded, 'field']
    for (const d of dims) fetchDimValues(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCtxKey])

  // Default-zone click from field shelf: dim → rows, value → values
  function clickDimField(dim: string) {
    if (rowsDims.includes(dim)) removeFromRows(dim)
    else if (colsDim === dim) clearColumns()
    else if (dim in dimFilters) removeFilterDim(dim)
    else addToRows(dim)
  }
  function clickValueField(v: ValueKey) {
    if (valueKeys.includes(v)) removeValue(v)
    else addValue(v)
  }

  // ── Drag-and-drop state + helpers ──
  type DragItem =
    | { kind: 'dim'; key: string; from: 'shelf' | 'rows' | 'columns' | 'filters' }
    | { kind: 'value'; key: ValueKey; from: 'shelf' | 'values' }
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null)

  const DRAG_MIME = 'application/x-pivot'

  function startDrag(e: React.DragEvent, item: DragItem) {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item))
    e.dataTransfer.effectAllowed = item.from === 'shelf' ? 'copyMove' : 'move'
    setDraggedItem(item)
  }
  function endDrag() {
    setDraggedItem(null)
  }

  function removeFromSource(item: DragItem) {
    if (item.kind === 'dim') {
      if (item.from === 'rows') removeFromRows(item.key)
      else if (item.from === 'columns') clearColumns()
      else if (item.from === 'filters') removeFilterDim(item.key)
    }
  }
  function dropOnRows(item: DragItem) {
    if (item.kind !== 'dim') return
    if (item.from === 'rows') return  // same zone — ignore for now
    removeFromSource(item)
    addToRows(item.key)
  }
  function dropOnColumns(item: DragItem) {
    if (item.kind !== 'dim') return
    if (item.from === 'columns') return
    removeFromSource(item)
    setColumns(item.key)
  }
  function dropOnFilters(item: DragItem) {
    if (item.kind !== 'dim') return
    if (item.from === 'filters') return
    removeFromSource(item)
    addFilterDim(item.key)
  }
  function dropOnValues(item: DragItem) {
    if (item.kind !== 'value') return
    if (item.from === 'values') return
    if (!valueKeys.includes(item.key)) addValue(item.key)
  }

  function zoneDropProps(accepts: 'dim' | 'value', onDrop: (item: DragItem) => void) {
    const active = !!draggedItem && draggedItem.kind === accepts
    return {
      dragActive: active,
      onDragOver: (e: React.DragEvent) => {
        if (!active) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const raw = e.dataTransfer.getData(DRAG_MIME)
        if (!raw) { endDrag(); return }
        try {
          const item = JSON.parse(raw) as DragItem
          onDrop(item)
        } catch {
          // ignore
        }
        endDrag()
      },
    }
  }

  const isCurrencySeries = useMemo(() => {
    const map: Record<string, boolean> = {}
    if (!result) return map
    for (const s of result.series) map[s.key] = s.valueKey !== 'count'
    return map
  }, [result])

  // For 2+ row dims: enrich each chart row with inner/outer labels and mark
  // the center index of each outer group so we can render a two-tier x-axis.
  const enhancedChartData = useMemo(() => {
    if (!result || result.data.length === 0) return [] as Record<string, string | number | boolean>[]
    if (result.rows.length < 2) {
      return result.data.map(r => ({ ...r, _innerLabel: r._rowLabel, _outerLabel: '', _outerSpan: 0, _showOuter: false, _innerBoundary: false }))
    }
    const outerKey = result.rows[0]
    const innerKey = result.rows[result.rows.length - 1]
    type Group = { startIdx: number; endIdx: number; value: string }
    const groups: Group[] = []
    let curr = ''
    for (let i = 0; i < result.data.length; i++) {
      const v = String(result.data[i][outerKey] ?? '')
      if (v !== curr) {
        groups.push({ startIdx: i, endIdx: i, value: v })
        curr = v
      } else {
        groups[groups.length - 1].endIdx = i
      }
    }
    const centerOuter = new Map<number, { value: string; span: number }>()
    for (const g of groups) {
      const center = Math.floor((g.startIdx + g.endIdx) / 2)
      centerOuter.set(center, { value: g.value, span: g.endIdx - g.startIdx + 1 })
    }
    return result.data.map((row, i) => {
      const c = centerOuter.get(i)
      const innerVal = String(row[innerKey] ?? '')
      const nextInner = i < result.data.length - 1 ? String(result.data[i + 1][innerKey] ?? '') : null
      return {
        ...row,
        _innerLabel: innerVal,
        _outerLabel: c?.value ?? '',
        _outerSpan: c?.span ?? 0,
        _showOuter: !!c,
        _innerBoundary: nextInner !== null && nextInner !== innerVal,
      }
    })
  }, [result])
  const showChartHierarchy = (result?.rows.length ?? 0) > 1
  const allCurrency = useMemo(
    () => valueKeys.length > 0 && valueKeys.every(v => v !== 'count'),
    [valueKeys]
  )
  const yAxisFormatter = (v: number) => fmt(v, allCurrency)

  const titleParts: string[] = []
  if (valueKeys.length > 0) titleParts.push(valueKeys.map(v => VALUE_LABEL[v]).join(' & '))
  if (rowsDims.length > 0) titleParts.push(`by ${rowsDims.map(r => DIM_LABEL[r]).join(' › ')}`)
  if (colsDim) titleParts.push(`by ${DIM_LABEL[colsDim]}`)
  const title = titleParts.join(' ')

  function clearPivot() {
    setRowsDims([])
    setColsDim('')
    setColsFilter([])
    setValueKeys([])
    setStatusFilter([])
    setFieldFilter([])
    setDimFilters({})
    setRowFilters({})
    setDatePreset('all')
    setCustomStart('')
    setCustomEnd('')
    setCollapsedGroups(new Set())
  }

  const hasAnySelection =
    rowsDims.length > 0 ||
    !!colsDim ||
    valueKeys.length > 0 ||
    statusFilter.length > 0 ||
    fieldFilter.length > 0 ||
    Object.keys(dimFilters).length > 0 ||
    datePreset !== 'all'

  function exportCsv() {
    if (!result) return
    const dimHeaders = result.rows.map(r => DIM_LABEL[r] || r)
    const seriesHeaders = result.series.map(s => s.label)
    const header = [...dimHeaders, ...seriesHeaders]
    const lines = [header.join(',')]
    for (const row of result.data) {
      const cells: string[] = []
      for (const r of result.rows) cells.push(String(row[r] ?? ''))
      for (const s of result.series) cells.push(String(row[s.key] ?? 0))
      lines.push(cells.map(c => /[,"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pivot_${rowsDims.join('_')}${colsDim ? `_by_${colsDim}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      {/* Field shelf */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Available Fields</p>
          <button
            onClick={clearPivot}
            disabled={!hasAnySelection}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-[#1B2E6B] disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
            title="Reset all rows, columns, values, and filters"
          >
            <X size={12} /> Clear Pivot
          </button>
        </div>
        <div className="space-y-2">
          <div>
            <p className="text-[10px] text-gray-500 mb-1">Dimensions (click to add to Rows · drag to any zone)</p>
            <div className="flex flex-wrap gap-1.5">
              {dimOptions.map(d => {
                const active = usedDims.has(d.key)
                return (
                  <button
                    key={d.key}
                    draggable
                    onDragStart={(e) => startDrag(e, { kind: 'dim', key: d.key, from: 'shelf' })}
                    onDragEnd={endDrag}
                    onClick={() => clickDimField(d.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-grab active:cursor-grabbing ${
                      active
                        ? 'bg-[#1B2E6B] text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 mb-1">Submitted Date (hierarchy — chain Year › Quarter › Month › Day in Rows)</p>
            <div className="flex flex-wrap gap-1.5">
              {DATE_HIERARCHY_OPTIONS.map(d => {
                const active = usedDims.has(d.key)
                return (
                  <button
                    key={d.key}
                    draggable
                    onDragStart={(e) => startDrag(e, { kind: 'dim', key: d.key, from: 'shelf' })}
                    onDragEnd={endDrag}
                    onClick={() => clickDimField(d.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-grab active:cursor-grabbing ${
                      active
                        ? 'bg-[#1B2E6B] text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {d.label.replace('Submitted ', '')}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 mb-1">Measures (click to add to Values · drag onto Values)</p>
            <div className="flex flex-wrap gap-1.5">
              {VALUE_OPTIONS.map(v => {
                const active = usedValues.has(v.key)
                return (
                  <button
                    key={v.key}
                    draggable
                    onDragStart={(e) => startDrag(e, { kind: 'value', key: v.key, from: 'shelf' })}
                    onDragEnd={endDrag}
                    onClick={() => clickValueField(v.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-grab active:cursor-grabbing ${
                      active
                        ? 'bg-[#1B2E6B] text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Σ {v.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Zones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ZoneCard title="Filters" hint="Slice the chart to specific values of any dimension." {...zoneDropProps('dim', dropOnFilters)}>
          {filterDimList.length === 0 ? (
            <EmptyZone />
          ) : (
            filterDimList.map(dim => (
              <FilterPill
                key={dim}
                dim={dim}
                label={DIM_LABEL[dim] || dim}
                state={dimValues[dim]}
                selected={dimFilters[dim] || []}
                onChange={(vals) => setFilterValues(dim, vals)}
                onSwitchToRows={() => moveDim(dim, 'rows')}
                onSwitchToColumns={() => moveDim(dim, 'columns')}
                onRemove={() => removeFilterDim(dim)}
                onDragStart={(e) => startDrag(e, { kind: 'dim', key: dim, from: 'filters' })}
                onDragEnd={endDrag}
              />
            ))
          )}
          <FieldAdder
            label="Add filter"
            options={allDimOptions.filter(d => !usedDims.has(d.key))}
            onPick={addFilterDim}
          />
        </ZoneCard>

        <ZoneCard title="Columns" hint="One dimension max — becomes the chart series." {...zoneDropProps('dim', dropOnColumns)}>
          {!colsDim ? (
            <EmptyZone />
          ) : (
            <FilterPill
              dim={colsDim}
              label={DIM_LABEL[colsDim] || colsDim}
              state={dimValues[colsDim]}
              selected={colsFilter}
              onChange={setColsFilter}
              onSwitchToRows={() => moveDim(colsDim, 'rows')}
              onSwitchToFilters={() => moveDim(colsDim, 'filters')}
              onRemove={clearColumns}
              onDragStart={(e) => startDrag(e, { kind: 'dim', key: colsDim, from: 'columns' })}
              onDragEnd={endDrag}
            />
          )}
          {!colsDim && (
            <FieldAdder
              label="Set columns"
              options={allDimOptions.filter(d => !usedDims.has(d.key))}
              onPick={setColumns}
            />
          )}
        </ZoneCard>

        <ZoneCard title="Rows" hint="Drag dimensions here. Multiple rows nest left-to-right." {...zoneDropProps('dim', dropOnRows)}>
          {rowsDims.length === 0 ? (
            <EmptyZone />
          ) : (
            rowsDims.map((dim, i) => (
              <FilterPill
                key={dim}
                dim={dim}
                label={DIM_LABEL[dim] || dim}
                state={dimValues[dim]}
                selected={rowFilters[dim] || []}
                onChange={(vals) => setRowFilterValues(dim, vals)}
                index={i}
                total={rowsDims.length}
                onMove={(dir) => {
                  const next = [...rowsDims]
                  const j = i + (dir === 'up' ? -1 : 1)
                  if (j < 0 || j >= next.length) return
                  ;[next[i], next[j]] = [next[j], next[i]]
                  setRowsDims(next)
                }}
                onSwitchToColumns={() => moveDim(dim, 'columns')}
                onSwitchToFilters={() => moveDim(dim, 'filters')}
                onRemove={() => removeFromRows(dim)}
                onDragStart={(e) => startDrag(e, { kind: 'dim', key: dim, from: 'rows' })}
                onDragEnd={endDrag}
              />
            ))
          )}
          <FieldAdder
            label="Add dimension"
            options={allDimOptions.filter(d => !usedDims.has(d.key))}
            onPick={addToRows}
            disabled={rowsDims.length >= 4}
          />
        </ZoneCard>

        <ZoneCard title="Values" hint="Each value renders as its own bar series." {...zoneDropProps('value', dropOnValues)}>
          {valueKeys.length === 0 ? (
            <EmptyZone />
          ) : (
            valueKeys.map(v => (
              <div
                key={v}
                draggable
                onDragStart={(e) => startDrag(e, { kind: 'value', key: v, from: 'values' })}
                onDragEnd={endDrag}
                className="inline-flex items-center gap-1 bg-[#1B2E6B] text-white text-xs rounded-full pl-3 pr-1 py-1 cursor-grab active:cursor-grabbing"
              >
                <span>Σ {VALUE_LABEL[v]}</span>
                <button
                  onClick={() => removeValue(v)}
                  className="w-4 h-4 rounded-full hover:bg-white/20 flex items-center justify-center"
                  aria-label="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            ))
          )}
          <FieldAdder
            label="Add value"
            options={VALUE_OPTIONS.filter(v => !usedValues.has(v.key)).map(v => ({ key: v.key, label: v.label }))}
            onPick={(k) => addValue(k as ValueKey)}
            disabled={valueKeys.length >= 3}
          />
        </ZoneCard>
      </div>

      {/* Inline filters (status / work type / date) */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Quick Filters</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <MultiCheckSelect
            label="Ticket Status"
            allLabel="All Ticket Statuses"
            options={STATUSES}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
          <MultiCheckSelect
            label="Field"
            allLabel="All Fields"
            options={dimValues['field']?.values || []}
            selected={fieldFilter}
            onChange={setFieldFilter}
          />
          <div className="flex flex-col gap-1.5">
            <select
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]"
              value={datePreset}
              onChange={e => setDatePreset(e.target.value as typeof datePreset)}
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
          <p className="text-xs font-semibold text-gray-700 truncate">{title || 'Pivot'}</p>
          {result && result.data.length > 0 && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-[#1B2E6B] transition-colors flex-shrink-0"
            >
              <Download size={12} /> Export CSV
            </button>
          )}
        </div>

        {rowsDims.length === 0 || valueKeys.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-xs text-gray-400">
            Add at least one dimension to <b className="mx-1">Rows</b> and one measure to <b className="mx-1">Values</b>.
          </div>
        ) : loading && !result ? (
          <div className="h-[260px] flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : error ? (
          <div className="h-[260px] flex items-center justify-center text-xs text-red-600">{error}</div>
        ) : !result || result.data.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-xs text-gray-400">No data for these filters.</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={enhancedChartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                {showChartHierarchy ? (
                  <XAxis
                    dataKey="_rowLabel"
                    interval={0}
                    height={56}
                    tick={(props) => <HierarchyTick {...props} data={enhancedChartData} />}
                  />
                ) : (
                  <XAxis dataKey="_rowLabel" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={70} />
                )}
                <YAxis tick={{ fontSize: 10 }} tickFormatter={yAxisFormatter} />
                {showChartHierarchy && (
                  <Customized component={(p: Record<string, unknown>) => {
                    const offset = p.offset as
                      | { left?: number; top?: number; width?: number; height?: number }
                      | undefined
                    const left = offset?.left
                    const top = offset?.top
                    const width = offset?.width
                    const height = offset?.height
                    if (typeof left !== 'number' || typeof top !== 'number'
                      || typeof width !== 'number' || typeof height !== 'number') {
                      return null
                    }
                    const count = enhancedChartData.length
                    if (!count) return null
                    const band = width / count
                    const lines: number[] = []
                    for (let i = 0; i < enhancedChartData.length - 1; i++) {
                      if (enhancedChartData[i]._innerBoundary) {
                        lines.push(left + (i + 1) * band)
                      }
                    }
                    return (
                      <g>
                        {lines.map((x, idx) => (
                          <line
                            key={idx}
                            x1={x}
                            y1={top}
                            x2={x}
                            y2={top + height + 30}
                            stroke="#9CA3AF"
                            strokeWidth={1}
                            strokeDasharray="3 3"
                          />
                        ))}
                      </g>
                    )
                  }} />
                )}
                <Tooltip
                  cursor={{ fill: '#F3F4F6' }}
                  content={<ChartTooltip currencyByKey={isCurrencySeries} />}
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
            {result.total_row_groups > result.data.length && (
              <p className="mt-2 text-[10px] text-gray-400">
                Showing top {result.data.length} of {result.total_row_groups} row combinations.
              </p>
            )}
          </>
        )}
      </div>

      {/* Data table */}
      {result && result.data.length > 0 && (
        <PivotTable
          result={result}
          isCurrencySeries={isCurrencySeries}
          allCurrency={allCurrency}
          collapsedGroups={collapsedGroups}
          onToggleGroup={(key) => {
            setCollapsedGroups(prev => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }}
          onCollapseAll={() => {
            // Outer dim group keys derived from current data
            if (!result || result.rows.length < 2) return
            const dim = result.rows[0]
            const all = new Set<string>()
            for (const r of result.data) all.add(String(r[dim] ?? ''))
            setCollapsedGroups(all)
          }}
          onExpandAll={() => setCollapsedGroups(new Set())}
        />
      )}
    </div>
  )
}

// ── Pivot data table with hierarchy + subtotals + grand total ──

type TableRowKind = 'header' | 'data' | 'grand_total'

interface BuiltTableRow {
  kind: TableRowKind
  cells: Record<string, string | number>
  groupLabel?: string
  groupKey?: string
}

function totalsFor(rows: Record<string, string | number>[], seriesKeys: string[]) {
  const out: Record<string, number> = {}
  for (const k of seriesKeys) {
    out[k] = rows.reduce((sum, r) => sum + (Number(r[k]) || 0), 0)
  }
  return out
}

function buildTableRows(result: PivotResponse, collapsedGroups: Set<string>): BuiltTableRow[] {
  if (result.data.length === 0) return []
  const dimKeys = result.rows
  const seriesKeys = result.series.map(s => s.key)

  if (dimKeys.length <= 1) {
    const rows: BuiltTableRow[] = result.data.map(d => ({ kind: 'data', cells: d }))
    rows.push({
      kind: 'grand_total',
      cells: totalsFor(result.data, seriesKeys),
      groupLabel: 'Grand Total',
    })
    return rows
  }

  const order: string[] = []
  const groups = new Map<string, Record<string, string | number>[]>()
  for (const row of result.data) {
    const k = String(row[dimKeys[0]] ?? '')
    if (!groups.has(k)) { groups.set(k, []); order.push(k) }
    groups.get(k)!.push(row)
  }

  const rows: BuiltTableRow[] = []
  for (const groupKey of order) {
    const members = groups.get(groupKey)!
    rows.push({
      kind: 'header',
      cells: { ...totalsFor(members, seriesKeys), [dimKeys[0]]: groupKey },
      groupLabel: groupKey,
      groupKey,
    })
    if (!collapsedGroups.has(groupKey)) {
      for (const m of members) rows.push({ kind: 'data', cells: m })
    }
  }
  rows.push({
    kind: 'grand_total',
    cells: totalsFor(result.data, seriesKeys),
    groupLabel: 'Grand Total',
  })
  return rows
}

function PivotTable({
  result,
  isCurrencySeries,
  allCurrency,
  collapsedGroups,
  onToggleGroup,
  onCollapseAll,
  onExpandAll,
}: {
  result: PivotResponse
  isCurrencySeries: Record<string, boolean>
  allCurrency: boolean
  collapsedGroups: Set<string>
  onToggleGroup: (groupKey: string) => void
  onCollapseAll: () => void
  onExpandAll: () => void
}) {
  const tableRows = useMemo(
    () => buildTableRows(result, collapsedGroups),
    [result, collapsedGroups]
  )
  const dimKeys = result.rows
  const showHierarchy = dimKeys.length > 1
  const showRowTotal = result.series.length > 1

  function renderValueCell(v: number, currency: boolean, bold = false) {
    const text = v === 0 ? '—' : (currency ? `$${v.toLocaleString()}` : v.toLocaleString())
    return (
      <td className={`px-3 py-1.5 text-right whitespace-nowrap ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
        {text}
      </td>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {showHierarchy && (
        <div className="flex items-center justify-end gap-3 px-3 py-1.5 border-b border-gray-100 bg-gray-50">
          <button
            onClick={onExpandAll}
            className="text-[11px] text-gray-500 hover:text-[#1B2E6B] transition-colors"
          >
            Expand all
          </button>
          <span className="text-gray-300 text-[10px]">·</span>
          <button
            onClick={onCollapseAll}
            className="text-[11px] text-gray-500 hover:text-[#1B2E6B] transition-colors"
          >
            Collapse all
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {dimKeys.map(r => (
                <th key={r} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">
                  {DIM_LABEL[r] || r}
                </th>
              ))}
              {result.series.map(s => (
                <th key={s.key} className="px-3 py-2 text-right font-semibold text-gray-600 whitespace-nowrap">
                  {s.label}
                </th>
              ))}
              {showRowTotal && (
                <th className="px-3 py-2 text-right font-semibold text-gray-600 whitespace-nowrap">Grand Total</th>
              )}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, idx) => {
              const rowTotal = result.series.reduce((sum, s) => sum + (Number(row.cells[s.key]) || 0), 0)

              if (row.kind === 'data') {
                return (
                  <tr key={idx} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    {dimKeys.map((r, i) => {
                      // In hierarchy mode the outer dim is owned by the header row.
                      const isOuter = showHierarchy && i === 0
                      if (isOuter) return <td key={r} className="px-3 py-1.5"></td>
                      const indent = showHierarchy && i === 1 ? 'pl-6 pr-3' : 'px-3'
                      return (
                        <td key={r} className={`py-1.5 text-gray-900 whitespace-nowrap ${indent}`}>
                          {String(row.cells[r] ?? '')}
                        </td>
                      )
                    })}
                    {result.series.map(s =>
                      renderValueCell(Number(row.cells[s.key]) || 0, !!isCurrencySeries[s.key])
                    )}
                    {showRowTotal && renderValueCell(rowTotal, allCurrency, true)}
                  </tr>
                )
              }

              if (row.kind === 'header') {
                const collapsed = !!row.groupKey && collapsedGroups.has(row.groupKey)
                return (
                  <tr key={idx} className="bg-gray-50/70 border-b border-gray-100 font-semibold text-gray-800">
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <button
                        onClick={() => row.groupKey && onToggleGroup(row.groupKey)}
                        className="inline-flex items-center gap-1.5 text-gray-700 hover:text-[#1B2E6B] transition-colors"
                        aria-label={collapsed ? 'Expand' : 'Collapse'}
                      >
                        {collapsed
                          ? <ChevronRight size={12} />
                          : <ChevronDown size={12} />
                        }
                        <span>{row.groupLabel}</span>
                      </button>
                    </td>
                    {/* Inner dim columns left blank in the header row */}
                    {dimKeys.slice(1).map(r => (
                      <td key={r} className="px-3 py-1.5"></td>
                    ))}
                    {result.series.map(s =>
                      renderValueCell(Number(row.cells[s.key]) || 0, !!isCurrencySeries[s.key], true)
                    )}
                    {showRowTotal && renderValueCell(rowTotal, allCurrency, true)}
                  </tr>
                )
              }

              // Grand total
              return (
                <tr key={idx} className="bg-gray-100 border-t-2 border-gray-300 font-semibold text-gray-900">
                  <td colSpan={dimKeys.length} className="px-3 py-1.5 whitespace-nowrap">
                    {row.groupLabel}
                  </td>
                  {result.series.map(s =>
                    renderValueCell(Number(row.cells[s.key]) || 0, !!isCurrencySeries[s.key], true)
                  )}
                  {showRowTotal && renderValueCell(rowTotal, allCurrency, true)}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Sub-components ──

function ZoneCard({
  title,
  hint,
  children,
  className = '',
  dragActive = false,
  onDragOver,
  onDrop,
}: {
  title: string
  hint: string
  children: React.ReactNode
  className?: string
  dragActive?: boolean
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`bg-white rounded-xl shadow-sm p-3 transition-colors border ${
        dragActive ? 'border-[#1B2E6B] ring-2 ring-[#1B2E6B]/30 bg-[#1B2E6B]/[0.03]' : 'border-gray-100'
      } ${className}`}
    >
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-wide">{title}</p>
        <p className="text-[10px] text-gray-400 truncate">{hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

function EmptyZone() {
  return <p className="text-[11px] text-gray-400 italic">No fields</p>
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
  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt])
  }
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
      ? selected[0]
      : `${selected.length} ${label}s`
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
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
          {options.map(opt => {
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
          })}
        </div>
      )}
    </div>
  )
}

function FilterPill({
  dim,
  label,
  state,
  selected,
  onChange,
  onSwitchToRows,
  onSwitchToColumns,
  onSwitchToFilters,
  onMove,
  index,
  total,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  dim: string
  label: string
  state: { values?: string[]; loading?: boolean; error?: string } | undefined
  selected: string[]
  onChange: (next: string[]) => void
  onSwitchToRows?: () => void
  onSwitchToColumns?: () => void
  onSwitchToFilters?: () => void
  onMove?: (dir: 'up' | 'down') => void
  index?: number
  total?: number
  onRemove: () => void
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const filteredOptions = useMemo(() => {
    const all = state?.values || []
    if (!search) return all.slice(0, 200)
    const q = search.toLowerCase()
    return all.filter(v => v.toLowerCase().includes(q)).slice(0, 200)
  }, [state, search])

  // Close popovers when the user clicks outside this pill.
  useEffect(() => {
    if (!open && !menuOpen) return
    function onDocMouseDown(e: MouseEvent) {
      const node = containerRef.current
      if (node && e.target instanceof Node && !node.contains(e.target)) {
        setOpen(false)
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open, menuOpen])

  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt])
  }

  const pillLabel =
    selected.length === 0
      ? `${label}: All`
      : selected.length === 1
      ? `${label}: ${selected[0]}`
      : `${label}: ${selected[0]} +${selected.length - 1}`

  return (
    <div
      ref={containerRef}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-dim={dim}
      className={`relative inline-flex items-center gap-1 bg-[#1B2E6B] text-white text-xs rounded-full pl-3 pr-1 py-1 ${onDragStart ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="text-left max-w-[220px] truncate"
        title={selected.length > 1 ? selected.join(', ') : undefined}
      >
        {pillLabel}
      </button>
      <button
        onClick={() => setMenuOpen(o => !o)}
        className="w-4 h-4 rounded-full hover:bg-white/20 flex items-center justify-center text-[10px]"
        aria-label="Options"
      >
        ⋯
      </button>
      <button
        onClick={onRemove}
        className="w-4 h-4 rounded-full hover:bg-white/20 flex items-center justify-center"
        aria-label="Remove"
      >
        <X size={11} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg text-xs min-w-[220px] max-h-72 overflow-hidden flex flex-col">
          <div className="px-2 py-1.5 border-b border-gray-100">
            <input
              type="text"
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#1B2E6B] text-gray-700"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {state?.loading ? (
              <p className="px-3 py-2 text-gray-400">Loading values…</p>
            ) : state?.error ? (
              <p className="px-3 py-2 text-red-600">{state.error}</p>
            ) : (state?.values || []).length === 0 ? (
              <p className="px-3 py-2 text-gray-400">No values found</p>
            ) : (
              <>
                {selected.length > 0 && (
                  <button
                    onMouseDown={(e) => { e.preventDefault(); onChange([]) }}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-[#1B2E6B] hover:bg-gray-50 border-b border-gray-100"
                  >
                    Clear selection
                  </button>
                )}
                {filteredOptions.map(opt => {
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
                      <span className="flex-1 text-left truncate" title={opt}>{opt}</span>
                    </button>
                  )
                })}
                {(state?.values || []).length > filteredOptions.length && (
                  <p className="px-3 py-1.5 text-[10px] text-gray-400 italic">Showing first 200 — refine search to see more.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {menuOpen && (
        <div className="absolute top-full right-0 mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg text-[11px] text-gray-700 min-w-[140px] py-1">
          {typeof index === 'number' && total && total > 1 && onMove && (
            <>
              {index > 0 && (
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                  onMouseDown={(e) => { e.preventDefault(); onMove('up'); setMenuOpen(false) }}
                >
                  ↑ Move left
                </button>
              )}
              {index < total - 1 && (
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                  onMouseDown={(e) => { e.preventDefault(); onMove('down'); setMenuOpen(false) }}
                >
                  ↓ Move right
                </button>
              )}
            </>
          )}
          {onSwitchToRows && (
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
              onMouseDown={(e) => { e.preventDefault(); onSwitchToRows(); setMenuOpen(false) }}
            >
              → Move to Rows
            </button>
          )}
          {onSwitchToColumns && (
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
              onMouseDown={(e) => { e.preventDefault(); onSwitchToColumns(); setMenuOpen(false) }}
            >
              → Move to Columns
            </button>
          )}
          {onSwitchToFilters && (
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
              onMouseDown={(e) => { e.preventDefault(); onSwitchToFilters(); setMenuOpen(false) }}
            >
              → Move to Filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function FieldAdder({
  label,
  options,
  onPick,
  disabled = false,
}: {
  label: string
  options: { key: string; label: string }[]
  onPick: (key: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (options.length === 0 || disabled) return null
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-[#1B2E6B] hover:text-[#1B2E6B] transition-colors"
      >
        <Plus size={11} /> {label}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg text-xs min-w-[160px] py-1 max-h-64 overflow-y-auto">
          {options.map(o => (
            <button
              key={o.key}
              onMouseDown={(e) => { e.preventDefault(); onPick(o.key); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
