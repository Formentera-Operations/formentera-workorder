import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendMail } from '@/lib/mailer'
import { repairCloseoutEmail } from '@/lib/email-templates'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const db = supabaseAdmin()

    // Upsert repairs/closeout
    const { data: repairData, error: repairError } = await db
      .from('Repairs_Closeout')
      .insert([{
        ticket_id: body.ticket_id,
        start_date: body.start_date || null,
        repair_details: body.repair_details || null,
        repair_images: body.repair_images || [],
        vendor: body.vendor || null,
        total_repair_cost: body.total_repair_cost || null,
        date_completed: body.date_completed || null,
        final_status: body.final_status || null,
        Work_Order_Type: body.Work_Order_Type || null,
        Priority_of_Issue: body.Priority_of_Issue || null,
        created_by: body.created_by,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single()

    if (repairError) throw repairError

    // Upsert vendor payment details — only when vendors are actually provided
    if (body.vendors && body.vendors.length > 0) {
      // Only sum non-null costs (null = pending)
      const vendorTotal: number = body.vendors.reduce(
        (sum: number, v: { cost?: number | null }) => sum + (v.cost != null ? Number(v.cost) : 0), 0
      )
      const allPending = body.vendors.every((v: { cost?: number | null }) => v.cost == null)

      // If all costs are pending or total is 0, fall back to the previous total
      let totalCost = vendorTotal
      if (allPending || vendorTotal === 0) {
        const { data: prevRepair } = await db
          .from('Repairs_Closeout')
          .select('total_repair_cost')
          .eq('ticket_id', body.ticket_id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle()
        totalCost = prevRepair?.total_repair_cost || 0
      }

      const v = body.vendors
      const vendorPayload = {
        ticket_id: body.ticket_id,
        vendor:        v[0]?.vendor || null,
        vendor_cost:   v[0]?.cost ?? null,
        vendor_2:      v[1]?.vendor || null,
        vendor_cost_2: v[1]?.cost ?? null,
        vendor_3:      v[2]?.vendor || null,
        vendor_cost_3: v[2]?.cost ?? null,
        vendor_4:      v[3]?.vendor || null,
        vendor_cost_4: v[3]?.cost ?? null,
        vendor_5:      v[4]?.vendor || null,
        vendor_cost_5: v[4]?.cost ?? null,
        vendor_6:      v[5]?.vendor || null,
        vendor_cost_6: v[5]?.cost ?? null,
        vendor_7:      v[6]?.vendor || null,
        vendor_cost_7: v[6]?.cost ?? null,
        total_cost: totalCost,
        updated_at: new Date().toISOString(),
      }

      await db
        .from('vendor_payment_details')
        .upsert(vendorPayload, { onConflict: 'ticket_id' })

      // Write total_repair_cost back to the new Repairs_Closeout row
      await db
        .from('Repairs_Closeout')
        .update({ total_repair_cost: totalCost })
        .eq('id', repairData.id)
    }

    // Update ticket status based on final_status
    if (body.final_status) {
      const BACKLOG_STATUSES = ['Backlog - Awaiting Parts', 'Backlog - Not Economical']
      const ticketStatus = BACKLOG_STATUSES.includes(body.final_status)
        ? 'Backlogged'
        : body.final_status === 'Repaired - Awaiting Final Cost'
        ? 'Awaiting Cost'
        : 'Closed'

      await db
        .from('Maintenance_Form_Submission')
        .update({ Ticket_Status: ticketStatus })
        .eq('id', body.ticket_id)

      // Mark closeout date
      await db
        .from('Repairs_Closeout')
        .update({ date_closed: new Date().toISOString(), closed_by: body.created_by })
        .eq('id', repairData.id)
    }

    // Send repair/closeout email
    try {
      const [ticketRes, vendorRes, dispatchRes, updatedRepairRes] = await Promise.all([
        db.from('Maintenance_Form_Submission').select('*').eq('id', body.ticket_id).single(),
        db.from('vendor_payment_details').select('*').eq('ticket_id', body.ticket_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('Dispatch').select('*').eq('ticket_id', body.ticket_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('Repairs_Closeout').select('*').eq('id', repairData.id).single(),
      ])

      if (ticketRes.data) {
        const { subject, html } = repairCloseoutEmail(
          ticketRes.data,
          updatedRepairRes.data || repairData,
          vendorRes.data || null,
          dispatchRes.data || null,
        )

        const foremanNames = [
          dispatchRes.data?.maintenance_foreman,
          dispatchRes.data?.production_foreman,
        ].filter(Boolean) as string[]

        const foremanEmailResults = await Promise.all(
          foremanNames.map(name => db.from('employees').select('work_email').ilike('name', name).single())
        )
        const foremanEmails = foremanEmailResults.map(r => r.data?.work_email).filter(Boolean) as string[]

        const recipients = [body.current_user_email, ...foremanEmails].filter(Boolean).join(',')
        if (recipients) {
          await sendMail({ to: recipients, subject, html }).catch(err =>
            console.error('Repair closeout email failed:', err)
          )
        }
      }
    } catch (emailErr) {
      console.error('Repair email error:', emailErr)
    }

    return NextResponse.json(repairData, { status: 201 })
  } catch (error) {
    console.error('Repairs error:', error)
    return NextResponse.json({ error: 'Failed to save repairs' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const db = supabaseAdmin()

    const { data: latest } = await db
      .from('Repairs_Closeout')
      .select('id')
      .eq('ticket_id', body.ticket_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latest) {
      await db
        .from('Repairs_Closeout')
        .update({ repair_images: body.repair_images })
        .eq('id', latest.id)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Repair images update error:', error)
    return NextResponse.json({ error: 'Failed to update repair images' }, { status: 500 })
  }
}
