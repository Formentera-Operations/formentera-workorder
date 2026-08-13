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

/**
 * View columns withheld from tool output.
 *
 * repair_vendor is never populated in this data — real vendors live in
 * vendor_payment_details and are returned as `vendors`. Emitting an always-null
 * column invites the model to treat it as the vendor field and report "no
 * vendor" for tickets that plainly have several.
 */
const HIDDEN_COLUMNS = ['repair_vendor']

function stripHidden(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row }
  for (const c of HIDDEN_COLUMNS) delete out[c]
  return out
}

/** The seven numbered vendor/cost column pairs, in order. */
const VENDOR_SLOTS = Array.from({ length: 7 }, (_, i) => ({
  vendorKey: i === 0 ? 'vendor' : `vendor_${i + 1}`,
  costKey: i === 0 ? 'vendor_cost' : `vendor_cost_${i + 1}`,
}))

/**
 * Flatten one vendor_payment_details row into a list, dropping unused slots.
 *
 * Skips blanks rather than stopping at the first one, so a gap in the middle
 * (vendor_2 cleared but vendor_3 still set) doesn't truncate the rest.
 */
function unpivotVendors(row: Record<string, unknown>): { vendor: string; cost: number | null }[] {
  const out: { vendor: string; cost: number | null }[] = []
  for (const { vendorKey, costKey } of VENDOR_SLOTS) {
    const name = row[vendorKey]
    if (typeof name !== 'string' || !name.trim()) continue
    const raw = row[costKey]
    out.push({
      vendor: name.trim(),
      cost: raw === null || raw === undefined || raw === '' ? null : Number(raw),
    })
  }
  return out
}

function trimLongText(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out = stripHidden(row)
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
      'final status — plus a `vendors` list per ticket, so there is no need to ' +
      "call get_ticket just to see who worked it. Restricted to the connected " +
      "user's assets. Long narrative fields are truncated here; use get_ticket " +
      'for the full text. Supports free text, equipment, well, facility, foreman, ' +
      'vendor, status, priority and date range.',
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
        limit: {
          type: 'number',
          description:
            'Optional ceiling on rows returned. Omit to get every matching ticket. ' +
            'Unfiltered searches can return the entire history, so pass a limit ' +
            'when a sample will do, or narrow with a date range.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_ticket',
    description:
      'Fetch one ticket by its ticket_id, with every field, full untruncated ' +
      'narrative text, and a per-vendor cost breakdown (a ticket can have up to ' +
      "seven vendors). Returns an error if it is outside the user's assets.",
    inputSchema: {
      type: 'object',
      properties: { ticket_id: { type: 'number' } },
      required: ['ticket_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'vendor_spend',
    description:
      'Total spend per vendor across many tickets, counting every vendor on each ' +
      'ticket against its own cost. Use this for any "how much did we spend with ' +
      'X" question — it is the only correct source for vendor totals, since a ' +
      'ticket commonly has several vendors and the ticket-level cost is their ' +
      "combined total. Restricted to the connected user's assets.",
    inputSchema: {
      type: 'object',
      properties: {
        vendor: { type: 'string', description: 'Optional: only this vendor (substring match, case-insensitive)' },
        start_date: { type: 'string', description: 'ISO date, inclusive lower bound on ticket issue_date' },
        end_date: { type: 'string', description: 'ISO date, inclusive upper bound on ticket issue_date' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ticket_stats',
    description:
      'Aggregate ticket counts and repair cost totals grouped by one dimension ' +
      '(asset, ticket_status, equipment_type, assigned_foreman, department, ' +
      'priority_of_issue, work_order_type). ' +
      'Vendor is intentionally not a dimension here — use vendor_spend for that. ' +
      'Counts every ticket in range with no row cap; tickets_counted reports how ' +
      'many were included.',
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

// repair_vendor is deliberately NOT groupable: the underlying closeout column
// is never populated in this data, so grouping by it yields one big
// "Unspecified" bucket rather than anything useful. Real vendor data lives in
// vendor_payment_details, which vendor_spend reads directly.
const GROUPABLE = new Set([
  'asset', 'ticket_status', 'equipment_type', 'assigned_foreman',
  'department', 'priority_of_issue', 'work_order_type',
])

/**
 * Per-ticket cost, tolerant of which column the view actually carries it in.
 *
 * The schema in git maps vendor_payment_details.total_cost to `repair_cost`
 * and keeps the closeout's `total_repair_cost` separate, but the live view is
 * reported to put the vendor total in `total_repair_cost`. Reading whichever
 * is populated avoids silently reporting zero if the file has drifted.
 */
function ticketCost(row: Record<string, unknown>): number {
  const primary = Number(row.repair_cost)
  if (Number.isFinite(primary) && primary !== 0) return primary
  const fallback = Number(row.total_repair_cost)
  return Number.isFinite(fallback) ? fallback : 0
}

async function searchTickets(args: Record<string, unknown>, scope: UserScope) {
  // `limit` is an optional ceiling the caller may ask for, not one imposed
  // here. Omitted, the search pages through every matching ticket.
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : null

  // Filtering by vendor cannot use the view: repair_vendor is never populated,
  // so matching on it returned nothing at all. Resolve matching ticket ids from
  // vendor_payment_details instead and intersect. Safe despite that table
  // having no asset column — the ids only narrow a query that is still asset
  // scoped, so this can't widen what the caller sees.
  const vendorTerm = text(args.vendor)
  let vendorIds: number[] | null = null
  if (vendorTerm) {
    vendorIds = await ticketIdsForVendor(vendorTerm)
    if (vendorIds.length === 0) return { count: 0, tickets: [] }
  }

  // Every column the view exposes, rather than a curated subset — the model
  // can then answer on area/route/AFE/dates without a follow-up round-trip.
  const build = (from: number, to: number) => {
    let q = supabaseAdmin()
      .from('workorder_ticket_summary')
      .select('*')
      .order('ticket_id', { ascending: false })
      .range(from, to)

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
    ]
    for (const [col, val] of pairs) {
      if (val) q = q.ilike(col, `%${escapeLike(val)}%`)
    }
    if (text(args.status)) q = q.eq('ticket_status', text(args.status))
    if (text(args.priority)) q = q.eq('priority_of_issue', text(args.priority))
    if (text(args.start_date)) q = q.gte('issue_date', text(args.start_date))
    if (text(args.end_date)) q = q.lte('issue_date', text(args.end_date))
    if (vendorIds) q = q.in('ticket_id', vendorIds)
    return q
  }

  let rows: Record<string, unknown>[]
  if (limit !== null) {
    const { data, error } = await build(0, limit - 1)
    if (error) return { error: error.message }
    rows = (data ?? []) as unknown as Record<string, unknown>[]
  } else {
    const res = await fetchAllPages(build)
    if (res.error) return { error: res.error }
    rows = res.rows
  }

  return { count: rows.length, tickets: await attachVendors(trimLongText(rows)) }
}

/** Ticket ids whose payment row names a vendor matching `term`, any slot. */
async function ticketIdsForVendor(term: string): Promise<number[]> {
  const e = escapeLike(term)
  const { rows } = await fetchAllPages((from, to) =>
    supabaseAdmin()
      .from('vendor_payment_details')
      .select('ticket_id')
      .or(VENDOR_SLOTS.map((s) => `${s.vendorKey}.ilike.%${e}%`).join(','))
      .order('ticket_id', { ascending: true })
      .range(from, to)
  )
  return rows
    .map((r) => (r as { ticket_id: number | null }).ticket_id)
    .filter((v): v is number => typeof v === 'number')
}

/**
 * Attach each ticket's vendor list to search results.
 *
 * One extra query for the whole page, not one per ticket — otherwise the model
 * has to call get_ticket in a loop to answer "who worked these tickets".
 */
async function attachVendors(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const ids = rows.map((r) => Number(r.ticket_id)).filter((v) => Number.isFinite(v))
  if (ids.length === 0) return rows

  // Chunked because .in() lists travel in the URL — an unlimited search can
  // return thousands of tickets, and one giant filter would exceed the URL
  // length long before the query itself became a problem.
  const byTicket = new Map<number, { vendor: string; cost: number | null }[]>()
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabaseAdmin()
      .from('vendor_payment_details')
      .select('*')
      .in('ticket_id', ids.slice(i, i + ID_CHUNK))

    // A failure here shouldn't lose the tickets themselves; return them bare.
    if (error || !data) return rows
    for (const row of data as unknown as Record<string, unknown>[]) {
      byTicket.set(Number(row.ticket_id), unpivotVendors(row))
    }
  }
  return rows.map((r) => ({ ...r, vendors: byTicket.get(Number(r.ticket_id)) ?? [] }))
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

  return { ...stripHidden(data as Record<string, unknown>), vendors: await vendorBreakdown(id) }
}

/**
 * Per-vendor costs for one ticket.
 *
 * ONLY call this after the ticket itself has passed applyAssetScope —
 * vendor_payment_details has no asset column, so it carries no scoping of its
 * own and would happily return any ticket's costs.
 *
 * The table stores up to seven vendors as numbered column pairs
 * (vendor/vendor_cost, vendor_2/vendor_cost_2, …); this flattens that into a
 * list and drops the unused slots.
 */
async function vendorBreakdown(ticketId: number) {
  // One row per ticket, guaranteed by a UNIQUE(ticket_id) constraint; edits
  // upsert onto it rather than appending. maybeSingle() is therefore exact.
  const { data, error } = await supabaseAdmin()
    .from('vendor_payment_details')
    .select('*')
    .eq('ticket_id', ticketId)
    .maybeSingle()

  if (error || !data) return []
  return unpivotVendors(data as Record<string, unknown>)
}

/**
 * Page size for aggregate reads. Aggregates are NOT capped — they page until
 * the table is exhausted, so totals cover everything in range.
 *
 * Paging rather than a single unbounded select is deliberate: PostgREST can
 * enforce its own server-side row ceiling, so dropping .limit() would just move
 * the truncation somewhere we can't see it. A short page that comes back
 * smaller than requested is the only reliable end-of-data signal.
 */
const AGGREGATE_PAGE = 1000

/**
 * Read every row a query matches, one page at a time.
 *
 * The builder is a factory because a PostgREST query object can't be reused
 * across requests — each page needs a fresh one. Ordering is applied by the
 * caller and must be stable, or rows can repeat or vanish between pages.
 */
async function fetchAllPages(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += AGGREGATE_PAGE) {
    const { data, error } = await build(from, from + AGGREGATE_PAGE - 1)
    if (error) return { rows, error: error.message }
    const page = (data ?? []) as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < AGGREGATE_PAGE) return { rows }
  }
}
/** PostgREST puts filters in the URL, so .in() lists have to stay short. */
const ID_CHUNK = 300

/**
 * Vendor spend across many tickets.
 *
 * Scoping is two-step and has to stay that way: vendor_payment_details has no
 * asset column, so we first resolve which ticket_ids the caller may see (via
 * the scoped view) and then only ever read vendor rows for those ids. There is
 * no path here that reads the table unfiltered.
 */
async function vendorSpend(args: Record<string, unknown>, scope: UserScope) {
  const { rows: tickets, error: tErr } = await fetchAllPages((from, to) => {
    let tq = supabaseAdmin()
      .from('workorder_ticket_summary')
      .select('ticket_id')
      .order('ticket_id', { ascending: true })
      .range(from, to)
    tq = applyAssetScope(tq, scope)
    if (text(args.start_date)) tq = tq.gte('issue_date', text(args.start_date))
    if (text(args.end_date)) tq = tq.lte('issue_date', text(args.end_date))
    return tq
  })
  if (tErr) return { error: tErr }

  const ids = tickets
    .map((t) => (t as { ticket_id: number | null }).ticket_id)
    .filter((v): v is number => typeof v === 'number')

  if (ids.length === 0) return { vendors: [], tickets_considered: 0 }

  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabaseAdmin()
      .from('vendor_payment_details')
      .select('*')
      .in('ticket_id', ids.slice(i, i + ID_CHUNK))
    if (error) return { error: error.message }
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]))
  }

  // Unpivot the seven numbered vendor/cost pairs into one row per vendor.
  const filter = text(args.vendor).toLowerCase()
  const agg = new Map<string, { vendor: string; spend: number; tickets: Set<number> }>()

  for (const row of rows) {
    const ticketId = Number(row.ticket_id)
    for (const { vendor, cost } of unpivotVendors(row)) {
      if (filter && !vendor.toLowerCase().includes(filter)) continue

      // Group case-insensitively — the same vendor is spelled inconsistently
      // across tickets, and separate buckets would understate each one.
      const key = vendor.toLowerCase()
      const bucket = agg.get(key) ?? { vendor, spend: 0, tickets: new Set<number>() }
      bucket.spend += cost ?? 0
      if (Number.isFinite(ticketId)) bucket.tickets.add(ticketId)
      agg.set(key, bucket)
    }
  }

  const vendors = [...agg.values()]
    .map((v) => ({ vendor: v.vendor, spend: Math.round(v.spend), ticket_count: v.tickets.size }))
    .sort((a, b) => b.spend - a.spend)

  // No cap: fetchAllPages walked every matching ticket, so this covers the
  // whole range rather than a leading slice of it.
  return { vendors, tickets_considered: ids.length }
}

async function ticketStats(args: Record<string, unknown>, scope: UserScope) {
  const groupBy = text(args.group_by)
  if (groupBy === 'repair_vendor' || groupBy === 'vendor') {
    return {
      error:
        'Vendor is not a dimension here: the repair_vendor column on the ticket ' +
        'summary is not populated in this data. Vendors live in ' +
        'vendor_payment_details, where a ticket can have several — use the ' +
        'vendor_spend tool.',
    }
  }
  if (!GROUPABLE.has(groupBy)) {
    return { error: `group_by must be one of: ${[...GROUPABLE].join(', ')}` }
  }

  const { rows: source, error } = await fetchAllPages((from, to) => {
    let q = supabaseAdmin()
      .from('workorder_ticket_summary')
      .select(`${groupBy}, repair_cost, total_repair_cost`)
      .order('ticket_id', { ascending: true })
      .range(from, to)
    q = applyAssetScope(q, scope)
    if (text(args.start_date)) q = q.gte('issue_date', text(args.start_date))
    if (text(args.end_date)) q = q.lte('issue_date', text(args.end_date))
    return q
  })
  if (error) return { error }

  const buckets = new Map<string, { count: number; repair_cost: number }>()
  for (const row of source) {
    const key = String(row[groupBy] ?? 'Unspecified')
    const cost = ticketCost(row)
    const b = buckets.get(key) ?? { count: 0, repair_cost: 0 }
    b.count += 1
    b.repair_cost += cost
    buckets.set(key, b)
  }

  const rows = [...buckets.entries()]
    .map(([key, v]) => ({ [groupBy]: key, count: v.count, repair_cost: Math.round(v.repair_cost) }))
    .sort((a, b) => b.count - a.count)

  // No cap — every ticket in range is counted. tickets_counted is reported so
  // the total is checkable rather than taken on faith.
  return { group_by: groupBy, groups: rows.length, tickets_counted: source.length, rows }
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
  if (name === 'vendor_spend') return await vendorSpend(args, scope)
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
