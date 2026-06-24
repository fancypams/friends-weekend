import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'

const SPREADSHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Flight Info'
const HEADER = ['Family', 'Direction', 'Home Airport', 'Flight', 'Date', 'Depart', 'Arrive', 'Origin', 'Destination', 'Traveler']

type ProfileRow = {
  family: string | null
  display_name: string | null
}

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

async function readRows(accessToken: string): Promise<string[][]> {
  const range = encodeURIComponent(`${SHEET_NAME}!A:J`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Sheets read failed: ${err}`)
  }

  const body = await res.json()
  return Array.isArray(body.values) ? body.values : []
}

async function replaceRows(accessToken: string, rows: string[][]) {
  const range = encodeURIComponent(`${SHEET_NAME}!A:J`)
  const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:clear`
  const updateUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}` +
    '?valueInputOption=USER_ENTERED'

  const clearRes = await fetch(clearUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })

  if (!clearRes.ok) {
    const err = await clearRes.text()
    throw new Error(`Sheets clear failed: ${err}`)
  }

  const updateRes = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  })

  if (!updateRes.ok) {
    const err = await updateRes.text()
    throw new Error(`Sheets update failed: ${err}`)
  }
}

function normalizeRow(row: unknown[]) {
  return HEADER.map((_, index) => String(row[index] ?? '').trim())
}

function isHeaderRow(row: unknown[]) {
  const first = String(row[0] ?? '').trim().toLowerCase()
  const second = String(row[1] ?? '').trim().toLowerCase()
  return (first === 'family' || first === 'family name') && second === 'direction'
}

function normalizeHeader(row: unknown[]) {
  const header = normalizeRow(row)
  return HEADER.map((fallback, index) => header[index] || fallback)
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireAdmin: true, requireActive: true })
  if (!auth.ok) return auth.response

  let dryRun = true
  try {
    const body = await req.json().catch(() => ({}))
    dryRun = body?.dryRun !== false
  } catch {
    dryRun = true
  }

  const { data: profiles, error: profilesErr } = await auth.admin
    .from('profiles')
    .select('family,display_name')
    .eq('active', true)
    .order('family', { ascending: true })
    .order('display_name', { ascending: true, nullsFirst: false })

  if (profilesErr) return serverError('Failed to load profiles', profilesErr.message)

  const travelersByFamily = new Map<string, string[]>()
  ;((profiles ?? []) as ProfileRow[]).forEach((profile) => {
    const family = String(profile.family ?? '').trim()
    const name = String(profile.display_name ?? '').trim()
    if (!family || !name) return
    const names = travelersByFamily.get(family) ?? []
    if (!names.includes(name)) names.push(name)
    travelersByFamily.set(family, names)
  })

  try {
    const accessToken = await getGoogleAccessToken()
    const rows = await readRows(accessToken)
    const header = rows.length > 0 && isHeaderRow(rows[0]) ? normalizeHeader(rows[0]) : HEADER
    const bodyRows = rows.length > 0 && isHeaderRow(rows[0]) ? rows.slice(1) : rows

    const migratedRows: string[][] = []
    const skipped: Array<{ rowNumber: number; family: string; reason: string }> = []
    let legacyRows = 0
    let preservedRows = 0

    bodyRows.forEach((row, index) => {
      const normalized = normalizeRow(row)
      const family = normalized[0]
      const traveler = normalized[9]
      const rowNumber = index + 2

      if (traveler) {
        migratedRows.push(normalized)
        preservedRows += 1
        return
      }

      legacyRows += 1
      const travelers = travelersByFamily.get(family) ?? []
      if (travelers.length === 0) {
        skipped.push({ rowNumber, family, reason: 'No active profiles with display names for family' })
        return
      }

      travelers.forEach((name) => {
        migratedRows.push([...normalized.slice(0, 9), name])
      })
    })

    const outputRows = [header, ...migratedRows]
    if (!dryRun) await replaceRows(accessToken, outputRows)

    return json({
      ok: true,
      dryRun,
      legacyRows,
      preservedRows,
      outputRows: migratedRows.length,
      skipped,
    })
  } catch (err) {
    console.error('[migrate-flight-travelers]', err)
    return serverError('Failed to migrate flight travelers', String(err))
  }
})
