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
    let query = db
      .from('Maintenance_Form_Submission')
      .select('Ticket_Status, Department, Issue_Date')

    if (userAssets.length > 0) query = query.in('Asset', userAssets)

    const { data, error } = await query
    if (error) throw error

    const rows = data || []

    // Status counts
    const statusCounts: Record<string, number> = {}
    for (const r of rows) {
      const s = r.Ticket_Status || 'Open'
      statusCounts[s] = (statusCounts[s] || 0) + 1
    }

    // Department counts (top 6 by volume)
    const deptMap: Record<string, number> = {}
    for (const r of rows) {
      if (r.Department) deptMap[r.Department] = (deptMap[r.Department] || 0) + 1
    }
    const deptCounts = Object.entries(deptMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([dept, count]) => ({ dept, count }))

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
      const date = (r.Issue_Date || '').slice(0, 10)
      const slot = trend.find(t => t.date === date)
      if (slot) slot.count++
    }

    return NextResponse.json({
      statusCounts,
      deptCounts,
      dailyTrend: trend,
      total: rows.length,
    })
  } catch (err) {
    console.error('KPIs fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch KPIs' }, { status: 500 })
  }
}
