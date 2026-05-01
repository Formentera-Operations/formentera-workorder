import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const equipment = searchParams.get('equipment') || ''
  const well = searchParams.get('well') || ''
  const facility = searchParams.get('facility') || ''

  // Need both equipment and a location anchor (well or facility) to match.
  if (!equipment || (!well && !facility)) {
    return NextResponse.json({ duplicates: [] })
  }

  try {
    const db = supabaseAdmin()
    let query = db
      .from('workorder_ticket_list')
      .select('id, Ticket_Status, Issue_Date, Created_by_Name, Issue_Description, assigned_foreman, Equipment, Well, Facility')
      .eq('Equipment', equipment)
      .neq('Ticket_Status', 'Closed')
      .order('Issue_Date', { ascending: false })
      .limit(5)

    if (well) query = query.eq('Well', well)
    else if (facility) query = query.eq('Facility', facility)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ duplicates: data || [] })
  } catch (error) {
    console.error('Duplicate check error:', error)
    return NextResponse.json({ duplicates: [] })
  }
}
