import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Statuses the home dashboard renders cards for. Anything else gets grouped
// under its own key in statusCounts so the frontend can still display it.
const KNOWN_STATUSES = ['Open', 'In Progress', 'Backlogged', 'Awaiting Cost', 'Closed'] as const
const OPEN_STATUSES = ['Open', 'In Progress', 'Backlogged', 'Awaiting Cost'] as const

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
    // explicit start/end. Computed up front so it's available to the trend
    // query AND the label generation below.
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
    // Inclusive of the end day — bump to start of next day for the lt
    // boundary so we don't drop tickets created at 23:59.
    const rangeEndExclusive = new Date(rangeEnd)
    rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 1)
    const rangeEndIso = rangeEndExclusive.toISOString().slice(0, 10)

    // Run every aggregate query in parallel. Each one is small + targeted
    // (HEAD counts, ORDER+LIMIT, or single-column SELECT) instead of the
    // previous "fetch every row in the table and aggregate in JS" pattern.
    // The userAssets filter is inlined per-query rather than extracted to
    // a helper — wrapping Supabase's chained builder in a generic blows
    // up the inferred types past TypeScript's recursion limit.
    const applyAssets = userAssets.length > 0
    const statusCountPromises = KNOWN_STATUSES.map(async (status) => {
      let q = db.from('workorder_ticket_summary')
        .select('*', { count: 'exact', head: true })
        .eq('ticket_status', status)
      if (applyAssets) q = q.in('asset', userAssets)
      const { count } = await q
      return { status, count: count || 0 }
    })

    // Tickets with NULL status historically rolled into "Open" — preserve
    // that behavior so the card counts match what the table SUM would show.
    const nullStatusCountPromise = (async () => {
      let q = db.from('workorder_ticket_summary')
        .select('*', { count: 'exact', head: true })
        .is('ticket_status', null)
      if (applyAssets) q = q.in('asset', userAssets)
      const { count } = await q
      return count || 0
    })()

    const totalCountPromise = (async () => {
      let q = db.from('workorder_ticket_summary').select('*', { count: 'exact', head: true })
      if (applyAssets) q = q.in('asset', userAssets)
      const { count } = await q
      return count || 0
    })()

    // Top 10 oldest unresolved tickets. ticket_id > 700 filter matches the
    // previous behavior (legacy/test rows excluded from the Needs Attention
    // surface). Ordering by issue_date ASC gives us oldest-first cheaply.
    const agedPromise = (async () => {
      let q = db.from('workorder_ticket_summary')
        .select('ticket_id, field, equipment_name, ticket_status, issue_date')
        .in('ticket_status', OPEN_STATUSES as unknown as string[])
        .gt('ticket_id', 700)
      if (applyAssets) q = q.in('asset', userAssets)
      const { data, error } = await q
        .order('issue_date', { ascending: true })
        .limit(10)
      if (error) throw error
      const nowMs = Date.now()
      return (data || []).map(r => ({
        ticket_id: r.ticket_id as number,
        field: (r.field as string) || '',
        equipment: (r.equipment_name as string) || 'Unknown',
        status: r.ticket_status as string,
        days_open: Math.floor((nowMs - new Date(r.issue_date as string).getTime()) / 86_400_000),
      }))
    })()

    // Daily trend — pull only the issue_date column for tickets in the
    // selected range, then bucket per day in JS. One column + a bounded
    // date range keeps the payload tiny even on "Last Year" custom ranges.
    const trendPromise = (async () => {
      let q = db.from('workorder_ticket_summary')
        .select('issue_date')
        .gte('issue_date', rangeStartIso)
        .lt('issue_date', rangeEndIso)
      if (applyAssets) q = q.in('asset', userAssets)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as { issue_date: string }[]
    })()

    const [statusResults, nullCount, total, agedTickets, trendRows] = await Promise.all([
      Promise.all(statusCountPromises),
      nullStatusCountPromise,
      totalCountPromise,
      agedPromise,
      trendPromise,
    ])

    const statusCounts: Record<string, number> = {}
    for (const r of statusResults) statusCounts[r.status] = r.count
    if (nullCount > 0) statusCounts['Open'] = (statusCounts['Open'] || 0) + nullCount

    // Build the daily trend skeleton (one entry per day in the range)
    // and then bucket the issue_date rows into it.
    const dayCount = Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000) + 1
    const useWeekdayLabels = dayCount <= 7
    const trend: { date: string; label: string; count: number }[] = []
    const cur = new Date(rangeStart)
    for (let i = 0; i < dayCount; i++) {
      const dateStr = cur.toISOString().slice(0, 10)
      const label = useWeekdayLabels
        ? cur.toLocaleDateString('en-US', { weekday: 'short' })
        : `${cur.getMonth() + 1}/${cur.getDate()}`
      trend.push({ date: dateStr, label, count: 0 })
      cur.setDate(cur.getDate() + 1)
    }
    const trendIndex = new Map(trend.map((t, i) => [t.date, i]))
    for (const r of trendRows) {
      const date = (r.issue_date || '').slice(0, 10)
      const idx = trendIndex.get(date)
      if (idx !== undefined) trend[idx].count++
    }

    return NextResponse.json({
      statusCounts,
      agedTickets,
      dailyTrend: trend,
      total,
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
