import { NextRequest, NextResponse } from 'next/server'
import { sendMail } from '@/lib/mailer'
import { newTicketEmail, newTicketDispatchEmail, selfDispatchEmail } from '@/lib/email-templates'

const TO = 'alejandro.benavides@formenteraops.com'

const sampleTicket = {
  id: 1042,
  Department: 'Production',
  Issue_Date: new Date().toISOString(),
  Location_Type: 'Well',
  Asset: 'Permian Basin',
  Area: 'Area 3',
  Field: 'West Field',
  Route: 'Route 7',
  Well: 'WL-204',
  Facility: undefined,
  Equipment_Type: 'Pump',
  Equipment: 'ESP Pump Unit B',
  Issue_Description: 'Pump is showing high amperage readings and intermittent shutdowns. Warning light on panel is flashing red.',
  Troubleshooting_Conducted: 'Checked surface connections and restarted the unit twice. Issue persists after restart.',
  Issue_Photos: [],
  Created_by_Name: 'Alejandro Benavides',
  assigned_foreman: undefined,
  Estimate_Cost: 2500,
}

export async function GET(req: NextRequest) {
  const scenario = new URL(req.url).searchParams.get('scenario') || '1'

  if (scenario === '1') {
    const { subject, html } = newTicketEmail(sampleTicket)
    await sendMail({ to: TO, subject, html })
    return NextResponse.json({ ok: true, scenario: 1, subject })
  }

  if (scenario === '2') {
    const { subject, html } = newTicketDispatchEmail(sampleTicket, {
      maintenance_foreman: 'Carlos Rivera',
      date_assigned: new Date().toISOString(),
      work_order_decision: 'Proceed with Repair',
    })
    await sendMail({ to: TO, subject, html })
    return NextResponse.json({ ok: true, scenario: 2, subject })
  }

  if (scenario === '3') {
    const { subject, html } = selfDispatchEmail(sampleTicket, {
      self_dispatch_assignee: 'Alejandro Benavides',
      date_assigned: new Date().toISOString(),
      work_order_decision: 'Proceed with Repair',
    })
    await sendMail({ to: TO, subject, html })
    return NextResponse.json({ ok: true, scenario: 3, subject })
  }

  return NextResponse.json({ error: 'Invalid scenario. Use ?scenario=1, 2, or 3' }, { status: 400 })
}
