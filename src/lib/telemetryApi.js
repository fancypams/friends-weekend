import { hasSupabaseConfig, supabaseAnonKey, supabaseFunctionUrl } from './supabaseClient'
import { callFunction } from './functionsApi'

const TELEMETRY_AUTH_STORAGE_KEY = 'auth-funnel-telemetry-context'

function parseHashParams() {
  const rawHash = String(window.location.hash || '')
  if (!rawHash) return new URLSearchParams()

  const hashValue = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  if (!hashValue) return new URLSearchParams()

  if (hashValue.includes('?')) {
    return new URLSearchParams(hashValue.split('?')[1] || '')
  }
  return new URLSearchParams()
}

function normalize(value, max = 160) {
  return String(value || '').trim().slice(0, max)
}

function readTelemetryContextFromUrl() {
  if (typeof window === 'undefined') {
    return { request_id: '', request_ts: '', request_sig: '' }
  }

  const searchParams = new URLSearchParams(window.location.search || '')
  const hashParams = parseHashParams()
  return {
    request_id: normalize(searchParams.get('rid') || hashParams.get('rid') || '', 120),
    request_ts: normalize(searchParams.get('rts') || hashParams.get('rts') || '', 24),
    request_sig: normalize(searchParams.get('rsig') || hashParams.get('rsig') || '', 512),
  }
}

function readStoredTelemetryContext() {
  if (typeof localStorage === 'undefined') {
    return { request_id: '', request_ts: '', request_sig: '' }
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(TELEMETRY_AUTH_STORAGE_KEY) || '{}')
    return {
      request_id: normalize(parsed?.request_id, 120),
      request_ts: normalize(parsed?.request_ts, 24),
      request_sig: normalize(parsed?.request_sig, 512),
    }
  } catch {
    return { request_id: '', request_ts: '', request_sig: '' }
  }
}

function mergeTelemetryContext(explicit = {}) {
  const fromUrl = readTelemetryContextFromUrl()
  const fromStorage = readStoredTelemetryContext()

  return {
    request_id: normalize(explicit.request_id || fromUrl.request_id || fromStorage.request_id, 120),
    request_ts: normalize(explicit.request_ts || fromUrl.request_ts || fromStorage.request_ts, 24),
    request_sig: normalize(explicit.request_sig || fromUrl.request_sig || fromStorage.request_sig, 512),
  }
}

export function setTelemetryAuthContext(context = {}) {
  if (typeof localStorage === 'undefined') return
  const merged = mergeTelemetryContext(context)
  if (!merged.request_id || !merged.request_ts || !merged.request_sig) return
  localStorage.setItem(TELEMETRY_AUTH_STORAGE_KEY, JSON.stringify(merged))
}

export function clearTelemetryAuthContext() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(TELEMETRY_AUTH_STORAGE_KEY)
}

export async function trackFunnelEvent(payload) {
  if (!hasSupabaseConfig) return

  const context = mergeTelemetryContext(payload || {})
  const body = {
    ...(payload || {}),
    request_id: context.request_id || undefined,
    request_ts: context.request_ts || undefined,
    request_sig: context.request_sig || undefined,
  }

  const res = await fetch(supabaseFunctionUrl('telemetry-funnel-event'), {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
