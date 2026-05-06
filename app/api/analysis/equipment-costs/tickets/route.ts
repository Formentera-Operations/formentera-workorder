import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const userAssets: string[] = Array.isArray(body.userAssets) ? body.userAssets : []
    const equipCategories: string[] = Array.isArray(body.equipCategories)
      ? body.equipCategories.filter((s: unknown) => typeof s === 'string' && s)
      : []
    const fields: string[] = Array.isArray(body.fields)
      ? body.fields.filter((s: unknown) => typeof s === 'string' && s)
      : []
    const startDate = isYmd(body.start_date) ? body.start_date : null
    const endDate = isYmd(body.end_date) ? body.end_date : null

    const buildQuery = () => {
      let q = supabaseAdmin()
        .from('workorder_ticket_summary')
        .select(
          'ticket_id, department, work_order_type, location_type, field, well, facility, equipment_name, issue_description, ticket_status, issue_date, repair_date_closed, "Estimate_Cost", repair_cost'
        )
        .order('issue_date', { ascending: false })
        .order('ticket_id', { ascending: false })
      if (userAssets.length > 0) q = q.in('asset', userAssets)
      if (equipCategories.length > 0) q = q.in('equipment_type', equipCategories)
      if (fields.length > 0) q = q.in('field', fields)
      if (startDate) q = q.gte('issue_date', startDate)
      if (endDate) q = q.lte('issue_date', endDate + 'T23:59:59')
      return q
    }

    const PAGE = 1000
    const HARD_CAP = 10000
    let rows: Record<string, unknown>[] = []
    for (let start = 0; start < HARD_CAP; start += PAGE) {
      const { data, error } = await buildQuery().range(start, start + PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const page = (data ?? []) as unknown as Record<string, unknown>[]
      rows.push(...page)
      if (page.length < PAGE) break
    }
    return NextResponse.json({ rows, capped: rows.length >= HARD_CAP })
  } catch (err) {
    console.error('equipment-costs tickets route error:', err)
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 })
  }
}
