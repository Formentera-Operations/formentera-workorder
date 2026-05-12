import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Shape returned by the get_kpi_summary Postgres function. The migration
// at migrations/add_get_kpi_summary_function.sql defines it.
interface KpiSummary {
  statusCounts: Record<string, number>
  agedTickets: Array<{
    ticket_id: number
    field: string
    equipment: string
    status: string
    days_open: number
  }>
  dailyTrend: Array<{ date: string; count: number }>
  total: number
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userAssetsParam = searchParams.get('userAssets') || ''
  const userAssets = userAssetsParam
    ? userAssetsParam.split(',').map(a => a.trim()).filter(Boolean)
    : []
  const startParam = searchParams.get('start') || ''
  const endParam = searchParams.get('end') || ''

  try {
    const db = supabaseAdmin()

    // Daily trend range — defaults to Mon→Sun of the current week if no
    // explicit start/end. Inclusive on both ends; the Postgres function
    // handles the exclusive upper-bound conversion internally.
    let rangeStart: Date
    let rangeEnd: Date
    if (startParam && endParam) {
      rangeStart = new Date(startParam + 'T00:00:00')
      rangeEnd = new Date(endParam + 'T00:00:00')
    } else {
      const today = new Date()
      rangeStart = new Date(today)
      rangeStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))
      rangeEnd = new Date(rangeStart)
      rangeEnd.setDate(rangeStart.getDate() + 6)
    }
    const rangeStartIso = rangeStart.toISOString().slice(0, 10)
    const rangeEndIso = rangeEnd.toISOString().slice(0, 10)

    // One RPC call returns every aggregate the dashboard needs (status
    // counts, aged tickets, daily trend, total). Replaces nine separate
    // PostgREST round-trips — each of which carried its own per-request
    // overhead even after the column indexes made the actual queries fast.
    const { data, error } = await db.rpc('get_kpi_summary', {
      user_assets: userAssets.length > 0 ? userAssets : null,
      range_start: rangeStartIso,
      range_end: rangeEndIso,
    })
    if (error) throw error

    const summary = (data || {
      statusCounts: {},
      agedTickets: [],
      dailyTrend: [],
      total: 0,
    }) as KpiSummary

    // Add the locale-aware label to each trend entry. Kept in JS rather
    // than the SQL function because Postgres's locale formatting isn't a
    // direct match for toLocaleDateString('en-US', { weekday: 'short' }).
    const dayCount = Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000) + 1
    const useWeekdayLabels = dayCount <= 7
    const dailyTrend = summary.dailyTrend.map(entry => {
      const d = new Date(entry.date + 'T00:00:00')
      const label = useWeekdayLabels
        ? d.toLocaleDateString('en-US', { weekday: 'short' })
        : `${d.getMonth() + 1}/${d.getDate()}`
      return { ...entry, label }
    })

    return NextResponse.json({
      statusCounts: summary.statusCounts,
      agedTickets: summary.agedTickets,
      dailyTrend,
      total: summary.total,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    })
  } catch (err) {
    console.error('KPIs fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch KPIs' }, { status: 500 })
  }
}
