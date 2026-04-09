import { hasSupabaseConfig, supabase } from './supabaseClient'
const SESSION_REFRESH_BUFFER_SECONDS = 60

function normalizeRedirectPath(value) {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/')) return '/'
  if (candidate.startsWith('//')) return '/'
  return candidate
}

export function getPostLoginRedirect() {
  const fromStorage = localStorage.getItem('post-login-redirect')
  if (!fromStorage) return '/'
  return normalizeRedirectPath(fromStorage)
}

export function setPostLoginRedirect(path) {
  localStorage.setItem('post-login-redirect', normalizeRedirectPath(path))
}

export function clearPostLoginRedirect() {
  localStorage.removeItem('post-login-redirect')
}

function looksLikeAuthExpiredError(err) {
  const message = String(err?.message || '').toLowerCase()
  const code = String(err?.code || err?.name || '').toLowerCase()
  const status = Number(err?.status || err?.statusCode || 0)

  return (
    status === 401
    || code === 'invalid_jwt'
    || code === 'jwt_expired'
    || message.includes('invalid jwt')
    || message.includes('invalid or expired token')
    || message.includes('no active session')
    || message.includes('jwt expired')
    || message.includes('token expired')
  )
}

async function refreshCurrentSession() {
  const refreshed = await supabase.auth.refreshSession()
  if (refreshed.error) throw refreshed.error
  return refreshed.data.session ?? null
}

function emptyAuthState() {
  return {
    session: null,
    profile: null,
    signedIn: false,
  }
}

export async function getCurrentSession() {
  if (!hasSupabaseConfig || !supabase) return null

  let session = null
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    if (!looksLikeAuthExpiredError(error)) throw error
    session = await refreshCurrentSession()
  } else {
    session = data.session ?? null
  }

  if (!session?.user) return null

  const expiresAt = Number(session.expires_at || 0)
  const now = Math.floor(Date.now() / 1000)
  if (expiresAt && expiresAt <= now + SESSION_REFRESH_BUFFER_SECONDS) {
    try {
      const refreshed = await refreshCurrentSession()
      if (refreshed?.user) {
        return refreshed
      }
    } catch {
      // Keep current session and let supabase auto-refresh handle transient failures.
    }
  }

  return session
}

export async function getProfile(userId) {
  if (!hasSupabaseConfig || !supabase || !userId) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,role,active')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getAuthState() {
  let session = await getCurrentSession()
  if (!session?.user) {
    return emptyAuthState()
  }

  let profile = null
  try {
    profile = await getProfile(session.user.id)
  } catch (err) {
    if (!looksLikeAuthExpiredError(err)) throw err
    session = await refreshCurrentSession()
    if (!session?.user) {
      return emptyAuthState()
    }
    profile = await getProfile(session.user.id)
  }

  return {
    session,
    profile,
    signedIn: true,
  }
}

export async function sendMagicLink(email, redirectTo) {
  if (!hasSupabaseConfig || !supabase) {
    throw new Error('Supabase is not configured')
  }

  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error('Email is required')
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: redirectTo,
    },
  })

  if (error) throw error
}

export async function globalSignOut() {
  if (!hasSupabaseConfig || !supabase) return
  await supabase.auth.signOut({ scope: 'global' })
}
