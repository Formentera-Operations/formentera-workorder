'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { filterOptions, COMPRESSOR_STATION_ASSET } from '@/lib/utils'
import FilterSelect from '@/components/ui/FilterSelect'
import WellSearchPicker from '@/components/forms/WellSearchPicker'
import { cachedFetch } from '@/lib/cached-fetch'

type CompressorStation = {
  station: string
  compressorId: string
  asset: string
  area: string
  route: string
  field: string
  foreman: string
  productionEngineer: string
  unitId: string
}

type MasterMeter = {
  meter: string
  asset: string
  area: string
  route: string
  field: string
  foreman: string
  productionEngineer: string
  unitId: string
}

interface LocationDropdownsProps {
  locationType: 'Well' | 'Facility' | 'Compressor Station' | 'Midstream Master Meters' | ''
  onChange: (vals: {
    asset: string; field: string; well: string; facility: string;
    area: string; route: string;
    wellUnitId?: string;
  }) => void
  initialValues?: {
    asset?: string; field?: string; well?: string; facility?: string;
  }
  userAssets?: string[]
  disabled?: boolean
}

type WFData = Record<string, string[]>

export default function LocationDropdowns({ locationType, onChange, initialValues, userAssets = [], disabled = false }: LocationDropdownsProps) {
  const [wfData, setWfData] = useState<WFData>({})
  const [loading, setLoading] = useState(true)

  const [asset, setAsset] = useState(initialValues?.asset || '')
  const [field, setField] = useState(initialValues?.field || '')
  const [well, setWell] = useState(initialValues?.well || '')
  const [facility, setFacility] = useState(initialValues?.facility || '')

  const [compressors, setCompressors] = useState<CompressorStation[]>([])
  const [masterMeters, setMasterMeters] = useState<MasterMeter[]>([])

  useEffect(() => {
    cachedFetch<WFData>('/api/well-facility', { cacheKey: 'well-facility' })
      .then(({ data }) => { setWfData(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Compressor station list — only needed when the Compressor Station location
  // type is active. Small fixed list, cached for the session.
  useEffect(() => {
    if (locationType !== 'Compressor Station') return
    cachedFetch<CompressorStation[]>('/api/compressors', { cacheKey: 'compressors' })
      .then(({ data }) => setCompressors(data))
      .catch(() => {})
  }, [locationType])

  // Master meter list — only needed when the Midstream Master Meters location
  // type is active. Small fixed list, cached for the session.
  useEffect(() => {
    if (locationType !== 'Midstream Master Meters') return
    cachedFetch<MasterMeter[]>('/api/master-meters', { cacheKey: 'master-meters' })
      .then(({ data }) => setMasterMeters(data))
      .catch(() => {})
  }, [locationType])

  // Derive hidden area/route/unitId from current selections
  const getDerived = useCallback((a: string, f: string, w: string, fac: string) => {
    const d = wfData
    const Asset = d.Asset ?? []
    const FIELD = d.FIELD ?? []
    const WELLNAME = d.WELLNAME ?? []
    const Facility_Name = d.Facility_Name ?? []
    const Area = d.Area ?? []
    const ROUTENAME = d.ROUTENAME ?? []
    const UNITID = d.UNITID ?? []
    for (let i = 0; i < Asset.length; i++) {
      if ((!a || Asset[i] === a) &&
          (!f || FIELD[i] === f) &&
          (!w || WELLNAME[i] === w) &&
          (!fac || Facility_Name[i] === fac)) {
        return {
          area: Area[i] || '',
          route: ROUTENAME[i] || '',
          unitId: w ? (UNITID[i] || '') : '',
        }
      }
    }
    return { area: '', route: '', unitId: '' }
  }, [wfData])

  const emit = useCallback((
    a: string, f: string, w: string, fac: string,
    overrides?: { unitId?: string; area?: string; route?: string },
  ) => {
    const derived = getDerived(a, f, w, fac)
    onChange({
      asset: a, field: f, well: w, facility: fac,
      area: overrides?.area ?? derived.area,
      route: overrides?.route ?? derived.route,
      wellUnitId: overrides?.unitId ?? derived.unitId,
    })
  }, [getDerived, onChange])

  // Auto-fill: when a selection narrows to a single candidate, fill it automatically
  useEffect(() => {
    if (!wfData || Object.keys(wfData).length === 0) return

    const AssetArr    = wfData.Asset ?? []
    const FieldArr    = wfData.FIELD ?? []
    const WellArr     = wfData.WELLNAME ?? []
    const FacilityArr = wfData.Facility_Name ?? []

    const isGood = (v: unknown): v is string =>
      v != null && String(v).trim() !== '' && String(v).toLowerCase() !== 'null'

    const len = Math.max(AssetArr.length, FieldArr.length, WellArr.length, FacilityArr.length)
    const idx: number[] = []
    for (let i = 0; i < len; i++) {
      if ((!asset    || AssetArr[i]    === asset) &&
          (!field    || FieldArr[i]    === field) &&
          (!well     || WellArr[i]     === well) &&
          (!facility || FacilityArr[i] === facility)) {
        idx.push(i)
      }
    }

    const uniq = (arr: unknown[]) => [...new Set(arr.filter(isGood))] as string[]
    const candAsset    = uniq(idx.map(i => AssetArr[i]))
    const candField    = uniq(idx.map(i => FieldArr[i]))
    const candWell     = uniq(idx.map(i => WellArr[i]))
    const candFacility = uniq(idx.map(i => FacilityArr[i]))
    const newAsset    = !asset    && candAsset.length    === 1 ? candAsset[0]    : asset
    const newField    = !field    && candField.length    === 1 ? candField[0]    : field
    // Only auto-fill the location field that matches the active type — never
    // cross-fill. A well's row also carries its single-well battery in
    // Facility_Name, so without this guard picking a Well would silently derive
    // a Facility (and surface it the moment you switch to the Facility view).
    const newWell     = locationType === 'Well'     && !well     && candWell.length     === 1 ? candWell[0]     : well
    const newFacility = locationType === 'Facility' && !facility && candFacility.length === 1 ? candFacility[0] : facility

    const changed = newAsset !== asset || newField !== field || newWell !== well || newFacility !== facility
    if (!changed) return

    if (newAsset    !== asset)    setAsset(newAsset)
    if (newField    !== field)    setField(newField)
    if (newWell     !== well)     setWell(newWell)
    if (newFacility !== facility) setFacility(newFacility)

    emit(newAsset, newField, newWell, newFacility)
  }, [asset, field, well, facility, wfData, emit, locationType])

  // Which of the user's assigned assets actually support a given location type.
  // Well/Facility come from the well-facility payload; Compressor Station and
  // Midstream Master Meters exist only for the Wheeler midstream asset.
  const assetsSupporting = useCallback((type: string): string[] => {
    if (type === 'Compressor Station' || type === 'Midstream Master Meters') {
      return userAssets.filter(a => a === COMPRESSOR_STATION_ASSET)
    }
    if (type === 'Well' || type === 'Facility') {
      const assetCol = wfData.Asset ?? []
      const valCol = (type === 'Well' ? wfData.WELLNAME : wfData.Facility_Name) ?? []
      const good = (v: unknown) =>
        v != null && String(v).trim() !== '' && String(v).toLowerCase() !== 'null'
      const set = new Set<string>()
      for (let i = 0; i < assetCol.length; i++) {
        if (userAssets.includes(assetCol[i]) && good(valCol[i])) set.add(assetCol[i])
      }
      return [...set]
    }
    return []
  }, [wfData, userAssets])

  // When the location type changes: (1) clear the dependent selections (field +
  // well + facility) so nothing bleeds across the switch, and (2) auto-select
  // the asset when exactly one of the user's assigned assets supports that type
  // (e.g. only FP WHEELER UPSTREAM has wells, only FP WHEELER MIDSTREAM has
  // compressors/meters). Auto-select is skipped when an asset is already chosen
  // or the choice is ambiguous. The ref guards the initial mount so edit-mode
  // initialValues aren't wiped.
  const lastLocationType = useRef(locationType)
  useEffect(() => {
    if (lastLocationType.current === locationType) return
    lastLocationType.current = locationType

    let nextAsset = asset
    if (!asset && locationType) {
      const candidates = assetsSupporting(locationType)
      if (candidates.length === 1) nextAsset = candidates[0]
    }

    if (field || well || facility || nextAsset !== asset) {
      if (nextAsset !== asset) setAsset(nextAsset)
      setField('')
      setWell('')
      setFacility('')
      emit(nextAsset, '', '', '')
    }
  }, [locationType, asset, field, well, facility, emit, assetsSupporting])

  const allAssets = filterOptions(wfData, 'Asset', {})
  const assets = userAssets.length > 0 ? allAssets.filter(a => userAssets.includes(a)) : allAssets
  const fields = filterOptions(wfData, 'FIELD', { Asset: asset || null })
  const facilities = filterOptions(wfData, 'Facility_Name', { Asset: asset || null, FIELD: field || null })

  // Compressor stations narrow by the chosen asset/field (all belong to
  // FP WHEELER MIDSTREAM, split across the STILES RANCH and MILLS RANCH fields).
  const compressorStations = compressors
    .filter(c => (!asset || c.asset === asset) && (!field || c.field === field))
    .map(c => c.station)

  // Master meters narrow by the chosen asset/field the same way (all belong to
  // FP WHEELER MIDSTREAM, split across the STILES RANCH and MILLS RANCH fields).
  const masterMeterNames = masterMeters
    .filter(m => (!asset || m.asset === asset) && (!field || m.field === field))
    .map(m => m.meter)

  const singleAsset = userAssets.length === 1

  // Pre-populate when user has exactly one asset
  useEffect(() => {
    if (singleAsset && !asset && userAssets[0]) {
      setAsset(userAssets[0])
      emit(userAssets[0], '', '', '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleAsset, userAssets[0]])

  if (loading) return <div className="text-sm text-gray-400 py-2">Loading locations…</div>

  return (
    <div className="space-y-4">
      {/* Asset */}
      <FilterSelect
        label="Asset"
        value={asset}
        options={assets}
        placeholder="Select an Asset"
        placeholderValue=""
        required
        disabled={disabled || singleAsset}
        allowClear
        onChange={v => { setAsset(v); setField(''); setWell(''); setFacility(''); emit(v, '', '', '') }}
      />

      {/* Field */}
      <FilterSelect
        label="Field"
        value={field}
        options={fields}
        placeholder="Select a Field"
        placeholderValue=""
        disabled={disabled}
        allowClear
        onChange={v => { setField(v); setWell(''); setFacility(''); emit(asset, v, '', '') }}
      />

      {/* Well — only shown if locationType = Well */}
      {locationType === 'Well' && (
        <div>
          <label className="form-label form-label-required">Well</label>
          <WellSearchPicker
            value={well}
            assetFilter={asset}
            fieldFilter={field}
            disabled={disabled || !asset}
            placeholder={asset ? 'Search for a well…' : 'Select an Asset first'}
            onChange={({ well: w, unitId, field: f, area, route }) => {
              setWell(w)
              setFacility('')
              const nextField = f || field
              if (f && f !== field) setField(f)
              emit(asset, nextField, w, '', { unitId, area, route })
            }}
            onClear={() => {
              setWell('')
              emit(asset, field, '', '')
            }}
          />
        </div>
      )}

      {/* Facility — only shown if locationType = Facility */}
      {locationType === 'Facility' && (
        <FilterSelect
          label="Facility"
          value={facility}
          options={facilities}
          placeholder="Select a Facility"
          placeholderValue=""
          required
          disabled={disabled}
          allowClear
          onChange={v => { setFacility(v); setWell(''); emit(asset, field, '', v) }}
        />
      )}

      {/* Compressor Station — only shown if locationType = Compressor Station.
          Stored in the same Facility field as facilities; selecting a station
          auto-fills the asset/field/area/route from the station's record. */}
      {locationType === 'Compressor Station' && (
        <FilterSelect
          label="Compressor Station"
          value={facility}
          options={compressorStations}
          placeholder="Select a Compressor Station"
          placeholderValue=""
          required
          disabled={disabled}
          allowClear
          onChange={v => {
            const chosen = compressors.find(c => c.station === v)
            setWell('')
            setFacility(v)
            if (chosen) {
              const nextAsset = asset || chosen.asset
              const nextField = chosen.field || field
              if (nextAsset !== asset) setAsset(nextAsset)
              if (nextField !== field) setField(nextField)
              emit(nextAsset, nextField, '', v, { area: chosen.area, route: chosen.route })
            } else {
              emit(asset, field, '', v)
            }
          }}
        />
      )}

      {/* Master Meters — only shown if locationType = Midstream Master Meters.
          Sourced from Snowflake (the FP WHEELER MIDSTREAM master-meter facility
          rows, which are kept out of the Facility dropdown). Stored in the same
          Facility field as facilities; selecting one auto-fills the
          asset/field/area/route from the meter's record. */}
      {locationType === 'Midstream Master Meters' && (
        <FilterSelect
          label="Master Meters"
          value={facility}
          options={masterMeterNames}
          placeholder="Select a Master Meter"
          placeholderValue=""
          required
          disabled={disabled}
          allowClear
          onChange={v => {
            const chosen = masterMeters.find(m => m.meter === v)
            setWell('')
            setFacility(v)
            if (chosen) {
              const nextAsset = asset || chosen.asset
              const nextField = chosen.field || field
              if (nextAsset !== asset) setAsset(nextAsset)
              if (nextField !== field) setField(nextField)
              emit(nextAsset, nextField, '', v, { area: chosen.area, route: chosen.route })
            } else {
              emit(asset, field, '', v)
            }
          }}
        />
      )}
    </div>
  )
}
