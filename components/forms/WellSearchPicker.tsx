'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

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
  disabled = false,
  placeholder = 'Search for a well…',
  onChange,
  onClear,
}: WellSearchPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ApiRow[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      setRows([])
      setLoading(false)
      return
    }
    const rid = ++requestIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: trimmed })
      if (assetFilter) params.set('asset', assetFilter)
      const res = await fetch(`/api/wells/search?${params.toString()}`)
      const data = await res.json()
      if (rid !== requestIdRef.current) return // stale response
      setRows(Array.isArray(data) ? data : [])
    } catch {
      if (rid === requestIdRef.current) setRows([])
    } finally {
      if (rid === requestIdRef.current) setLoading(false)
    }
  }, [assetFilter])

  // Debounce query → search
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => runSearch(query), 300)
    return () => clearTimeout(t)
  }, [query, open, runSearch])

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
              placeholder="Type a well name, API, or EID…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <p className="text-sm text-gray-400 px-3 py-3 text-center">Searching…</p>
            ) : query.trim().length < 2 ? (
              <p className="text-sm text-gray-400 px-3 py-3 text-center">Type at least 2 characters</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-gray-400 px-3 py-3 text-center">No wells found</p>
            ) : (
              rows.map(row => {
                const selected = row.WELLNAME === value
                const secondary = row.NAME && row.NAME !== row.WELLNAME
                  ? row.NAME
                  : row.UNITIDA ?? ''
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
