import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendMail } from '@/lib/mailer'
import { newTicketEmail, newTicketDispatchEmail, selfDispatchEmail } from '@/lib/email-templates'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('mode') // 'mine' | 'all'
  const userEmail = searchParams.get('userEmail') || ''
  const userName = searchParams.get('userName') || ''
  const search = searchParams.get('search') || ''
  const ticketId = searchParams.get('ticketId') || ''
  const startDate = searchParams.get('startDate') || ''
  const endDate = searchParams.get('endDate') || ''
  const asset = searchParams.get('asset') || ''
  const department = searchParams.get('department') || ''
  const equipment = searchParams.get('equipment') || ''
  const status = searchParams.get('status') || ''
  const foreman = searchParams.get('foreman') || ''
  const submittedBy = searchParams.get('submittedBy') || ''
  const finalCostPending = searchParams.get('finalCostPending') === 'true'
  const userAssetsParam = searchParams.get('userAssets') || ''
  const userAssets = userAssetsParam ? userAssetsParam.split(',').map(a => a.trim()).filter(Boolean) : []
  const page = parseInt(searchParams.get('page') || '0')
  const pageSize = parseInt(searchParams.get('pageSize') || '20')

  try {
    const db = supabaseAdmin()

    let query = db
      .from('Maintenance_Form_Submission')
      .select(`
        id, Department, Issue_Date, Location_Type, Field, Route, Facility,
        Equipment_Type, Equipment, Issue_Description, Issue_Photos,
        Well, Created_by_Email, Created_by_Name, Ticket_Status,
        Asset, Area, assigned_foreman, Estimate_Cost,
        Dispatch(work_order_decision, production_foreman, maintenance_foreman, date_assigned, Estimate_Cost)
      `, { count: 'exact' })

    // Mode: mine = only tickets the user created or is assigned to
    if (mode === 'mine') {
      query = query.or(
        `Created_by_Email.ilike.${userEmail},Created_by_Name.ilike.${userName},assigned_foreman.ilike.${userName}`
      )
    }

    // Restrict to user's assets unless admin (empty userAssets = sees all)
    if (userAssets.length > 0) query = query.in('Asset', userAssets)

    // Filters
    if (ticketId) query = query.eq('id', parseInt(ticketId))
    if (search) {
      query = query.or(
        `id::text.ilike.%${search}%,Route.ilike.%${search}%,Equipment.ilike.%${search}%,Issue_Description.ilike.%${search}%,Facility.ilike.%${search}%,Field.ilike.%${search}%,Well.ilike.%${search}%,Created_by_Name.ilike.%${search}%,assigned_foreman.ilike.%${search}%`
      )
    }
    if (startDate) query = query.gte('Issue_Date', startDate)
    if (endDate) query = query.lte('Issue_Date', endDate + 'T23:59:59')
    if (asset && asset !== 'All') query = query.ilike('Asset', asset)
    if (department && department !== 'All') query = query.eq('Department', department)
    if (equipment && equipment !== 'All') query = query.eq('Equipment', equipment)
    if (status && status !== 'All') query = query.eq('Ticket_Status', status)
    if (foreman && foreman !== 'All') query = query.eq('assigned_foreman', foreman)
    if (submittedBy && submittedBy !== 'All') query = query.eq('Created_by_Name', submittedBy)

    query = query
      .order('Issue_Date', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    const { data, error, count } = await query

    if (error) throw error

    // Filter finalCostPending in memory (requires joining vendor_payment_details)
    let results = data || []
    if (finalCostPending) {
      const ids = results.map((r: Record<string, unknown>) => r.id)
      const { data: vpd } = await db
        .from('vendor_payment_details')
        .select('ticket_id, total_cost')
        .in('ticket_id', ids)
      const vpdMap = new Map((vpd || []).map((v: Record<string, unknown>) => [v.ticket_id, v.total_cost]))
      results = results.filter((r: Record<string, unknown>) => !vpdMap.get(r.id))
    }

    return NextResponse.json({ data: results, count })
  } catch (error) {
    console.error('Tickets fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const db = supabaseAdmin()

    const { data, error } = await db
      .from('Maintenance_Form_Submission')
      .insert([{
        Department: body.Department,
        Issue_Date: new Date().toISOString(),
        Location_Type: body.Location_Type,
        Field: body.Field,
        Route: body.Route,
        Facility: body.Facility || null,
        Equipment_Type: body.Equipment_Type,
        Equipment: body.Equipment,
        Issue_Description: body.Issue_Description,
        Troubleshooting_Conducted: body.Troubleshooting_Conducted || null,
        Issue_Photos: body.Issue_Photos || [],
        Well: body.Well || null,
        Created_by_Email: body.Created_by_Email,
        Created_by_Name: body.Created_by_Name,
        Ticket_Status: (body.assigned_foreman || body.Self_Dispatch_Assignee) ? 'In Progress' : 'Open',
        Asset: body.Asset,
        Area: body.Area,
        Self_Dispatch_Assignee: body.Self_Dispatch_Assignee || null,
        assigned_foreman: body.assigned_foreman || null,
        Estimate_Cost: body.Estimate_Cost != null ? body.Estimate_Cost : null,
      }])
      .select()
      .single()

    if (error) throw error

    // Scenario 1: no foreman, no self-dispatch — send new ticket email
    if (!body.assigned_foreman && !body.Self_Dispatch_Assignee) {
      const { subject, html } = newTicketEmail(data)
      await sendMail({ to: body.Created_by_Email, subject, html }).catch(err =>
        console.error('NewTicket email failed:', err)
      )
    }

    // Scenario 2: foreman assigned — insert dispatch row + send emails
    if (body.assigned_foreman) {
      await db.from('Dispatch').insert([{
        ticket_id: data.id,
        date_assigned: new Date().toISOString(),
        created_at: new Date().toISOString(),
        work_order_decision: 'Proceed with Repair',
        maintenance_foreman: body.assigned_foreman,
        ticket_status: 'In Progress',
      }])

      const { subject, html } = newTicketDispatchEmail(data, {
        maintenance_foreman: body.assigned_foreman,
        date_assigned: new Date().toISOString(),
        work_order_decision: 'Proceed with Repair',
      })
      const { data: emp } = await db
        .from('employees')
        .select('work_email')
        .ilike('name', body.assigned_foreman)
        .single()
      const foremanEmail = emp?.work_email
      const recipients = [body.Created_by_Email, foremanEmail].filter(Boolean).join(',')
      await sendMail({ to: recipients, subject, html }).catch(err =>
        console.error('NewTicketDispatch email failed:', err)
      )
    }

    // Scenario 3: self-dispatch — insert dispatch row + send email to submitter
    if (body.Self_Dispatch_Assignee) {
      await db.from('Dispatch').insert([{
        ticket_id: data.id,
        date_assigned: new Date().toISOString(),
        created_at: new Date().toISOString(),
        work_order_decision: 'Proceed with Repair',
        self_dispatch_assignee: body.Self_Dispatch_Assignee,
        ticket_status: 'In Progress',
        Estimate_Cost: body.Estimate_Cost != null ? body.Estimate_Cost : null,
      }])

      const { subject, html } = selfDispatchEmail(data, {
        self_dispatch_assignee: body.Self_Dispatch_Assignee,
        date_assigned: new Date().toISOString(),
        work_order_decision: 'Proceed with Repair',
      })
      await sendMail({ to: body.Created_by_Email, subject, html }).catch(err =>
        console.error('SelfDispatch email failed:', err)
      )
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Ticket create error:', error)
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
  }
}
