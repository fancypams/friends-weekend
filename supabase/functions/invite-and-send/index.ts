import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { audit } from '../_shared/audit.ts'

type InviteAndSendPayload = {
  email?: string
  display_name?: string
  role?: 'admin' | 'member'
  active?: boolean
  redirect_to?: string
  host_name?: string
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeDisplayName(value: string | undefined) {
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
    throw new Error(`Resend API error: ${message}`)
  }

  return String(body?.id || '')
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
  const role = normalizeRole(payload.role)
  const active = payload.active ?? true

  if (!email || !email.includes('@')) {
    return badRequest('Valid email is required')
  }

  const { data: invite, error: inviteErr } = await auth.admin
    .from('invite_allowlist')
    .upsert(
      {
        email,
        display_name: displayName,
        role,
        active,
        invited_by: auth.user.id,
      },
      { onConflict: 'email' },
    )
    .select('email,display_name,role,active,invited_by,created_at,updated_at')
    .single()

  if (inviteErr || !invite) {
    return serverError('Failed to save invite', inviteErr?.message)
  }

  const redirectTo = resolveRedirectTo(payload.redirect_to)

  const { data: linkData, error: linkErr } = await auth.admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: redirectTo || undefined,
      data: displayName ? { display_name: displayName } : undefined,
    },
  })

  if (linkErr) {
    return serverError('Failed to generate magic link', linkErr.message)
  }

  const actionLink = String(linkData?.properties?.action_link || '').trim()
  if (!actionLink) {
    return serverError('Magic link generation returned no action link')
  }

  let resendApiKey = ''
  let resendFrom = ''
  try {
    resendApiKey = requireEnv('RESEND_API_KEY')
    resendFrom = requireEnv('RESEND_FROM')
  } catch (err) {
    return serverError('Missing email provider configuration', String(err))
  }

  const firstName = firstNameFromDisplayName(displayName, email)
  const hostName = String(payload.host_name ?? Deno.env.get('FRIENDS_WEEKEND_HOST_NAME') ?? '').trim()
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
    return serverError('Failed to send invite email', String(err))
  }

  await audit(auth.admin, {
    actorId: auth.user.id,
    action: 'invite.sent',
    entity: 'invite_allowlist',
    entityId: invite.email,
    details: {
      display_name: displayName,
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
