import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') // 'types' | 'equipment'
  const equipmentType = searchParams.get('equipmentType')
  const locationMatch = searchParams.get('locationMatch') // 'Well' | 'Facility'

  try {
    const db = supabaseAdmin()

    if (type === 'types') {
      let query = db
        .from('equipment_library')
        .select('type, match_type')

      if (locationMatch) {
        query = query.eq('match_type', locationMatch)
      }

      const { data, error } = await query
      if (error) throw error

      const unique = [...new Set((data || []).map(r => r.type).filter(Boolean))].sort() as string[]
      return NextResponse.json(unique.map((t, i) => ({ id: String(i), equipment_type: t })))
    }

    if (type === 'equipment') {
      let query = db
        .from('equipment_library')
        .select('id, equip_name, equip_code, type, match_type')
        .order('equip_name')

      if (locationMatch) {
        query = query.eq('match_type', locationMatch)
      }
      if (equipmentType) {
        query = query.eq('type', equipmentType)
      }

      const { data, error } = await query
      if (error) throw error
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: 'Missing type param' }, { status: 400 })
  } catch (error) {
    console.error('Equipment fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch equipment' }, { status: 500 })
  }
}
