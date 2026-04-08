import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, serverError, json } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'

const SPREADSHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Groceries'
const VALID_FAMILIES = ['Ekanger', 'Dzambo', 'Schambach', 'Montanez', 'Habibi', 'Donaldson']

async function getGoogleAccessToken(): Promise<string> {
  const rawKey = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')
  if (!rawKey) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY')

  const key = JSON.parse(rawKey)
  const now = Math.floor(Date.now() / 1000)

  const claimSet = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const header = b64url({ alg: 'RS256', typ: 'JWT' })
  const payload = b64url(claimSet)
  const signingInput = `${header}.${payload}`

  const pemBody = key.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  )

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  const jwt = `${signingInput}.${sigB64}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    throw new Error(`Google token exchange failed: ${err}`)
  }

  const { access_token } = await tokenRes.json()
  return access_token
}

async function appendRow(accessToken: string, values: string[]) {
  const range = encodeURIComponent(`${SHEET_NAME}!C5:E`)
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [values] }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Sheets API error: ${err}`)
  }

  return res.json()
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  let body: { item?: unknown; qty?: unknown; family?: unknown }
  try {
    body = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const item = String(body.item ?? '').trim()
  const qty = String(body.qty ?? '').trim()
  const family = String(body.family ?? '').trim()

  if (!item) return badRequest('Item is required')
  if (!qty) return badRequest('Quantity is required')
  if (!VALID_FAMILIES.includes(family)) return badRequest('Invalid family selection')

  try {
    const accessToken = await getGoogleAccessToken()
    await appendRow(accessToken, [item, qty, family])
  } catch (err) {
    console.error('[append-grocery]', err)
    return serverError('Failed to write to spreadsheet', String(err))
  }

  return json({ ok: true })
})
