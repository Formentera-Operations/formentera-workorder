// Shared filter model for the Analysis Tickets tab, used by both the client
// (building requests, narrowing option lists) and the API route (turning
// requests into queries). Single source of truth for how each filterable
// dimension maps to a query param, a database column, and its blank-value
// sentinel — a mismatch between those would silently return the wrong tickets.

// Every ticket filter is multi-select; an empty selection means "no constraint".
export const FILTER_DIMS = ['status', 'dept', 'field', 'workType', 'equipType', 'equip'] as const
export type FilterDim = typeof FILTER_DIMS[number]

// One distinct combination of the six dimensions. The API returns the set of
// combinations present in the data so the client can narrow each filter's
// options against the others without another round trip.
export type FacetRow = Record<FilterDim, string>

export type Selections = Record<FilterDim, string[]>

const DIM_COLUMN: Record<FilterDim, string> = {
  status: 'ticket_status',
  dept: 'department',
  field: 'field',
  workType: 'work_order_type',
  equipType: 'equipment_type',
  equip: 'equipment_name',
}

// Query-param name each dimension travels under. Values are sent as repeated
// params (`status=Open&status=Closed`) rather than a comma-joined string so
// values containing commas — equipment and well names — survive the round trip.
export const DIM_PARAM: Record<FilterDim, string> = {
  status: 'status',
  dept: 'department',
  field: 'field',
  workType: 'workType',
  equipType: 'equipmentType',
  equip: 'equipment',
}

// Label standing in for tickets whose underlying column is null or empty. The
// Overview drill-throughs and the Department pill list can surface these, and
// the API maps them back to a real is-null-or-blank test. Status has none —
// every ticket has a status.
export const DIM_NULL_LABEL: Partial<Record<FilterDim, string>> = {
  dept: 'Unknown',
  field: 'Unknown',
  workType: 'Unspecified',
  equipType: 'Unknown',
  equip: 'Unknown',
}

// Quote a value for a PostgREST `in.(…)` list. Equipment names, fields and
// departments are free-form enough to contain commas, parens or quotes, any of
// which would otherwise be parsed as list syntax.
export function quoteIn(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// Build the PostgREST filter expression for one multi-select filter, or null
// when nothing is selected. The result is passed to `.or(...)`, which covers the
// single- and multi-value cases alike; separate `.or(...)` calls are ANDed.
export function multiFilterExpr(column: string, values: string[], nullLabel?: string): string | null {
  if (values.length === 0) return null
  const wantsNull = nullLabel ? values.includes(nullLabel) : false
  const concrete = nullLabel ? values.filter(v => v !== nullLabel) : values
  const parts: string[] = []
  if (wantsNull) parts.push(`${column}.is.null`, `${column}.eq.`)
  if (concrete.length > 0) parts.push(`${column}.in.(${concrete.map(quoteIn).join(',')})`)
  return parts.length > 0 ? parts.join(',') : null
}

// Every ticket filter on the request, as `.or(...)` expressions ready to apply.
export function ticketFilterExprs(searchParams: URLSearchParams): string[] {
  const exprs: string[] = []
  for (const dim of FILTER_DIMS) {
    const expr = multiFilterExpr(
      DIM_COLUMN[dim],
      searchParams.getAll(DIM_PARAM[dim]),
      DIM_NULL_LABEL[dim]
    )
    if (expr) exprs.push(expr)
  }
  return exprs
}

// Write a client-side selection out as repeated query params.
export function appendSelectionParams(params: URLSearchParams, selections: Selections): void {
  for (const dim of FILTER_DIMS) {
    for (const v of selections[dim]) params.append(DIM_PARAM[dim], v)
  }
}

// Dependent (faceted) options: for each dimension, the values still present in
// some ticket matching every *other* dimension's selection. Choosing
// In Progress + Closed therefore narrows Equipment Type and Equipment to what
// those tickets actually use.
//
// A dimension deliberately does not constrain itself — otherwise picking one
// value would hide its siblings and multi-select would be impossible.
//
// Returns null when there is no cube to reason about (empty data, or a response
// predating `facets` reaching a newer client through the service-worker cache).
// Callers read null as "don't narrow anything", so a missing cube degrades to
// the full option lists rather than dimming everything and stranding the user.
export function facetAvailability(
  facets: FacetRow[] | undefined,
  selections: Selections
): Record<FilterDim, Set<string>> | null {
  if (!facets || facets.length === 0) return null

  const matchesOther = (row: FacetRow, dim: FilterDim) => {
    const sel = selections[dim]
    if (sel.length === 0) return true
    const v = row[dim]
    if (sel.includes(v)) return true
    // A blank column value matches the dimension's sentinel.
    const nullLabel = DIM_NULL_LABEL[dim]
    return v === '' && !!nullLabel && sel.includes(nullLabel)
  }

  const out = {} as Record<FilterDim, Set<string>>
  for (const dim of FILTER_DIMS) {
    const set = new Set<string>()
    const nullLabel = DIM_NULL_LABEL[dim]
    for (const row of facets) {
      if (FILTER_DIMS.every(other => other === dim || matchesOther(row, other))) {
        // Surface a blank as the dimension's sentinel so e.g. an "Unknown"
        // Department stays reachable instead of being permanently dimmed.
        const v = row[dim] || nullLabel
        if (v) set.add(v)
      }
    }
    out[dim] = set
  }
  return out
}

// Toggle one value in a multi-select selection.
export function toggleValue(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v]
}

// Keep every selected value visible in a picker even when it isn't in the
// canonical option list. The lists hide the blank buckets ('Unknown' fields,
// 'Unspecified' work types), but drill-throughs can select them — without this
// the selection would be invisible and impossible to undo.
export function withSelected(options: string[], selected: string[]): string[] {
  const extra = selected.filter(s => !options.includes(s))
  return extra.length > 0 ? [...options, ...extra] : options
}

export const TICKET_COLUMNS =
  'ticket_id, asset, field, department, work_order_type, location_type, well, facility, equipment_type, equipment_name, issue_description, ticket_status, issue_date, repair_date_closed, Estimate_Cost, repair_cost'

const SEARCH_COLUMNS = ['equipment_name', 'issue_description', 'field', 'well', 'facility', 'department']

export function searchExpr(search: string): string {
  const parts = SEARCH_COLUMNS.map(c => `${c}.ilike.%${search}%`)
  if (/^\d+$/.test(search)) parts.push(`ticket_id.eq.${search}`)
  return parts.join(',')
}
