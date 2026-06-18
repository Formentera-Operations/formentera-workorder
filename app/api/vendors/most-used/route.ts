import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Returns the vendors a given user has used most across their own closeouts,
// most-frequent first. Powers the "Most used" group pinned to the top of the
// vendor picker on the Repairs / Closeout screen.
//
// Attribution: Repairs_Closeout.created_by records who did the closeout, and
// vendor_payment_details holds up to 7 vendors per ticket linked by ticket_id.
// We pull this user's closeout ticket ids, fetch the vendor columns for those
// tickets, and tally vendor frequency in memory.

const LIMIT = 8

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const user = (searchParams.get('user') || '').trim()
  if (!user) return NextResponse.json({ vendors: [] })

  try {
    const db = supabaseAdmin()

    // This user's closeout tickets. created_by is matched case-insensitively
    // since it's a free-text name captured at closeout time.
    const { data: closeouts, error: rcErr } = await db
      .from('Repairs_Closeout')
      .select('ticket_id')
      .ilike('created_by', user)
    if (rcErr) throw rcErr

    const ticketIds = [...new Set((closeouts || []).map(r => r.ticket_id).filter(Boolean))]
    if (ticketIds.length === 0) return NextResponse.json({ vendors: [] })

    const { data: vpd, error: vpdErr } = await db
      .from('vendor_payment_details')
      .select('vendor, vendor_2, vendor_3, vendor_4, vendor_5, vendor_6, vendor_7')
      .in('ticket_id', ticketIds)
    if (vpdErr) throw vpdErr

    // Tally frequency across all seven vendor slots.
    const counts = new Map<string, number>()
    for (const row of vpd || []) {
      const r = row as Record<string, unknown>
      for (const key of ['vendor', 'vendor_2', 'vendor_3', 'vendor_4', 'vendor_5', 'vendor_6', 'vendor_7']) {
        const name = typeof r[key] === 'string' ? (r[key] as string).trim() : ''
        if (name) counts.set(name, (counts.get(name) || 0) + 1)
      }
    }

    const vendors = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, LIMIT)
      .map(([name]) => name)

    return NextResponse.json({ vendors })
  } catch (error) {
    console.error('Most-used vendors error:', error)
    // Non-fatal — the picker still works with the full list, so degrade quietly.
    return NextResponse.json({ vendors: [] })
  }
}
