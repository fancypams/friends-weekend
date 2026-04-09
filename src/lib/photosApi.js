import * as tus from 'tus-js-client'
import { bypassAuth, supabase, supabaseAnonKey, supabaseFunctionUrl, supabaseUrl } from './supabaseClient'

const SESSION_TIMEOUT_MS = 25000
const FUNCTION_TIMEOUT_MS = 30000
const DEBUG_BUILD_ID = 'photosApi-debug-2026-04-08T11:44:00Z'

if (typeof window !== 'undefined') {
  window.__photosApiBuild = DEBUG_BUILD_ID
}

function decodeJwtPayload(token) {
  const raw = String(token || '').trim()
  const parts = raw.split('.')
  if (parts.length < 2) return null

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = atob(padded)
    return JSON.parse(json)
  } catch {
    return null
  }
}

function safeProjectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split('.')[0] || ''
  } catch {
    return ''
  }
}

function authTokenFromHeaders(headers) {
  const auth = String(headers?.Authorization || '')
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.slice(7).trim()
}

function looksLikeInvalidJwtError(err) {
  const message = String(err?.message || '').toLowerCase()
  const code = String(err?.code || err?.body?.code || err?.body?.error_code || '').toLowerCase()
  const status = Number(err?.status || 0)

  return (
    status === 401
    && (
      code === 'invalid_jwt'
      || message.includes('invalid jwt')
      || message.includes('invalid or expired token')
      || message.includes('no active session')
    )
  )
}

function writeDebug(key, value) {
  if (typeof window === 'undefined') return
  window[key] = value
}

async function withTimeout(factory, timeoutMs, message) {
  let timer = null
  try {
    return await Promise.race([
      factory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function getValidSession() {
  if (!supabase) return null

  const { data, error } = await withTimeout(
    () => supabase.auth.getSession(),
    SESSION_TIMEOUT_MS,
    'Session check timed out. Please retry.',
  )
  if (error) throw error

  let session = data.session ?? null
  if (!session) return null

  const isInvalidJwt = (err) => {
    const message = String(err?.message || '').toLowerCase()
    const code = String(err?.code || '').toLowerCase()
    const status = Number(err?.status || err?.statusCode || 0)

    return (
      status === 401
      || code === 'invalid_jwt'
      || message.includes('invalid jwt')
      || message.includes('invalid or expired token')
    )
  }

  const refresh = async () => {
    const refreshed = await withTimeout(
      () => supabase.auth.refreshSession(),
      SESSION_TIMEOUT_MS,
      'Session refresh timed out. Please retry.',
    )
    if (refreshed.error) throw refreshed.error
    return refreshed.data.session ?? null
  }

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = Number(session.expires_at ?? 0)
  const expiresSoon = !expiresAt || expiresAt <= now + 60

  if (expiresSoon) {
    session = await refresh()
    if (!session) return null
  }

  // A token can be invalid before expiry (stale storage, key rotation, or mismatched session state).
  // Validate it once and force refresh if needed.
  const probe = await withTimeout(
    () => supabase.auth.getUser(session.access_token),
    SESSION_TIMEOUT_MS,
    'Session check timed out. Please retry.',
  )

  if (probe.error || !probe.data?.user) {
    if (!isInvalidJwt(probe.error)) {
      // Treat non-auth probe failures as transient and keep the current session.
      return session
    }

    session = await refresh()
    if (!session) return null
  }

  return session
}

async function authHeaders() {
  if (!supabase) {
    throw new Error('Supabase is not configured')
  }

  if (bypassAuth) {
    return {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    }
  }

  const session = await getValidSession()
  const token = session?.access_token
  if (!token) {
    throw new Error('No active session')
  }

  return {
    Authorization: `Bearer ${token}`,
    apikey: supabaseAnonKey,
    'Content-Type': 'application/json',
  }
}

async function parseResponse(res) {
  const text = await res.text()
  let body = null

  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }

  if (!res.ok) {
    const message = body?.error || body?.reason || body?.message || `Request failed (${res.status})`
    const error = new Error(message)
    error.status = res.status
    error.code = body?.code || body?.error_code || null
    error.body = body
    throw error
  }

  return body
}

async function callFunction(path, { method = 'GET', body } = {}) {
  const makeRequest = async (headers) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FUNCTION_TIMEOUT_MS)

    try {
      return await fetch(supabaseFunctionUrl(path), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  const shouldRetryWithRefresh = (res, payload) => {
    if (bypassAuth || !supabase) return false
    if (res.status !== 401) return false

    const message = String(payload?.error || payload?.message || '').toLowerCase()
    const code = String(payload?.code || payload?.error_code || '').toLowerCase()

    return (
      code === 'invalid_jwt'
      || message.includes('invalid jwt')
      || message.includes('invalid or expired token')
      || message.includes('no active session')
    )
  }

  const parseBodySafely = async (res) => {
    try {
      const text = await res.clone().text()
      if (!text) return null
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  let headers = await authHeaders()

  try {
    let res = await makeRequest(headers)
    const firstPayload = await parseBodySafely(res)

    if (shouldRetryWithRefresh(res, firstPayload)) {
      const refreshed = await withTimeout(
        () => supabase.auth.refreshSession(),
        SESSION_TIMEOUT_MS,
        'Session refresh timed out. Please retry.',
      )

      if (refreshed?.error) {
        throw refreshed.error
      }

      const refreshedToken = refreshed?.data?.session?.access_token
      if (refreshedToken) {
        headers = {
          ...headers,
          Authorization: `Bearer ${refreshedToken}`,
        }
        res = await makeRequest(headers)
      }
    }

    return await parseResponse(res)
  } catch (err) {
    writeDebug('__photosLastError', {
      build: DEBUG_BUILD_ID,
      functionPath: path,
      status: Number(err?.status || 0) || null,
      code: err?.code || err?.body?.code || err?.body?.error_code || null,
      message: err?.message || null,
      body: err?.body || null,
      at: new Date().toISOString(),
    })

    if (looksLikeInvalidJwtError(err) && !bypassAuth && supabase) {
      const token = authTokenFromHeaders(headers)
      const tokenPayload = decodeJwtPayload(token)
      const anonPayload = decodeJwtPayload(supabaseAnonKey)
      const functionRef = safeProjectRefFromUrl(supabaseFunctionUrl(path))

      let authProbe = null
      try {
        if (token) {
          const probe = await withTimeout(
            () => supabase.auth.getUser(token),
            SESSION_TIMEOUT_MS,
            'Session check timed out. Please retry.',
          )
          authProbe = {
            ok: Boolean(probe?.data?.user) && !probe?.error,
            code: probe?.error?.code || null,
            message: probe?.error?.message || null,
          }
        }
      } catch (probeErr) {
        authProbe = {
          ok: false,
          code: probeErr?.code || null,
          message: probeErr?.message || null,
        }
      }

      const debug = {
        build: DEBUG_BUILD_ID,
        functionPath: path,
        functionRef,
        anonRef: anonPayload?.ref || null,
        tokenRef: tokenPayload?.ref || null,
        tokenRole: tokenPayload?.role || null,
        tokenIss: tokenPayload?.iss || null,
        tokenAud: tokenPayload?.aud || null,
        tokenExp: tokenPayload?.exp || null,
        authProbe,
      }

      err.debug = debug
      err.debugSummary = `functionRef=${debug.functionRef} anonRef=${debug.anonRef} tokenRef=${debug.tokenRef} authProbeOk=${debug.authProbe?.ok}`

      writeDebug('__photosAuthDebug', debug)

      if (import.meta.env.DEV) {
        err.message = `${err.message} (${err.debugSummary})`
        // eslint-disable-next-line no-console
        console.error('[photosApi] Invalid JWT diagnostics', debug)
      }
    }

    if (err?.name === 'AbortError') {
      const timeoutError = new Error('Request timed out. Please try again.')
      timeoutError.code = 'request_timeout'
      timeoutError.status = 408
      throw timeoutError
    }
    throw err
  }
}

export async function fetchProfile(userId) {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,role,active')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export function createUploadTicket(payload) {
  return callFunction('create-upload-ticket', {
    method: 'POST',
    body: payload,
  })
}

export async function uploadWithSignedTicket(ticket, file) {
  if (!supabase) throw new Error('Supabase is not configured')

  const objectPath = String(ticket?.objectPath || ticket?.uploadPath || '').trim()
  if (!objectPath) throw new Error('Upload target path is missing')

  const session = bypassAuth ? null : await getValidSession()
  const accessToken = String(session?.access_token || '').trim()

  // Compatibility fallback for old tickets and bypass mode.
  if (!accessToken && ticket?.uploadPath && ticket?.uploadToken) {
    const { error } = await supabase.storage
      .from('shared-media')
      .uploadToSignedUrl(ticket.uploadPath, ticket.uploadToken, file)
    if (error) throw error
    return
  }

  if (!accessToken) {
    throw new Error('No active session')
  }

  const endpoint = `${supabaseUrl}/storage/v1/upload/resumable`
  const contentType = String(file?.type || ticket?.mimeType || 'application/octet-stream')

  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 2500, 5000],
      metadata: {
        bucketName: 'shared-media',
        objectName: objectPath,
        contentType,
        cacheControl: '3600',
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onError: (err) => reject(err),
      onSuccess: () => resolve(true),
    })

    upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads?.length) {
          upload.resumeFromPreviousUpload(previousUploads[0])
        }
        upload.start()
      })
      .catch(() => {
        upload.start()
      })
  })
}

export function completeUpload(mediaId) {
  return callFunction('complete-upload', {
    method: 'POST',
    body: { mediaId },
  })
}

export function fetchGalleryFeed(cursor = null, limit = 20) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  return callFunction(`gallery-feed?${params.toString()}`)
}

export function fetchMyUploads(cursor = null, limit = 20) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  return callFunction(`my-uploads?${params.toString()}`)
}

export function signMediaUrl(mediaId, variant = 'processed') {
  return callFunction('sign-media-url', {
    method: 'POST',
    body: { mediaId, variant },
  })
}

export function listInvites() {
  return callFunction('invites')
}

export function upsertInvite(payload) {
  return callFunction('invites', {
    method: 'POST',
    body: payload,
  })
}

export function inviteAndSend(payload) {
  return callFunction('invite-and-send', {
    method: 'POST',
    body: payload,
  })
}

export function removeInvite(email) {
  return callFunction(`invites/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  })
}

export function removeMedia(mediaId) {
  return callFunction(`media/${encodeURIComponent(mediaId)}`, {
    method: 'DELETE',
  })
}
