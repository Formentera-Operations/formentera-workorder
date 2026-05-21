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
    .filter(t => t.length >= 1)
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

    // WELLNAME IS NOT NULL alone is the right gate: it excludes facility-only
    // Wheeler rows (which have NULL WELLNAME) while letting through FP
    // WHEELER UPSTREAM wells (which have real WELLNAME values). A prior
    // version hardcoded a Wheeler asset exclusion here, which silently
    // blocked UPSTREAM foremen from seeing any wells.
    const whereParts: string[] = [
      `WELLNAME IS NOT NULL`,
    ]
    const binds: string[] = []

    if (tokens.length > 0) {
      // Snowflake REGEXP_LIKE is implicitly anchored — wrap with .* on both sides.
      // Tokens joined with .* enforce order, so "tubb j b b 03" needs those
      // chars in that sequence — filters out #103, #203 etc.
      const pattern = '.*' + tokens.join('.*') + '.*'
      whereParts.push('REGEXP_LIKE(SEARCH_BLOB, ?, \'i\')')
      binds.push(pattern)
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
