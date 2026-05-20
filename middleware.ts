import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session so it doesn't expire
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Allow auth routes through
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    // If already logged in and hitting login, honor ?next= so a deeplink
    // (e.g. weekly-reminder email button) can still resume after a manual
    // refresh of the login page.
    if (user && pathname === '/login') {
      const next = request.nextUrl.searchParams.get('next')
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
      return NextResponse.redirect(new URL(safeNext, request.url))
    }
    return supabaseResponse
  }

  // Protect all other routes — redirect to login if not authenticated.
  // Preserve the originally requested path + query in ?next= so the login
  // flow can return the user there after sign-in (used by deeplinks from
  // outside the app, e.g. weekly reminder email buttons).
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    const intended = pathname + (request.nextUrl.search || '')
    if (intended && intended !== '/') loginUrl.searchParams.set('next', intended)
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // api/cron/* is excluded so Vercel Cron and external automation can hit
    // those endpoints with Bearer auth instead of being redirected to
    // /login. The cron routes do their own Authorization header check.
    '/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
