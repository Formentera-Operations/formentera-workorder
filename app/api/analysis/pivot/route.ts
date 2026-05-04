import { NextRequest, NextResponse } from 'next/server'
import { runPivot, PIVOT_DIM_MAP, PIVOT_VALUES } from '@/lib/pivot'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await runPivot({
      rows: Array.isArray(body.rows) ? body.rows : (body.rows ? [body.rows] : []),
      columns: body.columns ?? null,
      values: Array.isArray(body.values) ? body.values : undefined,
      value: body.value,
      status: body.status,
      work_order_type: body.work_order_type,
      filters: Array.isArray(body.filters) ? body.filters : undefined,
      start_date: body.start_date,
      end_date: body.end_date,
      user_assets: Array.isArray(body.userAssets) ? body.userAssets : [],
      max_rows: typeof body.max_rows === 'number' ? body.max_rows : undefined,
      max_columns: typeof body.max_columns === 'number' ? body.max_columns : undefined,
    })
    if ('error' in result) {
      return NextResponse.json(result, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('pivot route error:', err)
    return NextResponse.json({ error: 'Pivot failed' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    dimensions: Object.keys(PIVOT_DIM_MAP),
    values: PIVOT_VALUES,
  })
}
