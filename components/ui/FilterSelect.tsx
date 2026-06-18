'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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
  // Options to surface in a small group at the very top of the list, in the
  // given order (e.g. a user's most-used vendors). They're shown under
  // `pinnedLabel` and removed from the main list so nothing appears twice.
  pinnedOptions?: string[]
  pinnedLabel?: string
}

export default function FilterSelect({
  label, value, onChange, options,
  placeholder = 'All', placeholderValue = 'All', required = false,
  disabled = false, allowClear = false, labelHidden = false,
  pinnedOptions = [], pinnedLabel = 'Most used',
}: FilterSelectProps) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  // Portal target: document.body. Tracked via state so SSR (where `document`
  // doesn't exist) renders nothing on first pass, then hydrates with the
  // portal target attached. Required because some parents that embed
  // FilterSelect — e.g. the maintenance page's filter panel — set
  // overflow-y-auto, which on iOS Safari traps position:fixed descendants
  // inside the scroll container instead of letting them anchor to the
  // viewport. Portaling to body bypasses every ancestor's containing block.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const showSearch = options.length > SEARCH_THRESHOLD
  // Token-AND match: every whitespace-separated word in the query must appear
  // somewhere in the option, in any order. A plain substring match failed on
  // names with punctuation/words between the terms — e.g. searching "tubb c"
  // wouldn't find "TUBB, JB C" because ", JB " breaks the contiguous string,
  // yet it would wrongly surface "JB TUBB CTB".
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (o: string) => !tokens.length || tokens.every(t => o.toLowerCase().includes(t))
  // Pinned options render first, in their given order; the main list drops
  // them so they don't appear twice.
  const pinnedSet = new Set(pinnedOptions)
  const pinnedFiltered = pinnedOptions.filter(matches)
  const filtered = options.filter(o => !pinnedSet.has(o) && matches(o))
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

  // Shared list body for both the mobile sheet and desktop modal: the
  // placeholder row, then the optional pinned group (header + rows + divider),
  // then the main list, then a No-results fallback.
  const renderListBody = () => (
    <>
      {renderRow(placeholder, placeholderValue)}
      {pinnedFiltered.length > 0 && (
        <>
          <li className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {pinnedLabel}
          </li>
          {pinnedFiltered.map(o => renderRow(o, o))}
          {filtered.length > 0 && <li aria-hidden className="my-1 border-t border-gray-100" />}
        </>
      )}
      {filtered.map(o => renderRow(o, o))}
      {pinnedFiltered.length === 0 && filtered.length === 0 && (
        <li className="px-4 py-3 text-sm text-gray-400 text-center">No results</li>
      )}
    </>
  )

  const triggerExtraPadding = showClear ? ' pr-16' : ''
  const disabledClasses = disabled ? ' opacity-50 cursor-not-allowed' : ''

  return (
    <div>
      {!labelHidden && (
        <label className={`form-label${required ? ' form-label-required' : ''}`}>{label}</label>
      )}

      {/* Mobile: bottom-sheet modal. Previously an inline dropdown anchored
          below the trigger, but when the field sat near the bottom of the
          viewport (e.g. Assigned Foreman on the new-ticket form) the list
          got squeezed against the bottom nav and only ~1 row was visible.
          The sheet always gets ~80vh regardless of trigger position. */}
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

      </div>

      {/* Mobile sheet — portaled to <body> so iOS Safari can't trap the
          fixed-position sheet inside an overflow-y-auto ancestor (e.g. the
          maintenance page's filter panel). The wrapping sm:hidden div
          ensures we don't render alongside the desktop modal when both
          would otherwise be visible after a viewport resize. */}
      {mounted && open && !disabled && createPortal(
        <div className="sm:hidden">
          <div className="fixed inset-0 z-50 bg-black/40" onClick={close} />
          <div className="fixed z-50 bg-white shadow-2xl flex flex-col
                          left-0 right-0 bottom-0
                          rounded-t-2xl max-h-[80vh]">
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
            <ul className="flex-1 overflow-y-auto px-2 space-y-0.5
                           pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              {renderListBody()}
            </ul>
          </div>
        </div>,
        document.body
      )}

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
                {renderListBody()}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
