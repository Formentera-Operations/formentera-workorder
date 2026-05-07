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

  // Local search that mirrors the server's tokenize-and-match logic so
  // online and offline results behave the same.
  const rows = useMemo(() => {
    if (!assetFilter) return []
    let pool = allRows
    if (fieldFilter) pool = pool.filter(r => r.FIELD === fieldFilter)
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.replace(/[^a-z0-9]+/g, ''))
      .filter(t => t.length >= 1)
      .slice(0, 10)
    if (tokens.length === 0) return pool.slice(0, 50)
    return pool.filter(r => {
      const blob = [r.WELLNAME, r.NAME, r.UNITIDA, r.FIELD, r.Asset, r.Area, r.ROUTENAME]
        .filter(Boolean).join(' ').toLowerCase()
      let pos = 0
      for (const t of tokens) {
        const idx = blob.indexOf(t, pos)
        if (idx === -1) return false
        pos = idx + t.length
      }
      return true
    }).slice(0, 50)
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

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
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

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}
