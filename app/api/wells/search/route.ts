import { NextResponse } from 'next/server'
import { snowflakeQuery } from '@/lib/snowflake'

export const dynamic = 'force-dynamic'

type WellSearchRow = {
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

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^a-z0-9]+/g, ''))
    .filter(t => t.length >= 2)
    .slice(0, 10)
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') ?? '').trim()
    const assetFilter = (searchParams.get('asset') ?? '').trim()
    const fieldFilter = (searchParams.get('field') ?? '').trim()

    const tokens = tokenize(q)

    // Require at least an asset filter when there are no tokens — prevents
    // pulling thousands of rows on an empty search.
    if (tokens.length === 0 && !assetFilter) {
      return NextResponse.json([])
    }

    const whereParts: string[] = [
      `WELLNAME IS NOT NULL`,
      `"Asset" NOT IN ('FP WHEELER MIDSTREAM', 'FP WHEELER UPSTREAM', 'FP WHEELER')`,
    ]
    const binds: string[] = []

    for (const t of tokens) {
      whereParts.push('SEARCH_BLOB ILIKE ?')
      binds.push(`%${t}%`)
    }
    if (assetFilter) {
      whereParts.push('"Asset" = ?')
      binds.push(assetFilter)
    }
    if (fieldFilter) {
      whereParts.push('FIELD = ?')
      binds.push(fieldFilter)
    }

    const sql = `
      SELECT
        UNITID, WELLNAME, NAME, UNITIDA, WVWELLID,
        "Asset", "Area", FIELD, ROUTENAME
      FROM FO_STAGE_DB.DEV_INTERMEDIATE.RETOOL_WELL_FACILITY
      WHERE ${whereParts.join(' AND ')}
      ORDER BY LOWER(WELLNAME)
      LIMIT 50
    `

    const rows = await snowflakeQuery<WellSearchRow>(sql, binds)
    return NextResponse.json(rows)
  } catch (error) {
    console.error('Wells search error:', error)
    const message = error instanceof Error ? error.message : 'Failed to search wells'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
