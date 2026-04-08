'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'

const STATUS_COLORS: Record<string, string> = {
  'Open': '#1B2E6B',
  'In Progress': '#F59E0B',
  'Awaiting Cost': '#F97316',
  'Backlogged': '#9CA3AF',
  'Closed': '#10B981',
}

const KPI_CARDS = [
  { key: 'Open',          label: 'Open',          bg: 'bg-blue-50',   text: 'text-[#1B2E6B]', dot: 'bg-[#1B2E6B]' },
  { key: 'In Progress',   label: 'In Progress',   bg: 'bg-amber-50',  text: 'text-amber-800', dot: 'bg-amber-400' },
  { key: 'Awaiting Cost', label: 'Awaiting Cost', bg: 'bg-orange-50', text: 'text-orange-800', dot: 'bg-orange-400' },
  { key: 'Closed',        label: 'Closed',        bg: 'bg-green-50',  text: 'text-green-800', dot: 'bg-emerald-500' },
]

interface KPIData {
  statusCounts: Record<string, number>
  deptCounts: { dept: string; count: number }[]
  dailyTrend: { date: string; label: string; count: number }[]
  total: number
}

export default function KPIDashboard() {
  const { assets } = useAuth()
  const [data, setData] = useState<KPIData | null>(null)

  useEffect(() => {
    const params = new URLSearchParams()
    if (assets.length > 0) params.set('userAssets', assets.join(','))
    fetch(`/api/kpis?${params}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
  }, [assets])

  if (!data) {
    return (
      <div className="space-y-4 mt-6">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-44 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-36 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-40 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    )
  }

  const { statusCounts, deptCounts, dailyTrend, total } = data
  const maxDept = deptCounts[0]?.count || 1
  const pieData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }))

  return (
    <div className="space-y-4 mt-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        {KPI_CARDS.map(({ key, label, bg, text, dot }) => (
          <div key={key} className={`${bg} rounded-xl p-4`}>
            <div className="flex items-center gap-1.5 mb-1">
              <div className={`w-2 h-2 rounded-full ${dot}`} />
              <span className={`text-xs font-medium ${text} opacity-70`}>{label}</span>
            </div>
            <span className={`text-3xl font-bold ${text}`}>{statusCounts[key] ?? 0}</span>
          </div>
        ))}
      </div>

      {/* Status distribution */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Status Distribution</h3>
        <div className="flex items-center gap-4">
          <PieChart width={110} height={110}>
            <Pie
              data={pieData}
              cx={55}
              cy={55}
              innerRadius={32}
              outerRadius={52}
              dataKey="value"
              stroke="none"
            >
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#D1D5DB'} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => [v, '']} />
          </PieChart>
          <div className="flex-1 space-y-1.5">
            {pieData.map(({ name, value }) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: STATUS_COLORS[name] ?? '#D1D5DB' }}
                  />
                  <span className="text-gray-600 truncate">{name}</span>
                </div>
                <span className="font-semibold text-gray-800 ml-2">{value}</span>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-1.5 flex justify-between text-xs">
              <span className="text-gray-500">Total</span>
              <span className="font-bold text-gray-800">{total}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 7-day trend */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Tickets This Week</h3>
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
              formatter={(v: number) => [v, 'Tickets']}
            />
            <Bar dataKey="count" fill="#1B2E6B" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Department breakdown */}
      {deptCounts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By Department</h3>
          <div className="space-y-2.5">
            {deptCounts.map(({ dept, count }) => (
              <div key={dept} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-28 truncate shrink-0">{dept}</span>
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
