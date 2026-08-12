import { NextResponse } from 'next/server'
import { originFrom } from '@/lib/mcp-oauth'

export const dynamic = 'force-dynamic'

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) — tells an MCP client
 * which authorization server guards this resource. Served at
 * /.well-known/oauth-protected-resource via a next.config.js rewrite.
 */
export async function GET(req: Request) {
  const origin = originFrom(req)
  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ['workorders:read'],
    bearer_methods_supported: ['header'],
  })
}
