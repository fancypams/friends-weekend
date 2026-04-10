import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/auth.ts'

type RequestMagicLinkPayload = {
  email?: string
  redirect_to?: string
  source?: string
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

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
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
  const redirectTo = normalizeRedirectTo(payload.redirect_to)
  const source = normalizeSource(payload.source)
  const userAgent = String(req.headers.get('user-agent') || '').trim() || null
  const requestIp = readRequestIp(req)

  let admin: SupabaseClient | null = null
  try {
    admin = createAdminClient()
  } catch {
    admin = null
  }

  if (!email || !email.includes('@')) {
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
    return badRequest('Valid email is required')
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

  return json({ sent: true })
})
