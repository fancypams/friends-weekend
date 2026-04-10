import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, forbidden, json, serverError } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/auth.ts'
import { writeFunnelEvent } from '../_shared/funnel.ts'
import { isTelemetryTimestampFresh, verifyTelemetryContextSignature } from '../_shared/telemetry-signature.ts'

type FunnelPayload = {
  journey?: string
  step?: string
  status?: string
  request_id?: string
  request_ts?: string
  request_sig?: string
  email?: string
  invite_email?: string
  error_code?: string
  error_message?: string
  context?: Record<string, unknown>
}

const ALLOWED_STEPS = new Set([
  'magic_link_clicked',
  'callback_session_exchange',
  'post_login_redirect',
])

const ALLOWED_STATUS = new Set([
  'observed',
  'success',
  'failed',
  'expired',
  'invalid',
  'rate_limited',
])
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000
const RATE_LIMIT_MAX_EVENTS = 120
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function clean(value: unknown, max = 120) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.slice(0, max)
}

function cleanSignature(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase()
  return raw.slice(0, 512)
}

function shouldEnforceTelemetrySignature() {
  const raw = String(Deno.env.get('TELEMETRY_ENFORCE_SIGNATURE') ?? '').trim().toLowerCase()
  if (!raw) return false
  return TRUE_VALUES.has(raw)
}

function parseAllowedOrigins() {
  const explicit = String(Deno.env.get('TELEMETRY_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const publicAppUrl = String(Deno.env.get('PUBLIC_APP_URL') ?? '').trim()
  let fromApp = ''
  try {
    fromApp = publicAppUrl ? new URL(publicAppUrl).origin : ''
  } catch {
    fromApp = ''
  }

  const defaults = [
    fromApp,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].filter(Boolean)

  return new Set([...defaults, ...explicit])
}

function getOrigin(req: Request) {
  const rawOrigin = String(req.headers.get('origin') || '').trim()
  if (rawOrigin) return rawOrigin

  const referer = String(req.headers.get('referer') || '').trim()
  if (!referer) return ''
  try {
    return new URL(referer).origin
  } catch {
    return ''
  }
}

function readClientIp(req: Request) {
  const forwarded = String(req.headers.get('x-forwarded-for') || '').trim()
  if (!forwarded) return ''
  return forwarded.split(',')[0]?.trim() || ''
}

async function isRateLimited(admin: ReturnType<typeof createAdminClient>, clientIp: string) {
  if (!clientIp) return false
  const cutoffIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()

  const { count, error } = await admin
    .from('funnel_events')
    .select('id', { count: 'exact', head: true })
    .eq('journey', 'invite_auth')
    .gte('created_at', cutoffIso)
    .eq('context->>client_ip', clientIp)

  if (error) {
    console.error('Failed rate-limit query', error)
    return false
  }

  return Number(count || 0) >= RATE_LIMIT_MAX_EVENTS
}

async function isDuplicateEvent(admin: ReturnType<typeof createAdminClient>, requestId: string, step: string, status: string) {
  if (!requestId) return false
  const cutoffIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()

  const { data, error } = await admin
    .from('funnel_events')
    .select('id')
    .eq('journey', 'invite_auth')
    .eq('request_id', requestId)
    .eq('step', step)
    .eq('status', status)
    .gte('created_at', cutoffIso)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Failed duplicate-check query', error)
    return false
  }

  return Boolean(data?.id)
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  let payload: FunnelPayload
  try {
    payload = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const journey = clean(payload.journey, 80) || 'invite_auth'
  const step = clean(payload.step, 80)
  const status = clean(payload.status, 40)
  const requestId = clean(payload.request_id, 120)
  const requestTs = clean(payload.request_ts, 24)
  const requestSig = cleanSignature(payload.request_sig)
  const enforceSignature = shouldEnforceTelemetrySignature()
  const hasSignatureContext = Boolean(requestId && requestTs && requestSig)

  let signatureStatus: 'verified' | 'missing' | 'invalid' | 'expired' = 'missing'
  if (hasSignatureContext) {
    if (!isTelemetryTimestampFresh(requestTs, 7200)) {
      signatureStatus = 'expired'
    } else {
      const isValidSignature = await verifyTelemetryContextSignature(requestId, requestTs, requestSig)
      signatureStatus = isValidSignature ? 'verified' : 'invalid'
    }
  }

  if (!step || !ALLOWED_STEPS.has(step)) {
    return badRequest('Invalid telemetry step')
  }

  if (!status || !ALLOWED_STATUS.has(status)) {
    return badRequest('Invalid telemetry status')
  }
  if (enforceSignature && signatureStatus === 'missing') {
    return forbidden('Missing telemetry signature context')
  }
  if (enforceSignature && signatureStatus === 'expired') {
    return forbidden('Telemetry signature expired')
  }
  if (enforceSignature && signatureStatus === 'invalid') {
    return forbidden('Invalid telemetry signature')
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return serverError('Missing Supabase environment', String(err))
  }

  const origin = getOrigin(req)
  const allowedOrigins = parseAllowedOrigins()
  if (!origin || !allowedOrigins.has(origin)) {
    return forbidden('Telemetry origin not allowed')
  }

  const clientIp = readClientIp(req)
  const rateLimited = await isRateLimited(admin, clientIp)
  if (rateLimited) {
    await writeFunnelEvent(admin, {
      journey,
      step,
      status: 'rate_limited',
      requestId,
      email: clean(payload.email, 320) || null,
      inviteEmail: clean(payload.invite_email, 320) || null,
      errorCode: 'telemetry_rate_limited',
      errorMessage: 'Telemetry event dropped due to rate limiting',
      context: {
        client_ip: clientIp || null,
        origin: origin || null,
        telemetry_signature_status: signatureStatus,
        telemetry_signature_enforced: enforceSignature,
      },
    })
    return json({ ok: true, dropped: 'rate_limited' }, 202)
  }

  if (await isDuplicateEvent(admin, requestId, step, status)) {
    return json({ ok: true, deduped: true })
  }

  await writeFunnelEvent(admin, {
    journey,
    step,
    status,
    requestId: requestId || null,
    email: clean(payload.email, 320) || null,
    inviteEmail: clean(payload.invite_email, 320) || null,
    errorCode: clean(payload.error_code, 120) || null,
    errorMessage: clean(payload.error_message, 600) || null,
    context: {
      ...(payload.context && typeof payload.context === 'object' ? payload.context : {}),
      client_ip: clientIp || null,
      origin: origin || null,
      user_agent: String(req.headers.get('user-agent') || '').trim() || null,
      telemetry_signature_status: signatureStatus,
      telemetry_signature_enforced: enforceSignature,
    },
  })

  return json({ ok: true })
})
