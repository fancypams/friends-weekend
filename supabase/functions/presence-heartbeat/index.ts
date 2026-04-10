import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'

type PresenceHeartbeatPayload = {
  path?: string
}

function normalizePath(value: string | undefined) {
  const raw = String(value ?? '').trim()
  if (!raw) return '/'
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//')) return '/'
  return raw.slice(0, 512)
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  let payload: PresenceHeartbeatPayload = {}
  try {
    payload = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const path = normalizePath(payload.path)
  const nowIso = new Date().toISOString()

  const { error } = await auth.admin
    .from('user_presence')
    .upsert(
      {
        user_id: auth.user.id,
        email: auth.profile.email,
        last_seen_at: nowIso,
        last_path: path,
      },
      {
        onConflict: 'user_id',
      },
    )

  if (error) {
    return serverError('Failed to update presence', error.message)
  }

  return json({
    ok: true,
    seen_at: nowIso,
    path,
  })
})
