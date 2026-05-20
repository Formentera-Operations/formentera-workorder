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

// Returns YYYY-MM-DD strings for the Saturday–Friday "work week" ending on
// THIS week's Friday in Chicago. For the actual cron run (Friday 5pm CT)
// that's the past Sat through today's Fri. For tests on other weekdays
// (Mon–Thu) it returns the same Sat–Fri window so the preview matches what
// the cron will actually send this Friday. For weekend tests (Sat/Sun) the
// window slides forward to the next upcoming Friday's week.
function getChicagoWeekRange(now: Date): { startDate: string; endDate: string } {
  const chicagoToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'long',
  }).format(now)
  const dayMap: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
  }
  const dow = dayMap[dayName] ?? 5
  // Days until this week's Friday: 0 if today IS Friday, otherwise count
  // forward. Saturday slides to next Friday (6 days out).
  const daysUntilFriday =
    dow === 5 ? 0 :
    dow === 6 ? 6 :
    5 - dow
  const [y, m, d] = chicagoToday.split('-').map(Number)
  const baseUtc = Date.UTC(y, m - 1, d)
  const fridayUtc = baseUtc + daysUntilFriday * 86400000
  const fmt = (utcMs: number) => new Date(utcMs).toISOString().slice(0, 10)
  return {
    startDate: fmt(fridayUtc - 6 * 86400000),
    endDate: fmt(fridayUtc),
  }
}

type Foreman = { name: string; work_email: string; assets: string[] | null }

type TicketRow = {
  id: number
  Ticket_Status: string
  Issue_Date: string | null
  Location_Type: string | null
  Asset: string | null
  Field: string | null
  Well: string | null
  Facility: string | null
  Equipment: string | null
  Issue_Description: string | null
  Created_by_Name: string | null
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
  // testTo=<email>: redirect every foreman's email to this single address so a
  // dry-run-with-actual-send can be reviewed without spamming real foremen.
  // Subject gets a [TEST — for {Name}] prefix so multiple test emails are
  // distinguishable in the recipient's inbox. Implies bypassing the DST gate.
  // Validation: must be exactly one email — no commas, no whitespace — so a
  // malformed value can't accidentally fan out to real foreman addresses.
  const testToRaw = (url.searchParams.get('testTo') || '').trim()
  const isTestMode = testToRaw.length > 0
  // foreman=<name>: case-insensitive match, processes only that one foreman.
  // Pair with testTo to send a single representative email instead of one
  // per foreman during a test.
  const foremanFilter = (url.searchParams.get('foreman') || '').trim().toLowerCase()
  // Production: filter tickets to Issue_Date within the current Chicago week
  // (Mon–Sun). Sunday is in the future when the cron fires Friday — harmless
  // upper bound. The "View in App" button in the email mirrors these exact
  // bounds so the page shows the same set on landing.
  // days=N override: rolling last-N-days window instead of the calendar week.
  // Useful for previewing a slim test email outside the normal Mon–Sun frame.
  const daysRaw = parseInt(url.searchParams.get('days') || '', 10)
  const { startDate, endDate } = (() => {
    if (Number.isFinite(daysRaw) && daysRaw > 0) {
      const end = new Date().toISOString().slice(0, 10)
      const start = new Date(Date.now() - daysRaw * 86400000).toISOString().slice(0, 10)
      return { startDate: start, endDate: end }
    }
    return getChicagoWeekRange(new Date())
  })()
  if (isTestMode) {
    const validTestTo = /^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(testToRaw)
    if (!validTestTo) {
      return NextResponse.json(
        { error: 'testTo must be a single valid email (no commas, no spaces)' },
        { status: 400 }
      )
    }
  }
  const testTo = testToRaw

  if (!force && !dryRun && !isTestMode && !isFivePmCentral(new Date())) {
    return NextResponse.json({ skipped: 'not 5pm Central' }, { status: 200 })
  }

  const db = supabaseAdmin()

  const ticketsQuery = db.from('workorder_ticket_list')
    .select('id, Ticket_Status, Issue_Date, Location_Type, Asset, Field, Well, Facility, Equipment, Issue_Description, Created_by_Name, assigned_foreman')
    .in('Ticket_Status', ['Open', 'In Progress'])
    .gte('Issue_Date', startDate)
    .lte('Issue_Date', endDate + 'T23:59:59')

  const [foremenRes, ticketsRes] = await Promise.all([
    db.from('employees')
      .select('name, work_email, assets')
      .eq('role', 'foreman'),
    ticketsQuery,
  ])

  if (foremenRes.error) {
    console.error('weekly-reminders foremen query failed:', foremenRes.error)
    return NextResponse.json({ error: 'Failed to load foremen' }, { status: 500 })
  }
  if (ticketsRes.error) {
    console.error('weekly-reminders tickets query failed:', ticketsRes.error)
    return NextResponse.json({ error: 'Failed to load tickets' }, { status: 500 })
  }

  let foremen = (foremenRes.data || []) as Foreman[]
  const tickets = (ticketsRes.data || []) as TicketRow[]
  if (foremanFilter) {
    foremen = foremen.filter(f => (f.name || '').toLowerCase() === foremanFilter)
  }

  const summary: { to: string; foreman: string; ticketCount: number; sent: boolean; error?: string }[] = []

  for (const f of foremen) {
    if (!f.work_email) continue
    const assets = Array.isArray(f.assets) ? f.assets : []
    const myTickets = assets.length === 0
      ? []
      : tickets.filter(t => t.Asset && assets.includes(t.Asset))

    const built = weeklyReminderEmail(f.name, myTickets.map(t => ({
      id: t.id,
      Ticket_Status: t.Ticket_Status,
      Issue_Date: t.Issue_Date || undefined,
      Location_Type: t.Location_Type || undefined,
      Asset: t.Asset || undefined,
      Well: t.Well || undefined,
      Facility: t.Facility || undefined,
      Equipment: t.Equipment || undefined,
      Issue_Description: t.Issue_Description || undefined,
      Created_by_Name: t.Created_by_Name || undefined,
      assigned_foreman: t.assigned_foreman || undefined,
    })), { startDate, endDate })

    const recipient = isTestMode ? testTo : f.work_email
    const subject = isTestMode ? `[TEST — for ${f.name}] ${built.subject}` : built.subject
    const html = built.html

    // Defensive guard: if we're in test mode, the recipient MUST equal the
    // test address. If anything ever changes upstream that breaks that
    // invariant, refuse to send rather than risk leaking to a real foreman.
    if (isTestMode && recipient !== testTo) {
      console.error(`weekly-reminders test-mode guard tripped: recipient=${recipient} testTo=${testTo}`)
      summary.push({ to: recipient, foreman: f.name, ticketCount: myTickets.length, sent: false, error: 'test-mode guard tripped' })
      continue
    }

    if (dryRun) {
      summary.push({ to: recipient, foreman: f.name, ticketCount: myTickets.length, sent: false })
      continue
    }

    try {
      await sendMail({ to: recipient, subject, html })
      summary.push({ to: recipient, foreman: f.name, ticketCount: myTickets.length, sent: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`weekly-reminders sendMail failed for ${recipient}:`, msg)
      summary.push({ to: recipient, foreman: f.name, ticketCount: myTickets.length, sent: false, error: msg })
    }
  }

  return NextResponse.json({
    dryRun,
    testMode: isTestMode ? testTo : false,
    foremenProcessed: summary.length,
    summary,
  })
}
