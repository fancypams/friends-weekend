<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearPostLoginRedirect, getPostLoginRedirect } from '../lib/authAccess'
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient'
import { clearTelemetryAuthContext, setTelemetryAuthContext, trackFunnelEvent } from '../lib/telemetryApi'

const route = useRoute()
const router = useRouter()
const statusMessage = ref('Signing you in...')

const AUTH_CALLBACK_QUERY_KEYS = [
  'rid',
  'rts',
  'rsig',
  'code',
  'error',
  'error_code',
  'error_description',
  'sb',
  'access_token',
  'refresh_token',
  'expires_at',
  'expires_in',
  'token_type',
  'type',
]

function normalizeRequestId(value) {
  const raw = String(value || '').trim()
  return raw.slice(0, 120)
}

function normalizeRedirect(value) {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/')) return '/'
  if (candidate.startsWith('//')) return '/'
  return candidate
}

function parseHashParams() {
  const rawHash = String(window.location.hash || '')
  if (!rawHash) return new URLSearchParams()

  const hashValue = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  if (!hashValue) return new URLSearchParams()

  if (hashValue.includes('?')) {
    return new URLSearchParams(hashValue.split('?')[1] || '')
  }

  const encodedFragmentIndex = hashValue.toLowerCase().indexOf('%23')
  if (encodedFragmentIndex >= 0) {
    return new URLSearchParams(hashValue.slice(encodedFragmentIndex + 3))
  }

  const decodedHash = decodeURIComponent(hashValue)
  const decodedFragmentIndex = decodedHash.indexOf('#')
  if (decodedFragmentIndex >= 0) {
    return new URLSearchParams(decodedHash.slice(decodedFragmentIndex + 1))
  }

  const normalized = hashValue.replace(/^\//, '')
  if (normalized.includes('error=') || normalized.includes('code=') || normalized.includes('access_token=')) {
    return new URLSearchParams(normalized)
  }

  return new URLSearchParams()
}

function readCallbackParams() {
  const searchParams = new URLSearchParams(window.location.search || '')
  const hashParams = parseHashParams()

  const requestId = String(
    route.query.rid
    || searchParams.get('rid')
    || hashParams.get('rid')
    || '',
  ).trim()
  const requestTs = String(
    route.query.rts
    || searchParams.get('rts')
    || hashParams.get('rts')
    || '',
  ).trim()
  const requestSig = String(
    route.query.rsig
    || searchParams.get('rsig')
    || hashParams.get('rsig')
    || '',
  ).trim()

  const code = String(
    route.query.code
    || searchParams.get('code')
    || hashParams.get('code')
    || '',
  ).trim()

  const accessToken = String(hashParams.get('access_token') || '').trim()
  const refreshToken = String(hashParams.get('refresh_token') || '').trim()

  const error = String(
    route.query.error
    || searchParams.get('error')
    || hashParams.get('error')
    || '',
  ).trim()

  const errorCode = String(
    route.query.error_code
    || searchParams.get('error_code')
    || hashParams.get('error_code')
    || '',
  ).trim()

  const errorDescription = String(
    route.query.error_description
    || searchParams.get('error_description')
    || hashParams.get('error_description')
    || '',
  ).trim()

  return {
    requestId,
    requestTs,
    requestSig,
    code,
    accessToken,
    refreshToken,
    error,
    errorCode,
    errorDescription,
  }
}

function classifyCallbackFailure(errorCode, errorMessage) {
  const code = String(errorCode || '').toLowerCase()
  const message = String(errorMessage || '').toLowerCase()

  if (
    code === 'otp_expired'
    || code === 'jwt_expired'
    || message.includes('expired')
    || message.includes('invalid or has expired')
  ) return 'expired'

  if (
    code === 'access_denied'
    || code === 'invalid_jwt'
    || message.includes('invalid jwt')
    || message.includes('missing auth callback token')
    || message.includes('missing auth callback')
  ) return 'invalid'

  return 'failed'
}

function clearAuthCallbackQueryFromUrl() {
  const url = new URL(window.location.href)
  let changed = false

  for (const key of AUTH_CALLBACK_QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }

  const rawHash = String(url.hash || '')
  if (rawHash.includes('?')) {
    const [hashPath, hashQuery = ''] = rawHash.split('?')
    const hashParams = new URLSearchParams(hashQuery)
    let hashChanged = false

    for (const key of AUTH_CALLBACK_QUERY_KEYS) {
      if (hashParams.has(key)) {
        hashParams.delete(key)
        hashChanged = true
      }
    }

    if (hashChanged) {
      const nextHashQuery = hashParams.toString()
      url.hash = nextHashQuery ? `${hashPath}?${nextHashQuery}` : hashPath
      changed = true
    }
  }

  if (!changed) return

  const search = url.searchParams.toString()
  const nextUrl = `${url.origin}${url.pathname}${search ? `?${search}` : ''}${url.hash}`
  window.history.replaceState(window.history.state, '', nextUrl)
}

function asLoginErrorQuery(details) {
  const fallbackDescription = 'This invite link is invalid or expired. Request a new magic link and try again.'
  return {
    error: details.error || 'access_denied',
    error_code: details.errorCode || 'otp_expired',
    error_description: details.errorDescription || fallbackDescription,
  }
}

async function routeAfterLogin() {
  const target = normalizeRedirect(getPostLoginRedirect())
  clearPostLoginRedirect()
  try {
    await router.replace(target || '/')
    await trackFunnelEvent({
      journey: 'invite_auth',
      step: 'post_login_redirect',
      status: 'success',
    }).catch(() => {})
  } catch (err) {
    await trackFunnelEvent({
      journey: 'invite_auth',
      step: 'post_login_redirect',
      status: 'failed',
      error_code: 'redirect_failed',
      error_message: String(err?.message || err),
    }).catch(() => {})
    throw err
  } finally {
    clearTelemetryAuthContext()
  }
}

onMounted(async () => {
  if (!hasSupabaseConfig || !supabase) {
    statusMessage.value = 'Supabase is not configured.'
    return
  }

  const callback = readCallbackParams()
  const requestId = normalizeRequestId(callback.requestId)
  if (requestId) {
    setTelemetryAuthContext({
      request_id: requestId,
      request_ts: String(callback.requestTs || ''),
      request_sig: String(callback.requestSig || ''),
    })
    await trackFunnelEvent({
      journey: 'invite_auth',
      step: 'magic_link_clicked',
      status: 'observed',
    }).catch(() => {})
  }

  if (callback.error || callback.errorCode || callback.errorDescription) {
    const classifiedStatus = classifyCallbackFailure(callback.errorCode || callback.error, callback.errorDescription)
    if (requestId) {
      await trackFunnelEvent({
        journey: 'invite_auth',
        step: 'callback_session_exchange',
        status: classifiedStatus,
        error_code: callback.errorCode || callback.error || 'access_denied',
        error_message: callback.errorDescription || 'Could not complete sign in from that link.',
      }).catch(() => {})
    }
    clearAuthCallbackQueryFromUrl()
    await router.replace({
      path: '/login',
      query: asLoginErrorQuery(callback),
    })
    return
  }

  try {
    if (callback.accessToken && callback.refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: callback.accessToken,
        refresh_token: callback.refreshToken,
      })
      if (error) throw error
    } else if (callback.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(callback.code)
      if (error) throw error
    } else {
      throw new Error('Missing auth callback token/code')
    }

    if (requestId) {
      await trackFunnelEvent({
        journey: 'invite_auth',
        step: 'callback_session_exchange',
        status: 'success',
      }).catch(() => {})
    }

    clearAuthCallbackQueryFromUrl()
    await routeAfterLogin()
  } catch (err) {
    const status = classifyCallbackFailure(err?.code, err?.message)
    if (requestId) {
      await trackFunnelEvent({
        journey: 'invite_auth',
        step: 'callback_session_exchange',
        status,
        error_code: String(err?.code || 'access_denied'),
        error_message: String(err?.message || 'Could not complete sign in from that link.'),
      }).catch(() => {})
    }
    clearAuthCallbackQueryFromUrl()
    await router.replace({
      path: '/login',
      query: {
        error: 'access_denied',
        error_code: 'otp_expired',
        error_description: err?.message || 'This invite link is invalid or expired. Request a new magic link and try again.',
      },
    })
  }
})
</script>

<template>
  <main class="auth-callback-page">
    <section class="auth-callback-card">
      <p class="auth-callback-message">{{ statusMessage }}</p>
    </section>
  </main>
</template>

<style scoped>
.auth-callback-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: linear-gradient(180deg, #edf7f8 0%, var(--bg-page) 55%, #efe9dd 100%);
}

.auth-callback-card {
  width: 100%;
  max-width: 460px;
  border-radius: 8px;
  border: 1px solid var(--green-border);
  background: #fff;
  box-shadow: 0 10px 30px rgba(28, 40, 36, 0.12);
  padding: 18px;
}

.auth-callback-message {
  margin: 0;
  color: var(--forest);
  font-family: var(--font-playfair);
  font-size: 15px;
}
</style>
