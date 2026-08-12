import { NextResponse } from 'next/server'
import { originFrom } from '@/lib/mcp-oauth'

export const dynamic = 'force-dynamic'

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 * Served at /.well-known/oauth-authorization-server via a rewrite in
 * next.config.js — Next ignores app/ directories that start with a dot.
 */
export async function GET(req: Request) {
  const origin = originFrom(req)
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    // Public clients only: MCP clients can't hold a secret, so PKCE is the
    // protection rather than client authentication.
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['workorders:read'],
  })
}
