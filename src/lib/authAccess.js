import { hasSupabaseConfig, supabase } from './supabaseClient'

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

export async function getCurrentSession() {
  if (!hasSupabaseConfig || !supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session ?? null
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
  const session = await getCurrentSession()
  if (!session?.user) {
    return {
      session: null,
      profile: null,
      signedIn: false,
      invited: false,
    }
  }

  const profile = await getProfile(session.user.id)

  return {
    session,
    profile,
    signedIn: true,
    invited: Boolean(profile?.active),
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
