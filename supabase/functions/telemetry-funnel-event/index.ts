import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/auth.ts'
import { writeFunnelEvent } from '../_shared/funnel.ts'

type FunnelPayload = {
  journey?: string
  step?: string
  status?: string
  request_id?: string
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

function clean(value: unknown, max = 120) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.slice(0, max)
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

  if (!step || !ALLOWED_STEPS.has(step)) {
    return badRequest('Invalid telemetry step')
  }

  if (!status || !ALLOWED_STATUS.has(status)) {
    return badRequest('Invalid telemetry status')
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return serverError('Missing Supabase environment', String(err))
  }

  await writeFunnelEvent(admin, {
    journey,
    step,
    status,
    requestId: clean(payload.request_id, 120) || null,
    email: clean(payload.email, 320) || null,
    inviteEmail: clean(payload.invite_email, 320) || null,
    errorCode: clean(payload.error_code, 120) || null,
    errorMessage: clean(payload.error_message, 600) || null,
    context: payload.context && typeof payload.context === 'object' ? payload.context : {},
  })

  return json({ ok: true })
})
