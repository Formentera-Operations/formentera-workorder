'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

interface ProfileCache { role: string; assets: string[] }

function profileKey(email: string): string {
  return `auth:profile:${email.toLowerCase()}`
}

// Last-known email is stored so we can prime role + assets synchronously on
// mount, before the async getSession() / getUser() round-trip completes.
// Without this, the first render always has role='field_user' and assets=[],
// causing every gated fetch (maintenance list, options) to wait ~200-400ms
// for AuthProvider to settle.
const LAST_EMAIL_KEY = 'auth:last-email'

function readProfileCache(email: string): ProfileCache | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(profileKey(email))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProfileCache
    if (typeof parsed?.role !== 'string' || !Array.isArray(parsed?.assets)) return null
    return parsed
  } catch {
    return null
  }
}

function writeProfileCache(email: string, profile: ProfileCache): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(profileKey(email), JSON.stringify(profile))
    window.localStorage.setItem(LAST_EMAIL_KEY, email.toLowerCase())
  } catch {
    /* quota / private mode — ignore */
  }
}

function readSeedProfile(): ProfileCache | null {
  if (typeof window === 'undefined') return null
  try {
    const lastEmail = window.localStorage.getItem(LAST_EMAIL_KEY)
    if (!lastEmail) return null
    return readProfileCache(lastEmail)
  } catch {
    return null
  }
}

interface AuthContextType {
  user: User | null
  session: Session | null
  userEmail: string
  userName: string
  role: string
  assets: string[]
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  userEmail: '',
  userName: '',
  role: 'field_user',
  assets: [],
  loading: true,
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<string>('field_user')
  const [assets, setAssets] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createSupabaseBrowserClient()

  // Seed role/assets from the last-known cached profile so deeplinks render
  // their auth-gated content (e.g. asset-filtered ticket list) without
  // waiting on the network getSession() round-trip. The useEffect below
  // still validates against Supabase and overwrites if anything changed.
  // Done in useEffect (not the useState initializer) to avoid SSR/hydration
  // mismatch — server has no window/localStorage.
  useEffect(() => {
    const seed = readSeedProfile()
    if (seed) {
      setRoleIfChanged(seed.role || 'field_user')
      setAssetsIfChanged(seed.assets || [])
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only swap state when content changes — otherwise every onAuthStateChange
  // (token refresh, app foreground, reconnection) creates a fresh array
  // reference for `assets` and consumers using userAssets in useEffect deps
  // refetch in a loop while the outbox is syncing.
  function setAssetsIfChanged(next: string[]) {
    setAssets(prev => (prev.length === next.length && prev.every((v, i) => v === next[i])) ? prev : next)
  }
  function setRoleIfChanged(next: string) {
    setRole(prev => prev === next ? prev : next)
  }

  async function loadEmployeeProfile(email: string) {
    // Prime from localStorage first so offline reloads still know who the
    // foreman is (their role + asset assignments). Otherwise the new-ticket
    // form falls into multi-asset mode and the well dropdown is empty.
    const cached = readProfileCache(email)
    if (cached) {
      setRoleIfChanged(cached.role || 'field_user')
      setAssetsIfChanged(cached.assets || [])
    }
    try {
      const { data } = await supabase
        .from('employees')
        .select('role, assets')
        .ilike('work_email', email)
        .single()
      if (data) {
        setRoleIfChanged(data.role || 'field_user')
        setAssetsIfChanged(data.assets || [])
        writeProfileCache(email, { role: data.role || 'field_user', assets: data.assets || [] })
      }
    } catch {
      // Offline / network error — leave cached values in place.
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user?.email) {
        loadEmployeeProfile(session.user.email).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user?.email) {
          loadEmployeeProfile(session.user.email).finally(() => setLoading(false))
        } else {
          setRole('field_user')
          setAssets([])
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const userEmail = user?.email ?? ''
  const userName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    userEmail.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ||
    ''

  return (
    <AuthContext.Provider value={{ user, session, userEmail, userName, role, assets, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
