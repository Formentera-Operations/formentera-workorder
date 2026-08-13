import { NextResponse } from 'next/server'
import {
  accessTokenTtl,
  issueAccessToken,
  issueRefreshToken,
  verifyPkce,
  verifyToken,
} from '@/lib/mcp-oauth'
import { scopeForEmail } from '@/lib/user-scope'

export const dynamic = 'force-dynamic'

function bad(error: string, description?: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status })
}

function tokenResponse(email: string) {
  return NextResponse.json(
    {
      access_token: issueAccessToken(email),
      refresh_token: issueRefreshToken(email),
      token_type: 'Bearer',
      expires_in: accessTokenTtl,
      scope: 'workorders:read',
    },
    { headers: { 'cache-control': 'no-store' } }
  )
}

/**
 * Token endpoint — exchanges an authorization code for an access token.
 *
 * Public client, so there is no client secret to check; PKCE is what binds the
 * code to whoever started the flow.
 *
 * Note: codes are stateless and therefore NOT single-use — a replayed code
 * works until it expires. The 60s TTL is what limits that window. Storing
 * issued codes would close it properly and should come with the token table.
 */
export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return bad('invalid_request', 'Expected application/x-www-form-urlencoded')
  }

  const grantType = String(form.get('grant_type') || '')

  // Silent renewal. Re-checking the employees row here is the one revocation
  // lever stateless tokens allow: remove someone's row and their next refresh
  // fails, rather than them holding access for the rest of the 30 days.
  if (grantType === 'refresh_token') {
    const payload = verifyToken(String(form.get('refresh_token') || ''), 'refresh')
    if (!payload) return bad('invalid_grant', 'Refresh token is invalid or expired')

    const email = String(payload.email || '')
    const scope = await scopeForEmail(email)
    if (!scope) return bad('invalid_grant', 'No employee record for this account')

    return tokenResponse(scope.email)
  }

  if (grantType !== 'authorization_code') {
    return bad('unsupported_grant_type')
  }

  const code = String(form.get('code') || '')
  const redirectUri = String(form.get('redirect_uri') || '')
  const clientId = String(form.get('client_id') || '')
  const verifier = String(form.get('code_verifier') || '')

  const payload = verifyToken(code, 'code')
  if (!payload) return bad('invalid_grant', 'Code is invalid or expired')

  // The code is bound to the client and redirect_uri it was issued for.
  if (payload.client_id !== clientId) return bad('invalid_grant', 'Code was issued to another client')
  if (payload.redirect_uri !== redirectUri) return bad('invalid_grant', 'redirect_uri mismatch')

  if (!verifyPkce(verifier, String(payload.cc || ''))) {
    return bad('invalid_grant', 'PKCE verification failed')
  }

  const email = String(payload.email || '')
  if (!email) return bad('invalid_grant', 'Code carries no subject')

  return tokenResponse(email)
}
