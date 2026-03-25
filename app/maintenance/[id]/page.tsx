'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, ChevronDown, Camera, X } from 'lucide-react'
import Accordion from '@/components/ui/Accordion'
import BottomNav from '@/components/layout/BottomNav'
import LocationDropdowns from '@/components/forms/LocationDropdowns'
import { useAuth } from '@/components/AuthProvider'
import { formatDate, formatDateShort, DEPARTMENTS, LOCATION_TYPES, WORK_ORDER_DECISIONS, FINAL_STATUSES, PRIORITY_OPTIONS } from '@/lib/utils'
import CommentsSection from '@/components/ui/CommentsSection'
import type { LocationType } from '@/types'

type Tab = 'Summary' | 'Initial Report' | 'Dispatch' | 'Repairs / Closeout'

export default function MaintenanceTicketPage() {
  const router = useRouter()
  const { id } = useParams()
  const { userName, userEmail } = useAuth()
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

  // Initial Report form state
  const [irForm, setIrForm] = useState<Record<string, string | boolean>>({})
  // Dispatch form state
  const [dispForm, setDispForm] = useState<Record<string, string | boolean>>({})
  // Repairs form state
  const [repForm, setRepForm] = useState<Record<string, string | boolean>>({})
  const [vendorRows, setVendorRows] = useState<{ vendor: string; cost: string }[]>([{ vendor: '', cost: '' }])
  const [repairPhotos, setRepairPhotos] = useState<string[]>([])
  const [uploadingRepairPhotos, setUploadingRepairPhotos] = useState(false)
  const [deleteRepairPhotoIdx, setDeleteRepairPhotoIdx] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/tickets/${id}`).then(r => r.json()),
      fetch('/api/employees').then(r => r.json()),
      fetch('/api/vendors').then(r => r.json()),
    ]).then(([ticketData, emps, vends]) => {
      setData(ticketData)
      setEmployees(emps || [])
      setVendors(vends || [])

      const t = ticketData.ticket || {}
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

      const d = (ticketData.dispatch || [])[0] || {}
      setDispForm({
        work_order_decision: d.work_order_decision || '',
        Estimate_Cost: t.Estimate_Cost != null ? String(t.Estimate_Cost) : (d.Estimate_Cost != null ? String(d.Estimate_Cost) : ''),
        assigned_foreman: d.maintenance_foreman || '',
        additional_assignee: d.production_foreman || '',
        date_assigned: d.date_assigned || new Date().toISOString(),
      })

      const rc = ticketData.repairs || {}
      setRepairPhotos(Array.isArray(rc.repair_images) ? rc.repair_images : [])
      const vd = ticketData.vendors || {}
      setRepForm({
        final_status: rc.final_status || '',
        start_date: rc.start_date || new Date().toISOString(),
        Work_Order_Type: rc.Work_Order_Type || '',
        Priority_of_Issue: rc.Priority_of_Issue || 'Low',
        repair_details: rc.repair_details || '',
        date_completed: rc.date_completed || '',
      })

      // Build vendor rows from vendor_payment_details
      const rows: { vendor: string; cost: string }[] = []
      for (let i = 1; i <= 7; i++) {
        const vKey = i === 1 ? 'vendor' : `vendor_${i}`
        const cKey = i === 1 ? 'vendor_cost' : `vendor_cost_${i}`
        if (vd[vKey]) rows.push({ vendor: vd[vKey] as string, cost: String(vd[cKey] || '') })
      }
      if (rows.length === 0) rows.push({ vendor: '', cost: '' })
      setVendorRows(rows)

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

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-sm text-gray-400">Loading…</div>
    </div>
  )

  const ticket = (data?.ticket || {}) as Record<string, unknown>
  const dispatch = ((data?.dispatch || []) as Record<string, unknown>[])[0] || {}
  const repairs = (data?.repairs || {}) as Record<string, unknown>
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
      alert('Updated successfully.')
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
          production_foreman: dispForm.assigned_foreman,
          date_assigned: dispForm.date_assigned,
          current_user_email: userEmail,
        }),
      })
      alert('Dispatched successfully.')
    } finally { setSaving(false) }
  }

  async function refreshData() {
    const res = await fetch(`/api/tickets/${id}`)
    const updated = await res.json()
    setData(updated)
  }

  async function saveRepairs() {
    setSaving(true)
    try {
      await fetch('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: id,
          ...repForm,
          repair_images: repairPhotos,
          vendors: vendorRows.filter(r => r.vendor).map(r => ({ vendor: r.vendor, cost: parseFloat(r.cost) || 0 })),
          created_by: userName,
          current_user_email: userEmail,
          assigned_foreman: dispatch.maintenance_foreman || dispatch.production_foreman || null,
          production_foreman: dispatch.production_foreman || null,
        }),
      })
      alert('Repairs saved. Original sender notified.')
    } finally { setSaving(false) }
  }

  const TABS: Tab[] = ['Summary', 'Initial Report', 'Dispatch', 'Repairs / Closeout']

  return (
    <div className="flex flex-col min-h-screen pb-16">
      {/* Header */}
      <div className="page-header">
        <button onClick={() => router.back()} className="p-1 -ml-1">
          <ArrowLeft size={20} className="text-gray-700" />
        </button>
        <h1 className="page-title">Maintenance Ticket</h1>
      </div>

      {/* Workflow tabs */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-100">
        <p className="text-xs text-gray-500 mb-2">Maintenance Workflow Selection</p>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`workflow-tab ${tab === t ? 'active' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">

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

            <Accordion title="Dispatch Details" forceOpen={expandAll}>
              <div>
                {[
                  ['Work Order Decision', dispatch.work_order_decision],
                  ['Estimated Cost', dispatch.Estimate_Cost ? `$${dispatch.Estimate_Cost}` : '—'],
                  ['Current Foreman', dispatch.production_foreman || dispatch.maintenance_foreman],
                  ['Additional Assignee', '—'],
                  ['Date Assigned', formatDate(dispatch.date_assigned as string)],
                ].map(([label, value]) => (
                  <div key={label as string} className="detail-row">
                    <span className="detail-label">{label as string}</span>
                    <span className="detail-value">{(value || '—') as string}</span>
                  </div>
                ))}
              </div>
            </Accordion>

            <Accordion title="Repairs / Closeout Details" forceOpen={expandAll}>
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
                  ['Priority of Issue', repairs.Priority_of_Issue],
                  ['Repair Details', repairs.repair_details],
                  ['Vendor', repairs.vendor],
                  ['Repair Cost', repairs.total_repair_cost ? `$${repairs.total_repair_cost}` : '—'],
                  ['Date Completed', repairs.date_completed ? formatDateShort(repairs.date_completed as string) : '—'],
                ].map(([label, value]) => (
                  <div key={label as string} className="detail-row">
                    <span className="detail-label">{label as string}</span>
                    <span className="detail-value">{(value || '—') as string}</span>
                  </div>
                ))}
              </div>
            </Accordion>
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
                <select className="form-select" value={irForm.Department as string} onChange={e => setIr('Department', e.target.value)}>
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
                    <select className="form-select" value={irForm.Equipment_Type as string} onChange={e => { setIr('Equipment_Type', e.target.value); setIr('Equipment', '') }}>
                      <option value="">Select Equipment Type</option>
                      {equipmentTypes.map(et => <option key={et.id} value={et.equipment_type}>{et.equipment_type}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="form-label">Equipment</label>
                  <div className="relative">
                    <select className="form-select" value={irForm.Equipment as string} onChange={e => setIr('Equipment', e.target.value)}>
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
                  <textarea className="form-textarea" value={irForm.Issue_Description as string} onChange={e => setIr('Issue_Description', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Troubleshooting Conducted</label>
                  <textarea className="form-textarea" placeholder="Detail anything you have done to repair or restart the equipment and if it was successful or not" value={irForm.Troubleshooting_Conducted as string} onChange={e => setIr('Troubleshooting_Conducted', e.target.value)} />
                </div>
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
                {/* Issue Photos */}
                <div>
                  <label className="form-label">Issue Photos</label>
                  <div
                    className={`form-input flex items-center justify-between cursor-pointer ${uploadingPhotos ? 'opacity-50 pointer-events-none' : ''}`}
                    onClick={() => document.getElementById('ir-photo-input')?.click()}
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
                        alert('Failed to upload photo. Please try again.')
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
                            onClick={() => setDeletePhotoIdx(i)}
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
              </div>
            </div>

            <button className="btn-primary" onClick={saveInitialReport} disabled={saving}>
              {saving ? 'Updating…' : 'Update'}
            </button>
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
                    <select className="form-select" value={dispForm.work_order_decision as string} onChange={e => setDisp('work_order_decision', e.target.value)}>
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
                    <input type="text" inputMode="decimal" className="form-input pl-8" placeholder="0" value={dispForm.Estimate_Cost as string} onChange={e => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setDisp('Estimate_Cost', v) }} />
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
                        <select className="form-select" value={dispForm.assigned_foreman as string} onChange={e => setDisp('assigned_foreman', e.target.value)}>
                          <option value="">Select Foreman</option>
                          {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                        </select>
                        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    </div>

                    <div>
                      <label className="form-label">Additional Assignee</label>
                      <div className="relative">
                        <select className="form-select" value={dispForm.additional_assignee as string} onChange={e => setDisp('additional_assignee', e.target.value)}>
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
                      />
                    </div>
                  </div>
                )}

                <button
                  className="btn-primary"
                  onClick={saveDispatch}
                  disabled={saving || !dispForm.work_order_decision || dispForm.Estimate_Cost === ''}
                >
                  {saving ? 'Dispatching…' : 'Dispatch'}
                </button>
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
                  <select className="form-select" value={repForm.final_status as string} onChange={e => setRep('final_status', e.target.value)}>
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
                <input type="datetime-local" className="form-input" value={repForm.start_date ? (repForm.start_date as string).slice(0, 16) : ''} onChange={e => setRep('start_date', e.target.value)} />
              </div>

              <div>
                <label className="form-label form-label-required">Work Order Type</label>
                <div className="relative">
                  <select className="form-select" value={repForm.Work_Order_Type as string} onChange={e => setRep('Work_Order_Type', e.target.value)}>
                    <option value="">Select Work Order Type</option>
                    {['AFE - Workover', 'AFE - Capital', 'LOE'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Priority radio buttons */}
              <div>
                <label className="form-label">Priority of Issue</label>
                <div className="space-y-2">
                  {PRIORITY_OPTIONS.map(p => (
                    <label key={p} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="priority"
                        value={p}
                        checked={repForm.Priority_of_Issue === p}
                        onChange={() => setRep('Priority_of_Issue', p)}
                        className="w-4 h-4 accent-[#1B2E6B]"
                      />
                      <span className="text-sm text-gray-700">{p}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="form-label form-label-required">Repair Details</label>
                <textarea className="form-textarea" placeholder="Enter details" value={repForm.repair_details as string} onChange={e => setRep('repair_details', e.target.value)} />
              </div>

              {/* Repair Images */}
              <div>
                <label className="form-label">Repair Images</label>
                <div
                  className={`form-input flex items-center justify-between cursor-pointer ${uploadingRepairPhotos ? 'opacity-50 pointer-events-none' : ''}`}
                  onClick={() => document.getElementById('repair-photo-input')?.click()}
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
                      alert('Failed to upload photo. Please try again.')
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
                          onClick={() => setDeleteRepairPhotoIdx(i)}
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
                <div key={i} className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label text-xs">
                      {i === 0 ? 'Vendor (leave blank if not applicable)' : `Vendor ${i + 1}`}
                    </label>
                    <div className="relative">
                      <select
                        className="form-select text-sm"
                        value={row.vendor}
                        onChange={e => {
                          const rows = [...vendorRows]
                          rows[i] = { ...rows[i], vendor: e.target.value }
                          setVendorRows(rows)
                        }}
                      >
                        <option value="">Select Vendor</option>
                        {row.vendor && !vendors.includes(row.vendor) && (
                          <option key={row.vendor} value={row.vendor}>{row.vendor}</option>
                        )}
                        {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="form-label text-xs">{i === 0 ? 'Repair Cost*' : 'Repair Cost'}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="form-input pl-7 text-sm"
                        placeholder="Enter Value"
                        value={row.cost}
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
              ))}

              {/* Add / Delete Vendor */}
              {vendorRows.length < 7 && (
                <button
                  className="btn-green"
                  onClick={() => setVendorRows([...vendorRows, { vendor: '', cost: '' }])}
                >
                  Add Vendor
                </button>
              )}
              {vendorRows.length > 1 && (
                <button
                  className="btn-red"
                  onClick={() => setVendorRows(vendorRows.slice(0, -1))}
                >
                  Delete Vendor
                </button>
              )}

              <div>
                <label className="form-label">Date Completed</label>
                <input type="datetime-local" className="form-input" value={repForm.date_completed ? (repForm.date_completed as string).slice(0, 16) : ''} onChange={e => setRep('date_completed', e.target.value)} />
              </div>

              <p className="text-sm text-gray-500">Submit the changes above to notify the original sender.</p>
              <button className="btn-submit" onClick={saveRepairs} disabled={saving}>
                {saving ? 'Submitting…' : 'Submit'}
              </button>
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

      <BottomNav />
    </div>
  )
}
