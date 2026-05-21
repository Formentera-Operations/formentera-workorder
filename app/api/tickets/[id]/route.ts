import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getUser } from '@/lib/supabase-server'

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

// Soft-delete: snapshots the Maintenance_Form_Submission row into
// deleted_tickets (with audit columns), then cascade-deletes the row plus
// its Dispatch / Repairs_Closeout / vendor_payment_details / comments
// children. Identity is read from the session cookie via getUser() — not
// from the request body — so the client can't spoof who's deleting. Role
// + assets come from the employees table for the same reason.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 })
    }

    const user = await getUser()
    if (!user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      return NextResponse.json({ error: 'A reason for deletion is required' }, { status: 400 })
    }

    const db = supabaseAdmin()

    // Look up the caller's profile so authorization decisions don't depend on
    // anything the client sends.
    const { data: profile } = await db
      .from('employees')
      .select('name, role, assets')
      .ilike('work_email', user.email)
      .maybeSingle()
    const callerRole = (profile?.role || 'field_user') as string
    const callerAssets = Array.isArray(profile?.assets) ? profile!.assets as string[] : []
    const callerName = (profile?.name as string | undefined) ||
      (user.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined ||
      user.email

    const { data: ticket, error: fetchError } = await db
      .from('Maintenance_Form_Submission')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (fetchError) throw fetchError
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Authorization:
    //   admin       — any ticket
    //   foreman     — tickets whose Asset is in their assigned assets
    //   field_user  — tickets they created (matched by Created_by_Email)
    //   analyst     — never
    const ticketAsset = (ticket as Record<string, unknown>).Asset as string | null
    const ticketCreatorEmail = ((ticket as Record<string, unknown>).Created_by_Email as string | null) || ''
    const isAuthorized =
      callerRole === 'admin' ? true :
      callerRole === 'foreman' ? !!ticketAsset && callerAssets.includes(ticketAsset) :
      callerRole === 'field_user' ? ticketCreatorEmail.toLowerCase() === user.email.toLowerCase() :
      false
    if (!isAuthorized) {
      return NextResponse.json({ error: 'You do not have permission to delete this ticket' }, { status: 403 })
    }

    // Snapshot before delete. If this fails we abort before touching the
    // live tables — better to leave the ticket intact than half-delete it
    // without an archive row.
    const { error: archiveError } = await db.from('deleted_tickets').insert({
      id,
      original_data: ticket,
      deleted_by_email: user.email,
      deleted_by_name: callerName,
      deleted_by_role: callerRole,
      deletion_reason: reason,
    })
    if (archiveError) {
      console.error('Archive to deleted_tickets failed:', archiveError)
      return NextResponse.json({ error: 'Could not archive ticket — delete aborted' }, { status: 500 })
    }

    // Cascade-delete children first to satisfy FK constraints, then the
    // parent. Errors here leave the archive row in place; that's fine —
    // worst case we have a duplicated record, never a missing one.
    await db.from('comments').delete().eq('ticket_id', id)
    await db.from('vendor_payment_details').delete().eq('ticket_id', id)
    await db.from('Repairs_Closeout').delete().eq('ticket_id', id)
    await db.from('Dispatch').delete().eq('ticket_id', id)
    const { error: deleteError } = await db
      .from('Maintenance_Form_Submission')
      .delete()
      .eq('id', id)
    if (deleteError) {
      console.error('Final ticket delete failed:', deleteError)
      return NextResponse.json({ error: 'Failed to delete ticket' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id })
  } catch (error) {
    console.error('Ticket delete error:', error)
    return NextResponse.json({ error: 'Failed to delete ticket' }, { status: 500 })
  }
}
