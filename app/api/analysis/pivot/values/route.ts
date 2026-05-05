import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { PIVOT_DIM_MAP, PIVOT_DIM_TRANSFORMS } from '@/lib/pivot'

export const dynamic = 'force-dynamic'

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const dim = String(body.dim || '')
    const col = PIVOT_DIM_MAP[dim]
    if (!col) {
      return NextResponse.json({ error: `Invalid dimension: ${dim}` }, { status: 400 })
    }
    const transform = PIVOT_DIM_TRANSFORMS[dim]
    const userAssets: string[] = Array.isArray(body.userAssets) ? body.userAssets : []

    // Cross-filter context. Each filter applies EXCEPT the one matching `dim`
    // itself, so the dropdown can still offer values to add/remove.
    const statusList: string[] = Array.isArray(body.status)
      ? body.status.filter((s: unknown) => typeof s === 'string' && s)
      : []
    const filtersIn: Array<{ dim: string; values: string[] }> = Array.isArray(body.filters)
      ? body.filters.filter((f: unknown): f is { dim: string; values: string[] } =>
          !!f && typeof f === 'object' && typeof (f as { dim?: unknown }).dim === 'string'
            && Array.isArray((f as { values?: unknown }).values))
      : []
    const startDate = isYmd(body.start_date) ? body.start_date : null
    const endDate = isYmd(body.end_date) ? body.end_date : null

    // Build the column list we need to SELECT — the target column plus any
    // columns referenced by post-fetch transform-backed filters.
    type PostFilter = { col: string; transform: (raw: unknown) => string | null; allowed: Set<string> }
    const postFilters: PostFilter[] = []
    const sqlFilters: Array<{ col: string; values: string[] }> = []
    if (dim !== 'status' && statusList.length > 0) {
      sqlFilters.push({ col: 'ticket_status', values: statusList })
    }
    for (const f of filtersIn) {
      if (f.dim === dim) continue // exclude self
      const fc = PIVOT_DIM_MAP[f.dim]
      if (!fc) continue
      const vals = f.values.filter((v: unknown): v is string => typeof v === 'string' && !!v)
      if (vals.length === 0) continue
      const tx = PIVOT_DIM_TRANSFORMS[f.dim]
      if (tx) postFilters.push({ col: fc, transform: tx, allowed: new Set(vals) })
      else sqlFilters.push({ col: fc, values: vals })
    }

    const selectCols = new Set<string>([col, ...postFilters.map(p => p.col)])

    let q = supabaseAdmin()
      .from('workorder_ticket_summary')
      .select(Array.from(selectCols).join(', '))
      .limit(transform || postFilters.length > 0 ? 20000 : 5000)

    if (userAssets.length > 0) q = q.in('asset', userAssets)
    for (const f of sqlFilters) q = q.in(f.col, f.values)
    if (startDate) q = q.gte('issue_date', startDate)
    if (endDate) q = q.lte('issue_date', endDate + 'T23:59:59')

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let rawRows = (data ?? []) as unknown as Record<string, unknown>[]
    if (postFilters.length > 0) {
      rawRows = rawRows.filter(r => postFilters.every(pf => {
        const bucket = pf.transform(r[pf.col])
        return bucket !== null && pf.allowed.has(bucket)
      }))
    }

    const set = new Set<string>()
    for (const row of rawRows) {
      const raw = row[col]
      const v = transform ? transform(raw) : (typeof raw === 'string' ? raw : null)
      if (v && v.length > 0) set.add(v)
    }
    // Date-bucket dims are lex-sortable to chronological order — reverse so
    // the most recent value shows up first.
    const values = Array.from(set).sort((a, b) => a.localeCompare(b))
    if (transform) values.reverse()
    return NextResponse.json({ dim, values })
  } catch (err) {
    console.error('pivot values route error:', err)
    return NextResponse.json({ error: 'Failed to fetch values' }, { status: 500 })
  }
}
