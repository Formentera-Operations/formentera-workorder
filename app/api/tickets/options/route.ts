import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Returns the universe of unique (asset, department, equipment, foreman,
// submitter) combos visible to the user. The client uses this to compute
// cascading dropdown options — see lib/cascading-options.ts.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('mode') || 'all'
  const userEmail = searchParams.get('userEmail') || ''
  const userName = searchParams.get('userName') || ''
  const userAssetsParam = searchParams.get('userAssets') || ''
  const userAssets = userAssetsParam ? userAssetsParam.split(',').map(a => a.trim()).filter(Boolean) : []

  try {
    const db = supabaseAdmin()

    let query = db
      .from('Maintenance_Form_Submission')
      .select('Asset, Department, Equipment, assigned_foreman, Created_by_Name')

    if (mode === 'mine') {
      query = query.or(
        `Created_by_Email.ilike.${userEmail},Created_by_Name.ilike.${userName},assigned_foreman.ilike.${userName}`
      )
    }

    if (userAssets.length > 0) query = query.in('Asset', userAssets)

    const { data, error } = await query

    if (error) throw error

    const seen = new Set<string>()
    const rows: { asset: string; department: string; equipment: string; foreman: string; submitter: string }[] = []
    for (const r of data || []) {
      const asset = r.Asset || ''
      const department = r.Department || ''
      const equipment = r.Equipment || ''
      const foreman = r.assigned_foreman || ''
      const submitter = r.Created_by_Name || ''
      const key = `${asset}|${department}|${equipment}|${foreman}|${submitter}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ asset, department, equipment, foreman, submitter })
    }

    return NextResponse.json({ rows })
  } catch (error) {
    console.error('Options fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch options' }, { status: 500 })
  }
}
