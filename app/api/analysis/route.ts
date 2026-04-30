import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'

const STATUS_ORDER = ['Open', 'In Progress', 'Backlogged', 'Awaiting Cost', 'Closed']

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userAssetsParam = searchParams.get('userAssets') || ''
  const userAssets = userAssetsParam ? userAssetsParam.split(',').map(a => a.trim()).filter(Boolean) : []
  const mode = searchParams.get('mode') || 'agg'
  const startDate = searchParams.get('startDate') || ''
  const endDate = searchParams.get('endDate') || ''

  const db = supabaseAdmin()

  try {
    if (mode === 'table') {
      const page = parseInt(searchParams.get('page') || '0')
      const pageSize = parseInt(searchParams.get('pageSize') || '25')
      const search = searchParams.get('search') || ''
      const statusFilter = searchParams.get('status') || ''
      const deptFilter = searchParams.get('department') || ''
      const workTypeFilter = searchParams.get('workType') || ''
      const equipmentFilter = searchParams.get('equipment') || ''
      const fieldFilter = searchParams.get('field') || ''

      let query = db
        .from('workorder_ticket_summary')
        .select(
          'ticket_id, asset, field, department, work_order_type, location_type, well, facility, equipment_name, issue_description, ticket_status, issue_date, repair_date_closed, Estimate_Cost, repair_cost',
          { count: 'exact' }
        )

      if (userAssets.length > 0) query = query.in('asset', userAssets)
      if (search) {
        const orParts = [
          `equipment_name.ilike.%${search}%`,
          `issue_description.ilike.%${search}%`,
          `field.ilike.%${search}%`,
          `well.ilike.%${search}%`,
          `facility.ilike.%${search}%`,
          `department.ilike.%${search}%`,
        ]
        if (/^\d+$/.test(search)) orParts.push(`ticket_id.eq.${search}`)
        query = query.or(orParts.join(','))
      }
      if (statusFilter && statusFilter !== 'All') query = query.eq('ticket_status', statusFilter)
      if (deptFilter && deptFilter !== 'All') query = query.eq('department', deptFilter)
      if (equipmentFilter && equipmentFilter !== 'All') {
        if (equipmentFilter === 'Unknown') query = query.or('equipment_name.is.null,equipment_name.eq.')
        else query = query.eq('equipment_name', equipmentFilter)
      }
      if (fieldFilter && fieldFilter !== 'All') {
        if (fieldFilter === 'Unknown') query = query.or('field.is.null,field.eq.')
        else query = query.eq('field', fieldFilter)
      }
      if (workTypeFilter) {
        if (workTypeFilter === 'Unspecified') {
          query = query.or('work_order_type.is.null,work_order_type.eq.')
        } else {
          query = query.eq('work_order_type', workTypeFilter)
        }
      }
      if (startDate) query = query.gte('issue_date', startDate)
      if (endDate) query = query.lte('issue_date', endDate + 'T23:59:59')

      query = query
        .order('issue_date', { ascending: false })
        .order('ticket_id', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      const { data, error, count } = await query
      if (error) throw error
      return NextResponse.json({ data: data || [], count })
    }

    if (mode === 'export') {
      const search = searchParams.get('search') || ''
      const statusFilter = searchParams.get('status') || ''
      const deptFilter = searchParams.get('department') || ''
      const workTypeFilter = searchParams.get('workType') || ''
      const equipmentFilter = searchParams.get('equipment') || ''
      const fieldFilter = searchParams.get('field') || ''
      const BATCH = 1000
      const exportRows: Record<string, unknown>[] = []
      let from = 0
      while (true) {
        let q = db
          .from('workorder_ticket_summary')
          .select('ticket_id, asset, field, department, work_order_type, location_type, well, facility, equipment_name, issue_description, ticket_status, issue_date, repair_date_closed, Estimate_Cost, repair_cost')
          .order('issue_date', { ascending: false })
          .order('ticket_id', { ascending: false })
          .range(from, from + BATCH - 1)
        if (userAssets.length > 0) q = q.in('asset', userAssets)
        if (search) {
          const orParts = [
            `equipment_name.ilike.%${search}%`,
            `issue_description.ilike.%${search}%`,
            `field.ilike.%${search}%`,
            `well.ilike.%${search}%`,
            `facility.ilike.%${search}%`,
            `department.ilike.%${search}%`,
          ]
          if (/^\d+$/.test(search)) orParts.push(`ticket_id.eq.${search}`)
          q = q.or(orParts.join(','))
        }
        if (statusFilter && statusFilter !== 'All') q = q.eq('ticket_status', statusFilter)
        if (deptFilter && deptFilter !== 'All') q = q.eq('department', deptFilter)
        if (equipmentFilter && equipmentFilter !== 'All') {
          if (equipmentFilter === 'Unknown') q = q.or('equipment_name.is.null,equipment_name.eq.')
          else q = q.eq('equipment_name', equipmentFilter)
        }
        if (fieldFilter && fieldFilter !== 'All') {
          if (fieldFilter === 'Unknown') q = q.or('field.is.null,field.eq.')
          else q = q.eq('field', fieldFilter)
        }
        if (workTypeFilter) {
          if (workTypeFilter === 'Unspecified') {
            q = q.or('work_order_type.is.null,work_order_type.eq.')
          } else {
            q = q.eq('work_order_type', workTypeFilter)
          }
        }
        if (startDate) q = q.gte('issue_date', startDate)
        if (endDate) q = q.lte('issue_date', endDate + 'T23:59:59')
        const { data, error } = await q
        if (error) throw error
        exportRows.push(...(data || []))
        if (!data || data.length < BATCH) break
        from += BATCH
      }

      const escape = (v: unknown) => {
        const s = String(v ?? '')
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s
      }
      const stripEmoji = (v: unknown) => String(v ?? '').replace(/^[^a-zA-Z0-9]+/, '').trim()
      const csvRows = exportRows.map(r => {
        const est = typeof r.Estimate_Cost === 'number' ? r.Estimate_Cost : (r.Estimate_Cost ? Number(r.Estimate_Cost) : 0)
        const rep = typeof r.repair_cost === 'number' ? r.repair_cost : (r.repair_cost ? Number(r.repair_cost) : 0)
        const savings = est > 0 || rep > 0 ? est - rep : ''
        return [
          r.ticket_id, escape(r.asset), escape(r.field), escape(stripEmoji(r.department)),
          escape(r.work_order_type), escape(r.location_type), escape(r.well),
          escape(r.facility), escape(r.equipment_name), escape(r.issue_description),
          escape(r.ticket_status), r.issue_date, r.repair_date_closed,
          r.Estimate_Cost, r.repair_cost, savings,
        ].join(',')
      })
      const header = 'Ticket ID,Asset,Field,Department,Work Order Type,Location Type,Well,Facility,Equipment,Description,Status,Submitted,Closed,Est. Cost,Repair Cost,Savings'
      const csv = '﻿' + [header, ...csvRows].join('\n')
      const filename = `tickets-${new Date().toISOString().slice(0, 10)}.csv`
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    if (mode === 'excel') {
      const search = searchParams.get('search') || ''
      const statusFilter = searchParams.get('status') || ''
      const deptFilter = searchParams.get('department') || ''
      const workTypeFilter = searchParams.get('workType') || ''
      const equipmentFilter = searchParams.get('equipment') || ''
      const fieldFilter = searchParams.get('field') || ''
      const BATCH = 1000
      const exportRows: Record<string, unknown>[] = []
      let from = 0
      while (true) {
        let q = db
          .from('workorder_ticket_summary')
          .select('ticket_id, asset, field, department, work_order_type, location_type, well, facility, equipment_name, issue_description, ticket_status, issue_date, repair_date_closed, Estimate_Cost, repair_cost')
          .order('issue_date', { ascending: false })
          .order('ticket_id', { ascending: false })
          .range(from, from + BATCH - 1)
        if (userAssets.length > 0) q = q.in('asset', userAssets)
        if (search) {
          const orParts = [
            `equipment_name.ilike.%${search}%`,
            `issue_description.ilike.%${search}%`,
            `field.ilike.%${search}%`,
            `well.ilike.%${search}%`,
            `facility.ilike.%${search}%`,
            `department.ilike.%${search}%`,
          ]
          if (/^\d+$/.test(search)) orParts.push(`ticket_id.eq.${search}`)
          q = q.or(orParts.join(','))
        }
        if (statusFilter && statusFilter !== 'All') q = q.eq('ticket_status', statusFilter)
        if (deptFilter && deptFilter !== 'All') q = q.eq('department', deptFilter)
        if (equipmentFilter && equipmentFilter !== 'All') {
          if (equipmentFilter === 'Unknown') q = q.or('equipment_name.is.null,equipment_name.eq.')
          else q = q.eq('equipment_name', equipmentFilter)
        }
        if (fieldFilter && fieldFilter !== 'All') {
          if (fieldFilter === 'Unknown') q = q.or('field.is.null,field.eq.')
          else q = q.eq('field', fieldFilter)
        }
        if (workTypeFilter) {
          if (workTypeFilter === 'Unspecified') {
            q = q.or('work_order_type.is.null,work_order_type.eq.')
          } else {
            q = q.eq('work_order_type', workTypeFilter)
          }
        }
        if (startDate) q = q.gte('issue_date', startDate)
        if (endDate) q = q.lte('issue_date', endDate + 'T23:59:59')
        const { data, error } = await q
        if (error) throw error
        exportRows.push(...(data || []))
        if (!data || data.length < BATCH) break
        from += BATCH
      }

      const stripEmoji = (v: unknown) => String(v ?? '').replace(/^[^a-zA-Z0-9]+/, '').trim()
      const wb = new ExcelJS.Workbook()
      wb.creator = 'Formentera Work Order'
      wb.created = new Date()
      const ws = wb.addWorksheet('Tickets')
      ws.columns = [
        { header: 'Ticket ID', key: 'ticket_id', width: 10 },
        { header: 'Asset', key: 'asset', width: 16 },
        { header: 'Field', key: 'field', width: 14 },
        { header: 'Department', key: 'department', width: 22 },
        { header: 'Work Order Type', key: 'work_order_type', width: 16 },
        { header: 'Location Type', key: 'location_type', width: 14 },
        { header: 'Well', key: 'well', width: 22 },
        { header: 'Facility', key: 'facility', width: 22 },
        { header: 'Equipment', key: 'equipment_name', width: 22 },
        { header: 'Description', key: 'issue_description', width: 50 },
        { header: 'Status', key: 'ticket_status', width: 14 },
        { header: 'Submitted', key: 'issue_date', width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
        { header: 'Closed', key: 'repair_date_closed', width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
        { header: 'Est. Cost', key: 'Estimate_Cost', width: 12, style: { numFmt: '$#,##0.00' } },
        { header: 'Repair Cost', key: 'repair_cost', width: 12, style: { numFmt: '$#,##0.00' } },
        { header: 'Savings', key: 'savings', width: 12, style: { numFmt: '$#,##0.00' } },
      ]
      const headerRow = ws.getRow(1)
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2E6B' } }
      headerRow.alignment = { vertical: 'middle' }
      headerRow.height = 22
      ws.views = [{ state: 'frozen', ySplit: 1 }]
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } }

      for (const r of exportRows) {
        const est = typeof r.Estimate_Cost === 'number' ? r.Estimate_Cost : (r.Estimate_Cost ? Number(r.Estimate_Cost) : null)
        const rep = typeof r.repair_cost === 'number' ? r.repair_cost : (r.repair_cost ? Number(r.repair_cost) : null)
        const savings = (est ?? 0) > 0 || (rep ?? 0) > 0 ? (est ?? 0) - (rep ?? 0) : null
        ws.addRow({
          ticket_id: r.ticket_id ?? null,
          asset: r.asset ?? '',
          field: r.field ?? '',
          department: stripEmoji(r.department),
          work_order_type: r.work_order_type ?? '',
          location_type: r.location_type ?? '',
          well: r.well ?? '',
          facility: r.facility ?? '',
          equipment_name: r.equipment_name ?? '',
          issue_description: r.issue_description ?? '',
          ticket_status: r.ticket_status ?? '',
          issue_date: r.issue_date ? new Date(r.issue_date as string) : null,
          repair_date_closed: r.repair_date_closed ? new Date(r.repair_date_closed as string) : null,
          Estimate_Cost: est,
          repair_cost: rep,
          savings,
        })
      }

      const buf = await wb.xlsx.writeBuffer()
      const filename = `tickets-${new Date().toISOString().slice(0, 10)}.xlsx`
      return new Response(buf, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    // Aggregation mode — batch-fetch all rows
    const BATCH = 1000
    const rows: {
      ticket_id: number
      asset: string
      field: string
      department: string
      equipment_type: string | null
      equipment_name: string
      work_order_type: string | null
      ticket_status: string
      issue_date: string
      repair_date_closed: string | null
      Estimate_Cost: number | null
      repair_cost: number | null
    }[] = []

    let from = 0
    while (true) {
      let q = db
        .from('workorder_ticket_summary')
        .select('ticket_id, asset, field, department, equipment_type, equipment_name, work_order_type, ticket_status, issue_date, repair_date_closed, Estimate_Cost, repair_cost')
        .order('ticket_id', { ascending: true })
        .range(from, from + BATCH - 1)
      if (userAssets.length > 0) q = q.in('asset', userAssets)
      if (startDate) q = q.gte('issue_date', startDate)
      if (endDate) q = q.lte('issue_date', endDate + 'T23:59:59')
      const { data, error } = await q
      if (error) throw error
      rows.push(...(data || []))
      if (!data || data.length < BATCH) break
      from += BATCH
    }

    // 1. Status tables — grouped by asset + field + dept
    const nowMs = Date.now()
    const statusTableMap: Record<string, Map<string, { count: number; estCost: number; repairCost: number; ageSum: number }>> = {}
    for (const s of STATUS_ORDER) statusTableMap[s] = new Map()

    for (const r of rows) {
      const status = r.ticket_status || 'Open'
      if (!statusTableMap[status]) statusTableMap[status] = new Map()
      const key = `${r.asset || ''}||${r.field || ''}||${r.department || ''}`
      const existing = statusTableMap[status].get(key) || { count: 0, estCost: 0, repairCost: 0, ageSum: 0 }
      existing.count++
      existing.estCost += r.Estimate_Cost || 0
      existing.repairCost += r.repair_cost || 0
      if (status !== 'Closed' && r.issue_date) {
        existing.ageSum += Math.floor((nowMs - new Date(r.issue_date).getTime()) / 86_400_000)
      }
      statusTableMap[status].set(key, existing)
    }

    const statusTables: Record<string, { asset: string; field: string; dept: string; count: number; estCost: number; repairCost: number; savings: number; avgAge: number | null }[]> = {}
    for (const s of STATUS_ORDER) {
      statusTables[s] = Array.from(statusTableMap[s].entries())
        .map(([key, val]) => {
          const [asset, field, dept] = key.split('||')
          const avgAge = s === 'Closed' || val.count === 0 ? null : Math.round(val.ageSum / val.count)
          return { asset, field, dept, count: val.count, estCost: val.estCost, repairCost: val.repairCost, savings: val.estCost - val.repairCost, avgAge }
        })
        .sort((a, b) => b.count - a.count)
    }

    // 2. Field + Equipment Type + Department chart data
    const fieldEquipMap = new Map<string, number>()
    for (const r of rows) {
      const key = `${r.field || 'Unknown'}||${r.equipment_name || 'Unknown'}||${r.department || 'Unknown'}`
      fieldEquipMap.set(key, (fieldEquipMap.get(key) || 0) + 1)
    }
    const fieldEquipChart = Array.from(fieldEquipMap.entries())
      .map(([key, count]) => {
        const [field, equip, dept] = key.split('||')
        return { field, equip, dept, count }
      })
      .sort((a, b) => b.count - a.count)

    // Unique departments
    const departments = [...new Set(rows.map(r => r.department).filter(Boolean))].sort() as string[]

    // 3. Cost by Department
    const costDeptMap = new Map<string, { estCost: number; repairCost: number }>()
    for (const r of rows) {
      const dept = r.department || 'Unknown'
      const existing = costDeptMap.get(dept) || { estCost: 0, repairCost: 0 }
      existing.estCost += r.Estimate_Cost || 0
      existing.repairCost += r.repair_cost || 0
      costDeptMap.set(dept, existing)
    }
    const costByDept = Array.from(costDeptMap.entries())
      .map(([dept, val]) => ({ dept, estCost: Math.round(val.estCost), repairCost: Math.round(val.repairCost) }))
      .filter(d => d.estCost > 0 || d.repairCost > 0)
      .sort((a, b) => b.estCost - a.estCost)

    // 5. Monthly trend — build from actual data
    const monthCountMap = new Map<string, number>()
    for (const r of rows) {
      const month = (r.issue_date || '').slice(0, 7)
      if (month) monthCountMap.set(month, (monthCountMap.get(month) || 0) + 1)
    }
    const monthlyTrend = [...monthCountMap.keys()]
      .sort()
      .map(month => ({
        month,
        label: new Date(month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count: monthCountMap.get(month) || 0,
      }))

    // 6. Top Repeat Equipment
    const equipCountMap = new Map<string, number>()
    for (const r of rows) {
      const equip = r.equipment_name || 'Unknown'
      equipCountMap.set(equip, (equipCountMap.get(equip) || 0) + 1)
    }
    const topEquipment = Array.from(equipCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }))

    // 9. Work type breakdown — closed tickets only
    const workTypeMap = new Map<string, number>()
    for (const r of rows) {
      if (r.ticket_status !== 'Closed') continue
      const type = r.work_order_type || 'Unspecified'
      workTypeMap.set(type, (workTypeMap.get(type) || 0) + 1)
    }
    const workTypeBreakdown = Array.from(workTypeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)

    // 7. Cost trend by month
    const costTrendMap = new Map<string, { estCost: number; repairCost: number }>()
    for (const r of rows) {
      const month = (r.issue_date || '').slice(0, 7)
      if (!month) continue
      const existing = costTrendMap.get(month) || { estCost: 0, repairCost: 0 }
      existing.estCost += r.Estimate_Cost || 0
      existing.repairCost += r.repair_cost || 0
      costTrendMap.set(month, existing)
    }
    const costTrend = [...costTrendMap.keys()]
      .sort()
      .map(month => ({
        month,
        label: new Date(month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        estCost: Math.round(costTrendMap.get(month)?.estCost || 0),
        repairCost: Math.round(costTrendMap.get(month)?.repairCost || 0),
      }))
      .filter(m => m.estCost > 0 || m.repairCost > 0)

    // 10. Cost matrix — pre-aggregated rollup that powers the slicer-driven
    // charts (Cost by Equipment / Cost by Ticket Status). One row per unique
    // combination of (month, asset, field, ticket_status, equipment_type,
    // equipment) keeps the payload compact while letting the client slice
    // freely without a round trip.
    type MatrixRow = {
      month: string
      asset: string
      field: string
      ticket_status: string
      equipment_type: string
      equipment: string
      est_cost: number
    }
    const matrixMap = new Map<string, MatrixRow>()
    for (const r of rows) {
      const month = (r.issue_date || '').slice(0, 7)
      if (!month) continue
      const key = `${month}||${r.asset || ''}||${r.field || ''}||${r.ticket_status || ''}||${r.equipment_type || ''}||${r.equipment_name || ''}`
      const existing = matrixMap.get(key)
      const cost = r.Estimate_Cost || 0
      if (existing) {
        existing.est_cost += cost
      } else {
        matrixMap.set(key, {
          month,
          asset: r.asset || '',
          field: r.field || '',
          ticket_status: r.ticket_status || '',
          equipment_type: r.equipment_type || '',
          equipment: r.equipment_name || '',
          est_cost: cost,
        })
      }
    }
    const costMatrix = Array.from(matrixMap.values()).map(m => ({
      ...m,
      est_cost: Math.round(m.est_cost),
    }))

    return NextResponse.json(
      { statusTables, fieldEquipChart, costByDept, monthlyTrend, departments, topEquipment, equipmentList: Array.from(equipCountMap.keys()).filter(Boolean).sort(), fieldList: [...new Set(rows.map(r => r.field).filter(Boolean))].sort() as string[], costTrend, workTypeBreakdown, costMatrix },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' } }
    )
  } catch (err) {
    console.error('Analysis fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch analysis data' }, { status: 500 })
  }
}
