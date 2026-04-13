import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function buildSystemPrompt(userName: string, role: string, userAssets: string[], todayStr: string) {
  return `You are an AI assistant built into a work order management app for Formentera Operations, an oil & gas operations company. You help field personnel understand their maintenance ticket data.

TODAY'S DATE: ${todayStr}

USER CONTEXT:
- Name: ${userName || 'Unknown'}
- Role: ${role || 'unknown'} (roles: field_user, foreman, admin, analyst)
- Assigned assets: ${userAssets.length > 0 ? userAssets.join(', ') : 'All assets'}

The data you receive is scoped to the user's assigned assets and any active date filter. All data is freshly queried from the database for every question.

RESPONSE FORMAT — return a JSON object in one of these formats:

1. Chart response (when data is best shown visually):
{
  "type": "chart",
  "chartType": "bar" | "line" | "pie",
  "title": "Chart title",
  "data": [{ "label": "...", "value": 123, ... }],
  "xKey": "label",
  "series": [{ "key": "value", "label": "Display label", "color": "#1B2E6B" }],
  "insight": "One sentence plain-language takeaway."
}

2. Text response (for explanations, recommendations, or when a chart doesn't fit):
{
  "type": "text",
  "text": "Your answer here."
}

3. Chart + explanation (when both are useful):
{
  "type": "chart",
  "chartType": "bar" | "line" | "pie",
  "title": "Chart title",
  "data": [...],
  "xKey": "label",
  "series": [...],
  "insight": "A longer explanation with context, recommendations, or next steps. You can write 2-3 sentences here when helpful."
}

RULES:
- ALWAYS return valid JSON only. No markdown, no backticks, no text outside the JSON object.
- For bar/line charts: xKey must be a field that exists in every data object.
- For pie charts: data objects need "label" and "value" fields.
- Use these colors in order: "#1B2E6B", "#3B82F6", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6"
- Keep data arrays to max 10 items. Show the top N and mention if there are more.
- Costs are in USD. Use natural formatting in insights: "$1.3M", "$45K", "$200".
- You support multi-turn conversation. If the user says "filter that", "show more", "now as a pie", etc., use conversation history to understand what they mean.

DOMAIN KNOWLEDGE:
- Ticket statuses: Open, In Progress, Backlogged, Awaiting Cost, Closed
- Work order types: LOE (lease operating expense — routine maintenance), AFE - Workover (well intervention), AFE - Capital (capital expenditure projects), Unspecified
- Work type breakdown only includes closed tickets
- Departments include: Production Operations, Compression, Electrical, Repair and Maintenance, Measurement, Engineering, and others
- Each ticket has a location — either a Well or a Facility within a Field
- "Estimate_Cost" is the cost estimate before work begins. "repair_cost" is the actual cost after completion. The difference (est - repair) = savings.
- Tickets with large "days open" values indicate stalled work that may need attention

TONE:
- Keep language simple and direct. Your users are field foremen and production engineers, not data scientists.
- Be concise. Lead with the answer or chart, not the reasoning.
- When giving recommendations, be specific: name the department, equipment, or field.
- If asked about priorities, consider: high days open, high cost, repeat equipment failures.
- If a question cannot be answered from the available data, say so clearly and suggest what questions you can answer.`
}

const BACKLOG_STATUSES = ['Open', 'In Progress', 'Backlogged']
const OPEN_STATUSES = ['Open', 'In Progress', 'Backlogged', 'Awaiting Cost']

async function fetchFreshData(userAssets: string[], startDate: string, endDate: string) {
  const db = supabaseAdmin()
  const BATCH = 1000
  const rows: {
    ticket_id: number
    asset: string
    field: string
    department: string
    equipment_name: string
    work_order_type: string | null
    ticket_status: string
    issue_date: string
    repair_date_closed: string | null
    Estimate_Cost: number | null
    repair_cost: number | null
  }[] = []

  let from = 0
  while (true) {
    let q = db
      .from('workorder_ticket_summary')
      .select('ticket_id, asset, field, department, equipment_name, work_order_type, ticket_status, issue_date, repair_date_closed, Estimate_Cost, repair_cost')
      .order('ticket_id', { ascending: true })
      .range(from, from + BATCH - 1)
    if (userAssets.length > 0) q = q.in('asset', userAssets)
    if (startDate) q = q.gte('issue_date', startDate)
    if (endDate) q = q.lte('issue_date', endDate + 'T23:59:59')
    const { data, error } = await q
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < BATCH) break
    from += BATCH
  }

  // Status counts
  const statusCounts: Record<string, number> = {}
  for (const r of rows) {
    const s = r.ticket_status || 'Open'
    statusCounts[s] = (statusCounts[s] || 0) + 1
  }

  // Top equipment
  const equipMap = new Map<string, number>()
  for (const r of rows) {
    const equip = r.equipment_name || 'Unknown'
    equipMap.set(equip, (equipMap.get(equip) || 0) + 1)
  }
  const topEquipment = Array.from(equipMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  // Cost by department
  const costDeptMap = new Map<string, { estCost: number; repairCost: number }>()
  for (const r of rows) {
    const dept = r.department || 'Unknown'
    const existing = costDeptMap.get(dept) || { estCost: 0, repairCost: 0 }
    existing.estCost += r.Estimate_Cost || 0
    existing.repairCost += r.repair_cost || 0
    costDeptMap.set(dept, existing)
  }
  const costByDept = Array.from(costDeptMap.entries())
    .map(([dept, val]) => ({ dept, estCost: Math.round(val.estCost), repairCost: Math.round(val.repairCost) }))
    .filter(d => d.estCost > 0 || d.repairCost > 0)
    .sort((a, b) => b.estCost - a.estCost)

  // Monthly trend
  const monthCountMap = new Map<string, number>()
  for (const r of rows) {
    const month = (r.issue_date || '').slice(0, 7)
    if (month) monthCountMap.set(month, (monthCountMap.get(month) || 0) + 1)
  }
  const monthlyTrend = [...monthCountMap.keys()]
    .sort()
    .slice(-12)
    .map(month => ({
      label: new Date(month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      count: monthCountMap.get(month) || 0,
    }))

  // Cost trend
  const costTrendMap = new Map<string, { estCost: number; repairCost: number }>()
  for (const r of rows) {
    const month = (r.issue_date || '').slice(0, 7)
    if (!month) continue
    const existing = costTrendMap.get(month) || { estCost: 0, repairCost: 0 }
    existing.estCost += r.Estimate_Cost || 0
    existing.repairCost += r.repair_cost || 0
    costTrendMap.set(month, existing)
  }
  const costTrend = [...costTrendMap.keys()]
    .sort()
    .slice(-12)
    .map(month => ({
      label: new Date(month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      estCost: Math.round(costTrendMap.get(month)?.estCost || 0),
      repairCost: Math.round(costTrendMap.get(month)?.repairCost || 0),
    }))
    .filter(m => m.estCost > 0 || m.repairCost > 0)

  // Backlog health
  const now = Date.now()
  const backlogMap: Record<string, { totalDays: number; count: number }> = {}
  for (const s of BACKLOG_STATUSES) backlogMap[s] = { totalDays: 0, count: 0 }
  for (const r of rows) {
    if (!BACKLOG_STATUSES.includes(r.ticket_status)) continue
    const days = Math.floor((now - new Date(r.issue_date).getTime()) / 86_400_000)
    backlogMap[r.ticket_status].totalDays += days
    backlogMap[r.ticket_status].count++
  }
  const backlogHealth = BACKLOG_STATUSES.map(status => ({
    status,
    count: backlogMap[status].count,
    avgDays: backlogMap[status].count > 0 ? Math.round(backlogMap[status].totalDays / backlogMap[status].count) : 0,
  }))

  // Work type breakdown (closed only)
  const workTypeMap = new Map<string, number>()
  for (const r of rows) {
    if (r.ticket_status !== 'Closed') continue
    const type = r.work_order_type || 'Unspecified'
    workTypeMap.set(type, (workTypeMap.get(type) || 0) + 1)
  }
  const workTypeBreakdown = Array.from(workTypeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  // Aged tickets (ID > 700)
  const agedTickets = rows
    .filter(r => OPEN_STATUSES.includes(r.ticket_status) && r.ticket_id > 700)
    .map(r => ({
      ticket_id: r.ticket_id,
      field: r.field || '',
      equipment: r.equipment_name || 'Unknown',
      status: r.ticket_status,
      days_open: Math.floor((now - new Date(r.issue_date).getTime()) / 86_400_000),
    }))
    .sort((a, b) => b.days_open - a.days_open)
    .slice(0, 10)

  // Field breakdown
  const fieldMap = new Map<string, number>()
  for (const r of rows) {
    const field = r.field || 'Unknown'
    fieldMap.set(field, (fieldMap.get(field) || 0) + 1)
  }
  const fieldBreakdown = Array.from(fieldMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([field, count]) => ({ field, count }))

  return { statusCounts, topEquipment, costByDept, monthlyTrend, costTrend, backlogHealth, workTypeBreakdown, agedTickets, fieldBreakdown, totalTickets: rows.length }
}

function buildDataContext(data: Awaited<ReturnType<typeof fetchFreshData>>) {
  return `
Here is the current aggregated work order data (freshly queried):

TOTAL TICKETS: ${data.totalTickets}

TICKET COUNTS BY STATUS:
${Object.entries(data.statusCounts).map(([status, count]) => `- ${status}: ${count} tickets`).join('\n')}

TOP EQUIPMENT BY TICKET COUNT:
${data.topEquipment.map(e => `- ${e.name}: ${e.count} tickets`).join('\n')}

COST BY DEPARTMENT:
${data.costByDept.map(d => `- ${d.dept}: Est $${d.estCost.toLocaleString()}, Repair $${d.repairCost.toLocaleString()}, Savings $${(d.estCost - d.repairCost).toLocaleString()}`).join('\n')}

MONTHLY TICKET TREND:
${data.monthlyTrend.map(m => `- ${m.label}: ${m.count} tickets`).join('\n')}

COST TREND BY MONTH:
${data.costTrend.map(m => `- ${m.label}: Est $${m.estCost.toLocaleString()}, Repair $${m.repairCost.toLocaleString()}`).join('\n')}

BACKLOG HEALTH:
${data.backlogHealth.map(b => `- ${b.status}: ${b.count} tickets, avg ${b.avgDays} days open`).join('\n')}

WORK TYPE BREAKDOWN (closed tickets):
${data.workTypeBreakdown.map(w => `- ${w.type}: ${w.count} tickets`).join('\n')}

TICKETS BY FIELD:
${data.fieldBreakdown.map(f => `- ${f.field}: ${f.count} tickets`).join('\n')}

TOP AGED OPEN TICKETS (oldest unresolved):
${data.agedTickets.slice(0, 5).map(t => `- Ticket #${t.ticket_id}: ${t.equipment} (${t.field}), ${t.status}, ${t.days_open} days open`).join('\n')}
`
}

export async function POST(req: NextRequest) {
  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ type: 'text', text: 'AI chat is not configured yet. Please contact your administrator.', noKey: true }, { status: 200 })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const { question, messages, userAssets, startDate, endDate, userName, role } = await req.json() as {
      question: string
      messages: { role: 'user' | 'assistant'; text?: string }[]
      userAssets: string[]
      startDate: string
      endDate: string
      userName: string
      role: string
    }

    if (!question) {
      return NextResponse.json({ error: 'Missing question' }, { status: 400 })
    }

    // Fetch fresh data from Supabase
    const freshData = await fetchFreshData(userAssets || [], startDate || '', endDate || '')
    const dataContext = buildDataContext(freshData)

    // Build multi-turn message history
    const claudeMessages: { role: 'user' | 'assistant'; content: string }[] = []

    // First message always includes data context
    if (messages && messages.length > 0) {
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        if (i === 0 && msg.role === 'user') {
          claudeMessages.push({ role: 'user', content: `${dataContext}\n\nUser question: ${msg.text}` })
        } else if (msg.text) {
          claudeMessages.push({ role: msg.role, content: msg.text })
        }
      }
    }

    // Add current question
    claudeMessages.push({
      role: 'user',
      content: claudeMessages.length === 0
        ? `${dataContext}\n\nUser question: ${question}`
        : `User question: ${question}`,
    })

    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: buildSystemPrompt(userName || '', role || '', userAssets || [], new Date().toISOString().slice(0, 10)),
      messages: claudeMessages,
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()

    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { type: 'text', text: cleaned }
    }

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('Chat API error:', err)
    return NextResponse.json({ error: 'Failed to process question' }, { status: 500 })
  }
}
