'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Wrench } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createSupabaseBrowserClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      window.location.href = '/'
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top navy bar */}
      <div className="bg-[#1B2E6B] h-1.5 w-full" />

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="w-12 h-12 bg-[#1B2E6B] flex items-center justify-center rounded">
              <span className="text-white font-bold text-xl">F</span>
            </div>
            <span className="text-3xl font-bold tracking-widest text-[#1B2E6B]">FORMENTERA</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 flex items-center justify-center gap-1.5">
            <Wrench size={13} /> Work Order App
          </p>
        </div>

        {/* Login form */}
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Sign in to continue</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="you@formenteraops.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary mt-2"
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>

      <div className="text-center pb-8 text-xs text-gray-300">
        © {new Date().getFullYear()} Formentera Operations
      </div>
    </div>
  )
}
