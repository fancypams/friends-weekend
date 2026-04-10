import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function parseLimit(url: URL) {
  const raw = Number(url.searchParams.get('limit') || 50)
  if (!Number.isFinite(raw) || raw <= 0) return 50
  return Math.min(Math.floor(raw), 200)
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['GET'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireAdmin: true, requireActive: true })
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const limit = parseLimit(url)
  const email = normalizeEmail(String(url.searchParams.get('email') || ''))

  if (email && !email.includes('@')) {
    return badRequest('Invalid email filter')
  }

  let query = auth.admin
    .from('invite_delivery_attempts')
    .select('id,attempt_id,invited_by,email,display_name,family,role,active,provider,status,failure_stage,provider_message_id,error_message,error_code,http_status,redirect_to,host_name,details,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (email) {
    query = query.eq('email', email)
  }

  const { data, error } = await query
  if (error) {
    return serverError('Failed to load invite delivery attempts', error.message)
  }

  const attempts = Array.isArray(data) ? data : []
  const providerMessageIds = attempts
    .map((row) => String(row?.provider_message_id || '').trim())
    .filter(Boolean)

  let latestEventByEmailId = new Map<string, {
    event_type: string
    occurred_at: string | null
    bounce_message: string | null
  }>()

  if (providerMessageIds.length) {
    const { data: events, error: eventsError } = await auth.admin
      .from('resend_email_events')
      .select('email_id,event_type,occurred_at,created_at,bounce_message')
      .in('email_id', providerMessageIds)
      .order('occurred_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (!eventsError && Array.isArray(events)) {
      latestEventByEmailId = new Map()
      for (const row of events) {
        const emailId = String(row?.email_id || '').trim()
        if (!emailId || latestEventByEmailId.has(emailId)) continue
        latestEventByEmailId.set(emailId, {
          event_type: String(row?.event_type || '').trim(),
          occurred_at: row?.occurred_at ?? null,
          bounce_message: row?.bounce_message ?? null,
        })
      }
    }
  }

  const enrichedItems = attempts.map((row) => {
    const emailId = String(row?.provider_message_id || '').trim()
    if (!emailId) {
      return {
        ...row,
        latest_provider_event: null,
        latest_provider_event_at: null,
        latest_provider_event_message: null,
      }
    }

    const latest = latestEventByEmailId.get(emailId) || null
    return {
      ...row,
      latest_provider_event: latest?.event_type || null,
      latest_provider_event_at: latest?.occurred_at || null,
      latest_provider_event_message: latest?.bounce_message || null,
    }
  })

  return json({
    items: enrichedItems,
  })
})
