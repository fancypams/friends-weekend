import { Webhook } from 'npm:svix'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError, unauthorized } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/auth.ts'

type ResendWebhookEvent = {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    from?: string
    subject?: string
    bounce?: {
      type?: string
      subType?: string
      subtype?: string
      message?: string
    }
    complaint?: {
      feedbackType?: string
      feedback_type?: string
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

function requireEnv(name: string) {
  const value = String(Deno.env.get(name) ?? '').trim()
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

function firstEmail(value: string[] | string | undefined) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim().toLowerCase() || null
  }
  const single = String(value || '').trim().toLowerCase()
  return single || null
}

function toIsoOrNull(value: string | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function parseEvent(raw: unknown) {
  const event = (raw || {}) as ResendWebhookEvent
  const data = (event.data || {}) as ResendWebhookEvent['data']
  const bounce = (data?.bounce || {}) as NonNullable<ResendWebhookEvent['data']>['bounce']
  const complaint = (data?.complaint || {}) as NonNullable<ResendWebhookEvent['data']>['complaint']

  return {
    eventType: String(event.type || '').trim(),
    occurredAt: toIsoOrNull(String(event.created_at || '')),
    emailId: String(data?.email_id || '').trim() || null,
    toEmail: firstEmail(data?.to),
    fromEmail: String(data?.from || '').trim() || null,
    subject: String(data?.subject || '').trim() || null,
    bounceType: String(bounce?.type || '').trim() || null,
    bounceSubtype: String(bounce?.subType || bounce?.subtype || '').trim() || null,
    bounceMessage: String(bounce?.message || '').trim() || null,
    complaintFeedbackType: String(complaint?.feedbackType || complaint?.feedback_type || '').trim() || null,
  }
}

async function saveWebhookEvent(
  admin: SupabaseClient,
  params: {
    svixId: string
    svixTimestamp: string | null
    event: ResendWebhookEvent
  },
) {
  const parsed = parseEvent(params.event)
  if (!parsed.eventType) {
    return badRequest('Missing event type')
  }

  const { error } = await admin
    .from('resend_email_events')
    .upsert(
      {
        svix_id: params.svixId,
        svix_timestamp: params.svixTimestamp,
        event_type: parsed.eventType,
        email_id: parsed.emailId,
        to_email: parsed.toEmail,
        from_email: parsed.fromEmail,
        subject: parsed.subject,
        occurred_at: parsed.occurredAt,
        bounce_type: parsed.bounceType,
        bounce_subtype: parsed.bounceSubtype,
        bounce_message: parsed.bounceMessage,
        complaint_feedback_type: parsed.complaintFeedbackType,
        raw_event: params.event,
      },
      {
        onConflict: 'svix_id',
        ignoreDuplicates: true,
      },
    )

  if (error) {
    return serverError('Failed to store webhook event', error.message)
  }

  return null
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const svixId = String(req.headers.get('svix-id') || '').trim()
  const svixTimestamp = String(req.headers.get('svix-timestamp') || '').trim() || null
  const svixSignature = String(req.headers.get('svix-signature') || '').trim()

  if (!svixId || !svixSignature) {
    return unauthorized('Missing webhook signature headers')
  }

  const payload = await req.text()

  let secret = ''
  let admin: SupabaseClient
  try {
    secret = requireEnv('RESEND_WEBHOOK_SECRET')
    admin = createAdminClient()
  } catch (err) {
    return serverError('Missing webhook configuration', String(err))
  }

  let event: ResendWebhookEvent
  try {
    const wh = new Webhook(secret)
    const verified = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp || '',
      'svix-signature': svixSignature,
    })
    event = verified as ResendWebhookEvent
  } catch {
    return unauthorized('Invalid webhook signature')
  }

  const saveError = await saveWebhookEvent(admin, { svixId, svixTimestamp, event })
  if (saveError) return saveError

  return json({ ok: true })
})
