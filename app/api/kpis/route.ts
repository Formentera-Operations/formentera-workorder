import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

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

    // Paginate to get all rows (Supabase defaults to 1000 row limit)
    const BATCH = 1000
    const rows: { ticket_status: string; department: string; issue_date: string; equipment_name: string }[] = []
    let from = 0
    while (true) {
      let q = db
        .from('workorder_ticket_summary')
        .select('ticket_status, department, issue_date, equipment_name')
        .order('ticket_id', { ascending: true })
        .range(from, from + BATCH - 1)
      if (userAssets.length > 0) q = q.in('asset', userAssets)
      const { data, error } = await q
      if (error) throw error
      rows.push(...(data || []))
      if (!data || data.length < BATCH) break
      from += BATCH
    }

    // Status counts
    const statusCounts: Record<string, number> = {}
    for (const r of rows) {
      const s = r.ticket_status || 'Open'
      statusCounts[s] = (statusCounts[s] || 0) + 1
    }

    // Department counts (top 6 by volume)
    const deptMap: Record<string, number> = {}
    for (const r of rows) {
      if (r.department) deptMap[r.department] = (deptMap[r.department] || 0) + 1
    }
    const deptCounts = Object.entries(deptMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([dept, count]) => ({ dept, count }))

    // Daily trend — defaults to Mon through Sun of current week, or honors start/end if provided
    let rangeStart: Date
    let rangeEnd: Date
    if (startParam && endParam) {
      rangeStart = new Date(startParam + 'T00:00:00')
      rangeEnd = new Date(endParam + 'T00:00:00')
    } else {
      const today = new Date()
      rangeStart = new Date(today)
      rangeStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)) // Monday
      rangeEnd = new Date(rangeStart)
      rangeEnd.setDate(rangeStart.getDate() + 6) // Sunday
    }
    const trend: { date: string; label: string; count: number }[] = []
    const dayCount = Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000) + 1
    const useWeekdayLabels = dayCount <= 7
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
    for (const r of rows) {
      const date = (r.issue_date || '').slice(0, 10)
      const idx = trendIndex.get(date)
      if (idx !== undefined) trend[idx].count++
    }

    return NextResponse.json({
      statusCounts,
      deptCounts,
      dailyTrend: trend,
      total: rows.length,
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
