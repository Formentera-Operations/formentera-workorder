'use client'
import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { Download, X, Plus } from 'lucide-react'

type ValueKey = 'count' | 'repair_cost' | 'estimate_cost'

const DIM_OPTIONS: { key: string; label: string }[] = [
  { key: 'equipment',       label: 'Equipment' },
  { key: 'equipment_type',  label: 'Equipment Type' },
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
  { key: 'status',          label: 'Status' },
]
const DIM_LABEL = Object.fromEntries(DIM_OPTIONS.map(d => [d.key, d.label]))

const VALUE_OPTIONS: { key: ValueKey; label: string }[] = [
  { key: 'count',         label: 'Ticket Count' },
  { key: 'repair_cost',   label: 'Repair Cost' },
  { key: 'estimate_cost', label: 'Estimate Cost' },
]
const VALUE_LABEL: Record<ValueKey, string> = Object.fromEntries(
  VALUE_OPTIONS.map(v => [v.key, v.label])
) as Record<ValueKey, string>

const STATUSES = ['Open', 'In Progress', 'Backlogged', 'Awaiting Cost', 'Closed']
const WORK_TYPES = ['LOE', 'AFE - Workover', 'AFE - Capital']
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
  const [rowsDims, setRowsDims] = useState<string[]>(['equipment'])
  const [colsDim, setColsDim] = useState<string>('department')
  const [valueKeys, setValueKeys] = useState<ValueKey[]>(['repair_cost'])
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [workTypeFilter, setWorkTypeFilter] = useState<string[]>([])
  const [datePreset, setDatePreset] = useState<'all' | 'ytd' | 'lastmonth' | 'thismonth'>('all')
  // Free-form filters: dim → selected values (empty list = no filter applied yet)
  const [dimFilters, setDimFilters] = useState<Record<string, string[]>>({})
  // Per-dim cache of distinct values + loading state
  const [dimValues, setDimValues] = useState<Record<string, { values?: string[]; loading?: boolean; error?: string }>>({})

  const [result, setResult] = useState<PivotResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filterDimList = useMemo(() => Object.keys(dimFilters), [dimFilters])
  const usedDims = useMemo(
    () => new Set([...rowsDims, ...(colsDim ? [colsDim] : []), ...filterDimList]),
    [rowsDims, colsDim, filterDimList]
  )
  const usedValues = useMemo(() => new Set(valueKeys), [valueKeys])

  const { startDate, endDate } = useMemo(() => {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    if (datePreset === 'ytd') return { startDate: `${today.getFullYear()}-01-01`, endDate: todayStr }
    if (datePreset === 'thismonth') {
      const d = new Date(today.getFullYear(), today.getMonth(), 1)
      return { startDate: d.toISOString().slice(0, 10), endDate: todayStr }
    }
    if (datePreset === 'lastmonth') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 0)
      return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }
    }
    return { startDate: '', endDate: '' }
  }, [datePreset])

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
        work_order_type: workTypeFilter.length > 0 ? workTypeFilter : undefined,
        filters: Object.entries(dimFilters)
          .filter(([, vs]) => vs.length > 0)
          .map(([dim, vs]) => ({ dim, values: vs })),
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
  }, [rowsDims, colsDim, valueKeys, statusFilter, workTypeFilter, dimFilters, startDate, endDate, userAssets])

  // ── Helpers for zone manipulation ──
  function addToRows(dim: string) {
    if (rowsDims.includes(dim)) return
    if (rowsDims.length >= 4) return
    setRowsDims([...rowsDims, dim])
    if (colsDim === dim) setColsDim('')
  }
  function removeFromRows(dim: string) {
    setRowsDims(rowsDims.filter(d => d !== dim))
  }
  function setColumns(dim: string) {
    if (rowsDims.includes(dim)) return
    setColsDim(dim)
  }
  function clearColumns() {
    setColsDim('')
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
      if (colsDim === dim) setColsDim('')
      removeFilterDim(dim)
      addToRows(dim)
    } else if (target === 'columns') {
      removeFromRows(dim)
      removeFilterDim(dim)
      setColumns(dim)
    } else {
      removeFromRows(dim)
      if (colsDim === dim) setColsDim('')
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

  function ensureDimValues(dim: string) {
    if (dimValues[dim]?.values || dimValues[dim]?.loading) return
    setDimValues(prev => ({ ...prev, [dim]: { loading: true } }))
    fetch('/api/analysis/pivot/values', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dim, userAssets }),
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

  // Default-zone click from field shelf: dim → rows, value → values
  function clickDimField(dim: string) {
    if (rowsDims.includes(dim)) removeFromRows(dim)
    else if (colsDim === dim) setColsDim('')
    else if (dim in dimFilters) removeFilterDim(dim)
    else addToRows(dim)
  }
  function clickValueField(v: ValueKey) {
    if (valueKeys.includes(v)) removeValue(v)
    else addValue(v)
  }

  const isCurrencySeries = useMemo(() => {
    const map: Record<string, boolean> = {}
    if (!result) return map
    for (const s of result.series) map[s.key] = s.valueKey !== 'count'
    return map
  }, [result])
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
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Available Fields</p>
        <div className="space-y-2">
          <div>
            <p className="text-[10px] text-gray-500 mb-1">Dimensions (click to add to Rows)</p>
            <div className="flex flex-wrap gap-1.5">
              {DIM_OPTIONS.map(d => {
                const active = usedDims.has(d.key)
                return (
                  <button
                    key={d.key}
                    onClick={() => clickDimField(d.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
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
            <p className="text-[10px] text-gray-500 mb-1">Measures (click to add to Values)</p>
            <div className="flex flex-wrap gap-1.5">
              {VALUE_OPTIONS.map(v => {
                const active = usedValues.has(v.key)
                return (
                  <button
                    key={v.key}
                    onClick={() => clickValueField(v.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
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
        <ZoneCard title="Rows" hint="Drag dimensions here. Multiple rows nest left-to-right.">
          {rowsDims.length === 0 ? (
            <EmptyZone />
          ) : (
            rowsDims.map((dim, i) => (
              <DimPill
                key={dim}
                label={DIM_LABEL[dim] || dim}
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
              />
            ))
          )}
          <FieldAdder
            label="Add dimension"
            options={DIM_OPTIONS.filter(d => !usedDims.has(d.key))}
            onPick={addToRows}
            disabled={rowsDims.length >= 4}
          />
        </ZoneCard>

        <ZoneCard title="Columns" hint="One dimension max — becomes the chart series.">
          {!colsDim ? (
            <EmptyZone />
          ) : (
            <DimPill
              label={DIM_LABEL[colsDim] || colsDim}
              onSwitchToRows={() => moveDim(colsDim, 'rows')}
              onSwitchToFilters={() => moveDim(colsDim, 'filters')}
              onRemove={clearColumns}
            />
          )}
          {!colsDim && (
            <FieldAdder
              label="Set columns"
              options={DIM_OPTIONS.filter(d => !usedDims.has(d.key))}
              onPick={setColumns}
            />
          )}
        </ZoneCard>

        <ZoneCard title="Filters" hint="Slice the chart to specific values of any dimension." className="md:col-span-2">
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
              />
            ))
          )}
          <FieldAdder
            label="Add filter"
            options={DIM_OPTIONS.filter(d => !usedDims.has(d.key))}
            onPick={addFilterDim}
          />
        </ZoneCard>

        <ZoneCard title="Values" hint="Each value renders as its own bar series." className="md:col-span-2">
          {valueKeys.length === 0 ? (
            <EmptyZone />
          ) : (
            valueKeys.map(v => (
              <div key={v} className="inline-flex items-center gap-1 bg-[#1B2E6B] text-white text-xs rounded-full pl-3 pr-1 py-1">
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
            label="Status"
            allLabel="All Statuses"
            options={STATUSES}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
          <MultiCheckSelect
            label="Work Type"
            allLabel="All Work Types"
            options={WORK_TYPES}
            selected={workTypeFilter}
            onChange={setWorkTypeFilter}
          />
          <select
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]"
            value={datePreset}
            onChange={e => setDatePreset(e.target.value as typeof datePreset)}
          >
            <option value="all">All Time</option>
            <option value="ytd">YTD</option>
            <option value="thismonth">This Month</option>
            <option value="lastmonth">Last Month</option>
          </select>
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
              <BarChart data={result.data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="_rowLabel" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={yAxisFormatter} />
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
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {result.rows.map(r => (
                    <th key={r} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">
                      {DIM_LABEL[r] || r}
                    </th>
                  ))}
                  {result.series.map(s => (
                    <th key={s.key} className="px-3 py-2 text-right font-semibold text-gray-600 whitespace-nowrap">
                      {s.label}
                    </th>
                  ))}
                  {result.series.length > 1 && (
                    <th className="px-3 py-2 text-right font-semibold text-gray-600 whitespace-nowrap">Row Total</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {result.data.map((row, idx) => {
                  const total = result.series.reduce((sum, s) => sum + (Number(row[s.key]) || 0), 0)
                  return (
                    <tr key={idx} className="border-b border-gray-50 last:border-0">
                      {result.rows.map(r => (
                        <td key={r} className="px-3 py-1.5 text-gray-900">{row[r]}</td>
                      ))}
                      {result.series.map(s => {
                        const v = Number(row[s.key]) || 0
                        const cur = isCurrencySeries[s.key]
                        return (
                          <td key={s.key} className="px-3 py-1.5 text-right text-gray-700">
                            {v === 0 ? '—' : (cur ? `$${v.toLocaleString()}` : v.toLocaleString())}
                          </td>
                        )
                      })}
                      {result.series.length > 1 && (
                        <td className="px-3 py-1.5 text-right font-semibold text-gray-900">
                          {allCurrency ? `$${total.toLocaleString()}` : total.toLocaleString()}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──

function ZoneCard({ title, hint, children, className = '' }: {
  title: string
  hint: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-white rounded-xl border border-gray-100 shadow-sm p-3 ${className}`}>
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

function DimPill({
  label,
  index,
  total,
  onMove,
  onSwitchToRows,
  onSwitchToColumns,
  onSwitchToFilters,
  onRemove,
}: {
  label: string
  index?: number
  total?: number
  onMove?: (dir: 'up' | 'down') => void
  onSwitchToRows?: () => void
  onSwitchToColumns?: () => void
  onSwitchToFilters?: () => void
  onRemove: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="relative inline-flex items-center gap-1 bg-[#1B2E6B] text-white text-xs rounded-full pl-3 pr-1 py-1">
      <span>{label}</span>
      <button
        onClick={() => setMenuOpen(o => !o)}
        onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
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
      {menuOpen && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg text-[11px] text-gray-700 min-w-[140px] py-1">
          {typeof index === 'number' && total && total > 1 && (
            <>
              {index > 0 && (
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                  onMouseDown={(e) => { e.preventDefault(); onMove?.('up'); setMenuOpen(false) }}
                >
                  ↑ Move left
                </button>
              )}
              {index < total - 1 && (
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                  onMouseDown={(e) => { e.preventDefault(); onMove?.('down'); setMenuOpen(false) }}
                >
                  ↓ Move right
                </button>
              )}
            </>
          )}
          {onSwitchToColumns && (
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
              onMouseDown={(e) => { e.preventDefault(); onSwitchToColumns(); setMenuOpen(false) }}
            >
              → Move to Columns
            </button>
          )}
          {onSwitchToRows && (
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
              onMouseDown={(e) => { e.preventDefault(); onSwitchToRows(); setMenuOpen(false) }}
            >
              → Move to Rows
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
  onRemove,
}: {
  dim: string
  label: string
  state: { values?: string[]; loading?: boolean; error?: string } | undefined
  selected: string[]
  onChange: (next: string[]) => void
  onSwitchToRows: () => void
  onSwitchToColumns: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filteredOptions = useMemo(() => {
    const all = state?.values || []
    if (!search) return all.slice(0, 200)
    const q = search.toLowerCase()
    return all.filter(v => v.toLowerCase().includes(q)).slice(0, 200)
  }, [state, search])

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
    <div className="relative inline-flex items-center gap-1 bg-[#1B2E6B] text-white text-xs rounded-full pl-3 pr-1 py-1" data-dim={dim}>
      <button
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="text-left max-w-[220px] truncate"
        title={selected.length > 1 ? selected.join(', ') : undefined}
      >
        {pillLabel}
      </button>
      <button
        onClick={() => setMenuOpen(o => !o)}
        onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
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
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
            onMouseDown={(e) => { e.preventDefault(); onSwitchToRows(); setMenuOpen(false) }}
          >
            → Move to Rows
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
            onMouseDown={(e) => { e.preventDefault(); onSwitchToColumns(); setMenuOpen(false) }}
          >
            → Move to Columns
          </button>
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
