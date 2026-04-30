'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, ChevronDown, Camera, X } from 'lucide-react'
import Accordion from '@/components/ui/Accordion'
import LocationDropdowns from '@/components/forms/LocationDropdowns'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useAuth } from '@/components/AuthProvider'
import { formatDate, formatDateShort, DEPARTMENTS, LOCATION_TYPES, WORK_ORDER_DECISIONS, FINAL_STATUSES, PRIORITY_OPTIONS } from '@/lib/utils'
import CommentsSection from '@/components/ui/CommentsSection'
import type { LocationType } from '@/types'

type Tab = 'Summary' | 'Initial Report' | 'Dispatch' | 'Repairs / Closeout'

export default function MaintenanceTicketPage() {
  const router = useRouter()
  const { id } = useParams()
  const { userName, userEmail, role, assets: userAssets } = useAuth()
  const [tab, setTab] = useState<Tab>('Summary')
  const [expandAll, setExpandAll] = useState(false)
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [irPhotos, setIrPhotos] = useState<string[]>([])
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [deletePhotoIdx, setDeletePhotoIdx] = useState<number | null>(null)
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([])
  const [vendors, setVendors] = useState<string[]>([])
  const [equipmentTypes, setEquipmentTypes] = useState<{ id: string; equipment_type: string }[]>([])
  const [equipment, setEquipment] = useState<{ id: number; equip_name: string }[]>([])
  const [afes, setAfes] = useState<{ number: string; description: string }[]>([])
  const [afesAll, setAfesAll] = useState<{ number: string; description: string }[]>([])
  const [wellAfes, setWellAfes] = useState<{ number: string; jobCategory: string; jobTypePrimary: string }[] | null>(null)

  // Initial Report form state
  const [irForm, setIrForm] = useState<Record<string, string | boolean>>({})
  // Dispatch form state
  const [dispForm, setDispForm] = useState<Record<string, string | boolean>>({})
  // Repairs form state
  const [repForm, setRepForm] = useState<Record<string, string | boolean>>({})
  const [vendorRows, setVendorRows] = useState<{ vendor: string; cost: string; pending: boolean }[]>([{ vendor: '', cost: '', pending: false }])
  const [repairPhotos, setRepairPhotos] = useState<string[]>([])
  const [uploadingRepairPhotos, setUploadingRepairPhotos] = useState(false)
  const [deleteRepairPhotoIdx, setDeleteRepairPhotoIdx] = useState<number | null>(null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function initForms(td: any) {
    const t = td.ticket || {} as any
    setIrPhotos(Array.isArray(t.Issue_Photos) ? t.Issue_Photos : [])
    setIrForm({
      Department: t.Department || '',
      Location_Type: t.Location_Type || '',
      Asset: t.Asset || '',
      Field: t.Field || '',
      Well: t.Well || '',
      Facility: t.Facility || '',
      Area: t.Area || '',
      Route: t.Route || '',
      Equipment_Type: t.Equipment_Type || '',
      Equipment: t.Equipment || '',
      Issue_Description: t.Issue_Description || '',
      Troubleshooting_Conducted: t.Troubleshooting_Conducted || '',
      assigned_foreman: t.assigned_foreman || '',
      Self_Dispatch: !!t.Self_Dispatch_Assignee,
      Estimate_Cost: t.Estimate_Cost != null ? String(t.Estimate_Cost) : '',
    })

    const d = (td.dispatch || [])[0] || {}
    setDispForm({
      work_order_decision: d.work_order_decision || '',
      Estimate_Cost: t.Estimate_Cost != null ? String(t.Estimate_Cost) : (d.Estimate_Cost != null ? String(d.Estimate_Cost) : ''),
      assigned_foreman: d.maintenance_foreman || t.assigned_foreman || '',
      additional_assignee: d.production_foreman || '',
      date_assigned: d.date_assigned || new Date().toISOString(),
    })

    const rc = td.repairs || {}
    setRepairPhotos(Array.isArray(rc.repair_images) ? rc.repair_images : [])
    const vd = td.vendors || {}
    setRepForm({
      final_status: rc.final_status || '',
      start_date: rc.start_date || new Date().toISOString(),
      Work_Order_Type: rc.Work_Order_Type || '',
      AFE_Number: rc.AFE_Number || '',
      Job_Category: rc.Job_Category || '',
      Job_Type_Primary: rc.Job_Type_Primary || '',
      Priority_of_Issue: rc.Priority_of_Issue || 'Low',
      repair_details: rc.repair_details || '',
      date_completed: rc.date_completed || '',
    })

    const rows: { vendor: string; cost: string; pending: boolean }[] = []
    for (let i = 1; i <= 7; i++) {
      const vKey = i === 1 ? 'vendor' : `vendor_${i}`
      const cKey = i === 1 ? 'vendor_cost' : `vendor_cost_${i}`
      if (vd[vKey]) {
        const cost = vd[cKey]
        const pending = cost === null || cost === undefined || cost === 0
        rows.push({ vendor: vd[vKey] as string, cost: pending ? '' : String(cost), pending })
      }
    }
    const awaitingFinalCost = rc.final_status === 'Repaired - Awaiting Final Cost'
    if (rows.length === 0) rows.push({ vendor: '', cost: '', pending: awaitingFinalCost })
    setVendorRows(rows)
  }

  useEffect(() => {
    Promise.all([
      fetch(`/api/tickets/${id}`).then(r => r.json()),
      fetch('/api/employees').then(r => r.json()),
      fetch('/api/vendors').then(r => r.json()),
    ]).then(([ticketData, emps, vends]) => {
      setData(ticketData)
      setEmployees(emps || [])
      setVendors(vends || [])
      initForms(ticketData)
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    const locType = irForm.Location_Type as string
    if (locType) {
      fetch(`/api/equipment?type=types&locationMatch=${encodeURIComponent(locType)}`)
        .then(r => r.json()).then(setEquipmentTypes)
    }
  }, [irForm.Location_Type])

  useEffect(() => {
    const eqType = irForm.Equipment_Type as string
    const locType = irForm.Location_Type as string
    if (eqType && locType) {
      fetch(`/api/equipment?type=equipment&equipmentType=${encodeURIComponent(eqType)}&locationMatch=${locType}`)
        .then(r => r.json()).then(setEquipment)
    }
  }, [irForm.Equipment_Type, irForm.Location_Type])

  useEffect(() => {
    const wot = String(repForm.Work_Order_Type || '')
    if (wot.startsWith('AFE') && afes.length === 0) {
      fetch('/api/afe').then(r => r.json()).then(data => {
        if (Array.isArray(data)) setAfes(data)
      }).catch(() => {})
    }
  }, [repForm.Work_Order_Type, afes.length])

  useEffect(() => {
    const wot = String(repForm.Work_Order_Type || '')
    const unitId = (data?.ticket as Record<string, unknown> | undefined)?.Well_UNITID as string | undefined
    if (!wot.startsWith('AFE') || !unitId) return
    if (wellAfes === null) {
      fetch(`/api/wells/${encodeURIComponent(unitId)}/afes`)
        .then(r => r.json())
        .then(d => { if (Array.isArray(d)) setWellAfes(d) })
        .catch(() => {})
    }
    if (afesAll.length === 0) {
      fetch('/api/afe?scope=all')
        .then(r => r.json())
        .then(d => { if (Array.isArray(d)) setAfesAll(d) })
        .catch(() => {})
    }
  }, [repForm.Work_Order_Type, data, wellAfes, afesAll.length])

  // When Final Status switches to Awaiting Final Cost, default empty-cost vendor rows to pending
  useEffect(() => {
    if (repForm.final_status !== 'Repaired - Awaiting Final Cost') return
    setVendorRows(rows => rows.map(r => (!r.cost && !r.pending ? { ...r, pending: true } : r)))
  }, [repForm.final_status])

  // When the user checks Cost pending on any vendor row, flip Final Status to Awaiting Final Cost
  useEffect(() => {
    const hasPending = vendorRows.some(r => r.vendor && r.pending)
    if (hasPending && repForm.final_status !== 'Repaired - Awaiting Final Cost') {
      setRep('final_status', 'Repaired - Awaiting Final Cost')
    }
  }, [vendorRows, repForm.final_status])

  // Auto-fill Job_Category and Job_Type_Primary when wellAfes lands and AFE_Number is set
  useEffect(() => {
    if (!wellAfes) return
    const afeNumber = String(repForm.AFE_Number || '')
    if (!afeNumber) return
    const match = wellAfes.find(w => w.number === afeNumber)
    if (!match) return
    if (!repForm.Job_Category && match.jobCategory) setRep('Job_Category', match.jobCategory)
    if (!repForm.Job_Type_Primary && match.jobTypePrimary) setRep('Job_Type_Primary', match.jobTypePrimary)
  }, [wellAfes, repForm.AFE_Number, repForm.Job_Category, repForm.Job_Type_Primary])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-sm text-gray-400">Loading…</div>
    </div>
  )

  const ticket = (data?.ticket || {}) as Record<string, unknown>
  const dispatch = ((data?.dispatch || []) as Record<string, unknown>[])[0] || {}

  const isSelfDispatchedByMe = !!(
    ticket.Self_Dispatch_Assignee &&
    String(ticket.Self_Dispatch_Assignee).toLowerCase() === (userName || '').toLowerCase()
  )
  const ticketAsset = ticket.Asset as string
  const isInMyAsset = userAssets.length === 0 || userAssets.includes(ticketAsset)
  const isReadOnly =
    role === 'analyst' ? true :
    role === 'admin' ? false :
    role === 'foreman' ? !isInMyAsset :
    !isSelfDispatchedByMe // field_user default
  const repairs = (data?.repairs || {}) as Record<string, unknown>
  const vendorData = (data?.vendors || {}) as Record<string, unknown>
  const comments = (data?.comments || []) as Record<string, unknown>[]



  const setIr = (k: string, v: string | boolean) => setIrForm(f => ({ ...f, [k]: v }))
  const setDisp = (k: string, v: string | boolean) => setDispForm(f => ({ ...f, [k]: v }))
  const setRep = (k: string, v: string | boolean) => setRepForm(f => ({ ...f, [k]: v }))

  async function saveInitialReport() {
    setSaving(true)
    try {
      await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Department: irForm.Department,
          Location_Type: irForm.Location_Type,
          Asset: irForm.Asset, Field: irForm.Field,
          Well: irForm.Well || null, Facility: irForm.Facility || null,
          Area: irForm.Area, Route: irForm.Route,
          Equipment_Type: irForm.Equipment_Type,
          Equipment: irForm.Equipment,
          Issue_Description: irForm.Issue_Description,
          Troubleshooting_Conducted: irForm.Troubleshooting_Conducted,
          assigned_foreman: irForm.assigned_foreman,
          Estimate_Cost: irForm.Estimate_Cost ? parseFloat(irForm.Estimate_Cost as string) : null,
          Issue_Photos: irPhotos,
        }),
      })
      await refreshData()
      toast.success('Initial report updated.', { duration: 5000 })
    } finally { setSaving(false) }
  }

  async function saveDispatch() {
    setSaving(true)
    try {
      await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: id,
          work_order_decision: dispForm.work_order_decision,
          Estimate_Cost: dispForm.Estimate_Cost,
          maintenance_foreman: dispForm.assigned_foreman,
          production_foreman: dispForm.additional_assignee || null,
          date_assigned: dispForm.date_assigned,
          current_user_email: userEmail,
        }),
      })
      const decision = String(dispForm.work_order_decision || '')
      const isBacklog = decision.toLowerCase().startsWith('backlog')
      const hdr = ((data?.ticket as Record<string, unknown>)?.Well || (data?.ticket as Record<string, unknown>)?.Facility || `Ticket #${id}`) as string
      if (isBacklog) {
        toast.warning(`${hdr} is Backlogged • #${id} • ${decision}`, { duration: 5000 })
      } else {
        toast.success(`${hdr} - Dispatched`, { duration: 5000 })
      }
      router.push('/maintenance')
    } finally { setSaving(false) }
  }

  async function refreshData() {
    const res = await fetch(`/api/tickets/${id}`)
    const updated = await res.json()
    setData(updated)
    initForms(updated)
  }

  const AUTO_COMPLETE_STATUSES = [
    'Repaired - Returned to Service',
    'No Action - Returned to Service',
    'Repaired - Awaiting Final Cost',
    'Decommissioned / Retired',
  ]

  async function saveRepairs() {
    setSaving(true)
    const filledVendors = vendorRows.filter(r => r.vendor)
    const hasPendingCost = filledVendors.some(r => r.pending || !r.cost)
    const effectiveFinalStatus = hasPendingCost ? 'Repaired - Awaiting Final Cost' : repForm.final_status as string
    if (hasPendingCost && repForm.final_status !== 'Repaired - Awaiting Final Cost') {
      setRepForm(f => ({ ...f, final_status: 'Repaired - Awaiting Final Cost' }))
    }
    const autoDateCompleted =
      AUTO_COMPLETE_STATUSES.includes(effectiveFinalStatus) && !repForm.date_completed
        ? new Date().toISOString()
        : repForm.date_completed || null
    try {
      const res = await fetch('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: id,
          ...repForm,
          final_status: effectiveFinalStatus,
          date_completed: autoDateCompleted,
          repair_images: repairPhotos,
          vendors: filledVendors.map(r => ({ vendor: r.vendor, cost: (r.pending || !r.cost) ? null : parseFloat(r.cost) })),
          created_by: userName,
          current_user_email: userEmail,
          assigned_foreman: dispatch.maintenance_foreman || dispatch.production_foreman || null,
          production_foreman: dispatch.production_foreman || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(`Failed to save: ${body.error || res.statusText}`, { duration: 8000 })
        return
      }
      const hdr = ((data?.ticket as Record<string, unknown>)?.Well || (data?.ticket as Record<string, unknown>)?.Facility || `Ticket #${id}`) as string
      const CLOSED_STATUSES = new Set(['Repaired - Returned to Service', 'No Action - Returned to Service', 'Decommissioned / Retired'])
      if (effectiveFinalStatus === 'Repaired - Awaiting Final Cost') {
        toast.info(`${hdr} - Awaiting Cost`, { duration: 5000 })
      } else if (CLOSED_STATUSES.has(effectiveFinalStatus)) {
        toast.success(`${hdr} is Closed`, { duration: 5000 })
      } else if (effectiveFinalStatus.toLowerCase().startsWith('backlog')) {
        toast.warning(`${hdr} is Backlogged`, { duration: 5000 })
      } else {
        toast.success(`${hdr} - Updated`, { duration: 5000 })
      }
      router.push('/maintenance')
    } finally { setSaving(false) }
  }

  const TABS: Tab[] = ['Summary', 'Initial Report', 'Dispatch', 'Repairs / Closeout']

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="page-header">
        <button onClick={() => router.back()} className="p-1 -ml-1">
          <ArrowLeft size={20} className="text-gray-700" />
        </button>
        <h1 className="page-title">Maintenance Ticket #{id}</h1>
      </div>

      {/* Workflow tabs */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 lg:px-32">
        <p className="text-xs text-gray-500 mb-2">Maintenance Workflow Selection</p>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {TABS.filter(t => {
            if (t !== 'Repairs / Closeout') return true
            const status = (ticket.Ticket_Status as string ?? '').toLowerCase()
            const hasEstCost = (ticket.Estimate_Cost != null && ticket.Estimate_Cost !== '') || (dispatch.Estimate_Cost != null && dispatch.Estimate_Cost !== '')
            return ['in progress', 'closed', 'backlogged', 'awaiting cost'].includes(status) && hasEstCost
          }).map(t => (
            <button
              key={t}
              onClick={() => {
                if (t === tab) return
                if (data) initForms(data)
                setTab(t)
              }}
              className={`workflow-tab ${tab === t ? 'active' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
        {(() => {
          const status = (ticket.Ticket_Status as string ?? '').toLowerCase()
          const eligibleStatus = ['in progress', 'closed', 'backlogged', 'awaiting cost'].includes(status)
          const hasEstCost = (ticket.Estimate_Cost != null && ticket.Estimate_Cost !== '') || (dispatch.Estimate_Cost != null && dispatch.Estimate_Cost !== '')
          if (status === 'open') return (
            <p className="text-xs text-blue-600 mt-2">
              Ticket must be dispatched to view the Repairs / Closeout tab.
            </p>
          )
          if (eligibleStatus && !hasEstCost) return (
            <p className="text-xs text-amber-600 mt-2">
              Add an Estimated Cost in the Dispatch tab to unlock the Repairs / Closeout tab.
            </p>
          )
          return null
        })()}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-32">

        {/* ======== SUMMARY TAB ======== */}
        {tab === 'Summary' && (
          <div className="space-y-4">
            {/* Ticket header info */}
            <div>
              <p className="text-xs text-gray-500 mb-0.5">{ticket.Department as string}</p>
              <h2 className="text-xl font-bold text-gray-900">{(ticket.Well || ticket.Facility) as string}</h2>
              <p className="text-sm text-gray-500">{formatDate(ticket.Issue_Date as string)}</p>
            </div>

            {/* Issue photo */}
            {Array.isArray(ticket.Issue_Photos) && ticket.Issue_Photos.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 text-center mb-1">Click to view</p>
                <div
                  className="w-full h-52 rounded-xl overflow-hidden cursor-pointer"
                  onClick={() => router.push(`/maintenance/${id}/issue-photos`)}
                >
                  <img src={(ticket.Issue_Photos as string[])[0]} alt="Issue" className="w-full h-full object-cover" />
                </div>
              </div>
            )}

            {/* Expand All toggle */}
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setExpandAll(v => !v)}
                className="text-xs font-medium text-[#1B2E6B] underline underline-offset-2"
              >
                {expandAll ? 'Collapse All' : 'Expand All'}
              </button>
            </div>

            {/* Accordion sections */}
            <Accordion title="Maintenance Location Details" forceOpen={expandAll}>
              <div>
                {[
                  ['Submission Date', formatDate(ticket.Issue_Date as string)],
                  ['Submitted by', ticket.Created_by_Name],
                  ['Asset', ticket.Asset],
                  ['Area', ticket.Area],
                  ['Field', ticket.Field],
                  ['Route', ticket.Route],
                  ['Location Type', ticket.Location_Type],
                  ticket.Location_Type === 'Well' ? ['Well', ticket.Well] : ['Facility', ticket.Facility],
                ].map(([label, value]) => (
                  <div key={label as string} className="detail-row">
                    <span className="detail-label">{label as string}</span>
                    <span className="detail-value">{(value || '—') as string}</span>
                  </div>
                ))}
              </div>
            </Accordion>

            <Accordion title="Equipment Details" forceOpen={expandAll}>
              <div>
                {[
                  ['Equipment Type', ticket.Equipment_Type],
                  ['Equipment', ticket.Equipment],
                ].map(([label, value]) => (
                  <div key={label as string} className="detail-row">
                    <span className="detail-label">{label as string}</span>
                    <span className="detail-value">{(value || '—') as string}</span>
                  </div>
                ))}
              </div>
            </Accordion>

            <Accordion title="Issue Details" forceOpen={expandAll}>
              <div>
                {[
                  ['Department', ticket.Department],
                  ['Issue Description', ticket.Issue_Description],
                  ['Troubleshooting Conducted', ticket.Troubleshooting_Conducted],
                ].map(([label, value]) => (
                  <div key={label as string} className="detail-row">
                    <span className="detail-label">{label as string}</span>
                    <span className="detail-value">{(value || '—') as string}</span>
                  </div>
                ))}
              </div>
            </Accordion>

            {!!dispatch.ticket_id && <Accordion title="Dispatch Details" forceOpen={expandAll}>
              <div>
                {[
                  ['Work Order Decision', dispatch.work_order_decision],
                  ['Estimated Cost', (dispatch.Estimate_Cost ?? ticket.Estimate_Cost) != null ? `$${dispatch.Estimate_Cost ?? ticket.Estimate_Cost}` : null],
                  ...(dispatch.self_dispatch_assignee ? [['Self Dispatch Assignee', dispatch.self_dispatch_assignee]] : []),
                  ...(!dispatch.self_dispatch_assignee ? [['Assigned Foreman', dispatch.maintenance_foreman]] : []),
                  ...(!dispatch.self_dispatch_assignee && dispatch.production_foreman && dispatch.maintenance_foreman ? [['Additional Assignee', dispatch.production_foreman]] : []),
                  ['Date Assigned', formatDate(dispatch.date_assigned as string)],
                ].map(([label, value]) => (
                  <div key={label as string} className="detail-row">
                    <span className="detail-label">{label as string}</span>
                    <span className="detail-value">{(value || '—') as string}</span>
                  </div>
                ))}
              </div>
            </Accordion>}

            {!!repairs.ticket_id && <Accordion title="Repairs / Closeout Details" forceOpen={expandAll}>
              <div>
                {!!(repairs.repair_images && (repairs.repair_images as string[]).length > 0) && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-400 text-center mb-1">Click to view</p>
                    <div
                      className="w-full h-48 rounded-xl overflow-hidden cursor-pointer"
                      onClick={() => router.push(`/maintenance/${id}/repair-images`)}
                    >
                      <img src={(repairs.repair_images as string[])[0]} alt="Repair" className="w-full h-full object-cover" />
                    </div>
                  </div>
                )}
                {[
                  ['Final Status', repairs.final_status],
                  ['Start Date', formatDateShort(repairs.start_date as string)],
                  ['Work Order Type', repairs.Work_Order_Type],
                  ...(String(repairs.Work_Order_Type || '').startsWith('AFE')
                    ? [
                        ['AFE Number', repairs.AFE_Number] as [string, unknown],
                        ['Job Category', repairs.Job_Category] as [string, unknown],
                        ['Job Type Primary', repairs.Job_Type_Primary] as [string, unknown],
                      ]
                    : []),
                  ['Priority of Issue', repairs.Priority_of_Issue],
                  ['Repair Details', repairs.repair_details],
                ].map(([label, value]) => (
                  <div key={label as string} className="detail-row">
                    <span className="detail-label">{label as string}</span>
                    <span className="detail-value">{(value || '—') as string}</span>
                  </div>
                ))}
                {(() => {
                  const pairs: [string, string][] = [
                    ['vendor', 'vendor_cost'],
                    ['vendor_2', 'vendor_cost_2'],
                    ['vendor_3', 'vendor_cost_3'],
                    ['vendor_4', 'vendor_cost_4'],
                    ['vendor_5', 'vendor_cost_5'],
                    ['vendor_6', 'vendor_cost_6'],
                    ['vendor_7', 'vendor_cost_7'],
                  ]
                  const rows = pairs.filter(([vk]) => vendorData[vk])
                  if (rows.length === 0) return (
                    <div className="detail-row">
                      <span className="detail-label">Vendor</span>
                      <span className="detail-value">—</span>
                    </div>
                  )
                  return rows.map(([vk, ck], i) => (
                    <div key={vk} className="detail-row">
                      <span className="detail-label">{i === 0 ? 'Vendor' : `Vendor ${i + 1}`}</span>
                      <span className="detail-value">
                        {vendorData[vk] as string}
                        {rows.length > 1 && vendorData[ck] ? ` — $${vendorData[ck]}` : ''}
                      </span>
                    </div>
                  ))
                })()}
                {[
                  ['Total Repair Cost', vendorData.total_cost ? `$${vendorData.total_cost}` : repairs.total_repair_cost ? `$${repairs.total_repair_cost}` : '—'],
                  ['Date Completed', repairs.date_completed ? formatDateShort(repairs.date_completed as string) : '—'],
                ].map(([label, value]) => (
                  <div key={label as string} className="detail-row">
                    <span className="detail-label">{label as string}</span>
                    <span className="detail-value">{(value || '—') as string}</span>
                  </div>
                ))}
              </div>
            </Accordion>}
          </div>
        )}

        {/* ======== INITIAL REPORT TAB ======== */}
        {tab === 'Initial Report' && (
          <div className="space-y-5">
            <h2 className="text-xl font-bold text-gray-900 text-center">Submission Details</h2>

            {/* Department */}
            <div>
              <label className="form-label">Department</label>
              <div className="relative">
                <select className="form-select" value={irForm.Department as string} onChange={e => setIr('Department', e.target.value)} disabled={isReadOnly}>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Location Type */}
            <div>
              <label className="form-label">Location Type</label>
              <div className="relative">
                <select
                  className="form-select"
                  value={irForm.Location_Type as string}
                  onChange={e => { setIr('Location_Type', e.target.value); setIr('Well', ''); setIr('Facility', '') }}
                  disabled={isReadOnly}
                >
                  {LOCATION_TYPES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {irForm.Location_Type && (
              <LocationDropdowns
                locationType={irForm.Location_Type as LocationType}
                initialValues={{
                  asset: irForm.Asset as string,
                  field: irForm.Field as string,
                  well: irForm.Well as string,
                  facility: irForm.Facility as string,
                }}
                disabled={isReadOnly}
                onChange={({ asset, field, well, facility, area, route }) => {
                  setIrForm(f => ({ ...f, Asset: asset, Field: field, Well: well, Facility: facility, Area: area, Route: route }))
                }}
              />
            )}

            {/* Problem Equipment */}
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">Problem Equipment</h3>
              <div className="space-y-4">
                <div>
                  <label className="form-label">Select an Equipment Type</label>
                  <div className="relative">
                    <select className="form-select" value={irForm.Equipment_Type as string} onChange={e => { setIr('Equipment_Type', e.target.value); setIr('Equipment', '') }} disabled={isReadOnly}>
                      <option value="">Select Equipment Type</option>
                      {equipmentTypes.map(et => <option key={et.id} value={et.equipment_type}>{et.equipment_type}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="form-label">Equipment</label>
                  <div className="relative">
                    <select className="form-select" value={irForm.Equipment as string} onChange={e => setIr('Equipment', e.target.value)} disabled={isReadOnly}>
                      <option value="">Select Equipment</option>
                      {equipment.map(eq => <option key={eq.id} value={eq.equip_name}>{eq.equip_name}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* Issue Details */}
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">Issue Details</h3>
              <div className="space-y-4">
                <div>
                  <label className="form-label">Issue Description / Scope & Cost</label>
                  <textarea className="form-textarea" value={irForm.Issue_Description as string} onChange={e => setIr('Issue_Description', e.target.value)} disabled={isReadOnly} />
                </div>
                <div>
                  <label className="form-label">Troubleshooting Conducted</label>
                  <textarea className="form-textarea" placeholder="Detail anything you have done to repair or restart the equipment and if it was successful or not" value={irForm.Troubleshooting_Conducted as string} onChange={e => setIr('Troubleshooting_Conducted', e.target.value)} disabled={isReadOnly} />
                </div>
                {ticket.Self_Dispatch_Assignee ? (
                  <div>
                    <label className="form-label">Self Dispatch Assignee</label>
                    <input
                      type="text"
                      className="form-input opacity-60 cursor-not-allowed"
                      disabled
                      value={String(ticket.Self_Dispatch_Assignee).trim().split(/\s+/).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(' ')}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="form-label">Initial Assigned Foreman</label>
                    <div className="relative">
                      <select className="form-select" value={irForm.assigned_foreman as string} disabled>
                        <option value="">Select Foreman</option>
                        {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                      </select>
                      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                )}
                {/* Issue Photos */}
                <div>
                  <label className="form-label">Issue Photos</label>
                  <div
                    className={`form-input flex items-center justify-between ${isReadOnly ? 'opacity-50 cursor-not-allowed pointer-events-none' : `cursor-pointer ${uploadingPhotos ? 'opacity-50 pointer-events-none' : ''}`}`}
                    onClick={() => !isReadOnly && document.getElementById('ir-photo-input')?.click()}
                  >
                    <span className="text-gray-400">{uploadingPhotos ? 'Uploading…' : 'Attach an image'}</span>
                    <Camera size={20} className="text-gray-400" />
                  </div>
                  <input
                    id="ir-photo-input"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || [])
                      if (!files.length) return
                      setUploadingPhotos(true)
                      try {
                        const urls = await Promise.all(files.map(async (file) => {
                          const fd = new FormData()
                          fd.append('file', file)
                          const res = await fetch('/api/upload', { method: 'POST', body: fd })
                          if (!res.ok) throw new Error('Upload failed')
                          const { url } = await res.json()
                          return url as string
                        }))
                        setIrPhotos(prev => [...prev, ...urls])
                      } catch {
                        toast.error('Failed to upload photo. Please try again.')
                      } finally {
                        setUploadingPhotos(false)
                      }
                    }}
                  />
                  {irPhotos.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {irPhotos.map((url, i) => (
                        <div key={i} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt="Issue photo"
                            className="w-20 h-20 object-cover rounded-lg cursor-pointer"
                            onClick={() => setPreviewUrl(url)}
                          />
                          <button
                            type="button"
                            onClick={() => !isReadOnly && setDeletePhotoIdx(i)}
                            disabled={isReadOnly}
                            className="absolute -top-1.5 -right-1.5 bg-gray-900 text-white rounded-full w-5 h-5 flex items-center justify-center shadow"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <label className="form-label mb-0">Self Dispatch?</label>
                  <button
                    type="button"
                    disabled
                    className={`w-12 h-6 rounded-full transition-colors opacity-60 cursor-not-allowed ${irForm.Self_Dispatch ? 'bg-[#1B2E6B]' : 'bg-gray-300'}`}
                  >
                    <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${irForm.Self_Dispatch ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>

                {irForm.Self_Dispatch && (
                  <div>
                    <label className="form-label">Estimated Cost</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="form-input pl-7"
                        placeholder="Enter Value"
                        value={irForm.Estimate_Cost as string}
                        onChange={e => {
                          const val = e.target.value
                          if (val === '' || /^\d*\.?\d*$/.test(val)) setIr('Estimate_Cost', val)
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!isReadOnly && (
              <button className="btn-primary" onClick={saveInitialReport} disabled={saving}>
                {saving ? 'Updating…' : 'Update'}
              </button>
            )}
          </div>
        )}

        {/* Delete photo confirmation modal */}
        {deletePhotoIdx !== null && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-3">
              <h3 className="text-lg font-bold text-gray-900">Delete Photo?</h3>
              <p className="text-sm text-gray-500">This action cannot be undone.</p>
              <button
                type="button"
                className="w-full py-3 rounded-xl bg-gray-900 text-white font-semibold"
                onClick={async () => {
                  const url = irPhotos[deletePhotoIdx!]
                  const updated = irPhotos.filter((_, j) => j !== deletePhotoIdx)
                  setIrPhotos(updated)
                  setDeletePhotoIdx(null)
                  await fetch('/api/upload', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url }),
                  }).catch(err => console.error('Storage delete failed:', err))
                  await fetch(`/api/tickets/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ Issue_Photos: updated }),
                  }).catch(err => console.error('Issue photos update failed:', err))
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="w-full py-3 rounded-xl border border-gray-200 text-gray-700 font-semibold"
                onClick={() => setDeletePhotoIdx(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Repair photo delete confirmation modal */}
        {deleteRepairPhotoIdx !== null && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-3">
              <h3 className="text-lg font-bold text-gray-900">Delete Photo?</h3>
              <p className="text-sm text-gray-500">This action cannot be undone.</p>
              <button
                type="button"
                className="w-full py-3 rounded-xl bg-gray-900 text-white font-semibold"
                onClick={async () => {
                  const url = repairPhotos[deleteRepairPhotoIdx!]
                  const updated = repairPhotos.filter((_, j) => j !== deleteRepairPhotoIdx)
                  setRepairPhotos(updated)
                  setDeleteRepairPhotoIdx(null)
                  await fetch('/api/upload', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url }),
                  }).catch(err => console.error('Storage delete failed:', err))
                  await fetch('/api/repairs', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ticket_id: id, repair_images: updated }),
                  }).catch(err => console.error('Repair images update failed:', err))
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="w-full py-3 rounded-xl border border-gray-200 text-gray-700 font-semibold"
                onClick={() => setDeleteRepairPhotoIdx(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Full-screen photo preview modal */}
        {previewUrl && (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setPreviewUrl(null)}
          >
            <button
              type="button"
              className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-1"
              onClick={() => setPreviewUrl(null)}
            >
              <X size={24} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Preview"
              className="max-w-full max-h-full rounded-lg object-contain"
              onClick={e => e.stopPropagation()}
            />
          </div>
        )}

        {/* ======== DISPATCH TAB ======== */}
        {tab === 'Dispatch' && (
          <div className="space-y-5">
            <div>
              <p className="text-xs text-gray-500">{ticket.Department as string}</p>
              <h2 className="text-xl font-bold text-gray-900">{(ticket.Well || ticket.Facility) as string}</h2>
              <p className="text-sm text-gray-500">{formatDate(ticket.Issue_Date as string)}</p>
            </div>

            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Task Assignment</h3>
              <div className="space-y-4">
                <div>
                  <label className="form-label form-label-required">Work Order Decision</label>
                  <div className="relative">
                    <select className="form-select" value={dispForm.work_order_decision as string} onChange={e => setDisp('work_order_decision', e.target.value)} disabled={isReadOnly}>
                      <option value="">Select Decision</option>
                      {WORK_ORDER_DECISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="form-label form-label-required">Estimated Cost</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input type="text" inputMode="decimal" className={`form-input pl-8 ${!dispForm.Estimate_Cost && !isReadOnly ? 'border-red-400 ring-1 ring-red-400' : ''}`} placeholder="Enter amount" value={dispForm.Estimate_Cost as string} onChange={e => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setDisp('Estimate_Cost', v) }} disabled={isReadOnly} />
                  </div>
                </div>

                {!!ticket.Self_Dispatch_Assignee && (
                  <div>
                    <label className="form-label">Self Dispatch Assignee</label>
                    <input
                      type="text"
                      className="form-input opacity-60 cursor-not-allowed"
                      disabled
                      value={String(ticket.Self_Dispatch_Assignee).trim().split(/\s+/).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(' ')}
                    />
                  </div>
                )}

                {dispForm.work_order_decision !== 'Backlog - Uneconomic / Awaiting Part' && !ticket.Self_Dispatch_Assignee && (
                  <>
                    <div>
                      <label className="form-label">Assigned Foreman</label>
                      <div className="relative">
                        <select className="form-select" value={dispForm.assigned_foreman as string} onChange={e => setDisp('assigned_foreman', e.target.value)} disabled={isReadOnly}>
                          <option value="">Select Foreman</option>
                          {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                        </select>
                        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    </div>

                    <div>
                      <label className="form-label">Additional Assignee</label>
                      <div className="relative">
                        <select className="form-select" value={dispForm.additional_assignee as string} onChange={e => setDisp('additional_assignee', e.target.value)} disabled={isReadOnly}>
                          <option value="">Select Employee</option>
                          {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                        </select>
                        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                  </>
                )}

                {dispForm.work_order_decision !== 'Backlog - Uneconomic / Awaiting Part' && (
                  <div>
                    <label className="form-label">Date Assigned</label>
                    <div className="relative">
                      <input
                        type="datetime-local"
                        className="form-input"
                        value={dispForm.date_assigned ? (dispForm.date_assigned as string).slice(0, 16) : ''}
                        onChange={e => setDisp('date_assigned', e.target.value)}
                        disabled={isReadOnly}
                      />
                    </div>
                  </div>
                )}

                {!isReadOnly && (
                  <button
                    className="btn-primary"
                    onClick={saveDispatch}
                    disabled={saving || !dispForm.work_order_decision || (dispForm.work_order_decision !== 'Backlog - Uneconomic / Awaiting Part' && dispForm.Estimate_Cost === '')}
                  >
                    {saving ? 'Dispatching…' : 'Dispatch'}
                  </button>
                )}
              </div>
            </div>

            <CommentsSection
              comments={comments as never}
              ticketId={id}
              userName={userName || ''}
              userEmail={userEmail || ''}
              onRefresh={refreshData}
            />
          </div>
        )}

        {/* ======== REPAIRS / CLOSEOUT TAB ======== */}
        {tab === 'Repairs / Closeout' && (
          <div className="space-y-5">
            <div>
              <p className="text-xs text-gray-500">{ticket.Department as string}</p>
              <h2 className="text-xl font-bold text-gray-900">{(ticket.Well || ticket.Facility) as string}</h2>
              <p className="text-sm text-gray-500">{formatDate(ticket.Issue_Date as string)}</p>
            </div>

            <div className="border-t border-gray-200 pt-4 space-y-4">
              <h3 className="text-lg font-bold text-gray-900">Final Status and Closeout</h3>
              <div>
                <label className="form-label form-label-required">Final Status</label>
                <div className="relative">
                  <select className="form-select" value={repForm.final_status as string} onChange={e => setRep('final_status', e.target.value)} disabled={isReadOnly}>
                    <option value="">Select a status</option>
                    {FINAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-bold text-gray-900">Repairs</h3>

              <div>
                <label className="form-label">Start Date</label>
                <input type="datetime-local" className="form-input" value={repForm.start_date ? (repForm.start_date as string).slice(0, 16) : ''} onChange={e => setRep('start_date', e.target.value)} disabled={isReadOnly} />
              </div>

              <div>
                <label className="form-label form-label-required">Work Order Type</label>
                <div className="relative">
                  <select className="form-select" value={repForm.Work_Order_Type as string} onChange={e => {
                    setRep('Work_Order_Type', e.target.value)
                    if (!e.target.value.startsWith('AFE')) {
                      setRep('AFE_Number', '')
                      setRep('Job_Category', '')
                      setRep('Job_Type_Primary', '')
                    }
                  }} disabled={isReadOnly}>
                    <option value="">Select Work Order Type</option>
                    {['AFE - Workover', 'AFE - Capital', 'LOE'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {String(repForm.Work_Order_Type || '').startsWith('AFE') && (() => {
                const unitId = ticket.Well_UNITID as string | undefined
                const wellAfeNumbers = wellAfes?.map(w => w.number) ?? null
                const wellScopeLoading = !!unitId && (wellAfes === null || afesAll.length === 0)
                const scoped = !!unitId && wellAfeNumbers !== null && wellAfeNumbers.length > 0
                const visibleAfes = wellScopeLoading
                  ? []
                  : scoped
                    ? afesAll.filter(a => wellAfeNumbers!.includes(a.number))
                    : afes
                const afeOptions = visibleAfes.map(a => `${a.number} — ${a.description}`)
                const currentNumber = String(repForm.AFE_Number || '')
                const match = [...afes, ...afesAll].find(a => a.number === currentNumber)
                const currentLabel = match ? `${match.number} — ${match.description}` : currentNumber
                const loading = wellScopeLoading || (scoped ? afesAll.length === 0 : afes.length === 0)
                const jobCategory = String(repForm.Job_Category || '')
                const jobTypePrimary = String(repForm.Job_Type_Primary || '')
                return (
                  <>
                    <div>
                      <label className="form-label form-label-required">AFE Number</label>
                      <SearchableSelect
                        value={currentLabel}
                        options={afeOptions}
                        placeholder={loading ? 'Loading AFEs…' : 'Select AFE'}
                        onChange={v => {
                          const picked = v.split(' — ')[0] || ''
                          setRep('AFE_Number', picked)
                          const w = wellAfes?.find(w => w.number === picked)
                          setRep('Job_Category', w?.jobCategory ?? '')
                          setRep('Job_Type_Primary', w?.jobTypePrimary ?? '')
                        }}
                        disabled={isReadOnly || loading}
                      />
                      {scoped && (
                        <p className="text-xs text-gray-500 mt-1">
                          Showing {visibleAfes.length} AFE{visibleAfes.length === 1 ? '' : 's'} tied to this well
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="form-label">Job Category</label>
                      <input
                        type="text"
                        className="form-input"
                        value={jobCategory}
                        placeholder={currentNumber ? '—' : 'Select an AFE first'}
                        readOnly
                        disabled
                      />
                    </div>
                    <div>
                      <label className="form-label">Job Type Primary</label>
                      <input
                        type="text"
                        className="form-input"
                        value={jobTypePrimary}
                        placeholder={currentNumber ? '—' : 'Select an AFE first'}
                        readOnly
                        disabled
                      />
                    </div>
                  </>
                )
              })()}

              {/* Priority pill selector */}
              <div>
                <label className="form-label">Priority of Issue</label>
                <div className="grid grid-cols-4 gap-1 sm:gap-1.5 p-1 sm:p-1.5 bg-gray-100 rounded-xl">
                  {PRIORITY_OPTIONS.map(p => {
                    const selected = repForm.Priority_of_Issue === p
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setRep('Priority_of_Issue', p)}
                        disabled={isReadOnly}
                        className={`px-1 sm:px-3 py-2 sm:py-2.5 rounded-lg text-[10px] sm:text-sm font-medium whitespace-nowrap transition-all ${
                          selected
                            ? 'bg-[#1B2E6B] text-white shadow-sm'
                            : 'text-gray-700 hover:bg-white/70'
                        } ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {p}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="form-label form-label-required">Repair Details</label>
                <textarea className="form-textarea" placeholder="Enter details" value={repForm.repair_details as string} onChange={e => setRep('repair_details', e.target.value)} disabled={isReadOnly} />
              </div>

              {/* Repair Images */}
              <div>
                <label className="form-label">Repair Images</label>
                <div
                  className={`form-input flex items-center justify-between ${isReadOnly ? 'opacity-50 cursor-not-allowed pointer-events-none' : `cursor-pointer ${uploadingRepairPhotos ? 'opacity-50 pointer-events-none' : ''}`}`}
                  onClick={() => !isReadOnly && document.getElementById('repair-photo-input')?.click()}
                >
                  <span className="text-gray-400">{uploadingRepairPhotos ? 'Uploading…' : 'Attach an image'}</span>
                  <Camera size={20} className="text-gray-400" />
                </div>
                <input
                  id="repair-photo-input"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || [])
                    if (!files.length) return
                    setUploadingRepairPhotos(true)
                    try {
                      const urls = await Promise.all(files.map(async (file) => {
                        const fd = new FormData()
                        fd.append('file', file)
                        const res = await fetch('/api/upload', { method: 'POST', body: fd })
                        if (!res.ok) throw new Error('Upload failed')
                        const { url } = await res.json()
                        return url as string
                      }))
                      setRepairPhotos(prev => [...prev, ...urls])
                    } catch {
                      toast.error('Failed to upload photo. Please try again.')
                    } finally {
                      setUploadingRepairPhotos(false)
                    }
                  }}
                />
                {repairPhotos.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {repairPhotos.map((url, i) => (
                      <div key={i} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt="Repair photo"
                          className="w-20 h-20 object-cover rounded-lg cursor-pointer"
                          onClick={() => setPreviewUrl(url)}
                        />
                        <button
                          type="button"
                          onClick={() => !isReadOnly && setDeleteRepairPhotoIdx(i)}
                          disabled={isReadOnly}
                          className="absolute -top-1.5 -right-1.5 bg-gray-900 text-white rounded-full w-5 h-5 flex items-center justify-center shadow"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Vendor rows */}
              {vendorRows.map((row, i) => (
                <div key={i} className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label text-xs">
                        {i === 0 ? 'Vendor (leave blank if not applicable)' : `Vendor ${i + 1}`}
                      </label>
                      <SearchableSelect
                        value={row.vendor}
                        options={row.vendor && !vendors.includes(row.vendor) ? [row.vendor, ...vendors] : vendors}
                        placeholder="Select Vendor"
                        disabled={isReadOnly}
                        onChange={v => {
                          const rows = [...vendorRows]
                          rows[i] = { ...rows[i], vendor: v }
                          setVendorRows(rows)
                        }}
                      />
                    </div>
                    <div>
                      <label className="form-label text-xs">{i === 0 ? 'Repair Cost*' : 'Repair Cost'}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="form-input pl-7 text-sm"
                          placeholder={row.pending ? 'Pending…' : 'Enter Value'}
                          value={row.cost}
                          disabled={isReadOnly || row.pending}
                          onChange={e => {
                            const val = e.target.value
                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                              const rows = [...vendorRows]
                              rows[i] = { ...rows[i], cost: val }
                              setVendorRows(rows)
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  {!isReadOnly && row.vendor && (
                    <label className="flex items-center gap-2 cursor-pointer w-fit">
                      <input
                        type="checkbox"
                        checked={row.pending}
                        className="w-3.5 h-3.5 accent-[#1B2E6B]"
                        onChange={e => {
                          const rows = [...vendorRows]
                          rows[i] = { ...rows[i], pending: e.target.checked, cost: e.target.checked ? '' : rows[i].cost }
                          setVendorRows(rows)
                        }}
                      />
                      <span className="text-xs text-amber-600">Cost pending</span>
                    </label>
                  )}
                </div>
              ))}

              {/* Add / Delete Vendor */}
              {!isReadOnly && vendorRows.length < 7 && (
                <button
                  className="btn-green"
                  onClick={() => setVendorRows([...vendorRows, { vendor: '', cost: '', pending: repForm.final_status === 'Repaired - Awaiting Final Cost' }])}
                >
                  Add Vendor
                </button>
              )}
              {!isReadOnly && vendorRows.length > 1 && (
                <button
                  className="btn-red"
                  onClick={() => setVendorRows(vendorRows.slice(0, -1))}
                >
                  Delete Vendor
                </button>
              )}

              <div>
                <label className="form-label">Date Completed</label>
                <input type="datetime-local" className="form-input" value={repForm.date_completed ? (repForm.date_completed as string).slice(0, 16) : ''} onChange={e => setRep('date_completed', e.target.value)} disabled={isReadOnly} />
              </div>

              {!isReadOnly && <p className="text-sm text-gray-500">Submit the changes above to notify the original sender.</p>}
              {!isReadOnly && (
                <button className="btn-submit" onClick={saveRepairs} disabled={
                  saving ||
                  !repForm.Work_Order_Type ||
                  (String(repForm.Work_Order_Type || '').startsWith('AFE') && !repForm.AFE_Number) ||
                  !repForm.final_status ||
                  !String(repForm.repair_details || '').trim() ||
                  (vendorRows.every(r => !r.cost) && repForm.final_status !== 'Repaired - Awaiting Final Cost')
                }>
                  {saving ? 'Submitting…' : 'Submit'}
                </button>
              )}
            </div>

            <CommentsSection
              comments={comments as never}
              ticketId={id}
              userName={userName || ''}
              userEmail={userEmail || ''}
              onRefresh={refreshData}
            />
          </div>
        )}
      </div>

    </div>
  )
}
