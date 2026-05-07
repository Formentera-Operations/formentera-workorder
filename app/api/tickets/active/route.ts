import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Returns all non-closed tickets for the given asset(s), with just the
// fields the client needs to render the duplicate warning. Pre-fetched on
// My Tickets / Maintenance load and used by the offline duplicate check
// in the new-ticket form (the live `/check-duplicates` endpoint can't
// run offline since it's a fresh DB query).

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userAssetsParam = searchParams.get('userAssets') || ''
  const userAssets = userAssetsParam
    ? userAssetsParam.split(',').map(a => a.trim()).filter(Boolean)
    : []

  if (userAssets.length === 0) {
    return NextResponse.json({ tickets: [] })
  }

  try {
    const db = supabaseAdmin()
    const { data, error } = await db
      .from('workorder_ticket_list')
      .select('id, Ticket_Status, Issue_Date, Created_by_Name, Issue_Description, assigned_foreman, Equipment, Well, Facility, Asset')
      .in('Asset', userAssets)
      .neq('Ticket_Status', 'Closed')
      .order('Issue_Date', { ascending: false })
      .limit(500)
    if (error) throw error
    return NextResponse.json({ tickets: data || [] })
  } catch (error) {
    console.error('Active tickets fetch error:', error)
    return NextResponse.json({ tickets: [] }, { status: 500 })
  }
}
