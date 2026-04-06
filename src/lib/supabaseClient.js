import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)
export const bypassAuth = String(import.meta.env.VITE_BYPASS_AUTH || '').toLowerCase() === 'true'

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
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
