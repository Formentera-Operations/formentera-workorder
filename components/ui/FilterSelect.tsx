'use client'
import { useState } from 'react'
import { Search, ChevronDown, X } from 'lucide-react'

// Lists shorter than this skip the search input entirely.
const SEARCH_THRESHOLD = 12

type FilterSelectProps = {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  // Text shown in the trigger when value is the placeholder, and as the
  // first row in the option list. Default 'All' (filter semantics).
  placeholder?: string
  // The value representing "unset"/"no selection". Default 'All'.
  // For form fields where unset means empty, pass placeholderValue=''.
  placeholderValue?: string
  required?: boolean
  disabled?: boolean
  // Shows a small X on the trigger when a value is set, letting the user
  // clear the selection without opening the picker.
  allowClear?: boolean
  // Suppress the rendered <label> above the trigger when the caller wants
  // to provide its own (e.g. the analysis page uses a small uppercase
  // pill label style). The `label` value is still used for the desktop
  // modal heading.
  labelHidden?: boolean
}

export default function FilterSelect({
  label, value, onChange, options,
  placeholder = 'All', placeholderValue = 'All', required = false,
  disabled = false, allowClear = false, labelHidden = false,
}: FilterSelectProps) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const showSearch = options.length > SEARCH_THRESHOLD
  const filtered = q ? options.filter(o => o.toLowerCase().includes(q.toLowerCase())) : options
  const close = () => { setOpen(false); setQ('') }
  const isPlaceholder = value === placeholderValue
  const showClear = allowClear && !isPlaceholder && !disabled

  const handleClear = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(placeholderValue)
  }

  const renderRow = (rowLabel: string, optionValue: string) => {
    const selected = value === optionValue
    return (
      <li
        key={optionValue}
        onClick={() => { onChange(optionValue); close() }}
        className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer ${
          selected ? 'bg-gray-100' : 'hover:bg-gray-50'
        }`}
      >
        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
          selected ? 'border-[#1B2E6B]' : 'border-gray-300'
        }`}>
          {selected && <span className="w-2.5 h-2.5 rounded-full bg-[#1B2E6B]" />}
        </span>
        <span className={`text-sm ${selected ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
          {rowLabel}
        </span>
      </li>
    )
  }

  const triggerExtraPadding = showClear ? ' pr-16' : ''
  const disabledClasses = disabled ? ' opacity-50 cursor-not-allowed' : ''

  return (
    <div>
      {!labelHidden && (
        <label className={`form-label${required ? ' form-label-required' : ''}`}>{label}</label>
      )}

      {/* Mobile: inline searchable dropdown anchored below the trigger.
          (Native <select> + iOS wheel was clean but lacked search, which
          matters for long lists like equipment.) */}
      <div className="relative sm:hidden">
        <button
          type="button"
          className={`form-select text-left w-full flex items-center justify-between${triggerExtraPadding}${disabledClasses}`}
          onClick={() => { if (!disabled) setOpen(v => !v) }}
          disabled={disabled}
        >
          <span className={isPlaceholder ? 'text-gray-400' : 'text-gray-900'}>
            {isPlaceholder ? placeholder : value}
          </span>
          <ChevronDown size={16} className="text-gray-400 shrink-0" />
        </button>
        {showClear && (
          <button
            type="button"
            className="absolute right-9 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
            onClick={handleClear}
            aria-label="Clear selection"
          >
            <X size={14} />
          </button>
        )}

        {open && !disabled && (
          <>
            {/* Backdrop catches outside taps. */}
            <div className="fixed inset-0 z-40" onClick={close} />
            <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
              <div className="p-2 border-b border-gray-100">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                    placeholder="Search..."
                    value={q}
                    onChange={e => setQ(e.target.value)}
                  />
                </div>
              </div>
              <ul className="max-h-64 overflow-y-auto py-1">
                <li
                  onClick={() => { onChange(placeholderValue); close() }}
                  className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 ${isPlaceholder ? 'font-medium text-[#1B2E6B]' : 'text-gray-700'}`}
                >
                  {placeholder}
                </li>
                {filtered.map(o => (
                  <li
                    key={o}
                    onClick={() => { onChange(o); close() }}
                    className={`px-4 py-2 text-sm cursor-pointer hover:bg-gray-50 ${value === o ? 'font-medium text-[#1B2E6B]' : 'text-gray-700'}`}
                  >
                    {o}
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-4 py-2 text-sm text-gray-400">No results</li>
                )}
              </ul>
            </div>
          </>
        )}
      </div>

      {/* Desktop: searchable centered modal. */}
      <div className="hidden sm:block relative">
        <button
          type="button"
          className={`form-select text-left w-full flex items-center justify-between${triggerExtraPadding}${disabledClasses}`}
          onClick={() => { if (!disabled) setOpen(v => !v) }}
          disabled={disabled}
        >
          <span className={isPlaceholder ? 'text-gray-400' : 'text-gray-900'}>
            {isPlaceholder ? placeholder : value}
          </span>
          <ChevronDown size={16} className="text-gray-400 shrink-0" />
        </button>
        {showClear && (
          <button
            type="button"
            className="absolute right-9 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
            onClick={handleClear}
            aria-label="Clear selection"
          >
            <X size={14} />
          </button>
        )}

        {open && !disabled && (
          <>
            <div className="fixed inset-0 z-50 bg-black/40" onClick={close} />
            <div className="fixed z-50 bg-white shadow-2xl flex flex-col
                            top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                            w-full max-w-md rounded-2xl max-h-[70vh]">
              <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900">{label}</h3>
                <button type="button" onClick={close} className="text-sm text-gray-500 px-2 py-1">
                  Cancel
                </button>
              </div>
              {showSearch && (
                <div className="px-4 pb-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                      placeholder="Search..."
                      value={q}
                      onChange={e => setQ(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <ul className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
                {renderRow(placeholder, placeholderValue)}
                {filtered.map(o => renderRow(o, o))}
                {filtered.length === 0 && (
                  <li className="px-4 py-3 text-sm text-gray-400 text-center">No results</li>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
