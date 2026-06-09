import { NextResponse } from 'next/server'
import { snowflakeQuery, COMPRESSOR_QUERY } from '@/lib/snowflake'

// Cache in memory for the session — the station list is a small, fixed set
// (driven by two hardcoded facility UNITIDs) that effectively never changes,
// so a 5-minute TTL is plenty and keeps the form's compressor picker instant.
let cache: { data: CompressorStation[]; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

type CompressorStation = {
  station: string
  compressorId: string
  asset: string
  area: string
  route: string
  field: string
  foreman: string
  productionEngineer: string
  unitId: string
}

type Row = {
  COMPRESSOR_STATION?: string
  COMPRESSORID?: string
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

    const rows = await snowflakeQuery<Row>(COMPRESSOR_QUERY)
    const data: CompressorStation[] = rows.map(r => ({
      station: r.COMPRESSOR_STATION ?? '',
      compressorId: r.COMPRESSORID ?? '',
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
    console.error('Snowflake compressors error:', error)
    return NextResponse.json({ error: 'Failed to fetch compressor stations' }, { status: 500 })
  }
}
