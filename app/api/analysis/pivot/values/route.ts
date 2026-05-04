import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { PIVOT_DIM_MAP, PIVOT_DIM_TRANSFORMS } from '@/lib/pivot'

export const dynamic = 'force-dynamic'

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

    let q = supabaseAdmin()
      .from('workorder_ticket_summary')
      .select(col)
      .limit(transform ? 10000 : 5000)

    if (userAssets.length > 0) q = q.in('asset', userAssets)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const set = new Set<string>()
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const raw = row[col]
      const v = transform ? transform(raw) : (typeof raw === 'string' ? raw : null)
      if (v && v.length > 0) set.add(v)
    }
    // For date hierarchies the lexical sort (e.g. "2024-03" < "2024-12")
    // gives chronological order — show most recent first by reversing.
    const values = Array.from(set).sort((a, b) => a.localeCompare(b))
    if (transform) values.reverse()
    return NextResponse.json({ dim, values })
  } catch (err) {
    console.error('pivot values route error:', err)
    return NextResponse.json({ error: 'Failed to fetch values' }, { status: 500 })
  }
}
