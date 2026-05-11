import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendMail } from '@/lib/mailer'
import { newTicketDispatchEmail } from '@/lib/email-templates'

function deriveTicketStatus(decision: string): string {
  if (decision === 'Backlog - Uneconomic / Awaiting Part') return 'Backlogged'
  if (decision === 'Close Ticket - No Action Required') return 'Closed'
  return 'In Progress'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const db = supabaseAdmin()

    // Idempotency: if the client supplied a stable request id (one UUID per
    // submit attempt), check for an existing Dispatch row first so a retried
    // offline replay doesn't create a duplicate row + duplicate email.
    if (typeof body.client_request_id === 'string' && body.client_request_id) {
      const { data: existing } = await db
        .from('Dispatch')
        .select('*')
        .eq('client_request_id', body.client_request_id)
        .maybeSingle()
      if (existing) return NextResponse.json(existing, { status: 200 })
    }

    // Conflict guard: if the client tells us which version of the parent
    // ticket it edited (the `updated_at` it saw on load), reject when the
    // ticket has been touched since — caller gets the current row back and
    // decides whether to Apply anyway or Discard. Mirrors the PATCH guard
    // in /api/tickets/[id].
    const clientTs = typeof body.client_updated_at === 'string' ? body.client_updated_at : null
    if (clientTs && body.ticket_id) {
      const { data: current } = await db
        .from('Maintenance_Form_Submission')
        .select('updated_at')
        .eq('id', body.ticket_id)
        .single()
      const serverTs = (current as { updated_at?: string } | null)?.updated_at
      if (serverTs && Date.parse(serverTs) !== Date.parse(clientTs)) {
        const { data: full } = await db
          .from('workorder_ticket_list')
          .select('*')
          .eq('id', body.ticket_id)
          .single()
        return NextResponse.json(
          { error: 'Ticket was changed by someone else', current: full },
          { status: 412 }
        )
      }
    }

    const ticketStatus = deriveTicketStatus(body.work_order_decision || '')
    const estimateCost = body.Estimate_Cost ? parseFloat(body.Estimate_Cost) : null

    const insertResult = await db
      .from('Dispatch')
      .insert([{
        ticket_id: body.ticket_id,
        work_order_decision: body.work_order_decision,
        Estimate_Cost: estimateCost,
        production_foreman: body.production_foreman || null,
        maintenance_foreman: body.maintenance_foreman || null,
        self_dispatch_assignee: body.self_dispatch_assignee || null,
        date_assigned: body.date_assigned || new Date().toISOString(),
        created_at: new Date().toISOString(),
        ticket_status: ticketStatus,
        client_request_id: typeof body.client_request_id === 'string' ? body.client_request_id : null,
      }])
      .select()
      .single()

    let { data: dispatchData, error: dispatchError } = insertResult

    // Concurrent insert with same idempotency key — return the winner.
    if (dispatchError && (dispatchError as { code?: string }).code === '23505' && body.client_request_id) {
      const { data: winner } = await db
        .from('Dispatch')
        .select('*')
        .eq('client_request_id', body.client_request_id)
        .maybeSingle()
      if (winner) return NextResponse.json(winner, { status: 200 })
    }

    if (dispatchError) throw dispatchError

    // Update ticket status + cost + foreman on main ticket
    await db
      .from('Maintenance_Form_Submission')
      .update({
        Ticket_Status: ticketStatus,
        Estimate_Cost: estimateCost,
        assigned_foreman: body.production_foreman || body.maintenance_foreman || null,
      })
      .eq('id', body.ticket_id)

    // Fetch updated ticket for email
    const { data: ticket } = await db
      .from('Maintenance_Form_Submission')
      .select('*')
      .eq('id', body.ticket_id)
      .single()

    if (ticket) {
      const { subject, html } = newTicketDispatchEmail(ticket, {
        maintenance_foreman: body.maintenance_foreman,
        production_foreman: body.production_foreman,
        self_dispatch_assignee: body.self_dispatch_assignee,
        date_assigned: body.date_assigned || new Date().toISOString(),
        work_order_decision: body.work_order_decision,
      })

      // Look up work emails for assigned foremen
      const foremanNames = [body.maintenance_foreman, body.production_foreman].filter(Boolean) as string[]
      const foremanEmailResults = await Promise.all(
        foremanNames.map(name =>
          db.from('employees').select('work_email').ilike('name', name).single()
        )
      )
      const foremanEmails = foremanEmailResults
        .map(r => r.data?.work_email)
        .filter(Boolean) as string[]

      const recipients = [body.current_user_email, ...foremanEmails].filter(Boolean).join(',')
      if (recipients) {
        await sendMail({ to: recipients, subject, html }).catch(err =>
          console.error('Dispatch email failed:', err)
        )
      }
    }

    return NextResponse.json(dispatchData, { status: 201 })
  } catch (error) {
    console.error('Dispatch error:', error)
    return NextResponse.json({ error: 'Failed to dispatch ticket' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const db = supabaseAdmin()

    const { data, error } = await db
      .from('Dispatch')
      .update({
        work_order_decision: body.work_order_decision,
        Estimate_Cost: body.Estimate_Cost,
        production_foreman: body.production_foreman || null,
        maintenance_foreman: body.maintenance_foreman || null,
        self_dispatch_assignee: body.self_dispatch_assignee || null,
        date_assigned: body.date_assigned,
        due_date: body.due_date || null,
      })
      .eq('id', body.dispatch_id)
      .select()
      .single()

    if (error) throw error

    // Sync Ticket_Status on the main ticket when dispatch decision changes
    if (body.work_order_decision && body.ticket_id) {
      const ticketStatus = deriveTicketStatus(body.work_order_decision)
      await db
        .from('Maintenance_Form_Submission')
        .update({ Ticket_Status: ticketStatus })
        .eq('id', body.ticket_id)
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Dispatch update error:', error)
    return NextResponse.json({ error: 'Failed to update dispatch' }, { status: 500 })
  }
}
