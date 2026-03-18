'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronDown, Camera } from 'lucide-react'
import LocationDropdowns from '@/components/forms/LocationDropdowns'
import { DEPARTMENTS, LOCATION_TYPES } from '@/lib/utils'
import { useAuth } from '@/components/AuthProvider'
import type { LocationType } from '@/types'

export default function MaintenanceFormPage() {
  const router = useRouter()
  const { userEmail, userName } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [equipmentTypes, setEquipmentTypes] = useState<{ id: string; equipment_type: string }[]>([])
  const [equipment, setEquipment] = useState<{ id: number; equip_name: string }[]>([])
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([])

  const [form, setForm] = useState({
    Department: '',
    Location_Type: '' as LocationType | '',
    Asset: '', Field: '', Well: '', Facility: '', Area: '', Route: '',
    Equipment_Type: '',
    Equipment: '',
    Issue_Description: '',
    Troubleshooting_Conducted: '',
    Issue_Photos: [] as string[],
    assigned_foreman: '',
    Self_Dispatch: false,
  })

  useEffect(() => {
    fetch('/api/employees').then(r => r.json()).then(setEmployees)
  }, [])

  useEffect(() => {
    if (form.Location_Type) {
      setEquipmentTypes([])
      setEquipment([])
      fetch(`/api/equipment?type=types&locationMatch=${encodeURIComponent(form.Location_Type)}`)
        .then(r => r.json()).then(setEquipmentTypes)
    }
  }, [form.Location_Type])

  useEffect(() => {
    if (form.Equipment_Type && form.Location_Type) {
      fetch(`/api/equipment?type=equipment&equipmentType=${encodeURIComponent(form.Equipment_Type)}&locationMatch=${form.Location_Type}`)
        .then(r => r.json()).then(setEquipment)
    }
  }, [form.Equipment_Type, form.Location_Type])

  const set = (key: string, val: unknown) => setForm(f => ({ ...f, [key]: val }))

  async function handleSubmit() {
    const missingWellOrFacility = !(form.Well || form.Facility)
    if (
      !form.Department ||
      !form.Location_Type ||
      !form.Asset ||
      missingWellOrFacility ||
      !form.Equipment_Type ||
      !form.Equipment ||
      !form.Issue_Description
    ) {
      alert('Please fill in all required fields.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          Created_by_Email: userEmail,
          Created_by_Name: userName,
          Self_Dispatch_Assignee: form.Self_Dispatch ? userName : null,
        }),
      })
      if (!res.ok) throw new Error('Submit failed')
      router.push('/my-tickets')
    } catch {
      alert('Failed to submit ticket. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen pb-16">
      {/* Header */}
      <div className="page-header">
        <button onClick={() => router.back()} className="p-1 -ml-1">
          <ArrowLeft size={20} className="text-gray-700" />
        </button>
        <h1 className="page-title">Maintenance Form</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
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
                set('Well', ''); set('Facility', '')
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
          onChange={({ asset, field, well, facility, area, route }) => {
            setForm(f => ({ ...f, Asset: asset, Field: field, Well: well, Facility: facility, Area: area, Route: route }))
          }}
        />

        {/* Problem Equipment section */}
        <div className="pt-2">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Problem Equipment</h3>

          <div className="space-y-4">
            <div>
              <label className="form-label form-label-required">Select an Equipment Type</label>
              <div className="relative">
                <select className="form-select" value={form.Equipment_Type} onChange={e => { set('Equipment_Type', e.target.value); set('Equipment', '') }}>
                  <option value="">Select Equipment Type</option>
                  {equipmentTypes.map(et => <option key={et.id} value={et.equipment_type}>{et.equipment_type}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="form-label form-label-required">Equipment Name</label>
              <div className="relative">
                <select className="form-select" value={form.Equipment} onChange={e => set('Equipment', e.target.value)}>
                  <option value="">Select Equipment</option>
                  {equipment.map(eq => <option key={eq.id} value={eq.equip_name}>{eq.equip_name}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

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
              <div className="form-input flex items-center justify-between cursor-pointer" onClick={() => document.getElementById('issue-photo-input')?.click()}>
                <span className="text-gray-400">Attach an image</span>
                <Camera size={20} className="text-gray-400" />
              </div>
              <input
                id="issue-photo-input"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (e) => {
                  // In production: upload to Supabase Storage and store URLs
                  const files = Array.from(e.target.files || [])
                  const urls = files.map(f => URL.createObjectURL(f))
                  set('Issue_Photos', urls)
                }}
              />
              {form.Issue_Photos.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {form.Issue_Photos.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={url} alt="Issue photo" className="w-16 h-16 object-cover rounded-lg" />
                  ))}
                </div>
              )}
            </div>

            {/* Assigned Foreman */}
            <div>
              <label className="form-label">Assigned Foreman</label>
              <div className="relative">
                <select className="form-select" value={form.assigned_foreman} onChange={e => set('assigned_foreman', e.target.value)}>
                  <option value="">Select Foreman</option>
                  {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Self Dispatch */}
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">Self Dispatch?</label>
              <button
                type="button"
                onClick={() => set('Self_Dispatch', !form.Self_Dispatch)}
                className={`w-12 h-6 rounded-full transition-colors ${form.Self_Dispatch ? 'bg-[#1B2E6B]' : 'bg-gray-300'}`}
              >
                <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${form.Self_Dispatch ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Submit */}
        <button className="btn-submit" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
