import { supabaseAdmin } from '@/lib/supabase'

export const PIVOT_DIM_MAP: Record<string, string> = {
  foreman: 'assigned_foreman',
  vendor: 'repair_vendor',
  equipment: 'equipment_name',
  equipment_type: 'equipment_type',
  well: 'well',
  facility: 'facility',
  department: 'department',
  job_category: 'job_category',
  priority: 'priority_of_issue',
  work_order_type: 'work_order_type',
  status: 'ticket_status',
  asset: 'asset',
  field: 'field',
}

export const PIVOT_VALUES = ['count', 'estimate_cost', 'repair_cost'] as const
export type PivotValue = (typeof PIVOT_VALUES)[number]

export interface PivotInput {
  rows: string
  columns?: string | null
  value?: PivotValue
  status?: string
  work_order_type?: string
  start_date?: string
  end_date?: string
  user_assets?: string[]
  max_rows?: number
  max_columns?: number
}

export interface PivotResult {
  rows: string
  columns: string | null
  value: PivotValue
  series: string[]
  data: Record<string, string | number>[]
  total_row_groups: number
  total_col_groups: number
}

const VALUE_COL_MAP: Record<PivotValue, string | null> = {
  count: null,
  estimate_cost: 'Estimate_Cost',
  repair_cost: 'repair_cost',
}

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function runPivot(input: PivotInput): Promise<PivotResult | { error: string }> {
  const rowsKey = String(input.rows || '')
  const colsKey = input.columns ? String(input.columns) : ''
  const rowCol = PIVOT_DIM_MAP[rowsKey]
  if (!rowCol) return { error: `Invalid rows: ${rowsKey}. Valid: ${Object.keys(PIVOT_DIM_MAP).join(', ')}` }

  let colCol: string | null = null
  if (colsKey) {
    colCol = PIVOT_DIM_MAP[colsKey]
    if (!colCol) return { error: `Invalid columns: ${colsKey}. Valid: ${Object.keys(PIVOT_DIM_MAP).join(', ')}` }
    if (rowCol === colCol) return { error: 'rows and columns must be different dimensions' }
  }

  const valueType: PivotValue = (PIVOT_VALUES as readonly string[]).includes(input.value as string)
    ? (input.value as PivotValue)
    : 'count'
  const valueCol = VALUE_COL_MAP[valueType]

  const maxRows = Math.min(Math.max(typeof input.max_rows === 'number' ? input.max_rows : 12, 1), 20)
  const maxCols = Math.min(Math.max(typeof input.max_columns === 'number' ? input.max_columns : 5, 1), 6)

  const db = supabaseAdmin()
  const selectParts = [rowCol]
  if (colCol) selectParts.push(colCol)
  if (valueCol) selectParts.push(`"${valueCol}"`)

  let query = db
    .from('workorder_ticket_summary')
    .select(selectParts.join(', '))
    .limit(10000)

  const userAssets = input.user_assets || []
  if (userAssets.length > 0) query = query.in('asset', userAssets)
  if (typeof input.status === 'string' && input.status) query = query.eq('ticket_status', input.status)
  if (typeof input.work_order_type === 'string' && input.work_order_type) query = query.eq('work_order_type', input.work_order_type)
  if (isYmd(input.start_date)) query = query.gte('issue_date', input.start_date)
  if (isYmd(input.end_date)) query = query.lte('issue_date', input.end_date + 'T23:59:59')

  const { data, error } = await query
  if (error) return { error: error.message }

  const rows = (data ?? []) as unknown as Record<string, unknown>[]

  const cellMap = new Map<string, Map<string, number>>()
  const rowTotals = new Map<string, number>()
  const colTotals = new Map<string, number>()
  const SINGLE_SERIES = '__total__'

  for (const r of rows) {
    const rk = (r[rowCol] as string) || 'Unspecified'
    const ck = colCol ? ((r[colCol] as string) || 'Unspecified') : SINGLE_SERIES
    const v = valueCol ? ((r[valueCol] as number) || 0) : 1
    let inner = cellMap.get(rk)
    if (!inner) { inner = new Map(); cellMap.set(rk, inner) }
    inner.set(ck, (inner.get(ck) || 0) + v)
    rowTotals.set(rk, (rowTotals.get(rk) || 0) + v)
    colTotals.set(ck, (colTotals.get(ck) || 0) + v)
  }

  const topRows = Array.from(rowTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxRows)
    .map(([k]) => k)

  let seriesLabels: string[]
  let topCols: string[]
  let otherCols: string[] = []

  if (!colCol) {
    seriesLabels = ['Total']
    topCols = [SINGLE_SERIES]
  } else {
    const sortedCols = Array.from(colTotals.entries()).sort((a, b) => b[1] - a[1])
    topCols = sortedCols.slice(0, maxCols).map(([k]) => k)
    otherCols = sortedCols.slice(maxCols).map(([k]) => k)
    seriesLabels = otherCols.length > 0 ? [...topCols, 'Other'] : [...topCols]
  }
  const useOther = otherCols.length > 0

  const result: Record<string, string | number>[] = topRows.map(rk => {
    const row: Record<string, string | number> = { [rowsKey]: rk }
    const inner = cellMap.get(rk) || new Map<string, number>()
    if (!colCol) {
      row['Total'] = Math.round(inner.get(SINGLE_SERIES) || 0)
    } else {
      for (const c of topCols) row[c] = Math.round(inner.get(c) || 0)
      if (useOther) {
        let s = 0
        for (const oc of otherCols) s += inner.get(oc) || 0
        row['Other'] = Math.round(s)
      }
    }
    return row
  })

  return {
    rows: rowsKey,
    columns: colCol ? colsKey : null,
    value: valueType,
    series: seriesLabels,
    data: result,
    total_row_groups: rowTotals.size,
    total_col_groups: colCol ? colTotals.size : 1,
  }
}
