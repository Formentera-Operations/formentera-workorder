import { createSupabaseServerClient } from '@/lib/supabase-server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    // Log server-side only — the redirect stays generic so we don't surface
    // auth internals in a URL the user can see or share.
    console.error('[auth/callback] exchangeCodeForSession failed:', {
      message: error.message,
      status: error.status,
      code: error.code,
    })
  } else {
    // No ?code= means the provider bounced us before issuing one — Entra and
    // Supabase both report why via these params.
    console.error('[auth/callback] no code in callback:', {
      error: searchParams.get('error'),
      error_code: searchParams.get('error_code'),
      error_description: searchParams.get('error_description'),
      params: [...searchParams.keys()],
    })
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
