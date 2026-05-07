import { NextResponse } from 'next/server'
import { snowflakeQuery } from '@/lib/snowflake'

export const dynamic = 'force-dynamic'

type WellRow = {
  UNITID: string
  WELLNAME: string
  NAME: string | null
  UNITIDA: string | null
  WVWELLID: string | null
  Asset: string | null
  Area: string | null
  FIELD: string | null
  ROUTENAME: string | null
}

// Returns the full well list for an asset (or all assets when none is given).
// Used by the New Ticket form so the well picker can search the cached list
// client-side — including when the device is offline.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const assetFilter = (searchParams.get('asset') ?? '').trim()
    const whereParts: string[] = [
      'WELLNAME IS NOT NULL',
      `"Asset" NOT IN ('FP WHEELER MIDSTREAM', 'FP WHEELER UPSTREAM', 'FP WHEELER')`,
    ]
    const binds: string[] = []
    if (assetFilter) {
      whereParts.push('"Asset" = ?')
      binds.push(assetFilter)
    }
    const sql = `
      SELECT
        UNITID, WELLNAME, NAME, UNITIDA, WVWELLID,
        "Asset", "Area", FIELD, ROUTENAME
      FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY
      WHERE ${whereParts.join(' AND ')}
      ORDER BY LOWER(WELLNAME)
      LIMIT 5000
    `
    const rows = await snowflakeQuery<WellRow>(sql, binds)
    return NextResponse.json(rows)
  } catch (error) {
    console.error('Wells list error:', error)
    const message = error instanceof Error ? error.message : 'Failed to load wells'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
