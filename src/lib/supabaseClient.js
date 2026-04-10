import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

function isLocalHostRuntime() {
  if (typeof window === 'undefined') return false
  const host = String(window.location.hostname || '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

const bypassRequested = String(import.meta.env.VITE_BYPASS_AUTH || '').toLowerCase() === 'true'
export const bypassAuth = bypassRequested && (import.meta.env.DEV || isLocalHostRuntime())

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'friends-weekend-auth',
      },
    })
  : null

export function supabaseFunctionUrl(path) {
  if (!supabaseUrl) {
    throw new Error('Missing VITE_SUPABASE_URL')
  }

  const cleanPath = String(path).replace(/^\//, '')
  return `${supabaseUrl}/functions/v1/${cleanPath}`
}
