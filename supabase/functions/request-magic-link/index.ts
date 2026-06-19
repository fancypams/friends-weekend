import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/auth.ts'
import { writeFunnelEvent } from '../_shared/funnel.ts'
import { signTelemetryContext } from '../_shared/telemetry-signature.ts'

type RequestMagicLinkPayload = {
  email?: string
  redirect_to?: string
  source?: string
  request_id?: string
}

type MagicLinkAttempt = {
  email: string
  status: 'success' | 'failed'
  failure_stage?: string | null
  error_message?: string | null
  error_code?: string | null
  http_status?: number | null
  redirect_to?: string | null
  source?: string | null
  user_agent?: string | null
  request_ip?: string | null
  details?: Record<string, unknown>
}

type InviteRow = {
  email: string
  display_name: string | null
  active: boolean
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value)
}

function normalizeRedirectTo(value: string | undefined) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function normalizeSource(value: string | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

function normalizeRequestId(value: string | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed.slice(0, 120) || crypto.randomUUID()
}

function appendTelemetryContextToRedirect(redirectTo: string, requestId: string, requestTs: string, requestSig: string) {
  const raw = String(redirectTo || '').trim()
  if (!raw || !requestId || !requestTs || !requestSig) return raw
  if (raw.includes('rid=') && raw.includes('rts=') && raw.includes('rsig=')) return raw

  const hashIndex = raw.indexOf('#')
  const base = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : ''
  const params = new URLSearchParams(base.split('?')[1] || '')
  params.set('rid', requestId)
  params.set('rts', requestTs)
  params.set('rsig', requestSig)

  const bareBase = base.split('?')[0] || base
  return `${bareBase}?${params.toString()}${hash}`
}

function requireEnv(name: string) {
  const value = String(Deno.env.get(name) ?? '').trim()
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

function readRequestIp(req: Request) {
  const forwarded = String(req.headers.get('x-forwarded-for') || '').trim()
  if (!forwarded) return null
  return forwarded.split(',')[0]?.trim() || null
}

function isAlreadyRegisteredAuthError(err: unknown) {
  const message = String((err as Error | null)?.message || '').toLowerCase()
  const code = String((err as { code?: string } | null)?.code || '').toLowerCase()
  return (
    code === 'email_exists'
    || code === 'user_already_exists'
    || message.includes('already been registered')
    || message.includes('already registered')
    || message.includes('already exists')
  )
}

async function ensureInvitedAuthUser(admin: SupabaseClient, email: string) {
  const { data: invite, error: inviteErr } = await admin
    .from('invite_allowlist')
    .select('email,display_name,active')
    .eq('email', email)
    .maybeSingle<InviteRow>()

  if (inviteErr) {
    return {
      ok: false as const,
      failureStage: 'invite_lookup',
      errorMessage: inviteErr.message || 'Failed to verify invite',
      errorCode: String(inviteErr.code || ''),
      httpStatus: null,
    }
  }

  if (!invite?.active) {
    return {
      ok: false as const,
      failureStage: 'invite_lookup',
      errorMessage: 'No active invite found for this email',
      errorCode: 'invite_not_active',
      httpStatus: 403,
    }
  }

  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: invite.display_name ? { display_name: invite.display_name } : undefined,
  })

  if (createErr && !isAlreadyRegisteredAuthError(createErr)) {
    const errLike = createErr as Error & { status?: number; code?: string }
    return {
      ok: false as const,
      failureStage: 'auth_user_create',
      errorMessage: errLike.message || 'Failed to create invited user',
      errorCode: String(errLike.code || ''),
      httpStatus: Number.isFinite(Number(errLike.status)) ? Number(errLike.status) : null,
    }
  }

  return { ok: true as const }
}

async function logMagicLinkAttempt(admin: SupabaseClient | null, attempt: MagicLinkAttempt) {
  if (!admin) return
  try {
    await admin.from('magic_link_attempts').insert({
      email: attempt.email,
      status: attempt.status,
      failure_stage: attempt.failure_stage ?? null,
      error_message: attempt.error_message ?? null,
      error_code: attempt.error_code ?? null,
      http_status: attempt.http_status ?? null,
      redirect_to: attempt.redirect_to ?? null,
      source: attempt.source ?? null,
      user_agent: attempt.user_agent ?? null,
      request_ip: attempt.request_ip ?? null,
      details: attempt.details ?? {},
    })
  } catch (err) {
    console.error('Failed to write magic link attempt', err)
  }
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  let payload: RequestMagicLinkPayload
  try {
    payload = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const email = normalizeEmail(String(payload.email ?? ''))
  const requestId = normalizeRequestId(payload.request_id)
  const requestTs = String(Math.floor(Date.now() / 1000))
  const requestSig = await signTelemetryContext(requestId, requestTs)
  const redirectTo = appendTelemetryContextToRedirect(
    normalizeRedirectTo(payload.redirect_to),
    requestId,
    requestTs,
    requestSig,
  )
  const source = normalizeSource(payload.source)
  const userAgent = String(req.headers.get('user-agent') || '').trim() || null
  const requestIp = readRequestIp(req)

  let admin: SupabaseClient | null = null
  try {
    admin = createAdminClient()
  } catch {
    admin = null
  }

  if (!isValidEmail(email)) {
    await logMagicLinkAttempt(admin, {
      email: email || '(missing email)',
      status: 'failed',
      failure_stage: 'validation',
      error_message: 'Valid email is required',
      source,
      redirect_to: redirectTo || null,
      user_agent: userAgent,
      request_ip: requestIp,
    })
    if (admin) {
      await writeFunnelEvent(admin, {
        journey: 'invite_auth',
        step: 'magic_link_requested',
        status: 'failed',
        requestId,
        email,
        errorCode: 'validation',
        errorMessage: 'Valid email is required',
        context: {
          source,
        },
      })
    }
    return badRequest('Valid email is required')
  }

  if (!admin) {
    const message = 'Missing Supabase service role configuration'
    await logMagicLinkAttempt(admin, {
      email,
      status: 'failed',
      failure_stage: 'configuration',
      error_message: message,
      source,
      redirect_to: redirectTo || null,
      user_agent: userAgent,
      request_ip: requestIp,
    })
    return serverError('Missing magic link configuration', message)
  }

  const inviteProvisioning = await ensureInvitedAuthUser(admin, email)
  if (!inviteProvisioning.ok) {
    await logMagicLinkAttempt(admin, {
      email,
      status: 'failed',
      failure_stage: inviteProvisioning.failureStage,
      error_message: inviteProvisioning.errorMessage,
      error_code: inviteProvisioning.errorCode,
      http_status: inviteProvisioning.httpStatus,
      source,
      redirect_to: redirectTo || null,
      user_agent: userAgent,
      request_ip: requestIp,
    })
    await writeFunnelEvent(admin, {
      journey: 'invite_auth',
      step: 'magic_link_requested',
      status: 'failed',
      requestId,
      email,
      errorCode: inviteProvisioning.errorCode,
      errorMessage: inviteProvisioning.errorMessage,
      context: {
        source,
        redirect_to: redirectTo || null,
        failure_stage: inviteProvisioning.failureStage,
        http_status: inviteProvisioning.httpStatus,
      },
    })

    if (inviteProvisioning.httpStatus === 403) {
      return badRequest('No active invite found for this email')
    }
    return serverError('Failed to prepare magic link', inviteProvisioning.errorMessage)
  }

  let anon: SupabaseClient
  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const anonKey = requireEnv('SUPABASE_ANON_KEY')
    anon = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  } catch (err) {
    await logMagicLinkAttempt(admin, {
      email,
      status: 'failed',
      failure_stage: 'configuration',
      error_message: String(err),
      source,
      redirect_to: redirectTo || null,
      user_agent: userAgent,
      request_ip: requestIp,
    })
    if (admin) {
      await writeFunnelEvent(admin, {
        journey: 'invite_auth',
        step: 'magic_link_requested',
        status: 'failed',
        requestId,
        email,
        errorCode: 'configuration',
        errorMessage: String(err),
        context: {
          source,
          redirect_to: redirectTo || null,
        },
      })
    }
    return serverError('Missing magic link configuration', String(err))
  }

  const { error } = await anon.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: redirectTo || undefined,
    },
  })

  if (error) {
    const errLike = error as Error & { status?: number; code?: string }
    const lowered = String(errLike?.message || '').toLowerCase()
    const isRateLimited = (
      Number(errLike?.status || 0) === 429
      || lowered.includes('rate limit')
      || lowered.includes('for security purposes')
      || lowered.includes('after')
    )

    await logMagicLinkAttempt(admin, {
      email,
      status: 'failed',
      failure_stage: 'otp_request',
      error_message: errLike.message || 'Failed to request magic link',
      error_code: String(errLike.code || ''),
      http_status: Number.isFinite(Number(errLike.status)) ? Number(errLike.status) : null,
      source,
      redirect_to: redirectTo || null,
      user_agent: userAgent,
      request_ip: requestIp,
    })
    if (admin) {
      await writeFunnelEvent(admin, {
        journey: 'invite_auth',
        step: 'magic_link_requested',
        status: isRateLimited ? 'rate_limited' : 'failed',
        requestId,
        email,
        errorCode: String(errLike.code || ''),
        errorMessage: errLike.message || 'Failed to request magic link',
        context: {
          source,
          redirect_to: redirectTo || null,
          http_status: Number.isFinite(Number(errLike.status)) ? Number(errLike.status) : null,
        },
      })
    }
    return serverError('Failed to request magic link', errLike.message)
  }

  await logMagicLinkAttempt(admin, {
    email,
    status: 'success',
    source,
    redirect_to: redirectTo || null,
    user_agent: userAgent,
    request_ip: requestIp,
  })
  if (admin) {
    await writeFunnelEvent(admin, {
      journey: 'invite_auth',
      step: 'magic_link_requested',
      status: 'success',
      requestId,
      email,
      context: {
        source,
        redirect_to: redirectTo || null,
      },
    })
  }

  return json({
    sent: true,
    request_id: requestId,
    request_ts: requestTs,
    request_sig: requestSig,
  })
})
