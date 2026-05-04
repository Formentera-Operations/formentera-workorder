'use client'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

interface SearchableSelectProps {
  value: string
  onChange: (val: string) => void
  options: string[]
  placeholder?: string
  disabled?: boolean
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = query
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options

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

  function select(val: string) {
    onChange(val)
    setOpen(false)
    setQuery('')
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setQuery('')
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
          {value && (
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
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              className="flex-1 bg-transparent outline-none text-gray-900 placeholder-gray-400"
              style={{ fontSize: 16 }}
              placeholder="Search…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          {/* Options list */}
          <div className="max-h-80 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400 px-3 py-3 text-center">No results</p>
            ) : (
              filtered.map(o => (
                <div
                  key={o}
                  className={`px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                    o === value ? 'bg-[#1B2E6B] text-white' : 'text-gray-800 hover:bg-gray-50'
                  }`}
                  onClick={() => select(o)}
                >
                  {o}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
