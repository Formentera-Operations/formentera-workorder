import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

/**
 * Who the caller is, resolved from a verified token — never from request input.
 *
 * `assets` is the authoritative list of assets this person may see. An EMPTY
 * array means unrestricted (admins/analysts), matching the existing convention
 * in the app: `if (assets.length > 0) query.in('asset', assets)`. The important
 * difference from the old client-supplied version is that "unrestricted" now
 * has to come from the employees table, not from a caller sending `[]`.
 */
export type UserScope = {
  email: string
  name: string
  role: string
  assets: string[]
}

/** Service-role client for the employees lookup — read-only use here. */
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Look up the employee row for a verified email address.
 *
 * Matching is `ilike` to mirror AuthProvider — work_email casing in the
 * employees table is inconsistent, so an exact `eq` silently misses people
 * and would hand them an empty asset list (i.e. unrestricted).
 */
export async function scopeForEmail(email: string): Promise<UserScope | null> {
  if (!email) return null
  const { data, error } = await adminClient()
    .from('employees')
    .select('name, role, assets, work_email')
    .ilike('work_email', email)
    .single()

  // Fail closed: no employee row means no access, rather than defaulting to
  // an empty asset list, which every caller reads as "all assets".
  if (error || !data) return null

  return {
    email: (data.work_email as string) || email,
    name: (data.name as string) || '',
    role: (data.role as string) || 'field_user',
    assets: (data.assets as string[]) || [],
  }
}

/**
 * Resolve the caller of a cookie-authenticated request (the Next.js app).
 *
 * Uses getClaims(), which verifies the JWT signature locally against the
 * project's published keys — same approach as middleware.ts, so no extra
 * round-trip to the auth server on every API call.
 */
export async function getUserScope(): Promise<UserScope | null> {
  const supabase = createSupabaseServerClient()
  const { data } = await supabase.auth.getClaims()
  const email = (data?.claims as { email?: string } | undefined)?.email
  if (!email) return null
  return await scopeForEmail(email)
}

/**
 * The single choke point every read must pass through.
 *
 * Kept deliberately tiny and boring: if a tool forgets to call this, that's a
 * leak, so the rule is that no query builder escapes a tool function without
 * going through it.
 */
export function applyAssetScope<T extends { in: (col: string, vals: string[]) => T }>(
  query: T,
  scope: UserScope,
  column = 'asset'
): T {
  if (scope.assets.length === 0) return query
  return query.in(column, scope.assets)
}
