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

    const ticketStatus = deriveTicketStatus(body.work_order_decision || '')
    const estimateCost = body.Estimate_Cost ? parseFloat(body.Estimate_Cost) : null

    const { data: dispatchData, error: dispatchError } = await db
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
      }])
      .select()
      .single()

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
        maintenance_foreman: body.maintenance_foreman || body.production_foreman,
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
    return NextResponse.json(data)
  } catch (error) {
    console.error('Dispatch update error:', error)
    return NextResponse.json({ error: 'Failed to update dispatch' }, { status: 500 })
  }
}
