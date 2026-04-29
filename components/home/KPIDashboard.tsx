'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'

const KPI_GRID = [
  { key: 'Open',          label: 'Open',          bg: 'bg-blue-50',   text: 'text-[#1B2E6B]', dot: 'bg-[#1B2E6B]' },
  { key: 'In Progress',   label: 'In Progress',   bg: 'bg-amber-50',  text: 'text-amber-800', dot: 'bg-amber-400' },
  { key: 'Backlogged',    label: 'Backlogged',    bg: 'bg-gray-100',  text: 'text-gray-700',  dot: 'bg-gray-400' },
  { key: 'Awaiting Cost', label: 'Awaiting Cost', bg: 'bg-orange-50', text: 'text-orange-800', dot: 'bg-orange-400' },
]

const KPI_CLOSED = { key: 'Closed', label: 'Closed', bg: 'bg-green-50', text: 'text-green-800', dot: 'bg-emerald-500' }

type TrendPreset = 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'custom'

const TREND_PRESETS: { key: TrendPreset; label: string; title: string }[] = [
  { key: 'this-week',  label: 'This Week',  title: 'Tickets This Week' },
  { key: 'last-week',  label: 'Last Week',  title: 'Tickets Last Week' },
  { key: 'this-month', label: 'This Month', title: 'Tickets This Month' },
  { key: 'last-month', label: 'Last Month', title: 'Tickets Last Month' },
  { key: 'custom',     label: 'Custom',     title: 'Tickets' },
]

function toLocalISO(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface KPIData {
  statusCounts: Record<string, number>
  deptCounts: { dept: string; count: number }[]
  dailyTrend: { date: string; label: string; count: number }[]
  total: number
}

export default function KPIDashboard() {
  const { assets, loading } = useAuth()
  const router = useRouter()

  const [data, setData] = useState<KPIData | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [trendPreset, setTrendPreset] = useState<TrendPreset>('this-week')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const { trendStart, trendEnd } = useMemo(() => {
    const today = new Date()
    if (trendPreset === 'this-week') {
      const start = new Date(today)
      start.setDate(today.getDate() - ((today.getDay() + 6) % 7))
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      return { trendStart: toLocalISO(start), trendEnd: toLocalISO(end) }
    }
    if (trendPreset === 'last-week') {
      const start = new Date(today)
      start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 7)
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      return { trendStart: toLocalISO(start), trendEnd: toLocalISO(end) }
    }
    if (trendPreset === 'this-month') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      return { trendStart: toLocalISO(start), trendEnd: toLocalISO(end) }
    }
    if (trendPreset === 'last-month') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 0)
      return { trendStart: toLocalISO(start), trendEnd: toLocalISO(end) }
    }
    return { trendStart: customStart, trendEnd: customEnd }
  }, [trendPreset, customStart, customEnd])

  const fetchKPIs = useCallback(() => {
    if (loading) return
    if (trendPreset === 'custom' && (!trendStart || !trendEnd)) return
    const params = new URLSearchParams()
    if (assets.length > 0) params.set('userAssets', assets.join(','))
    if (trendStart) params.set('start', trendStart)
    if (trendEnd) params.set('end', trendEnd)
    params.set('_t', Date.now().toString())
    fetch(`/api/kpis?${params}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setData(d); setLastRefreshed(new Date()) })
      .catch(() => {})
  }, [assets, loading, trendPreset, trendStart, trendEnd])

  useEffect(() => {
    fetchKPIs()
  }, [fetchKPIs])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchKPIs() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchKPIs])

  // Poll every 30 seconds as a fallback when Realtime isn't available
  useEffect(() => {
    const interval = setInterval(fetchKPIs, 30_000)
    return () => clearInterval(interval)
  }, [fetchKPIs])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel('kpi-refresh')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Maintenance_Form_Submission' }, fetchKPIs)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Repairs_Closeout' }, fetchKPIs)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchKPIs])

  if (!data) {
    return (
      <div className="space-y-4 mt-6">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-20 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-44 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-36 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-40 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    )
  }

  const { statusCounts, deptCounts, dailyTrend } = data
  const maxDept = deptCounts[0]?.count || 1

  function goToStatus(status: string) {
    router.push(`/maintenance?status=${encodeURIComponent(status)}`)
  }

  return (
    <div className="space-y-4 mt-6">
      {/* Last updated */}
      {lastRefreshed && (
        <p className="text-xs text-gray-400">Updated {lastRefreshed.toLocaleTimeString()}</p>
      )}

      {/* KPI cards — 2×2 grid */}
      <div className="grid grid-cols-2 gap-3">
        {KPI_GRID.map(({ key, label, bg, text, dot }) => (
          <div
            key={key}
            className={`${bg} rounded-xl p-4 cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] active:scale-100 active:opacity-80`}
            onClick={() => goToStatus(key)}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <div className={`w-2 h-2 rounded-full ${dot}`} />
              <span className={`text-xs font-medium ${text} opacity-70`}>{label}</span>
            </div>
            <span className={`text-3xl font-bold ${text}`}>{statusCounts[key] ?? 0}</span>
          </div>
        ))}
      </div>

      {/* Closed — full width */}
      <div
        className={`${KPI_CLOSED.bg} rounded-xl p-4 cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] active:scale-100 active:opacity-80 flex items-center justify-between`}
        onClick={() => goToStatus(KPI_CLOSED.key)}
      >
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <div className={`w-2 h-2 rounded-full ${KPI_CLOSED.dot}`} />
            <span className={`text-xs font-medium ${KPI_CLOSED.text} opacity-70`}>{KPI_CLOSED.label}</span>
          </div>
          <span className={`text-3xl font-bold ${KPI_CLOSED.text}`}>{statusCounts[KPI_CLOSED.key] ?? 0}</span>
        </div>
        <span className={`text-xs ${KPI_CLOSED.text} opacity-50`}>Tap to view →</span>
      </div>

      {/* Daily trend with preset filter */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-700">
            {TREND_PRESETS.find(p => p.key === trendPreset)?.title}
          </h3>
        </div>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {TREND_PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setTrendPreset(p.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${trendPreset === p.key ? 'bg-[#1B2E6B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {trendPreset === 'custom' && (
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 block mb-0.5">From</label>
              <input
                type="date"
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 block mb-0.5">To</label>
              <input
                type="date"
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1B2E6B]"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
              />
            </div>
          </div>
        )}
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={dailyTrend} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: '#F3F4F6' }}
              formatter={(v) => [v, 'Tickets']}
            />
            <Bar
              dataKey="count"
              fill="#1B2E6B"
              radius={[4, 4, 0, 0]}
              style={{ cursor: 'pointer' }}
              activeBar={{ fill: '#2B3E8B', stroke: 'none' }}
              onClick={(d: unknown) => {
                const date = (d as { date?: string })?.date
                if (date) router.push(`/maintenance?startDate=${date}&endDate=${date}`)
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Department breakdown */}
      {deptCounts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By Department</h3>
          <div className="space-y-2.5">
            {deptCounts.map(({ dept, count }) => (
              <div
                key={dept}
                className="flex items-center gap-2 cursor-pointer hover:bg-blue-50 -mx-2 px-2 py-1 rounded-lg transition-colors"
                onClick={() => router.push(`/maintenance?department=${encodeURIComponent(dept)}`)}
              >
                <span title={dept} className="text-xs text-gray-600 w-28 truncate shrink-0">{dept}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#1B2E6B] rounded-full transition-all"
                    style={{ width: `${Math.round((count / maxDept) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-gray-800 w-5 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
