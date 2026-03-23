const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://formentera-workorder.vercel.app'

type TicketRow = {
  id: number
  Department?: string
  Issue_Date?: string
  Location_Type?: string
  Field?: string
  Area?: string
  Route?: string
  Well?: string
  Facility?: string
  Equipment_Type?: string
  Equipment?: string
  Issue_Description?: string
  Troubleshooting_Conducted?: string
  Issue_Photos?: string[]
  Created_by_Name?: string
  Asset?: string
  assigned_foreman?: string
  Estimate_Cost?: number | null
}

type DispatchExtras = {
  self_dispatch_assignee?: string
  date_assigned?: string
  work_order_decision?: string
}

const clean = (v: unknown): string =>
  v === null || v === undefined || String(v).trim() === '' ? '—' : String(v).trim()

const fmtDate = (v: unknown): string => {
  if (!v) return '—'
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? clean(v) : d.toLocaleDateString()
}

const section = (title: string, lines: string[]) =>
  `<div style="margin:14px 0;"><strong>${title}</strong><br><br>${lines.map(l => `${l}<br>`).join('')}<br></div>`

function buildEmailParts(r: TicketRow) {
  const well = clean(r.Well)
  const facility = clean(r.Facility)
  const wfLabel = well !== '—' ? 'Well' : 'Facility'
  const wfValue = well !== '—' ? well : facility !== '—' ? facility : '—'

  const id             = String(r.id)
  const department     = clean(r.Department)
  const issueDate      = fmtDate(r.Issue_Date)
  const locationType   = clean(r.Location_Type)
  const field          = clean(r.Field)
  const area           = clean(r.Area)
  const route          = clean(r.Route)
  const submittedBy    = clean(r.Created_by_Name)
  const issueDesc      = clean(r.Issue_Description)
  const troubleshoot   = clean(r.Troubleshooting_Conducted)
  const equipmentType  = clean(r.Equipment_Type)
  const equipment      = clean(r.Equipment)
  const asset          = clean(r.Asset)
  const assignedForeman = clean(r.assigned_foreman)

  const photoUrls: string[] = Array.isArray(r.Issue_Photos)
    ? r.Issue_Photos.filter(Boolean)
    : []

  const ticketUrl = `${APP_URL}/tickets/${id}`

  const deeplinkHtml = `
    <div style="margin:16px 0 24px;">
      <a href="${ticketUrl}"
         style="display:inline-block;padding:12px 18px;border-radius:6px;
                background:#1B2E6B;color:#fff;text-decoration:none;font-weight:600;">
        View Ticket #${id}
      </a>
    </div>
  `

  const locLines = [
    `Asset: ${asset}`,
    `Area: ${area}`,
    `Field: ${field}`,
    `Route: ${route}`,
    `Location Type: ${locationType}`,
    `${wfLabel}: ${wfValue}`,
    `Submission Date: ${issueDate}`,
    ...(assignedForeman !== '—' ? [`Assigned Foreman: ${assignedForeman}`] : []),
    `Submitted by: ${submittedBy}`,
  ]

  const locHtml      = section('Maintenance Location Details', locLines)
  const eqpHtml      = section('Equipment Details', [`Equipment Type: ${equipmentType}`, `Equipment: ${equipment}`])
  const issueHtml    = section('Issue Details', [`Department: ${department}`, `Issue Description: ${issueDesc}`, `Troubleshooting Conducted: ${troubleshoot}`])

  const photosHtml = photoUrls.length
    ? `<div style="margin:14px 0;"><strong>Issue Photos</strong><br><br>${photoUrls.map((u, i) =>
        `<div style="margin:8px 0;"><img src="${u}" alt="Issue photo ${i + 1}" style="max-width:600px;width:100%;height:auto;display:block;border-radius:8px;"></div>`
      ).join('')}</div>`
    : ''

  const bodyHtml = deeplinkHtml + locHtml + eqpHtml + issueHtml + photosHtml

  return { id, wfValue, bodyHtml }
}

export function newTicketEmail(r: TicketRow) {
  const { id, wfValue, bodyHtml } = buildEmailParts(r)
  return {
    subject: `New ticket #${id} — ${wfValue}`,
    html: bodyHtml,
  }
}

export function newTicketDispatchEmail(r: TicketRow) {
  const { id, wfValue, bodyHtml } = buildEmailParts(r)
  return {
    subject: `New ticket #${id} Dispatched — ${wfValue}`,
    html: bodyHtml,
  }
}

export function selfDispatchEmail(r: TicketRow, dispatch: DispatchExtras) {
  const { id, wfValue, bodyHtml } = buildEmailParts(r)

  const toTitleCase = (s?: string) =>
    s ? s.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '—'

  const estimatedCost = (() => {
    const n = Number(r.Estimate_Cost)
    return Number.isFinite(n)
      ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
      : '—'
  })()

  const dispatchHtml = section('Dispatch Details', [
    `Work Order Decision: ${dispatch.work_order_decision ?? 'Proceed with Repair'}`,
    `Estimated Cost: ${estimatedCost}`,
    `Self Dispatch Assignee: ${toTitleCase(dispatch.self_dispatch_assignee)}`,
    `Date Assigned: ${fmtDate(dispatch.date_assigned)}`,
  ])

  return {
    subject: `Ticket #${id} Self Dispatched — ${wfValue}`,
    html: dispatchHtml + bodyHtml,
  }
}
