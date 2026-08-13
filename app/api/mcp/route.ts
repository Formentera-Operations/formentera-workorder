import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { bearerFrom, originFrom, verifyToken } from '@/lib/mcp-oauth'
import { applyAssetScope, scopeForEmail, type UserScope } from '@/lib/user-scope'

export const dynamic = 'force-dynamic'

/**
 * Read-only MCP server over JSON-RPC.
 *
 * Written against the wire protocol directly rather than the MCP SDK: adding a
 * dependency isn't possible from the current dev machine (node has no outbound
 * network), and the surface we need — initialize / tools/list / tools/call —
 * is small enough that the SDK would mostly be indirection.
 *
 * SECURITY MODEL
 * The bearer token carries only an email. Assets are re-read from the
 * employees table on EVERY call, so a token issued yesterday reflects today's
 * assignments and can't hold on to access that was revoked in the HR data.
 * Every query goes through applyAssetScope().
 */

/** Escape PostgREST LIKE wildcards so user text can't broaden a match. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`)
}

/**
 * Free-text fields that can run to paragraphs. Returned in full by get_ticket,
 * but trimmed in list results — 50 rows × three long narratives is mostly
 * padding, and it crowds out the rows themselves.
 */
const LONG_TEXT_FIELDS = ['issue_description', 'repair_details', 'troubleshooting_conducted']

function trimLongText(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out = { ...row }
    for (const f of LONG_TEXT_FIELDS) {
      const v = out[f]
      if (typeof v === 'string' && v.length > 300) out[f] = `${v.slice(0, 300)}…`
    }
    return out
  })
}

function text(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, 200) : ''
}

// ---------------------------------------------------------------- tools

const TOOLS = [
  {
    name: 'list_my_assets',
    description:
      'List the assets the connected user is allowed to see, plus their role. ' +
      'Call this first to understand the scope of every other tool.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_tickets',
    description:
      'Search work order tickets. Returns every field on the ticket summary — ' +
      'including area, route, dates, foremen, AFE number, job category, costs and ' +
      "final status. Results are always restricted to the connected user's assets. " +
      'Long narrative fields are truncated here; use get_ticket for the full text. ' +
      'Supports free text, equipment, well, facility, foreman, vendor, status, ' +
      'priority and date range.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Free text matched against issue description and repair details' },
        equipment: { type: 'string' },
        well: { type: 'string' },
        facility: { type: 'string' },
        foreman: { type: 'string' },
        vendor: { type: 'string' },
        status: { type: 'string' },
        priority: { type: 'string' },
        start_date: { type: 'string', description: 'ISO date, inclusive lower bound on issue_date' },
        end_date: { type: 'string', description: 'ISO date, inclusive upper bound on issue_date' },
        limit: { type: 'number', description: 'Max rows, default 20, hard cap 50' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_ticket',
    description:
      'Fetch one ticket by its ticket_id, with every field and full untruncated ' +
      "narrative text. Returns an error if it is outside the user's assets.",
    inputSchema: {
      type: 'object',
      properties: { ticket_id: { type: 'number' } },
      required: ['ticket_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ticket_stats',
    description:
      'Aggregate ticket counts and repair cost totals grouped by one dimension ' +
      '(asset, ticket_status, equipment_type, assigned_foreman, repair_vendor, ' +
      'department, priority_of_issue, work_order_type).',
    inputSchema: {
      type: 'object',
      properties: {
        group_by: { type: 'string' },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
      },
      required: ['group_by'],
      additionalProperties: false,
    },
  },
]

const GROUPABLE = new Set([
  'asset', 'ticket_status', 'equipment_type', 'assigned_foreman',
  'repair_vendor', 'department', 'priority_of_issue', 'work_order_type',
])

async function searchTickets(args: Record<string, unknown>, scope: UserScope) {
  const limit = Math.min(typeof args.limit === 'number' ? args.limit : 20, 50)
  // Every column the view exposes, rather than a curated subset — the model
  // can then answer on area/route/AFE/dates without a follow-up round-trip.
  let q = supabaseAdmin()
    .from('workorder_ticket_summary')
    .select('*')
    .order('ticket_id', { ascending: false })
    .limit(limit)

  q = applyAssetScope(q, scope)

  const free = text(args.text)
  if (free) {
    const e = escapeLike(free)
    q = q.or(`issue_description.ilike.%${e}%,repair_details.ilike.%${e}%`)
  }
  const pairs: [string, string][] = [
    ['equipment_name', text(args.equipment)],
    ['well', text(args.well)],
    ['facility', text(args.facility)],
    ['assigned_foreman', text(args.foreman)],
    ['repair_vendor', text(args.vendor)],
  ]
  for (const [col, val] of pairs) {
    if (val) q = q.ilike(col, `%${escapeLike(val)}%`)
  }
  if (text(args.status)) q = q.eq('ticket_status', text(args.status))
  if (text(args.priority)) q = q.eq('priority_of_issue', text(args.priority))
  if (text(args.start_date)) q = q.gte('issue_date', text(args.start_date))
  if (text(args.end_date)) q = q.lte('issue_date', text(args.end_date))

  const { data, error } = await q
  if (error) return { error: error.message }
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  return { count: rows.length, tickets: trimLongText(rows) }
}

async function getTicket(args: Record<string, unknown>, scope: UserScope) {
  const id = typeof args.ticket_id === 'number' ? args.ticket_id : Number(args.ticket_id)
  if (!Number.isFinite(id)) return { error: 'ticket_id must be a number' }

  // Full row, narrative fields untruncated — this is the drill-down tool.
  let q = supabaseAdmin()
    .from('workorder_ticket_summary')
    .select('*')
    .eq('ticket_id', id)
  q = applyAssetScope(q, scope)

  const { data, error } = await q.maybeSingle()
  if (error) return { error: error.message }
  // Deliberately indistinguishable from "does not exist" — saying "exists but
  // you can't see it" would leak which tickets belong to other assets.
  if (!data) return { error: `Ticket #${id} not found in your assets.` }
  return data
}

async function ticketStats(args: Record<string, unknown>, scope: UserScope) {
  const groupBy = text(args.group_by)
  if (!GROUPABLE.has(groupBy)) {
    return { error: `group_by must be one of: ${[...GROUPABLE].join(', ')}` }
  }

  let q = supabaseAdmin()
    .from('workorder_ticket_summary')
    .select(`${groupBy}, repair_cost`)
    .limit(5000)
  q = applyAssetScope(q, scope)
  if (text(args.start_date)) q = q.gte('issue_date', text(args.start_date))
  if (text(args.end_date)) q = q.lte('issue_date', text(args.end_date))

  const { data, error } = await q
  if (error) return { error: error.message }

  const buckets = new Map<string, { count: number; repair_cost: number }>()
  // Cast through unknown: the select list is built at runtime, so supabase-js
  // can't infer a row shape from it.
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const key = String(row[groupBy] ?? 'Unspecified')
    const cost = Number(row.repair_cost) || 0
    const b = buckets.get(key) ?? { count: 0, repair_cost: 0 }
    b.count += 1
    b.repair_cost += cost
    buckets.set(key, b)
  }

  const rows = [...buckets.entries()]
    .map(([key, v]) => ({ [groupBy]: key, count: v.count, repair_cost: Math.round(v.repair_cost) }))
    .sort((a, b) => b.count - a.count)

  return { group_by: groupBy, groups: rows.length, rows }
}

async function callTool(name: string, args: Record<string, unknown>, scope: UserScope): Promise<unknown> {
  if (name === 'list_my_assets') {
    return {
      email: scope.email,
      name: scope.name,
      role: scope.role,
      assets: scope.assets,
      unrestricted: scope.assets.length === 0,
    }
  }
  if (name === 'search_tickets') return await searchTickets(args, scope)
  if (name === 'get_ticket') return await getTicket(args, scope)
  if (name === 'ticket_stats') return await ticketStats(args, scope)
  return { error: `Unknown tool: ${name}` }
}

// ---------------------------------------------------------------- transport

type RpcRequest = { jsonrpc: string; id?: string | number | null; method: string; params?: Record<string, unknown> }

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

/** 401 that tells the client where to authenticate (RFC 9728). */
function unauthorized(req: Request) {
  const origin = originFrom(req)
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    }
  )
}

export async function POST(req: Request) {
  const token = bearerFrom(req.headers.get('authorization'))
  if (!token) return unauthorized(req)

  const payload = verifyToken(token, 'access')
  if (!payload) return unauthorized(req)

  // Re-resolve assets per call rather than trusting anything in the token.
  const scope = await scopeForEmail(String(payload.email || ''))
  if (!scope) return unauthorized(req)

  let body: RpcRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 })
  }

  const { id, method, params } = body

  if (method === 'initialize') {
    const requested = (params?.protocolVersion as string) || '2025-06-18'
    return NextResponse.json(
      rpcResult(id, {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: { name: 'formentera-workorders', version: '0.1.0' },
      })
    )
  }

  // Notifications carry no id and expect no response body.
  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 202 })
  }

  if (method === 'ping') return NextResponse.json(rpcResult(id, {}))

  if (method === 'tools/list') {
    return NextResponse.json(rpcResult(id, { tools: TOOLS }))
  }

  if (method === 'tools/call') {
    const name = String(params?.name || '')
    const args = (params?.arguments as Record<string, unknown>) || {}
    if (!TOOLS.some((t) => t.name === name)) {
      return NextResponse.json(rpcError(id, -32602, `Unknown tool: ${name}`))
    }
    try {
      const result = await callTool(name, args, scope)
      return NextResponse.json(
        rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Tool execution failed'
      return NextResponse.json(
        rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true })
      )
    }
  }

  return NextResponse.json(rpcError(id, -32601, `Method not found: ${method}`))
}

/** Some clients probe with GET before POSTing; answer without a stream. */
export async function GET(req: Request) {
  const token = bearerFrom(req.headers.get('authorization'))
  if (!token || !verifyToken(token, 'access')) return unauthorized(req)
  return new NextResponse(null, { status: 405, headers: { allow: 'POST' } })
}
