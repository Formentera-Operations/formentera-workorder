import { NextResponse } from 'next/server'
import { accessTokenTtl, issueAccessToken, verifyPkce, verifyToken } from '@/lib/mcp-oauth'

export const dynamic = 'force-dynamic'

function bad(error: string, description?: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status })
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

  if (String(form.get('grant_type') || '') !== 'authorization_code') {
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

  return NextResponse.json(
    {
      access_token: issueAccessToken(email),
      token_type: 'Bearer',
      expires_in: accessTokenTtl,
      scope: 'workorders:read',
    },
    { headers: { 'cache-control': 'no-store' } }
  )
}
