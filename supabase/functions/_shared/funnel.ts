import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

type FunnelEventParams = {
  journey: string
  step: string
  status: string
  requestId?: string | null
  userId?: string | null
  email?: string | null
  inviteEmail?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  context?: Record<string, unknown>
}

function requireEnv(name: string) {
  const value = String(Deno.env.get(name) ?? '').trim()
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

function normalizeEmail(value: string | null | undefined) {
  const raw = String(value ?? '').trim().toLowerCase()
  return raw || null
}

function cleanText(value: string | null | undefined, max = 240) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  return raw.slice(0, max)
}

async function sha256Hex(input: string) {
  const encoded = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashEmailForTelemetry(email: string | null | undefined) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null

  const salt = requireEnv('TELEMETRY_HASH_SALT')
  return sha256Hex(`${salt}:${normalized}`)
}

export async function writeFunnelEvent(admin: SupabaseClient, params: FunnelEventParams) {
  try {
    const emailHash = await hashEmailForTelemetry(params.email)
    const inviteEmailHash = await hashEmailForTelemetry(params.inviteEmail)

    await admin.from('funnel_events').insert({
      journey: cleanText(params.journey, 80),
      step: cleanText(params.step, 80),
      status: cleanText(params.status, 40),
      request_id: cleanText(params.requestId, 120),
      user_id: params.userId ?? null,
      email_hash: emailHash,
      invite_email_hash: inviteEmailHash,
      error_code: cleanText(params.errorCode, 120),
      error_message: cleanText(params.errorMessage, 600),
      context: params.context ?? {},
    })
  } catch (err) {
    console.error('Failed to write funnel event', err)
  }
}
