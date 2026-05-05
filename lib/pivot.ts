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
  description: 'issue_description',
  ticket_id: 'ticket_id',
  // ── Submitted Date hierarchy (all derived from issue_date) ──
  submitted_year: 'issue_date',
  submitted_quarter: 'issue_date',
  submitted_month: 'issue_date',
  submitted_day: 'issue_date',
}

// Some dims are derived from another column (e.g. date buckets). The
// transform maps the raw DB value to the bucket label used in pivot keys.
export const PIVOT_DIM_TRANSFORMS: Partial<Record<string, (raw: unknown) => string | null>> = {
  ticket_id: (raw) => {
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
    if (typeof raw === 'string' && raw) return raw
    return null
  },
  submitted_year: (raw) => {
    const s = typeof raw === 'string' ? raw : ''
    return s.length >= 4 ? s.slice(0, 4) : null
  },
  submitted_quarter: (raw) => {
    const s = typeof raw === 'string' ? raw : ''
    if (s.length < 7) return null
    const m = parseInt(s.slice(5, 7), 10)
    if (!Number.isFinite(m)) return null
    return `${s.slice(0, 4)} Q${Math.floor((m - 1) / 3) + 1}`
  },
  submitted_month: (raw) => {
    const s = typeof raw === 'string' ? raw : ''
    return s.length >= 7 ? s.slice(0, 7) : null
  },
  submitted_day: (raw) => {
    const s = typeof raw === 'string' ? raw : ''
    return s.length >= 10 ? s.slice(0, 10) : null
  },
}

export const PIVOT_VALUES = ['count', 'estimate_cost', 'repair_cost', 'savings'] as const
export type PivotValue = (typeof PIVOT_VALUES)[number]

const VALUE_LABELS: Record<PivotValue, string> = {
  count: 'Ticket Count',
  estimate_cost: 'Estimate Cost',
  repair_cost: 'Repair Cost',
  savings: 'Savings',
}

// Columns that must be SELECTed to compute each measure. Savings is
// derived (Estimate_Cost − repair_cost) so it pulls both.
const VALUE_COLS_NEEDED: Record<PivotValue, string[]> = {
  count: [],
  estimate_cost: ['Estimate_Cost'],
  repair_cost: ['repair_cost'],
  savings: ['Estimate_Cost', 'repair_cost'],
}

export interface PivotFilter {
  dim: string
  values: string[]
}

export interface PivotInput {
  rows: string | string[]
  columns?: string | null
  value?: PivotValue
  values?: PivotValue[]
  status?: string | string[]
  work_order_type?: string | string[]
  filters?: PivotFilter[]
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

  const maxRows = Math.min(Math.max(typeof input.max_rows === 'number' ? input.max_rows : 12, 1), 200)
  const maxCols = Math.min(Math.max(typeof input.max_columns === 'number' ? input.max_columns : 5, 1), 50)

  // Build SELECT list
  const rowCols = rowsKeys.map(r => PIVOT_DIM_MAP[r])
  const colCol = colsKey ? PIVOT_DIM_MAP[colsKey] : null
  const valueCols = Array.from(
    new Set(valueKeys.flatMap(v => VALUE_COLS_NEEDED[v]))
  )
  const selectParts: string[] = [...rowCols]
  if (colCol) selectParts.push(colCol)
  for (const vc of valueCols) selectParts.push(`"${vc}"`)

  const db = supabaseAdmin()
  const userAssets = input.user_assets || []
  const statusList = Array.isArray(input.status)
    ? input.status.filter(s => typeof s === 'string' && s)
    : (typeof input.status === 'string' && input.status ? [input.status] : [])
  const wotList = Array.isArray(input.work_order_type)
    ? input.work_order_type.filter(s => typeof s === 'string' && s)
    : (typeof input.work_order_type === 'string' && input.work_order_type ? [input.work_order_type] : [])

  // Free-form filters: any pivot dim with a list of allowed values.
  // Transform-backed dims (e.g. submitted_year) can't be filtered via SQL .in()
  // because Postgres needs date_part — apply those in JS after fetching.
  type PostFilter = { col: string; transform: (raw: unknown) => string | null; allowed: Set<string> }
  const postFilters: PostFilter[] = []
  const sqlInFilters: Array<{ col: string; values: string[] }> = []
  if (Array.isArray(input.filters)) {
    for (const f of input.filters) {
      if (!f || typeof f.dim !== 'string') continue
      const fc = PIVOT_DIM_MAP[f.dim]
      if (!fc) continue
      const vals = Array.isArray(f.values) ? f.values.filter(v => typeof v === 'string') : []
      if (vals.length === 0) continue
      const transform = PIVOT_DIM_TRANSFORMS[f.dim]
      if (transform) postFilters.push({ col: fc, transform, allowed: new Set(vals) })
      else sqlInFilters.push({ col: fc, values: vals })
    }
  }

  // Build a fresh query for each pagination call. Supabase caps each page at
  // ~1000 rows, so we loop until a short page comes back or the safety cap
  // hits.
  const buildQuery = () => {
    let q = db
      .from('workorder_ticket_summary')
      .select(Array.from(new Set(selectParts)).join(', '))
    if (userAssets.length > 0) q = q.in('asset', userAssets)
    if (statusList.length === 1) q = q.eq('ticket_status', statusList[0])
    else if (statusList.length > 1) q = q.in('ticket_status', statusList)
    if (wotList.length === 1) q = q.eq('work_order_type', wotList[0])
    else if (wotList.length > 1) q = q.in('work_order_type', wotList)
    for (const f of sqlInFilters) q = q.in(f.col, f.values)
    if (isYmd(input.start_date)) q = q.gte('issue_date', input.start_date)
    if (isYmd(input.end_date)) q = q.lte('issue_date', input.end_date + 'T23:59:59')
    return q
  }

  const PAGE = 1000
  const HARD_CAP = 100000
  let rawRows: Record<string, unknown>[] = []
  for (let start = 0; start < HARD_CAP; start += PAGE) {
    const { data, error } = await buildQuery().range(start, start + PAGE - 1)
    if (error) return { error: error.message }
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    rawRows.push(...page)
    if (page.length < PAGE) break
  }
  if (postFilters.length > 0) {
    rawRows = rawRows.filter(r => postFilters.every(pf => {
      const bucket = pf.transform(r[pf.col])
      return bucket !== null && pf.allowed.has(bucket)
    }))
  }

  // Pre-resolve transforms for row/column dims so the aggregation loop
  // doesn't repeatedly look them up.
  const rowTransforms = rowsKeys.map(rk => PIVOT_DIM_TRANSFORMS[rk] || null)
  const colTransform = colsKey ? (PIVOT_DIM_TRANSFORMS[colsKey] || null) : null

  // Aggregate: for each (rowComboKey, colKey), accumulate one number per value
  type Cell = Partial<Record<PivotValue, number>>
  const cellMap = new Map<string, Map<string, Cell>>()
  const rowDimsByCombo = new Map<string, string[]>()
  const rowTotals = new Map<string, number>() // ranked by FIRST value
  const colTotals = new Map<string, number>() // ranked by sum across all values
  const SINGLE_COL = '__total__'
  const firstValueKey = valueKeys[0]

  for (const r of rawRows) {
    const dimVals = rowCols.map((rc, i) => {
      const tx = rowTransforms[i]
      const raw = r[rc]
      const v = tx ? tx(raw) : (typeof raw === 'string' ? raw : null)
      return v || 'Unspecified'
    })
    const rowComboKey = dimVals.join(ROW_KEY_SEP)
    if (!rowDimsByCombo.has(rowComboKey)) rowDimsByCombo.set(rowComboKey, dimVals)

    let colKey = SINGLE_COL
    if (colCol) {
      const raw = r[colCol]
      const v = colTransform ? colTransform(raw) : (typeof raw === 'string' ? raw : null)
      colKey = v || 'Unspecified'
    }

    let inner = cellMap.get(rowComboKey)
    if (!inner) { inner = new Map(); cellMap.set(rowComboKey, inner) }
    let cell = inner.get(colKey)
    if (!cell) { cell = {}; inner.set(colKey, cell) }

    let firstVal = 0
    for (const vk of valueKeys) {
      let v: number
      if (vk === 'count') {
        v = 1
      } else if (vk === 'savings') {
        const est = (r['Estimate_Cost'] as number) || 0
        const rep = (r['repair_cost'] as number) || 0
        v = est - rep
      } else if (vk === 'estimate_cost') {
        v = (r['Estimate_Cost'] as number) || 0
      } else {
        v = (r['repair_cost'] as number) || 0
      }
      cell[vk] = (cell[vk] || 0) + v
      if (vk === firstValueKey) firstVal = v
    }

    rowTotals.set(rowComboKey, (rowTotals.get(rowComboKey) || 0) + firstVal)
    if (colCol) colTotals.set(colKey, (colTotals.get(colKey) || 0) + firstVal)
  }

  // Pick top N by total, then re-sort chronologically when any row dim is a
  // date grain so months / quarters / years read in time order rather than by
  // size. Lexical sort works for our date bucket formats (YYYY, YYYY Qn,
  // YYYY-MM, YYYY-MM-DD).
  const hasDateDimInRows = rowsKeys.some(k => k.startsWith('submitted_'))
  const topRowCombos = (() => {
    const byTotal = Array.from(rowTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxRows)
      .map(([k]) => k)
    if (hasDateDimInRows) byTotal.sort()
    return byTotal
  })()

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
