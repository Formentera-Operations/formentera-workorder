'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, ChevronDown, Camera, X, AlertTriangle } from 'lucide-react'
import LocationDropdowns from '@/components/forms/LocationDropdowns'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { DEPARTMENTS, LOCATION_TYPES, newRequestId } from '@/lib/utils'
import { useAuth } from '@/components/AuthProvider'
import { cachedFetch } from '@/lib/cached-fetch'
import { queuedMutate } from '@/lib/queued-mutate'
import { uploadPhoto } from '@/lib/upload-photo'
import PhotoImg from '@/components/ui/PhotoImg'
import TicketSummaryPreview from '@/components/ui/TicketSummaryPreview'
import type { LocationType } from '@/types'

export default function MaintenanceFormPage() {
  const router = useRouter()
  const { userEmail, userName, assets: userAssets } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [equipmentTypes, setEquipmentTypes] = useState<{ id: string; equipment_type: string }[]>([])
  const [equipment, setEquipment] = useState<{ id: number; equip_name: string }[]>([])
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([])
  type DuplicateTicket = {
    id: number
    Ticket_Status: string
    Issue_Date: string
    Created_by_Name: string | null
    Issue_Description: string | null
    assigned_foreman: string | null
  }
  const [duplicates, setDuplicates] = useState<DuplicateTicket[]>([])
  const [duplicateBannerDismissed, setDuplicateBannerDismissed] = useState(false)
  const [confirmDuplicates, setConfirmDuplicates] = useState<DuplicateTicket[] | null>(null)
  const [previewTicketId, setPreviewTicketId] = useState<number | null>(null)

  function meaningfulDescription(s: string | null): string | null {
    if (!s) return null
    const trimmed = s.trim()
    if (!trimmed) return null
    if (['none', 'n/a', 'na', '-', '--'].includes(trimmed.toLowerCase())) return null
    return trimmed
  }

  const [form, setForm] = useState({
    Department: '',
    Location_Type: '' as LocationType | '',
    Asset: '', Field: '', Well: '', Well_UNITID: '', Facility: '', Area: '', Route: '',
    Equipment_Type: '',
    Equipment: '',
    Issue_Description: '',
    Troubleshooting_Conducted: '',
    Issue_Photos: [] as string[],
    assigned_foreman: '',
    Self_Dispatch: false,
    Estimate_Cost: '',
  })

  useEffect(() => {
    const params = new URLSearchParams()
    const asset = form.Asset || (userAssets.length === 1 ? userAssets[0] : '')
    if (asset) params.set('asset', asset)
    cachedFetch<typeof employees>(
      `/api/employees?${params}`,
      { cacheKey: `employees:${asset}` }
    )
      .then(({ data }) => setEmployees(data))
      .catch(() => {})
  }, [form.Asset, userAssets])

  useEffect(() => {
    if (form.Location_Type) {
      setEquipmentTypes([])
      setEquipment([])
      cachedFetch<typeof equipmentTypes>(
        `/api/equipment?type=types&locationMatch=${encodeURIComponent(form.Location_Type)}`,
        { cacheKey: `equipment-types:${form.Location_Type}` }
      )
        .then(({ data }) => setEquipmentTypes(data))
        .catch(() => {})
    }
  }, [form.Location_Type])

  useEffect(() => {
    if (form.Equipment_Type && form.Location_Type) {
      cachedFetch<typeof equipment>(
        `/api/equipment?type=equipment&equipmentType=${encodeURIComponent(form.Equipment_Type)}&locationMatch=${form.Location_Type}`,
        { cacheKey: `equipment:${form.Location_Type}:${form.Equipment_Type}` }
      )
        .then(({ data }) => setEquipment(data))
        .catch(() => {})
    }
  }, [form.Equipment_Type, form.Location_Type])

  useEffect(() => {
    if (!form.Equipment || (!form.Well && !form.Facility)) {
      setDuplicates([])
      setDuplicateBannerDismissed(false)
      return
    }
    const params = new URLSearchParams({ equipment: form.Equipment })
    if (form.Well) params.set('well', form.Well)
    else if (form.Facility) params.set('facility', form.Facility)
    fetch(`/api/tickets/check-duplicates?${params}`)
      .then(r => r.json())
      .then(d => {
        setDuplicates(d.duplicates || [])
        setDuplicateBannerDismissed(false)
      })
      .catch(() => setDuplicates([]))
  }, [form.Equipment, form.Well, form.Facility])

  const set = (key: string, val: unknown) => setForm(f => ({ ...f, [key]: val }))

  async function submitTicket(force: boolean): Promise<{ conflict: true; duplicates: DuplicateTicket[] } | { conflict: false; queued?: boolean }> {
    const isOnline = typeof navigator === 'undefined' || navigator.onLine
    const body = {
      ...form,
      Created_by_Email: userEmail,
      Created_by_Name: userName,
      Self_Dispatch_Assignee: form.Self_Dispatch ? userName : null,
      Estimate_Cost: form.Estimate_Cost ? parseFloat(form.Estimate_Cost) : null,
      // Server-side idempotency key — stable for this submit attempt and
      // any retries (offline replay, network blips). The server returns
      // the existing row instead of inserting again if it sees this id.
      client_request_id: newRequestId(),
      // The duplicate check still runs at sync time when offline — if the
      // server detects a duplicate then, the failed-sync review surface
      // gives the foreman a "Submit anyway" option.
      force,
    }

    if (!isOnline) {
      const label = form.Well || form.Facility || form.Equipment || 'new'
      const result = await queuedMutate('/api/tickets', {
        method: 'POST',
        description: `Submit new ticket — ${label}`,
        body,
      })
      if (!result.ok) throw new Error(result.error || 'Could not save ticket locally')
      return { conflict: false, queued: true }
    }

    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 409) {
      const body = await res.json().catch(() => ({ duplicates: [] }))
      return { conflict: true, duplicates: (body.duplicates || []) as DuplicateTicket[] }
    }
    if (!res.ok) throw new Error('Submit failed')
    return { conflict: false }
  }

  async function handleSubmit() {
    if (submitLock.current) return
    submitLock.current = true
    const missingWellOrFacility = !(form.Well || form.Facility)
    if (
      !form.Department ||
      !form.Location_Type ||
      !form.Asset ||
      missingWellOrFacility ||
      !form.Equipment_Type ||
      !form.Equipment ||
      !form.Issue_Description ||
      (form.Self_Dispatch && !form.Estimate_Cost) ||
      (form.Estimate_Cost && isNaN(Number(form.Estimate_Cost)))
    ) {
      alert('Please fill in all required fields.')
      return
    }

    setSubmitting(true)
    try {
      const result = await submitTicket(false)
      if (result.conflict) {
        setConfirmDuplicates(result.duplicates)
        return
      }
      if (result.queued) {
        toast.message('Saved offline — will submit when you\'re back online.', { duration: 5000 })
      } else {
        toast.info('Maintenance Form Successfully Submitted', { duration: 5000 })
      }
      router.push('/my-tickets')
    } catch {
      toast.error('Failed to submit ticket. Please try again.')
    } finally {
      setSubmitting(false)
      submitLock.current = false
    }
  }

  async function handleConfirmSubmit() {
    setConfirmDuplicates(null)
    if (submitLock.current) return
    submitLock.current = true
    setSubmitting(true)
    try {
      const result = await submitTicket(true)
      if (result.conflict === false && result.queued) {
        toast.message('Saved offline — will submit when you\'re back online.', { duration: 5000 })
      } else {
        toast.info('Maintenance Form Successfully Submitted', { duration: 5000 })
      }
      router.push('/my-tickets')
    } catch {
      toast.error('Failed to submit ticket. Please try again.')
    } finally {
      setSubmitting(false)
      submitLock.current = false
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="page-header">
        <button onClick={() => router.back()} className="p-1 -ml-1">
          <ArrowLeft size={20} className="text-gray-700" />
        </button>
        <h1 className="page-title">Maintenance Form</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 lg:px-32">
        <h2 className="text-xl font-bold text-gray-900 text-center">Maintenance Form</h2>

        {/* Department */}
        <div>
          <label className="form-label form-label-required">Department</label>
          <div className="relative">
            <select className="form-select" value={form.Department} onChange={e => set('Department', e.target.value)}>
              <option value="">Select a department</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Location Type */}
        <div>
          <label className="form-label form-label-required">Location Type</label>
          <div className="relative">
            <select
              className="form-select"
              value={form.Location_Type}
              onChange={e => {
                set('Location_Type', e.target.value)
                set('Well', ''); set('Well_UNITID', ''); set('Facility', '')
                set('Equipment_Type', ''); set('Equipment', '')
              }}
            >
              <option value="">Select a location type</option>
              {LOCATION_TYPES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Cascading location dropdowns */}
        <LocationDropdowns
          locationType={form.Location_Type as LocationType}
          userAssets={userAssets}
          onChange={({ asset, field, well, facility, area, route, wellUnitId }) => {
            setForm(f => ({
              ...f,
              Asset: asset, Field: field,
              Well: well, Well_UNITID: wellUnitId ?? '',
              Facility: facility, Area: area, Route: route,
            }))
          }}
        />

        {/* Problem Equipment section */}
        <div className="pt-2">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Problem Equipment</h3>

          <div className="space-y-4">
            <div>
              <label className="form-label form-label-required">Select an Equipment Type</label>
              <SearchableSelect
                value={form.Equipment_Type}
                options={equipmentTypes.map(et => et.equipment_type)}
                placeholder="Select Equipment Type"
                onChange={v => { set('Equipment_Type', v); set('Equipment', '') }}
              />
            </div>

            <div>
              <label className="form-label form-label-required">Equipment Name</label>
              <SearchableSelect
                value={form.Equipment}
                options={equipment.map(eq => eq.equip_name)}
                placeholder="Select Equipment"
                onChange={v => set('Equipment', v)}
              />
            </div>
          </div>
        </div>

        {/* Duplicate ticket warning */}
        {duplicates.length > 0 && !duplicateBannerDismissed && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-amber-900">
                  {duplicates.length === 1
                    ? 'There is already an active ticket on this equipment'
                    : `There are ${duplicates.length} active tickets on this equipment`}
                </div>
                <div className="mt-2 space-y-2">
                  {duplicates.map(d => (
                    <div key={d.id} className="rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-gray-900">
                          #{d.id} · {d.Ticket_Status}
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewTicketId(d.id)}
                          className="text-[#1B2E6B] font-medium hover:underline"
                        >
                          View ticket
                        </button>
                      </div>
                      <div className="text-gray-500 mt-0.5">
                        Opened {new Date(d.Issue_Date).toLocaleDateString()}
                        {d.Created_by_Name ? ` by ${d.Created_by_Name}` : ''}
                        {d.assigned_foreman ? ` · Assigned to ${d.assigned_foreman}` : ''}
                      </div>
                      {meaningfulDescription(d.Issue_Description) && (
                        <div className="text-gray-700 mt-1 line-clamp-2">
                          {meaningfulDescription(d.Issue_Description)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setDuplicateBannerDismissed(true)}
                  className="mt-2 text-xs text-amber-900 underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Issue Details section */}
        <div className="pt-2">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Issue Details</h3>

          <div className="space-y-4">
            <div>
              <label className="form-label form-label-required">Issue Description / Scope & Cost</label>
              <textarea
                className="form-textarea"
                placeholder="Include any warning lights, faults, or alarms"
                value={form.Issue_Description}
                onChange={e => set('Issue_Description', e.target.value)}
              />
            </div>

            <div>
              <label className="form-label">Any Troubleshooting Conducted</label>
              <textarea
                className="form-textarea"
                placeholder="Detail anything you have done to repair or restart the equipment and if it was successful or not"
                value={form.Troubleshooting_Conducted}
                onChange={e => set('Troubleshooting_Conducted', e.target.value)}
              />
            </div>

            {/* Issue Photos */}
            <div>
              <label className="form-label">Issue Photos</label>
              <div className={`form-input flex items-center justify-between cursor-pointer ${uploadingPhotos ? 'opacity-50 pointer-events-none' : ''}`} onClick={() => document.getElementById('issue-photo-input')?.click()}>
                <span className="text-gray-400">{uploadingPhotos ? 'Uploading…' : 'Attach an image'}</span>
                <Camera size={20} className="text-gray-400" />
              </div>
              <input
                id="issue-photo-input"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const files = Array.from(e.target.files || [])
                  if (!files.length) return
                  setUploadingPhotos(true)
                  try {
                    // uploadPhoto handles online (real /api/upload) AND offline
                    // (compress + stash in IDB, return idb:// ref) — sync worker
                    // resolves the ref when connectivity returns.
                    const urls = await Promise.all(files.map(file => uploadPhoto(file)))
                    set('Issue_Photos', [...form.Issue_Photos, ...urls])
                  } catch {
                    alert('Failed to upload photo. Please try again.')
                  } finally {
                    setUploadingPhotos(false)
                  }
                }}
              />
              {form.Issue_Photos.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {form.Issue_Photos.map((url, i) => (
                    <div key={i} className="relative">
                      <PhotoImg
                        url={url}
                        alt="Issue photo"
                        className="w-20 h-20 object-cover rounded-lg cursor-pointer"
                        onClick={() => setPreviewUrl(url)}
                      />
                      <button
                        type="button"
                        onClick={() => set('Issue_Photos', form.Issue_Photos.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 bg-gray-900 text-white rounded-full w-5 h-5 flex items-center justify-center shadow"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Full-screen preview modal */}
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
                  <PhotoImg
                    url={previewUrl}
                    alt="Preview"
                    className="max-w-full max-h-full rounded-lg object-contain"
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              )}
            </div>

            {/* Assigned Foreman — hidden when self dispatching */}
            {!form.Self_Dispatch && (
              <div>
                <label className="form-label">Assigned Foreman</label>
                <SearchableSelect
                  value={form.assigned_foreman}
                  options={employees.map(e => e.name)}
                  placeholder="Select Foreman"
                  onChange={v => set('assigned_foreman', v)}
                />
              </div>
            )}

            {/* Self Dispatch */}
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">Self Dispatch?</label>
              <button
                type="button"
                onClick={() => {
                  const next = !form.Self_Dispatch
                  setForm(f => ({ ...f, Self_Dispatch: next, assigned_foreman: next ? '' : f.assigned_foreman }))
                }}
                className={`w-12 h-6 rounded-full transition-colors ${form.Self_Dispatch ? 'bg-[#1B2E6B]' : 'bg-gray-300'}`}
              >
                <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${form.Self_Dispatch ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* Estimated Cost — only shown when Self Dispatch is on */}
            {form.Self_Dispatch && (
              <div>
                <label className="form-label form-label-required">Estimated Cost</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="form-input pl-7"
                    placeholder="Enter Value"
                    value={form.Estimate_Cost}
                    onChange={e => {
                      const val = e.target.value
                      if (val === '' || /^\d*\.?\d*$/.test(val)) set('Estimate_Cost', val)
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Submit */}
        <button
          className="btn-submit"
          onClick={handleSubmit}
          disabled={submitting || uploadingPhotos || !form.Department || !form.Location_Type || !form.Asset || !(form.Well || form.Facility) || !form.Equipment_Type || !form.Equipment || !form.Issue_Description || (form.Self_Dispatch && !form.Estimate_Cost)}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

      {/* Duplicate ticket confirmation modal */}
      {confirmDuplicates && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-gray-900">Possible duplicate ticket</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {confirmDuplicates.length === 1
                    ? 'An active ticket already exists on this equipment:'
                    : `${confirmDuplicates.length} active tickets already exist on this equipment:`}
                </p>
              </div>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {confirmDuplicates.map(d => (
                <div key={d.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-gray-900">#{d.id} · {d.Ticket_Status}</div>
                    <button
                      type="button"
                      onClick={() => setPreviewTicketId(d.id)}
                      className="text-[#1B2E6B] font-medium hover:underline"
                    >
                      View ticket
                    </button>
                  </div>
                  <div className="text-gray-500 mt-0.5">
                    Opened {new Date(d.Issue_Date).toLocaleDateString()}
                    {d.Created_by_Name ? ` by ${d.Created_by_Name}` : ''}
                    {d.assigned_foreman ? ` · Assigned to ${d.assigned_foreman}` : ''}
                  </div>
                  {meaningfulDescription(d.Issue_Description) && (
                    <div className="text-gray-700 mt-1 line-clamp-2">{meaningfulDescription(d.Issue_Description)}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setConfirmDuplicates(null)
                  setSubmitting(false)
                  submitLock.current = false
                }}
                className="flex-1 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                className="flex-1 py-2.5 rounded-lg bg-[#1B2E6B] text-sm font-medium text-white hover:bg-[#152552]"
              >
                Submit anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {previewTicketId !== null && (
        <TicketSummaryPreview
          ticketId={previewTicketId}
          onClose={() => setPreviewTicketId(null)}
        />
      )}
    </div>
  )
}
