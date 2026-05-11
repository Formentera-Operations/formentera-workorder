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
      db.from('Repairs_Closeout').select('*').eq('ticket_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('vendor_payment_details').select('*').eq('ticket_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('comments').select('*').eq('ticket_id', id).order('created_at', { ascending: true }),
    ])

    if (ticketRes.error) throw ticketRes.error

    return NextResponse.json({
      ticket: ticketRes.data,
      dispatch: dispatchRes.data || [],
      repairs: repairsRes.data || null,
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

    // Conflict guard: if the client tells us which version it edited (the
    // `updated_at` it saw on load), reject the update when the base row
    // has been touched since — caller gets the current row back and can
    // decide whether to retry against the fresh state. updated_at is
    // maintained by a BEFORE UPDATE trigger on Maintenance_Form_Submission
    // so any direct or cascading change reliably bumps it.
    const clientTs = typeof body.client_updated_at === 'string' ? body.client_updated_at : null
    const updateBody: Record<string, unknown> = { ...body }
    delete updateBody.client_updated_at
    // Drop the legacy field too in case an old client is still sending it.
    delete updateBody.client_last_activity_ts

    if (clientTs) {
      const { data: current } = await db
        .from('Maintenance_Form_Submission')
        .select('updated_at')
        .eq('id', id)
        .single()
      const serverTs = (current as { updated_at?: string } | null)?.updated_at
      if (serverTs && Date.parse(serverTs) !== Date.parse(clientTs)) {
        const { data: full } = await db
          .from('workorder_ticket_list')
          .select('*')
          .eq('id', id)
          .single()
        return NextResponse.json(
          { error: 'Ticket was changed by someone else', current: full },
          { status: 412 }
        )
      }
    }

    const { data, error } = await db
      .from('Maintenance_Form_Submission')
      .update(updateBody)
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
