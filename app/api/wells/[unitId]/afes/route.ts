import { NextResponse } from 'next/server'
import { snowflakeQuery } from '@/lib/snowflake'

export const dynamic = 'force-dynamic'

type Row = { AFE_NUMBER_PRIMARY: string }

export async function GET(
  _req: Request,
  { params }: { params: { unitId: string } },
) {
  try {
    const unitId = (params.unitId || '').trim()
    if (!unitId) return NextResponse.json([])

    const sql = `
      SELECT DISTINCT j.AFE_NUMBER_PRIMARY
      FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY w
      JOIN FO_PRODUCTION_DB.GOLD_DEVELOPMENT.DIM_JOB j
        ON j.WELL_ID = w.WVWELLID
      WHERE w.UNITID = ?
        AND j.AFE_NUMBER_PRIMARY IS NOT NULL
        AND j.AFE_NUMBER_PRIMARY <> ''
    `
    const rows = await snowflakeQuery<Row>(sql, [unitId])
    const numbers = rows.map(r => r.AFE_NUMBER_PRIMARY).filter(Boolean)
    return NextResponse.json(numbers)
  } catch (error) {
    console.error('Well AFEs error:', error)
    const message = error instanceof Error ? error.message : 'Failed to fetch well AFEs'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
