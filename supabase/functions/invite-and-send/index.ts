import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { audit } from '../_shared/audit.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { writeFunnelEvent } from '../_shared/funnel.ts'

type InviteAndSendPayload = {
  email?: string
  display_name?: string
  family?: string
  role?: 'admin' | 'member'
  active?: boolean
  redirect_to?: string
  host_name?: string
  request_id?: string
}

type InviteDeliveryAttempt = {
  invited_by: string | null
  email: string
  display_name: string | null
  family: string | null
  role: 'admin' | 'member'
  active: boolean
  provider?: string
  status: 'success' | 'failed'
  failure_stage?: string | null
  provider_message_id?: string | null
  error_message?: string | null
  error_code?: string | null
  http_status?: number | null
  redirect_to?: string | null
  host_name?: string | null
  details?: Record<string, unknown>
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeDisplayName(value: string | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

function normalizeFamily(value: string | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

function normalizeRole(value: string | undefined) {
  if (value === 'admin' || value === 'member') return value
  return 'member'
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

function resolveRedirectTo(payloadRedirectTo: string | undefined) {
  const fromPayload = normalizeRedirectTo(payloadRedirectTo)
  if (fromPayload) return fromPayload

  const fromEnv = normalizeRedirectTo(Deno.env.get('MAGIC_LINK_REDIRECT_URL'))
  if (fromEnv) return fromEnv

  const appUrl = normalizeRedirectTo(Deno.env.get('PUBLIC_APP_URL'))
  if (!appUrl) return ''

  const joiner = appUrl.endsWith('/') ? '' : '/'
  return `${appUrl}${joiner}#/login`
}

function requireEnv(name: string) {
  const value = String(Deno.env.get(name) ?? '').trim()
  if (!value) {
    throw new Error(`Missing env ${name}`)
  }
  return value
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function firstNameFromDisplayName(displayName: string | null, email: string) {
  const fromDisplay = String(displayName ?? '').trim()
  if (fromDisplay) {
    return fromDisplay.split(/\s+/)[0] || fromDisplay
  }

  const local = email.split('@')[0] || ''
  const firstToken = local.split(/[._-]+/)[0] || ''
  if (!firstToken) return 'friend'
  return `${firstToken.charAt(0).toUpperCase()}${firstToken.slice(1)}`
}

function buildEmailHtml(firstName: string, hostName: string, actionLink: string) {
  const safeFirst = escapeHtml(firstName)
  const safeHost = escapeHtml(hostName)
  const safeLink = escapeHtml(actionLink)
  const signoffHtml = safeHost
    ? `<p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;color:#3a4a3e;">Let’s go,<br>${safeHost}</p>`
    : '<p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;color:#3a4a3e;">Let’s go,</p>'

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f7f8;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f7f8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e8eb;">
            <tr>
              <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;color:#1f2d22;">
                <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6a8a97;font-weight:700;">Friends Weekend</p>
                <h1 style="margin:0 0 14px 0;font-size:30px;line-height:1.2;color:#1f2d22;">Seattle, here we come</h1>
                <p style="margin:0 0 16px 0;font-size:17px;line-height:1.7;color:#3a4a3e;">Hey ${safeFirst},</p>
                <p style="margin:0 0 16px 0;font-size:17px;line-height:1.7;color:#3a4a3e;">We made a little trip home base so we can keep everything in one place before and during the weekend.</p>
                <p style="margin:0 0 14px 0;font-size:16px;line-height:1.7;color:#5e625e;">Inside you’ll find:</p>
                <ul style="margin:0 0 18px 20px;padding:0;font-size:16px;line-height:1.7;color:#5e625e;">
                  <li>Basics (lodging + transportation)</li>
                  <li>Itinerary (day-by-day plans)</li>
                  <li>Pre-Trip Prep (movies, music, and more)</li>
                  <li>Groceries + group updates</li>
                </ul>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.7;color:#5e625e;">And yes, the <strong>Shared Media</strong> gallery is ready for chaos in the best way.<br>Upload photos/videos from <strong>July 31–Aug 4</strong>, and we’ll all see new drops each night at <strong>9:00 PM Pacific</strong>.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 28px 8px 28px;">
                <a href="${safeLink}" style="display:inline-block;background:#243123;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;line-height:1;padding:14px 22px;border-radius:999px;">Jump In</a>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
                ${signoffHtml}
                <p style="margin:0;font-size:13px;line-height:1.6;color:#7a807a;">P.S. Open the magic link on this same device for the smoothest sign-in.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function buildEmailText(firstName: string, hostName: string, actionLink: string) {
  const signoff = hostName ? `Let's go, ${hostName}` : "Let's go,"
  return [
    `Hey ${firstName},`,
    '',
    'We made a little trip home base so we can keep everything in one place before and during the weekend.',
    '',
    'Inside you\'ll find:',
    '- Basics (lodging + transportation)',
    '- Itinerary (day-by-day plans)',
    '- Pre-Trip Prep (movies, music, and more)',
    '- Groceries + group updates',
    '',
    'And yes, the Shared Media gallery is ready for chaos in the best way.',
    'Upload photos/videos from July 31-Aug 4, and we\'ll all see new drops each night at 9:00 PM Pacific.',
    '',
    `Jump in: ${actionLink}`,
    '',
    signoff,
  ].join('\n')
}

async function sendInviteEmail(params: {
  resendApiKey: string
  from: string
  to: string
  subject: string
  html: string
  text: string
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  })

  const raw = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    body = { raw }
  }

  if (!res.ok) {
    const message = String(body?.message || body?.error || `Request failed (${res.status})`)
    const error = new Error(`Resend API error: ${message}`)
    const typed = error as Error & { status?: number; code?: string }
    typed.status = res.status
    typed.code = String(body?.code || body?.name || '')
    throw error
  }

  return String(body?.id || '')
}

async function logInviteDeliveryAttempt(
  admin: SupabaseClient,
  attempt: InviteDeliveryAttempt,
) {
  try {
    await admin.from('invite_delivery_attempts').insert({
      invited_by: attempt.invited_by,
      email: attempt.email,
      display_name: attempt.display_name,
      family: attempt.family,
      role: attempt.role,
      active: attempt.active,
      provider: attempt.provider ?? 'resend',
      status: attempt.status,
      failure_stage: attempt.failure_stage ?? null,
      provider_message_id: attempt.provider_message_id ?? null,
      error_message: attempt.error_message ?? null,
      error_code: attempt.error_code ?? null,
      http_status: attempt.http_status ?? null,
      redirect_to: attempt.redirect_to ?? null,
      host_name: attempt.host_name ?? null,
      details: attempt.details ?? {},
    })
  } catch (err) {
    console.error('Failed to write invite delivery attempt', err)
  }
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireAdmin: true, requireActive: true })
  if (!auth.ok) return auth.response

  let payload: InviteAndSendPayload
  try {
    payload = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const email = normalizeEmail(String(payload.email ?? ''))
  const displayName = normalizeDisplayName(payload.display_name)
  const family = normalizeFamily(payload.family)
  const role = normalizeRole(payload.role)
  const active = payload.active ?? true
  const hostName = String(payload.host_name ?? Deno.env.get('FRIENDS_WEEKEND_HOST_NAME') ?? '').trim()
  const redirectTo = resolveRedirectTo(payload.redirect_to)
  const requestId = String(payload.request_id ?? '').trim().slice(0, 120) || crypto.randomUUID()

  if (!email || !email.includes('@')) {
    return badRequest('Valid email is required')
  }

  const attemptBase = {
    invited_by: auth.user.id,
    email,
    display_name: displayName,
    family,
    role,
    active,
    provider: 'resend',
    redirect_to: redirectTo || null,
    host_name: hostName || null,
  } satisfies Omit<InviteDeliveryAttempt, 'status'>

  const { data: invite, error: inviteErr } = await auth.admin
    .from('invite_allowlist')
    .upsert(
      {
        email,
        display_name: displayName,
        family,
        role,
        active,
        invited_by: auth.user.id,
      },
      { onConflict: 'email' },
    )
    .select('email,display_name,family,role,active,invited_by,created_at,updated_at')
    .single()

  if (inviteErr || !invite) {
    await writeFunnelEvent(auth.admin, {
      journey: 'invite_auth',
      step: 'invite_sent',
      status: 'failed',
      requestId,
      userId: auth.user.id,
      inviteEmail: email,
      errorCode: 'invite_upsert',
      errorMessage: inviteErr?.message || 'Failed to save invite',
    })
    await logInviteDeliveryAttempt(auth.admin, {
      ...attemptBase,
      status: 'failed',
      failure_stage: 'invite_upsert',
      error_message: inviteErr?.message || 'Failed to save invite',
    })
    return serverError('Failed to save invite', inviteErr?.message)
  }

  const { data: linkData, error: linkErr } = await auth.admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: redirectTo || undefined,
      data: displayName ? { display_name: displayName } : undefined,
    },
  })

  if (linkErr) {
    await writeFunnelEvent(auth.admin, {
      journey: 'invite_auth',
      step: 'invite_sent',
      status: 'failed',
      requestId,
      userId: auth.user.id,
      inviteEmail: email,
      errorCode: String(linkErr.code || 'magic_link_generation'),
      errorMessage: linkErr.message || 'Failed to generate magic link',
    })
    await logInviteDeliveryAttempt(auth.admin, {
      ...attemptBase,
      status: 'failed',
      failure_stage: 'magic_link_generation',
      error_message: linkErr.message || 'Failed to generate magic link',
      error_code: String(linkErr.code || ''),
    })
    return serverError('Failed to generate magic link', linkErr.message)
  }

  const actionLink = String(linkData?.properties?.action_link || '').trim()
  if (!actionLink) {
    await writeFunnelEvent(auth.admin, {
      journey: 'invite_auth',
      step: 'invite_sent',
      status: 'failed',
      requestId,
      userId: auth.user.id,
      inviteEmail: email,
      errorCode: 'magic_link_generation',
      errorMessage: 'Magic link generation returned no action link',
    })
    await logInviteDeliveryAttempt(auth.admin, {
      ...attemptBase,
      status: 'failed',
      failure_stage: 'magic_link_generation',
      error_message: 'Magic link generation returned no action link',
    })
    return serverError('Magic link generation returned no action link')
  }

  let resendApiKey = ''
  let resendFrom = ''
  try {
    resendApiKey = requireEnv('RESEND_API_KEY')
    resendFrom = requireEnv('RESEND_FROM')
  } catch (err) {
    await writeFunnelEvent(auth.admin, {
      journey: 'invite_auth',
      step: 'invite_sent',
      status: 'failed',
      requestId,
      userId: auth.user.id,
      inviteEmail: email,
      errorCode: 'provider_configuration',
      errorMessage: String(err),
    })
    await logInviteDeliveryAttempt(auth.admin, {
      ...attemptBase,
      status: 'failed',
      failure_stage: 'provider_configuration',
      error_message: String(err),
    })
    return serverError('Missing email provider configuration', String(err))
  }

  const firstName = firstNameFromDisplayName(displayName, email)
  const subject = `${firstName}, Seattle plans are live`
  const html = buildEmailHtml(firstName, hostName, actionLink)
  const text = buildEmailText(firstName, hostName, actionLink)

  let emailId = ''
  try {
    emailId = await sendInviteEmail({
      resendApiKey,
      from: resendFrom,
      to: email,
      subject,
      html,
      text,
    })
  } catch (err) {
    const enriched = err as Error & { status?: number; code?: string }
    await writeFunnelEvent(auth.admin, {
      journey: 'invite_auth',
      step: 'invite_sent',
      status: 'failed',
      requestId,
      userId: auth.user.id,
      inviteEmail: email,
      errorCode: String(enriched?.code || 'provider_send'),
      errorMessage: String(enriched?.message || err),
      context: {
        http_status: Number.isFinite(Number(enriched?.status)) ? Number(enriched.status) : null,
      },
    })
    await logInviteDeliveryAttempt(auth.admin, {
      ...attemptBase,
      status: 'failed',
      failure_stage: 'provider_send',
      error_message: String(enriched?.message || err),
      error_code: String(enriched?.code || ''),
      http_status: Number.isFinite(Number(enriched?.status)) ? Number(enriched.status) : null,
    })
    return serverError('Failed to send invite email', String(err))
  }

  await writeFunnelEvent(auth.admin, {
    journey: 'invite_auth',
    step: 'invite_sent',
    status: 'success',
    requestId,
    userId: auth.user.id,
    inviteEmail: email,
    context: {
      resend_email_id: emailId || null,
      role: invite.role,
      active: invite.active,
    },
  })

  await logInviteDeliveryAttempt(auth.admin, {
    ...attemptBase,
    status: 'success',
    provider_message_id: emailId || null,
    details: {
      invited_email: email,
      role: invite.role,
      active: invite.active,
    },
  })

  await audit(auth.admin, {
    actorId: auth.user.id,
    action: 'invite.sent',
    entity: 'invite_allowlist',
    entityId: invite.email,
    details: {
      display_name: displayName,
      family,
      role: invite.role,
      active: invite.active,
      resend_email_id: emailId,
      redirect_to: redirectTo || null,
    },
  })

  return json({
    item: invite,
    delivery: {
      email_id: emailId,
      provider: 'resend',
    },
  })
})
