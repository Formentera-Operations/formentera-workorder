import { NextResponse } from 'next/server'
import { clientRedirectUris, issueCode } from '@/lib/mcp-oauth'
import { getUserScope } from '@/lib/user-scope'

export const dynamic = 'force-dynamic'

/**
 * Authorization endpoint.
 *
 * This route is deliberately LEFT UNDER middleware.ts, so an unauthenticated
 * visitor is bounced to /login?next=<this url> and returns here after Microsoft
 * SSO — that's how the connecting person's identity gets established.
 *
 * GET renders a consent screen; POST issues the code. The two-step exists on
 * purpose: auto-approving on GET would let a malicious client that registered
 * via open DCR obtain a token just by getting a signed-in user to click a link.
 */

type Params = {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  method: string
}

function readParams(url: URL): Params {
  return {
    clientId: url.searchParams.get('client_id') || '',
    redirectUri: url.searchParams.get('redirect_uri') || '',
    state: url.searchParams.get('state') || '',
    codeChallenge: url.searchParams.get('code_challenge') || '',
    method: url.searchParams.get('code_challenge_method') || '',
  }
}

/** Returns an error message if the request is not a valid authorization request. */
function validate(p: Params): string | null {
  if (!p.clientId) return 'Missing client_id.'
  if (!p.redirectUri) return 'Missing redirect_uri.'
  if (!p.codeChallenge) return 'Missing code_challenge (PKCE is required).'
  if (p.method !== 'S256') return 'code_challenge_method must be S256.'

  const registered = clientRedirectUris(p.clientId)
  if (!registered) return 'Unknown or expired client_id.'
  // Exact match only — prefix matching is how redirect_uri hijacking happens.
  if (!registered.includes(p.redirectUri)) return 'redirect_uri does not match this client.'
  return null
}

function errorPage(message: string, status: number) {
  return new NextResponse(
    page(`<h1>Cannot connect</h1><p class="err">${escapeHtml(message)}</p>`),
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

function page(inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to Work Orders</title>
<style>
 body{font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#111;
      display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
 .card{max-width:420px;width:100%}
 h1{color:#1B2E6B;font-size:20px;margin:0 0 12px}
 p{color:#444;font-size:14px;line-height:1.5}
 .err{color:#b91c1c}
 ul{color:#444;font-size:14px;line-height:1.6;padding-left:18px}
 button{width:100%;background:#1B2E6B;color:#fff;border:0;border-radius:8px;
        padding:12px;font-size:14px;font-weight:600;cursor:pointer;margin-top:16px}
 .muted{color:#888;font-size:12px;margin-top:16px}
</style></head><body><div class="card">${inner}</div></body></html>`
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const p = readParams(url)

  const invalid = validate(p)
  if (invalid) return errorPage(invalid, 400)

  // Middleware guarantees a session; this additionally requires an employees
  // row, since that is what defines which assets they may read.
  const scope = await getUserScope()
  if (!scope) {
    return errorPage('Your account has no employee record, so no assets can be assigned to this connection.', 403)
  }

  const assetText =
    scope.assets.length > 0
      ? scope.assets.map((a) => `<li>${escapeHtml(a)}</li>`).join('')
      : '<li><strong>All assets</strong> (your role has no asset restriction)</li>'

  return new NextResponse(
    page(`
      <h1>Connect to Work Orders</h1>
      <p>Claude is asking to read your work order tickets as
         <strong>${escapeHtml(scope.email)}</strong>.</p>
      <p>It will be able to read tickets for:</p>
      <ul>${assetText}</ul>
      <p>This connection is <strong>read-only</strong>. It cannot create, edit,
         or delete tickets.</p>
      <form method="POST">
        <input type="hidden" name="client_id" value="${escapeHtml(p.clientId)}">
        <input type="hidden" name="redirect_uri" value="${escapeHtml(p.redirectUri)}">
        <input type="hidden" name="state" value="${escapeHtml(p.state)}">
        <input type="hidden" name="code_challenge" value="${escapeHtml(p.codeChallenge)}">
        <input type="hidden" name="code_challenge_method" value="${escapeHtml(p.method)}">
        <button type="submit">Allow access</button>
      </form>
      <p class="muted">This connection stays active for 30 days, renewing itself
         in the background. Your asset list is re-checked on every request, so
         changes to your assignments apply immediately.</p>
    `),
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  )
}

export async function POST(req: Request) {
  const form = await req.formData()
  const p: Params = {
    clientId: String(form.get('client_id') || ''),
    redirectUri: String(form.get('redirect_uri') || ''),
    state: String(form.get('state') || ''),
    codeChallenge: String(form.get('code_challenge') || ''),
    method: String(form.get('code_challenge_method') || ''),
  }

  const invalid = validate(p)
  if (invalid) return errorPage(invalid, 400)

  const scope = await getUserScope()
  if (!scope) return errorPage('Not authorized.', 403)

  const code = issueCode({
    email: scope.email,
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
  })

  const dest = new URL(p.redirectUri)
  dest.searchParams.set('code', code)
  if (p.state) dest.searchParams.set('state', p.state)
  return NextResponse.redirect(dest.toString(), 302)
}
