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

const VALUE_LABELS: Record<PivotValue, string> = {
  count: 'Ticket Count',
  estimate_cost: 'Estimate Cost',
  repair_cost: 'Repair Cost',
}

const VALUE_COL_MAP: Record<PivotValue, string | null> = {
  count: null,
  estimate_cost: 'Estimate_Cost',
  repair_cost: 'repair_cost',
}

export interface PivotInput {
  rows: string | string[]
  columns?: string | null
  value?: PivotValue
  values?: PivotValue[]
  status?: string
  work_order_type?: string
  start_date?: string
  end_date?: string
  user_assets?: string[]
  max_rows?: number
  max_columns?: number
}

export interface PivotSeries {
  key: string
  label: string
  valueKey: PivotValue
  columnGroup: string | null
}

export interface PivotResult {
  rows: string[]
  columns: string | null
  values: { key: PivotValue; label: string }[]
  series: PivotSeries[]
  data: Record<string, string | number>[]
  total_row_groups: number
  total_col_groups: number
}

const ROW_KEY_SEP = '|||'
const ROW_LABEL_SEP = ' › ' // ›

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function runPivot(input: PivotInput): Promise<PivotResult | { error: string }> {
  // Normalize rows to array
  const rowsKeys = Array.isArray(input.rows)
    ? input.rows.filter(Boolean)
    : input.rows
      ? [input.rows]
      : []
  if (rowsKeys.length === 0) return { error: 'rows must contain at least one dimension' }
  if (rowsKeys.length > 4) return { error: 'rows may contain at most 4 dimensions' }

  for (const r of rowsKeys) {
    if (!PIVOT_DIM_MAP[r]) return { error: `Invalid row dimension: ${r}. Valid: ${Object.keys(PIVOT_DIM_MAP).join(', ')}` }
  }
  if (new Set(rowsKeys).size !== rowsKeys.length) return { error: 'duplicate row dimensions' }

  // Normalize column (single, optional)
  const colsKey = input.columns || null
  if (colsKey && !PIVOT_DIM_MAP[colsKey]) return { error: `Invalid columns: ${colsKey}` }
  if (colsKey && rowsKeys.includes(colsKey)) return { error: 'columns must differ from rows' }

  // Normalize values to array. Accept legacy single `value`.
  let valueKeys: PivotValue[] = []
  if (input.values && input.values.length > 0) {
    valueKeys = input.values
  } else if (input.value) {
    valueKeys = [input.value]
  } else {
    valueKeys = ['count']
  }
  for (const v of valueKeys) {
    if (!(PIVOT_VALUES as readonly string[]).includes(v)) {
      return { error: `Invalid value: ${v}. Valid: ${PIVOT_VALUES.join(', ')}` }
    }
  }
  if (new Set(valueKeys).size !== valueKeys.length) return { error: 'duplicate values' }
  if (valueKeys.length > 3) return { error: 'at most 3 values' }

  const values = valueKeys.map(k => ({ key: k, label: VALUE_LABELS[k] }))

  const maxRows = Math.min(Math.max(typeof input.max_rows === 'number' ? input.max_rows : 12, 1), 20)
  const maxCols = Math.min(Math.max(typeof input.max_columns === 'number' ? input.max_columns : 5, 1), 6)

  // Build SELECT list
  const rowCols = rowsKeys.map(r => PIVOT_DIM_MAP[r])
  const colCol = colsKey ? PIVOT_DIM_MAP[colsKey] : null
  const valueCols = Array.from(
    new Set(valueKeys.map(v => VALUE_COL_MAP[v]).filter((c): c is string => !!c))
  )
  const selectParts: string[] = [...rowCols]
  if (colCol) selectParts.push(colCol)
  for (const vc of valueCols) selectParts.push(`"${vc}"`)

  const db = supabaseAdmin()
  let query = db
    .from('workorder_ticket_summary')
    .select(Array.from(new Set(selectParts)).join(', '))
    .limit(10000)

  const userAssets = input.user_assets || []
  if (userAssets.length > 0) query = query.in('asset', userAssets)
  if (typeof input.status === 'string' && input.status) query = query.eq('ticket_status', input.status)
  if (typeof input.work_order_type === 'string' && input.work_order_type) query = query.eq('work_order_type', input.work_order_type)
  if (isYmd(input.start_date)) query = query.gte('issue_date', input.start_date)
  if (isYmd(input.end_date)) query = query.lte('issue_date', input.end_date + 'T23:59:59')

  const { data, error } = await query
  if (error) return { error: error.message }

  const rawRows = (data ?? []) as unknown as Record<string, unknown>[]

  // Aggregate: for each (rowComboKey, colKey), accumulate one number per value
  type Cell = Partial<Record<PivotValue, number>>
  const cellMap = new Map<string, Map<string, Cell>>()
  const rowDimsByCombo = new Map<string, string[]>()
  const rowTotals = new Map<string, number>() // ranked by FIRST value
  const colTotals = new Map<string, number>() // ranked by sum across all values
  const SINGLE_COL = '__total__'
  const firstValueKey = valueKeys[0]

  for (const r of rawRows) {
    const dimVals = rowCols.map(rc => (r[rc] as string) || 'Unspecified')
    const rowComboKey = dimVals.join(ROW_KEY_SEP)
    if (!rowDimsByCombo.has(rowComboKey)) rowDimsByCombo.set(rowComboKey, dimVals)

    const colKey = colCol ? ((r[colCol] as string) || 'Unspecified') : SINGLE_COL

    let inner = cellMap.get(rowComboKey)
    if (!inner) { inner = new Map(); cellMap.set(rowComboKey, inner) }
    let cell = inner.get(colKey)
    if (!cell) { cell = {}; inner.set(colKey, cell) }

    let firstVal = 0
    for (const vk of valueKeys) {
      const vc = VALUE_COL_MAP[vk]
      const v = vc ? ((r[vc] as number) || 0) : 1
      cell[vk] = (cell[vk] || 0) + v
      if (vk === firstValueKey) firstVal = v
    }

    rowTotals.set(rowComboKey, (rowTotals.get(rowComboKey) || 0) + firstVal)
    if (colCol) colTotals.set(colKey, (colTotals.get(colKey) || 0) + firstVal)
  }

  const topRowCombos = Array.from(rowTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxRows)
    .map(([k]) => k)

  // Decide series
  let series: PivotSeries[] = []
  let topCols: string[] = []
  let otherCols: string[] = []

  if (!colCol) {
    // No column dim: one series per value
    series = values.map(v => ({
      key: v.label,
      label: v.label,
      valueKey: v.key,
      columnGroup: null,
    }))
    topCols = [SINGLE_COL]
  } else {
    const sortedCols = Array.from(colTotals.entries()).sort((a, b) => b[1] - a[1])
    topCols = sortedCols.slice(0, maxCols).map(([k]) => k)
    otherCols = sortedCols.slice(maxCols).map(([k]) => k)
    const colGroups = otherCols.length > 0 ? [...topCols, '__OTHER__'] : [...topCols]
    for (const cg of colGroups) {
      const cgLabel = cg === '__OTHER__' ? 'Other' : cg
      for (const v of values) {
        const seriesKey = values.length === 1 ? cgLabel : `${cgLabel} · ${v.label}`
        series.push({
          key: seriesKey,
          label: seriesKey,
          valueKey: v.key,
          columnGroup: cg === '__OTHER__' ? 'Other' : cg,
        })
      }
    }
  }

  // Build data rows
  const dataRows: Record<string, string | number>[] = topRowCombos.map(combo => {
    const dims = rowDimsByCombo.get(combo) || []
    const rowOut: Record<string, string | number> = {
      _rowLabel: dims.join(ROW_LABEL_SEP),
    }
    rowsKeys.forEach((rk, i) => { rowOut[rk] = dims[i] || 'Unspecified' })

    const inner = cellMap.get(combo) || new Map<string, Cell>()

    if (!colCol) {
      const cell = inner.get(SINGLE_COL) || {}
      for (const v of values) {
        rowOut[v.label] = Math.round(cell[v.key] || 0)
      }
    } else {
      // sum over topCols and Other bucket
      for (const cg of [...topCols, ...(otherCols.length > 0 ? ['__OTHER__'] : [])]) {
        const cgLabel = cg === '__OTHER__' ? 'Other' : cg
        // Cells contributing to this column group
        const contributors: Cell[] = []
        if (cg === '__OTHER__') {
          for (const oc of otherCols) {
            const c = inner.get(oc)
            if (c) contributors.push(c)
          }
        } else {
          const c = inner.get(cg)
          if (c) contributors.push(c)
        }
        for (const v of values) {
          let s = 0
          for (const cc of contributors) s += cc[v.key] || 0
          const seriesKey = values.length === 1 ? cgLabel : `${cgLabel} · ${v.label}`
          rowOut[seriesKey] = Math.round(s)
        }
      }
    }
    return rowOut
  })

  return {
    rows: rowsKeys,
    columns: colsKey,
    values,
    series,
    data: dataRows,
    total_row_groups: rowTotals.size,
    total_col_groups: colCol ? colTotals.size : 1,
  }
}
