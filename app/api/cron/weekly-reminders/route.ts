import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendMail } from '@/lib/mailer'
import { weeklyReminderEmail } from '@/lib/email-templates'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Vercel Cron hits this every Friday at 22:00 UTC and 23:00 UTC. One of those
// is 5 PM Central depending on DST — we early-return on the wrong one so this
// only sends once per Friday year-round (no drift across the March / November
// DST changeover).
function isFivePmCentral(now: Date): boolean {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', hour12: false,
  }).format(now)
  return parseInt(hour, 10) === 17
}

type Foreman = { name: string; work_email: string; assets: string[] | null }

type TicketRow = {
  id: number
  Ticket_Status: string
  Issue_Date: string | null
  Asset: string | null
  Field: string | null
  Well: string | null
  Facility: string | null
  Equipment: string | null
  Issue_Description: string | null
  assigned_foreman: string | null
}

export async function GET(req: NextRequest) {
  // Vercel sends Authorization: Bearer <CRON_SECRET> automatically when the
  // env var is set. Reject anything else so the endpoint can't be triggered
  // by a random caller.
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') === 'true'
  const force = url.searchParams.get('force') === 'true'

  if (!force && !dryRun && !isFivePmCentral(new Date())) {
    return NextResponse.json({ skipped: 'not 5pm Central' }, { status: 200 })
  }

  const db = supabaseAdmin()

  const [foremenRes, ticketsRes] = await Promise.all([
    db.from('employees')
      .select('name, work_email, assets')
      .eq('role', 'foreman'),
    db.from('workorder_ticket_list')
      .select('id, Ticket_Status, Issue_Date, Asset, Field, Well, Facility, Equipment, Issue_Description, assigned_foreman')
      .in('Ticket_Status', ['Open', 'In Progress']),
  ])

  if (foremenRes.error) {
    console.error('weekly-reminders foremen query failed:', foremenRes.error)
    return NextResponse.json({ error: 'Failed to load foremen' }, { status: 500 })
  }
  if (ticketsRes.error) {
    console.error('weekly-reminders tickets query failed:', ticketsRes.error)
    return NextResponse.json({ error: 'Failed to load tickets' }, { status: 500 })
  }

  const foremen = (foremenRes.data || []) as Foreman[]
  const tickets = (ticketsRes.data || []) as TicketRow[]

  const summary: { to: string; foreman: string; ticketCount: number; sent: boolean; error?: string }[] = []

  for (const f of foremen) {
    if (!f.work_email) continue
    const assets = Array.isArray(f.assets) ? f.assets : []
    const myTickets = assets.length === 0
      ? []
      : tickets.filter(t => t.Asset && assets.includes(t.Asset))

    const { subject, html } = weeklyReminderEmail(f.name, myTickets.map(t => ({
      id: t.id,
      Ticket_Status: t.Ticket_Status,
      Issue_Date: t.Issue_Date || undefined,
      Asset: t.Asset || undefined,
      Well: t.Well || undefined,
      Facility: t.Facility || undefined,
      Equipment: t.Equipment || undefined,
      Issue_Description: t.Issue_Description || undefined,
      assigned_foreman: t.assigned_foreman || undefined,
    })))

    if (dryRun) {
      summary.push({ to: f.work_email, foreman: f.name, ticketCount: myTickets.length, sent: false })
      continue
    }

    try {
      await sendMail({ to: f.work_email, subject, html })
      summary.push({ to: f.work_email, foreman: f.name, ticketCount: myTickets.length, sent: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`weekly-reminders sendMail failed for ${f.work_email}:`, msg)
      summary.push({ to: f.work_email, foreman: f.name, ticketCount: myTickets.length, sent: false, error: msg })
    }
  }

  return NextResponse.json({
    dryRun,
    foremenProcessed: summary.length,
    summary,
  })
}
