'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import Image from 'next/image'
import { Wrench } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [msLoading, setMsLoading] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const supabase = createSupabaseBrowserClient()

  async function handleMicrosoftLogin() {
    setMsLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email',
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setError(error.message)
      setMsLoading(false)
    }
  }

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
            <Image
              src="/formentera_logo.jpg"
              alt="Formentera"
              width={48}
              height={48}
              className="rounded"
              priority
            />
            <span className="text-3xl font-bold tracking-widest text-[#1B2E6B]">FORMENTERA</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 flex items-center justify-center gap-1.5">
            <Wrench size={13} /> Work Order App
          </p>
        </div>

        {/* Login form */}
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Sign in to continue</h2>

          {/* Microsoft SSO — primary */}
          <button
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={msLoading}
            className="w-full flex items-center justify-center gap-3 bg-[#1B2E6B] text-white rounded-lg px-4 py-3 text-sm font-semibold hover:bg-[#152358] transition-colors disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 21 21">
              <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
              <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
              <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            {msLoading ? 'Redirecting…' : 'Sign in with Microsoft'}
          </button>

          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="w-full mt-2 text-sm text-gray-400 hover:text-[#1B2E6B] transition-colors underline underline-offset-2"
          >
            Need help signing in?
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or sign in with email</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="Enter your email"
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
              className="w-full border border-gray-300 text-gray-700 font-medium py-3 px-4 rounded-lg flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>

      {/* Help modal */}
      {showHelp && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowHelp(false)} />
          <div className="fixed inset-4 z-50 bg-white rounded-2xl shadow-xl overflow-y-auto max-w-lg mx-auto my-auto max-h-[85vh]">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-[#1B2E6B]">How to Sign In</h3>
              <button onClick={() => setShowHelp(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="px-5 py-4 space-y-5">
              <div className="flex gap-3">
                <span className="w-7 h-7 bg-[#1B2E6B] text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">1</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Tap &quot;Sign in with Microsoft&quot;</p>
                  <p className="text-xs text-gray-500 mt-1">Tap the button on the login screen. You do not need to type in the email and password fields above it.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-7 h-7 bg-[#1B2E6B] text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Enter Your Microsoft Credentials</p>
                  <p className="text-xs text-gray-500 mt-1">Enter your <strong>@formenteraops.com</strong> email and password. This is the same one you use for Outlook, Teams, and other Microsoft apps.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-7 h-7 bg-[#1B2E6B] text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">3</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Approve the Sign-In Request</p>
                  <p className="text-xs text-gray-500 mt-1">Microsoft will show a number on screen and send a notification to your <strong>Outlook mobile app</strong>. Open the Outlook app and enter the number to approve.</p>
                  <div className="bg-amber-50 border-l-2 border-amber-400 px-3 py-2 rounded-r-lg mt-2">
                    <p className="text-xs text-amber-800"><strong>Don&apos;t see the notification?</strong> Swipe down to refresh your Outlook app. You can also tap &quot;I can&apos;t use my Outlook mobile app right now&quot; for other options.</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-7 h-7 bg-[#1B2E6B] text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">4</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">&quot;Stay Signed In?&quot; — Tap Yes</p>
                  <p className="text-xs text-gray-500 mt-1">Tap <strong>Yes</strong> so you won&apos;t have to repeat this process every time you open the app.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-7 h-7 bg-[#10b981] text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">&#10003;</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">You&apos;re In!</p>
                  <p className="text-xs text-gray-500 mt-1">You&apos;ll be redirected to the app. From here you can submit tickets, view your work orders, and see dashboards.</p>
                </div>
              </div>
              <div className="bg-green-50 border-l-2 border-green-400 px-3 py-2 rounded-r-lg">
                <p className="text-xs text-green-800"><strong>Tip:</strong> Add this app to your home screen for quick access. In Safari, tap the share icon → &quot;Add to Home Screen.&quot; In Chrome, tap the menu → &quot;Add to Home Screen.&quot;</p>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="text-center pb-8 text-xs text-gray-300">
        © {new Date().getFullYear()} Formentera Operations
      </div>
    </div>
  )
}
