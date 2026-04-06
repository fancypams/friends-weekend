import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { forbidden, unauthorized, serverError } from './http.ts'

export type ProfileRow = {
  user_id: string
  email: string
  role: 'admin' | 'member'
  active: boolean
}

export type AuthResult = {
  ok: true
  admin: SupabaseClient
  user: User
  profile: ProfileRow
}

export type AuthFailure = {
  ok: false
  response: Response
}

function getEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

export function createAdminClient() {
  const supabaseUrl = getEnv('SUPABASE_URL')
  const serviceRole = getEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(supabaseUrl, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function parseBearer(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
  if (!authHeader) return null
  const [scheme, token] = authHeader.split(' ')
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null
  return token
}

function isBypassEnabled() {
  const value = String(Deno.env.get('BYPASS_AUTH') ?? '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes'
}

async function resolveBypassIdentity(admin: SupabaseClient): Promise<{ user: User; profile: ProfileRow } | null> {
  const { data: adminProfile, error: adminErr } = await admin
    .from('profiles')
    .select('user_id,email,role,active')
    .eq('active', true)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle<ProfileRow>()

  if (adminErr) return null
  let profile = adminProfile

  if (!profile) {
    const { data: anyProfile, error: anyErr } = await admin
      .from('profiles')
      .select('user_id,email,role,active')
      .eq('active', true)
      .limit(1)
      .maybeSingle<ProfileRow>()

    if (anyErr || !anyProfile) return null
    profile = anyProfile
  }

  const user = {
    id: profile.user_id,
    email: profile.email,
    aud: 'authenticated',
    role: 'authenticated',
  } as User

  return { user, profile }
}

type RequireAuthOptions = {
  requireAdmin?: boolean
  requireActive?: boolean
}

export async function requireAuth(req: Request, options: RequireAuthOptions = {}): Promise<AuthResult | AuthFailure> {
  const { requireAdmin = false, requireActive = true } = options

  let admin: SupabaseClient
  try {
    admin = createAdminClient()
  } catch (err) {
    return { ok: false, response: serverError('Missing Supabase environment', String(err)) }
  }

  if (isBypassEnabled()) {
    const identity = await resolveBypassIdentity(admin)
    if (!identity) {
      return { ok: false, response: forbidden('BYPASS_AUTH is enabled but no active profile was found') }
    }

    if (requireAdmin && identity.profile.role !== 'admin') {
      return { ok: false, response: forbidden('Admin permissions required') }
    }

    return {
      ok: true,
      admin,
      user: identity.user,
      profile: identity.profile,
    }
  }

  const token = parseBearer(req)
  if (!token) return { ok: false, response: unauthorized() }

  const { data: authData, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !authData.user) {
    return { ok: false, response: unauthorized('Invalid or expired token') }
  }

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('user_id,email,role,active')
    .eq('user_id', authData.user.id)
    .maybeSingle<ProfileRow>()

  if (profileErr || !profile) {
    return { ok: false, response: forbidden('No profile found for user') }
  }

  if (requireActive && !profile.active) {
    return { ok: false, response: forbidden('User is not invited') }
  }

  if (requireAdmin && profile.role !== 'admin') {
    return { ok: false, response: forbidden('Admin permissions required') }
  }

  return {
    ok: true,
    admin,
    user: authData.user,
    profile,
  }
}
