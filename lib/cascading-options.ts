// Computes available dropdown options from the universe of unique
// (asset, department, equipment, foreman, submitter) combos returned by
// /api/tickets/options. Each dropdown's options are derived by filtering
// the rows on every OTHER selected filter — so picking Department=HSE
// narrows Equipment to equipment that appears on HSE tickets, but
// Department itself still shows every department compatible with the
// other current selections.
//
// The currently selected value for a filter is always preserved in its
// own dropdown even if cascading would otherwise exclude it — otherwise
// the user couldn't see what they had picked.

export type OptionRow = {
  asset: string
  department: string
  equipment: string
  foreman: string
  submitter: string
}

export type CascadeFilters = {
  asset?: string
  department?: string
  equipment?: string
  foreman?: string
  submitter?: string
}

type Dim = keyof OptionRow

const ALL = 'All'

function isActive(value: string | undefined): value is string {
  return !!value && value !== ALL
}

function rowMatches(row: OptionRow, filters: CascadeFilters, exclude: Dim): boolean {
  if (exclude !== 'asset' && isActive(filters.asset) && row.asset !== filters.asset) return false
  if (exclude !== 'department' && isActive(filters.department) && row.department !== filters.department) return false
  if (exclude !== 'equipment' && isActive(filters.equipment) && row.equipment !== filters.equipment) return false
  if (exclude !== 'foreman' && isActive(filters.foreman) && row.foreman !== filters.foreman) return false
  if (exclude !== 'submitter' && isActive(filters.submitter) && row.submitter !== filters.submitter) return false
  return true
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

function ensureSelected(list: string[], selected: string | undefined): string[] {
  if (!isActive(selected) || list.includes(selected)) return list
  return [...list, selected].sort()
}

export function deriveCascadingOptions(rows: OptionRow[], filters: CascadeFilters) {
  return {
    assets: ensureSelected(
      uniqueSorted(rows.filter(r => rowMatches(r, filters, 'asset')).map(r => r.asset)),
      filters.asset,
    ),
    departments: ensureSelected(
      uniqueSorted(rows.filter(r => rowMatches(r, filters, 'department')).map(r => r.department)),
      filters.department,
    ),
    equipments: ensureSelected(
      uniqueSorted(rows.filter(r => rowMatches(r, filters, 'equipment')).map(r => r.equipment)),
      filters.equipment,
    ),
    foremans: ensureSelected(
      uniqueSorted(rows.filter(r => rowMatches(r, filters, 'foreman')).map(r => r.foreman)),
      filters.foreman,
    ),
    submitters: ensureSelected(
      uniqueSorted(rows.filter(r => rowMatches(r, filters, 'submitter')).map(r => r.submitter)),
      filters.submitter,
    ),
  }
}
