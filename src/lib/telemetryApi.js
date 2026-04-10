import { hasSupabaseConfig, supabaseAnonKey, supabaseFunctionUrl } from './supabaseClient'
import { callFunction } from './functionsApi'

export async function trackFunnelEvent(payload) {
  if (!hasSupabaseConfig) return

  const res = await fetch(supabaseFunctionUrl('telemetry-funnel-event'), {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || body?.message || 'Failed to write telemetry event')
  }
}

export async function fetchFunnelTelemetry({ windowMinutes = 1440 } = {}) {
  if (!hasSupabaseConfig) return { summary: {}, top_failures: [] }

  const params = new URLSearchParams()
  params.set('window_minutes', String(windowMinutes))
  return callFunction(`funnel-telemetry?${params.toString()}`)
}
