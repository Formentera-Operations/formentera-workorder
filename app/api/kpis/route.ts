import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userAssetsParam = searchParams.get('userAssets') || ''
  const userAssets = userAssetsParam
    ? userAssetsParam.split(',').map(a => a.trim()).filter(Boolean)
    : []

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

    // Equipment counts (top 8 by volume)
    const equipMap: Record<string, number> = {}
    for (const r of rows) {
      if (r.equipment_name) equipMap[r.equipment_name] = (equipMap[r.equipment_name] || 0) + 1
    }
    const equipCounts = Object.entries(equipMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([equip, count]) => ({ equip, count }))

    // Daily trend — last 7 days
    const today = new Date()
    const trend: { date: string; label: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const label = d.toLocaleDateString('en-US', { weekday: 'short' })
      trend.push({ date: dateStr, label, count: 0 })
    }
    for (const r of rows) {
      const date = (r.issue_date || '').slice(0, 10)
      const slot = trend.find(t => t.date === date)
      if (slot) slot.count++
    }

    return NextResponse.json({
      statusCounts,
      deptCounts,
      equipCounts,
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
