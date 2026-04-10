import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'

type ProfilePresenceRow = {
  user_id: string
  email: string
  display_name: string | null
  role: 'admin' | 'member'
  active: boolean
  user_presence: {
    last_seen_at: string | null
    last_path: string | null
  } | null
}

function parseInactivityMinutes(url: URL) {
  const raw = Number(url.searchParams.get('inactivity_minutes') || 15)
  if (!Number.isFinite(raw) || raw <= 0) return 15
  return Math.min(Math.floor(raw), 240)
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['GET'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireAdmin: true, requireActive: true })
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const inactivityMinutes = parseInactivityMinutes(url)
  const cutoffMs = Date.now() - inactivityMinutes * 60 * 1000

  const { data, error } = await auth.admin
    .from('profiles')
    .select('user_id,email,display_name,role,active,user_presence(last_seen_at,last_path)')
    .eq('active', true)
    .order('email', { ascending: true })

  if (error) {
    return serverError('Failed to load active users', error.message)
  }

  const rows = (Array.isArray(data) ? data : []) as ProfilePresenceRow[]

  const items = rows.map((row) => {
    const lastSeenAt = row.user_presence?.last_seen_at || null
    const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0
    const isActiveNow = Number.isFinite(lastSeenMs) && lastSeenMs > 0 && lastSeenMs >= cutoffMs

    return {
      user_id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      role: row.role,
      is_active_now: isActiveNow,
      last_seen_at: lastSeenAt,
      last_path: row.user_presence?.last_path || null,
    }
  })

  const sortedItems = [...items].sort((a, b) => {
    const aMs = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0
    const bMs = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0
    return bMs - aMs
  })

  const activeNowCount = sortedItems.filter((row) => row.is_active_now).length
  const activeNowExcludingSelfCount = sortedItems.filter((row) => (
    row.is_active_now && row.user_id !== auth.user.id
  )).length

  return json({
    active_now_count: activeNowExcludingSelfCount,
    active_now_including_self_count: activeNowCount,
    total_active_members: sortedItems.length,
    inactivity_minutes: inactivityMinutes,
    cutoff_at: new Date(cutoffMs).toISOString(),
    items: sortedItems,
  })
})
