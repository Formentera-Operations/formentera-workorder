import crypto from 'crypto'

/**
 * Minimal OAuth 2.1 primitives for the MCP server.
 *
 * Tokens are stateless HMAC-signed blobs rather than database rows. That keeps
 * this branch free of migrations, but it has a real consequence: an issued
 * token CANNOT be revoked before it expires. TTLs are therefore short, and a
 * token table should land before this is opened past a single operator.
 *
 * Rotating MCP_TOKEN_SECRET invalidates every outstanding token at once, which
 * is the only revocation lever available today.
 */

const ACCESS_TOKEN_TTL_SEC = 60 * 60 * 8 // 8 hours — one working day
const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30 // 30 days
const CODE_TTL_SEC = 60 // authorization codes are single-use and short-lived

function secret(): string {
  const s = process.env.MCP_TOKEN_SECRET
  // Fail closed. A default/empty secret would make every token forgeable.
  if (!s || s.length < 32) {
    throw new Error('MCP_TOKEN_SECRET is missing or too short (need >= 32 chars)')
  }
  return s
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

function hmac(data: string): string {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url')
}

export type TokenType = 'client' | 'code' | 'access' | 'refresh'

type Payload = Record<string, unknown> & { typ: TokenType; exp: number }

export function signToken(typ: TokenType, claims: Record<string, unknown>, ttlSec: number): string {
  const payload: Payload = { ...claims, typ, exp: Math.floor(Date.now() / 1000) + ttlSec }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${hmac(body)}`
}

export function verifyToken(token: string, expected: TokenType): Payload | null {
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.', 2)
  if (!body || !sig) return null

  // timingSafeEqual throws on length mismatch, so compare lengths first.
  const want = hmac(body)
  if (want.length !== sig.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null

  let payload: Payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (payload.typ !== expected) return null
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

/**
 * Client registration is stateless too: the client_id *is* a signed token
 * carrying the redirect URIs it registered. Nothing to store, and a client_id
 * can't be forged to point at an attacker-controlled redirect.
 */
export function issueClientId(redirectUris: string[]): string {
  // 10 years — clients are long-lived; the signature is what matters.
  return signToken('client', { redirect_uris: redirectUris }, 60 * 60 * 24 * 365 * 10)
}

export function clientRedirectUris(clientId: string): string[] | null {
  const payload = verifyToken(clientId, 'client')
  if (!payload) return null
  const uris = payload.redirect_uris
  return Array.isArray(uris) ? (uris as string[]) : null
}

export function issueCode(params: {
  email: string
  clientId: string
  redirectUri: string
  codeChallenge: string
}): string {
  return signToken('code', {
    email: params.email,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    cc: params.codeChallenge,
  }, CODE_TTL_SEC)
}

export function issueAccessToken(email: string): string {
  return signToken('access', { email }, ACCESS_TOKEN_TTL_SEC)
}

/**
 * Refresh tokens let the client renew silently instead of sending the operator
 * back through Microsoft SSO every few hours.
 *
 * The security tradeoff is real and worth naming: a 30-day refresh token that
 * cannot be revoked is a much bigger liability than a short access token. Two
 * things limit it — the token endpoint re-checks the employees row on every
 * refresh (so deleting someone's row cuts them off), and rotating
 * MCP_TOKEN_SECRET still invalidates everything at once.
 */
export function issueRefreshToken(email: string): string {
  return signToken('refresh', { email }, REFRESH_TOKEN_TTL_SEC)
}

export const accessTokenTtl = ACCESS_TOKEN_TTL_SEC
export const refreshTokenTtl = REFRESH_TOKEN_TTL_SEC

/** PKCE S256 only — the plain method is not accepted. */
export function verifyPkce(codeVerifier: string, challenge: string): boolean {
  if (!codeVerifier || !challenge) return false
  const computed = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  if (computed.length !== challenge.length) return false
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(challenge))
}

/** Read a Bearer token from an Authorization header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1] : null
}

/** Absolute origin of this deployment, used to build metadata URLs. */
export function originFrom(req: Request): string {
  const url = new URL(req.url)
  // Vercel terminates TLS upstream, so req.url can say http on the preview.
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host
  return `${proto}://${host}`
}
