import { NextResponse } from 'next/server'
import { sendMail } from '@/lib/mailer'
import { newTicketEmail } from '@/lib/email-templates'

export async function GET() {
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
  }

  const { subject, html } = newTicketEmail(sampleTicket)

  await sendMail({
    to: 'alejandro.benavides@formenteraops.com',
    subject,
    html,
  })

  return NextResponse.json({ ok: true, subject })
}
