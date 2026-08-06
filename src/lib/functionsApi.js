import { bypassAuth, supabase, supabaseAnonKey, supabaseFunctionUrl } from './supabaseClient'

const SESSION_TIMEOUT_MS = 25000
const FUNCTION_TIMEOUT_MS = 30000
const DEBUG_BUILD_ID = 'functionsApi-debug-2026-04-10T13:30:00Z'

if (typeof window !== 'undefined') {
  window.__functionsApiBuild = DEBUG_BUILD_ID
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

export async function getValidSession() {
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
  } else {
    return session
  }

  const probe = await withTimeout(
    () => supabase.auth.getUser(session.access_token),
    SESSION_TIMEOUT_MS,
    'Session check timed out. Please retry.',
  )

  if (!probe.error && probe.data?.user) return session
  if (!isInvalidJwt(probe.error)) return session

  session = await refresh()
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

export async function callFunction(path, { method = 'GET', body } = {}) {
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
    const status = Number(res.status || 0)
    if (status !== 401 && status !== 400) return false

    const message = String(payload?.error || payload?.message || '').toLowerCase()
    const code = String(payload?.code || payload?.error_code || '').toLowerCase()

    return (
      code === '401'
      || code === 'invalid_jwt'
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
    writeDebug('__functionsLastError', {
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

      writeDebug('__functionsAuthDebug', debug)

      if (import.meta.env.DEV) {
        err.message = `${err.message} (${err.debugSummary})`
        // eslint-disable-next-line no-console
        console.error('[functionsApi] Invalid JWT diagnostics', debug)
      }

      const sessionError = new Error('Could not authenticate this request. Please retry.')
      sessionError.code = 'invalid_jwt'
      sessionError.status = 401
      throw sessionError
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

function filenameFromContentDisposition(value) {
  const header = String(value || '')
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1])
    } catch {
      return utfMatch[1]
    }
  }

  const match = header.match(/filename="?([^";]+)"?/i)
  return match?.[1] || ''
}

function numberFromHeader(headers, name) {
  const value = Number(headers.get(name) || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

async function readBlobWithProgress(res, onProgress) {
  const totalBytes = (
    numberFromHeader(res.headers, 'Content-Length')
    || numberFromHeader(res.headers, 'X-Archive-Total-Bytes')
  )
  const itemCount = numberFromHeader(res.headers, 'X-Archive-Item-Count')

  onProgress?.({
    phase: 'downloading',
    loadedBytes: 0,
    totalBytes,
    itemCount,
  })

  if (!res.body) {
    const blob = await res.blob()
    onProgress?.({
      phase: 'complete',
      loadedBytes: blob.size,
      totalBytes: totalBytes || blob.size,
      itemCount,
    })
    return blob
  }

  const reader = res.body.getReader()
  const chunks = []
  let loadedBytes = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    loadedBytes += value.length
    onProgress?.({
      phase: 'downloading',
      loadedBytes,
      totalBytes,
      itemCount,
    })
  }

  const blob = new Blob(chunks, {
    type: res.headers.get('Content-Type') || 'application/octet-stream',
  })
  onProgress?.({
    phase: 'complete',
    loadedBytes: blob.size,
    totalBytes: totalBytes || blob.size,
    itemCount,
  })
  return blob
}

export async function callFunctionBlob(path, { method = 'GET', body, timeoutMs = 0, onProgress } = {}) {
  const headers = await authHeaders()
  delete headers['Content-Type']

  const controller = timeoutMs > 0 ? new AbortController() : null
  const timeout = timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null

  try {
    onProgress?.({
      phase: 'requesting',
      loadedBytes: 0,
      totalBytes: 0,
      itemCount: 0,
    })

    const res = await fetch(supabaseFunctionUrl(path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    })

    if (!res.ok) {
      let payload = null
      try {
        const text = await res.text()
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = null
      }

      const error = new Error(payload?.error || payload?.message || `Request failed (${res.status})`)
      error.status = res.status
      error.body = payload
      throw error
    }

    return {
      blob: await readBlobWithProgress(res, onProgress),
      filename: filenameFromContentDisposition(res.headers.get('Content-Disposition')),
      itemCount: numberFromHeader(res.headers, 'X-Archive-Item-Count'),
      totalBytes: numberFromHeader(res.headers, 'X-Archive-Total-Bytes'),
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutError = new Error('Request timed out. Please try again.')
      timeoutError.code = 'request_timeout'
      timeoutError.status = 408
      throw timeoutError
    }
    throw err
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
