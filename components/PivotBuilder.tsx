'use client'
import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { Download } from 'lucide-react'

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

const VALUE_OPTIONS = [
  { key: 'count',         label: 'Ticket Count' },
  { key: 'repair_cost',   label: 'Repair Cost' },
  { key: 'estimate_cost', label: 'Estimate Cost' },
] as const

const STATUSES = ['Open', 'In Progress', 'Backlogged', 'Awaiting Cost', 'Closed']
const WORK_TYPES = ['LOE', 'AFE - Workover', 'AFE - Capital']
const SERIES_COLORS = ['#1B2E6B', '#3B82F6', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#9CA3AF']

interface PivotResponse {
  rows: string
  columns: string | null
  value: 'count' | 'estimate_cost' | 'repair_cost'
  series: string[]
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
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs" style={{ minWidth: 180, maxWidth: 280 }}>
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

export default function PivotBuilder({ userAssets }: { userAssets: string[] }) {
  const [rowsDim, setRowsDim] = useState('equipment')
  const [colsDim, setColsDim] = useState('department')
  const [valueType, setValueType] = useState<'count' | 'repair_cost' | 'estimate_cost'>('repair_cost')
  const [statusFilter, setStatusFilter] = useState('')
  const [workTypeFilter, setWorkTypeFilter] = useState('')
  const [datePreset, setDatePreset] = useState<'all' | 'ytd' | 'lastmonth' | 'thismonth'>('all')

  const [result, setResult] = useState<PivotResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch('/api/analysis/pivot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        rows: rowsDim,
        columns: colsDim || null,
        value: valueType,
        status: statusFilter || undefined,
        work_order_type: workTypeFilter || undefined,
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
  }, [rowsDim, colsDim, valueType, statusFilter, workTypeFilter, startDate, endDate, userAssets])

  const isCurrency = valueType !== 'count'
  const valueFormatter = (v: number) => fmt(v, isCurrency)
  const valueLabel = VALUE_OPTIONS.find(v => v.key === valueType)?.label || ''
  const rowsLabel = DIM_LABEL[rowsDim] || rowsDim
  const colsLabel = colsDim ? DIM_LABEL[colsDim] || colsDim : ''
  const title = colsDim
    ? `${valueLabel} by ${rowsLabel} by ${colsLabel}`
    : `${valueLabel} by ${rowsLabel}`

  function exportCsv() {
    if (!result) return
    const headers = [rowsLabel, ...result.series]
    const lines = [headers.join(',')]
    for (const row of result.data) {
      const cells = [String(row[result.rows] ?? '').replace(/"/g, '""')]
      for (const s of result.series) cells.push(String(row[s] ?? 0))
      lines.push(cells.map(c => /[,"\n]/.test(c) ? `"${c}"` : c).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pivot_${rowsDim}${colsDim ? `_by_${colsDim}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      {/* Field selectors */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 space-y-3">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Fields</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Rows</label>
              <select
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]"
                value={rowsDim}
                onChange={e => setRowsDim(e.target.value)}
              >
                {DIM_OPTIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Columns</label>
              <select
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]"
                value={colsDim}
                onChange={e => setColsDim(e.target.value)}
              >
                <option value="">None (single series)</option>
                {DIM_OPTIONS.filter(d => d.key !== rowsDim).map(d => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Value</label>
              <select
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]"
                value={valueType}
                onChange={e => setValueType(e.target.value as typeof valueType)}
              >
                {VALUE_OPTIONS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Filters</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <select
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B2E6B]"
              value={workTypeFilter}
              onChange={e => setWorkTypeFilter(e.target.value)}
            >
              <option value="">All Work Types</option>
              {WORK_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
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
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-700">{title}</p>
          {result && result.data.length > 0 && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-[#1B2E6B] transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          )}
        </div>

        {loading && !result ? (
          <div className="h-[260px] flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : error ? (
          <div className="h-[260px] flex items-center justify-center text-xs text-red-600">{error}</div>
        ) : !result || result.data.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-xs text-gray-400">No data for these filters.</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={result.data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey={result.rows} tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={valueFormatter} />
                <Tooltip cursor={{ fill: '#F3F4F6' }} content={<ChartTooltip valueFormatter={valueFormatter} />} wrapperStyle={{ outline: 'none', zIndex: 50 }} />
                {result.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {result.series.map((s, i) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    name={s === 'Total' ? valueLabel : s}
                    fill={s === 'Other' ? '#9CA3AF' : SERIES_COLORS[i % SERIES_COLORS.length]}
                    radius={[3, 3, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
            {(result.total_row_groups > result.data.length || result.total_col_groups > result.series.length) && (
              <p className="mt-2 text-[10px] text-gray-400">
                Showing top {result.data.length} of {result.total_row_groups} {rowsLabel.toLowerCase()} groups
                {colsDim && result.total_col_groups > result.series.length && (
                  <> · {result.total_col_groups - (result.series.includes('Other') ? result.series.length - 1 : result.series.length)} smaller {colsLabel.toLowerCase()} groups bucketed into &quot;Other&quot;</>
                )}
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
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">{rowsLabel}</th>
                  {result.series.map(s => (
                    <th key={s} className="px-3 py-2 text-right font-semibold text-gray-600">
                      {s === 'Total' ? valueLabel : s}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((row, idx) => {
                  const total = result.series.reduce((sum, s) => sum + (Number(row[s]) || 0), 0)
                  return (
                    <tr key={idx} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-1.5 text-gray-900">{row[result.rows]}</td>
                      {result.series.map(s => (
                        <td key={s} className="px-3 py-1.5 text-right text-gray-700">
                          {(Number(row[s]) || 0) === 0 ? '—' : (isCurrency ? `$${Number(row[s]).toLocaleString()}` : Number(row[s]).toLocaleString())}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-semibold text-gray-900">
                        {isCurrency ? `$${total.toLocaleString()}` : total.toLocaleString()}
                      </td>
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
