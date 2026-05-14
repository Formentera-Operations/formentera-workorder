'use client'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { cachedFetch } from '@/lib/cached-fetch'

export interface WellSearchResult {
  well: string
  unitId: string
  field: string
  area: string
  route: string
  asset: string
}

interface WellSearchPickerProps {
  value: string
  assetFilter?: string
  fieldFilter?: string
  disabled?: boolean
  placeholder?: string
  onChange: (result: WellSearchResult) => void
  onClear?: () => void
}

type ApiRow = {
  UNITID: string
  WELLNAME: string
  NAME: string | null
  UNITIDA: string | null
  WVWELLID: string | null
  Asset: string | null
  Area: string | null
  FIELD: string | null
  ROUTENAME: string | null
}

export default function WellSearchPicker({
  value,
  assetFilter,
  fieldFilter,
  disabled = false,
  placeholder = 'Search for a well…',
  onChange,
  onClear,
}: WellSearchPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [allRows, setAllRows] = useState<ApiRow[]>([])
  const [allRowsLoading, setAllRowsLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Pull the full well list for the foreman's asset once (cached in IDB so
  // it works offline). Re-fetches when the asset changes.
  useEffect(() => {
    if (!assetFilter) { setAllRows([]); return }
    let cancelled = false
    setAllRowsLoading(true)
    cachedFetch<ApiRow[]>(
      `/api/wells/all?asset=${encodeURIComponent(assetFilter)}`,
      { cacheKey: `wells:all:${assetFilter}` }
    )
      .then(({ data }) => {
        if (!cancelled) setAllRows(Array.isArray(data) ? data : [])
      })
      .catch(() => { if (!cancelled) setAllRows([]) })
      .finally(() => { if (!cancelled) setAllRowsLoading(false) })
    return () => { cancelled = true }
  }, [assetFilter])

  // Local search. Both the blob and the query are "squished" (non-alphanumeric
  // removed) so a token like "jbc" can match "J B C" — the spaces in well
  // names shouldn't matter. Matching is order-insensitive: every token must
  // appear somewhere in the squished blob, but not in any particular order.
  // Filtered rows are then ranked so that prefix/substring matches on
  // WELLNAME (and then NAME) rise above matches that only hit because tokens
  // were scattered across other fields.
  const rows = useMemo(() => {
    if (!assetFilter) return []
    let pool = allRows
    if (fieldFilter) pool = pool.filter(r => r.FIELD === fieldFilter)
    const squish = (s: string | null | undefined): string =>
      (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.replace(/[^a-z0-9]+/g, ''))
      .filter(t => t.length >= 1)
      .slice(0, 10)
    if (tokens.length === 0) return pool.slice(0, 50)
    const sqQuery = tokens.join('')
    const filtered = pool.filter(r => {
      const blob = squish([r.WELLNAME, r.NAME, r.UNITIDA, r.FIELD, r.Asset, r.Area, r.ROUTENAME]
        .filter(Boolean).join(' '))
      return tokens.every(t => blob.includes(t))
    })
    const score = (r: ApiRow): number => {
      const w = squish(r.WELLNAME)
      const n = squish(r.NAME)
      if (w === sqQuery) return 0
      if (w.startsWith(sqQuery)) return 1
      if (w.includes(sqQuery)) return 2
      if (tokens.every(t => w.includes(t))) return 3
      if (n && n === sqQuery) return 4
      if (n && n.startsWith(sqQuery)) return 5
      if (n && n.includes(sqQuery)) return 6
      if (n && tokens.every(t => n.includes(t))) return 7
      return 8
    }
    return filtered
      .sort((a, b) => {
        const diff = score(a) - score(b)
        if (diff !== 0) return diff
        return a.WELLNAME.localeCompare(b.WELLNAME)
      })
      .slice(0, 50)
  }, [allRows, query, assetFilter, fieldFilter])

  const loading = allRowsLoading
  // runSearch retained for compatibility; no-op since filtering is reactive.
  const runSearch = useCallback((_q: string) => {}, [])
  void runSearch

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function select(row: ApiRow) {
    onChange({
      well: row.WELLNAME,
      unitId: row.UNITID,
      field: row.FIELD ?? '',
      area: row.Area ?? '',
      route: row.ROUTENAME ?? '',
      asset: row.Asset ?? '',
    })
    setOpen(false)
    setQuery('')
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    setQuery('')
    if (onClear) onClear()
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <div
        className={`form-input flex items-center justify-between gap-2 cursor-pointer ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={() => {
          if (!open) {
            setOpen(true)
            setTimeout(() => inputRef.current?.focus(), 0)
          } else {
            setOpen(false)
            setQuery('')
          }
        }}
      >
        <span className={value ? 'text-gray-900' : 'text-gray-400'}>
          {value || placeholder}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {value && onClear && (
            <button type="button" onClick={clear} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
          <ChevronDown size={16} className="text-gray-400" />
        </div>
      </div>

      {open && (() => {
        const rowList = (
          loading ? (
            <p className="text-sm text-gray-400 px-3 py-3 text-center">Searching…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-400 px-3 py-3 text-center">
              {assetFilter ? 'No wells found' : 'Select an Asset first'}
            </p>
          ) : (
            rows.map(row => {
              const selected = row.WELLNAME === value
              const secondary = row.NAME && row.NAME !== row.WELLNAME ? row.NAME : null
              return (
                <div
                  key={row.UNITID}
                  className={`px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                    selected ? 'bg-[#1B2E6B] text-white' : 'text-gray-800 hover:bg-gray-50'
                  }`}
                  onClick={() => select(row)}
                >
                  <div>{row.WELLNAME}</div>
                  {secondary && (
                    <div className={`text-xs ${selected ? 'text-gray-200' : 'text-gray-400'}`}>
                      {secondary}
                    </div>
                  )}
                </div>
              )
            })
          )
        )

        return (
          <>
            {/* Mobile: inline dropdown anchored below the trigger. */}
            <div className="sm:hidden absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
                <Search size={14} className="text-gray-400 flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  className="flex-1 text-sm bg-transparent outline-none text-gray-900 placeholder-gray-400"
                  placeholder="Type to filter…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              <div className="max-h-80 overflow-y-auto">{rowList}</div>
            </div>

            {/* Desktop: centered modal, matching FilterSelect's pattern. */}
            <div className="hidden sm:block">
              <div
                className="fixed inset-0 z-50 bg-black/40"
                onClick={() => { setOpen(false); setQuery('') }}
              />
              <div className="fixed z-50 bg-white shadow-2xl flex flex-col
                              top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                              w-full max-w-md rounded-2xl max-h-[70vh]">
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-900">Well</h3>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setQuery('') }}
                    className="text-sm text-gray-500 px-2 py-1"
                  >
                    Cancel
                  </button>
                </div>
                <div className="px-4 pb-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                      placeholder="Type to filter…"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-4">{rowList}</div>
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}
