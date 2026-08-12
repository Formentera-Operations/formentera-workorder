import { NextResponse } from 'next/server'
import { issueClientId } from '@/lib/mcp-oauth'

export const dynamic = 'force-dynamic'

/**
 * Dynamic Client Registration (RFC 7591). Claude registers itself here before
 * starting the authorization flow.
 *
 * Registration is open (no auth) as the spec intends — registering grants
 * nothing on its own. Access still requires a human to sign in at
 * /api/oauth/authorize, and the resulting token is scoped to that person's
 * assets.
 */
export async function POST(req: Request) {
  let body: { redirect_uris?: unknown; client_name?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 })
  }

  const uris = body.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === 'string')) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' },
      { status: 400 }
    )
  }

  // Only https callbacks, plus http on localhost for desktop clients that
  // spin up a loopback listener.
  for (const u of uris as string[]) {
    let parsed: URL
    try {
      parsed = new URL(u)
    } catch {
      return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 })
    }
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
      return NextResponse.json(
        { error: 'invalid_redirect_uri', error_description: 'must be https (or http on loopback)' },
        { status: 400 }
      )
    }
  }

  const clientId = issueClientId(uris as string[])

  return NextResponse.json(
    {
      client_id: clientId,
      redirect_uris: uris,
      client_name: typeof body.client_name === 'string' ? body.client_name : 'MCP Client',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    { status: 201 }
  )
}
