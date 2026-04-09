import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, notFound, serverError, json } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { audit } from '../_shared/audit.ts'

type InvitePayload = {
  email?: string
  display_name?: string
  role?: 'admin' | 'member'
  active?: boolean
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeDisplayName(value: string | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

function parseEmailFromPath(req: Request) {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  if (parts.length < 4) return null
  return decodeURIComponent(parts[3] ?? '').trim().toLowerCase()
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['GET', 'POST', 'DELETE'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireAdmin: true, requireActive: true })
  if (!auth.ok) return auth.response

  if (req.method === 'GET') {
    const { data, error } = await auth.admin
      .from('invite_allowlist')
      .select('email,display_name,role,active,invited_by,created_at,updated_at')
      .order('created_at', { ascending: false })

    if (error) {
      return serverError('Failed to load invite list', error.message)
    }

    return json({ items: data ?? [] })
  }

  if (req.method === 'POST') {
    let payload: InvitePayload
    try {
      payload = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const email = normalizeEmail(String(payload.email ?? ''))
    const displayName = normalizeDisplayName(payload.display_name)
    const role = payload.role ?? 'member'
    const active = payload.active ?? true

    if (!email || !email.includes('@')) {
      return badRequest('Valid email is required')
    }

    if (!['admin', 'member'].includes(role)) {
      return badRequest('Role must be admin or member')
    }

    const { data, error } = await auth.admin
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

    if (error || !data) {
      return serverError('Failed to save invite', error?.message)
    }

    await audit(auth.admin, {
      actorId: auth.user.id,
      action: 'invite.upserted',
      entity: 'invite_allowlist',
      entityId: data.email,
      details: {
        display_name: displayName,
        role,
        active,
      },
    })

    return json({ item: data })
  }

  const email = parseEmailFromPath(req)
  if (!email) {
    return badRequest('Missing email path parameter')
  }

  const { data: found, error: findErr } = await auth.admin
    .from('invite_allowlist')
    .select('email')
    .eq('email', email)
    .maybeSingle()

  if (findErr) {
    return serverError('Failed to verify invite record', findErr.message)
  }

  if (!found) {
    return notFound('Invite record not found')
  }

  const { error: deleteErr } = await auth.admin
    .from('invite_allowlist')
    .delete()
    .eq('email', email)

  if (deleteErr) {
    return serverError('Failed to delete invite', deleteErr.message)
  }

  await audit(auth.admin, {
    actorId: auth.user.id,
    action: 'invite.deleted',
    entity: 'invite_allowlist',
    entityId: email,
  })

  return json({ deleted: true, email })
})
