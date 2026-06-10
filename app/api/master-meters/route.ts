import { NextResponse } from 'next/server'
import { snowflakeQuery, MASTER_METER_QUERY } from '@/lib/snowflake'

// Cache in memory for the session — the master-meter list is a small, fixed set
// of FP WHEELER MIDSTREAM facility rows that effectively never changes, so a
// 5-minute TTL is plenty and keeps the form's Master Meters picker instant.
let cache: { data: MasterMeter[]; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

type MasterMeter = {
  meter: string
  asset: string
  area: string
  route: string
  field: string
  foreman: string
  productionEngineer: string
  unitId: string
}

type Row = {
  MASTER_METER?: string
  Asset?: string
  Area?: string
  ROUTENAME?: string
  Foreman?: string
  PRODUCTION_ENGINEER?: string
  FIELD?: string
  UNITID?: string
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }

    const rows = await snowflakeQuery<Row>(MASTER_METER_QUERY)
    const data: MasterMeter[] = rows.map(r => ({
      meter: r.MASTER_METER ?? '',
      asset: r.Asset ?? '',
      area: r.Area ?? '',
      route: r.ROUTENAME ?? '',
      field: r.FIELD ?? '',
      foreman: r.Foreman ?? '',
      productionEngineer: r.PRODUCTION_ENGINEER ?? '',
      unitId: r.UNITID ?? '',
    }))

    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (error) {
    console.error('Snowflake master meters error:', error)
    return NextResponse.json({ error: 'Failed to fetch master meters' }, { status: 500 })
  }
}
