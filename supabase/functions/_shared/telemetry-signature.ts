function requireEnv(name: string) {
  const value = String(Deno.env.get(name) ?? '').trim()
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

function normalizeRequestId(value: string) {
  return String(value || '').trim().slice(0, 120)
}

function normalizeTimestamp(value: string) {
  return String(value || '').trim().slice(0, 24)
}

async function signRaw(message: string) {
  const secret = requireEnv('TELEMETRY_SIGNING_SECRET')
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function signTelemetryContext(requestId: string, requestTs: string) {
  const rid = normalizeRequestId(requestId)
  const rts = normalizeTimestamp(requestTs)
  if (!rid || !rts) throw new Error('Missing request id or timestamp for telemetry signing')
  return signRaw(`${rid}.${rts}`)
}

export async function verifyTelemetryContextSignature(requestId: string, requestTs: string, requestSig: string) {
  const rid = normalizeRequestId(requestId)
  const rts = normalizeTimestamp(requestTs)
  const sig = String(requestSig || '').trim().toLowerCase()
  if (!rid || !rts || !sig) return false

  const expected = await signRaw(`${rid}.${rts}`)
  return sig === expected
}

export function isTelemetryTimestampFresh(requestTs: string, maxAgeSeconds = 7200) {
  const parsed = Number(requestTs)
  if (!Number.isFinite(parsed) || parsed <= 0) return false

  const now = Math.floor(Date.now() / 1000)
  const age = now - parsed
  if (age < -300) return false
  return age <= maxAgeSeconds
}
