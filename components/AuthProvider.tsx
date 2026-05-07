'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

interface ProfileCache { role: string; assets: string[] }

function profileKey(email: string): string {
  return `auth:profile:${email.toLowerCase()}`
}

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
  } catch {
    /* quota / private mode — ignore */
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

  async function loadEmployeeProfile(email: string) {
    // Prime from localStorage first so offline reloads still know who the
    // foreman is (their role + asset assignments). Otherwise the new-ticket
    // form falls into multi-asset mode and the well dropdown is empty.
    const cached = readProfileCache(email)
    if (cached) {
      setRole(cached.role || 'field_user')
      setAssets(cached.assets || [])
    }
    try {
      const { data } = await supabase
        .from('employees')
        .select('role, assets')
        .ilike('work_email', email)
        .single()
      if (data) {
        setRole(data.role || 'field_user')
        setAssets(data.assets || [])
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
