import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const TENANT_ID = process.env.MS_TENANT_ID!
const CLIENT_ID = process.env.MS_CLIENT_ID!
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET!
const SENDER = process.env.MS_SENDER_EMAIL!

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const to = (searchParams.get('to') ?? '').trim()

  if (!to) {
    return NextResponse.json({ error: 'Missing ?to= parameter' }, { status: 400 })
  }
  // Safety: only allow sending to formenteraops.com addresses via this debug route
  if (!to.toLowerCase().endsWith('@formenteraops.com')) {
    return NextResponse.json(
      { error: 'Recipient must be @formenteraops.com' },
      { status: 400 },
    )
  }

  // Step 1 — token
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    },
  )
  const tokenBody = await tokenRes.text()
  if (!tokenRes.ok) {
    return NextResponse.json(
      {
        stage: 'token',
        ok: false,
        status: tokenRes.status,
        body: safeParse(tokenBody),
      },
      { status: 500 },
    )
  }
  const { access_token } = JSON.parse(tokenBody) as { access_token: string }

  // Step 2 — sendMail
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`
  const payload = {
    message: {
      subject: 'Formentera mailer test',
      body: {
        contentType: 'HTML',
        content: `<p>This is a debug test sent from <b>${SENDER}</b> at ${new Date().toISOString()}.</p>`,
      },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: false,
  }

  const sendRes = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const sendBody = await sendRes.text()

  return NextResponse.json({
    stage: 'sendMail',
    ok: sendRes.ok,
    status: sendRes.status,
    sender: SENDER,
    recipient: to,
    graphUrl: sendUrl,
    requestId: sendRes.headers.get('request-id'),
    clientRequestId: sendRes.headers.get('client-request-id'),
    body: safeParse(sendBody),
  }, { status: sendRes.ok ? 200 : 500 })
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
