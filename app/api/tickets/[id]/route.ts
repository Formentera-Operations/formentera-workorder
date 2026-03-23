import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = supabaseAdmin()
    const id = parseInt(params.id)

    const [ticketRes, dispatchRes, repairsRes, vendorRes, commentsRes] = await Promise.all([
      db.from('Maintenance_Form_Submission').select('*').eq('id', id).single(),
      db.from('Dispatch').select('*').eq('ticket_id', id).order('created_at', { ascending: false }),
      db.from('Repairs_Closeout').select('*').eq('ticket_id', id).order('created_at', { ascending: false }),
      db.from('vendor_payment_details').select('*').eq('ticket_id', id).maybeSingle(),
      db.from('comments').select('*').eq('ticket_id', id).order('created_at', { ascending: true }),
    ])

    if (ticketRes.error) throw ticketRes.error

    return NextResponse.json({
      ticket: ticketRes.data,
      dispatch: dispatchRes.data || [],
      repairs: repairsRes.data || [],
      vendors: vendorRes.data || null,
      comments: commentsRes.data || [],
    })
  } catch (error) {
    console.error('Ticket detail error:', error)
    return NextResponse.json({ error: 'Failed to fetch ticket' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const db = supabaseAdmin()
    const id = parseInt(params.id)

    const { data, error } = await db
      .from('Maintenance_Form_Submission')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error('Ticket update error:', error)
    return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 })
  }
}
