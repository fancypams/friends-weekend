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
    .from('magic_link_attempts')
    .select('id,attempt_id,email,status,failure_stage,error_message,error_code,http_status,redirect_to,source,user_agent,request_ip,details,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (email) {
    query = query.eq('email', email)
  }

  const { data, error } = await query
  if (error) {
    return serverError('Failed to load magic link attempts', error.message)
  }

  return json({
    items: data ?? [],
  })
})
