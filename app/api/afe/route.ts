import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type AfeOption = {
  number: string
  description: string
  type: string | null
  status: string | null
}

let cache: { data: AfeOption[]; ts: number } | null = null
let cacheAll: { data: AfeOption[]; ts: number } | null = null
const CACHE_TTL = 10 * 60 * 1000

async function login(base: string, id: string, key: string): Promise<string> {
  const res = await fetch(`${base}/api/Authentication/ApiKey/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ Id: id, Key: key }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Login failed: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  if (!data?.AuthenticationToken) throw new Error('No AuthenticationToken in login response')
  return data.AuthenticationToken as string
}

async function logout(base: string, token: string): Promise<void> {
  try {
    await fetch(`${base}/api/Authentication/Logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ AuthenticationToken: token }),
      cache: 'no-store',
    })
  } catch {
    // best-effort; logout is a no-op on Execute 21.1.306+
  }
}

async function fetchAfes(base: string, token: string, scope: 'default' | 'all'): Promise<AfeOption[]> {
  const filter = scope === 'all'
    ? []
    : [
        { Column: 'STATUS_DESC', Operator: '=', Value: 'Fully Approved' },
        { Column: 'CUSTOM/OPERATOR_STATUS', Operator: '=', Value: 'Operated' },
      ]
  const res = await fetch(`${base}/api/Documents/Reporting/Execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      AuthenticationToken: token,
      DocumentType: 'AFE',
      ReportType: 'AFE',
      Columns: [
        'AFENUMBER_DOC/AFENUMBER',
        'DESCRIPTION',
        'CUSTOM/AFE_TYPE',
        'STATUS_DESC',
      ],
      SortColumns: [],
      Filter: filter,
      GlobalSearch: '',
      MaxRowCount: 5000,
      SkipRows: 0,
      IncludeArchived: false,
      IncludeRawData: false,
    }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Report fetch failed: ${res.status} ${body.slice(0, 300)}`)
  }

  const payload = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = Array.isArray(payload?.Rows) ? payload.Rows : []

  return rows
    .map((r) => {
      const data = Array.isArray(r?.Data) ? r.Data : []
      const number = String(data[0] ?? '').trim()
      if (!number) return null
      return {
        number,
        description: String(data[1] ?? ''),
        type: data[2] ? String(data[2]) : null,
        status: data[3] ? String(data[3]) : null,
      } as AfeOption
    })
    .filter((x): x is AfeOption => x !== null)
    .sort((a, b) => a.number.localeCompare(b.number))
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const refresh = searchParams.get('refresh') === '1'
    const scope: 'default' | 'all' = searchParams.get('scope') === 'all' ? 'all' : 'default'

    const activeCache = scope === 'all' ? cacheAll : cache
    if (!refresh && activeCache && Date.now() - activeCache.ts < CACHE_TTL) {
      return NextResponse.json(activeCache.data)
    }

    const base = (process.env.AFE_EXECUTE_BASE_URL || '').replace(/\/+$/, '')
    const id = process.env.AFE_EXECUTE_API_KEY_ID
    const key = process.env.AFE_EXECUTE_API_KEY

    if (!base || !id || !key) {
      return NextResponse.json({ error: 'AFE Execute credentials not configured' }, { status: 500 })
    }

    const token = await login(base, id, key)
    try {
      const afes = await fetchAfes(base, token, scope)
      if (scope === 'all') cacheAll = { data: afes, ts: Date.now() }
      else cache = { data: afes, ts: Date.now() }
      return NextResponse.json(afes)
    } finally {
      await logout(base, token)
    }
  } catch (error) {
    console.error('AFE route error:', error)
    const message = error instanceof Error ? error.message : 'Failed to fetch AFE list'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
