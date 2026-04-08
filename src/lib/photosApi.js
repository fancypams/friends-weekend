import { bypassAuth, supabase, supabaseAnonKey, supabaseFunctionUrl } from './supabaseClient'

const SESSION_TIMEOUT_MS = 12000
const FUNCTION_TIMEOUT_MS = 30000

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

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = Number(session.expires_at ?? 0)
  const expiresSoon = !expiresAt || expiresAt <= now + 60

  if (expiresSoon) {
    const refreshed = await withTimeout(
      () => supabase.auth.refreshSession(),
      SESSION_TIMEOUT_MS,
      'Session refresh timed out. Please retry.',
    )
    if (refreshed.error) throw refreshed.error
    session = refreshed.data.session ?? null
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
    const message = body?.error || body?.message || `Request failed (${res.status})`
    const error = new Error(message)
    error.status = res.status
    error.code = body?.code || body?.error_code || null
    error.body = body
    throw error
  }

  return body
}

async function callFunction(path, { method = 'GET', body } = {}) {
  const headers = await authHeaders()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FUNCTION_TIMEOUT_MS)

  try {
    const res = await fetch(supabaseFunctionUrl(path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    return parseResponse(res)
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutError = new Error('Request timed out. Please try again.')
      timeoutError.code = 'request_timeout'
      timeoutError.status = 408
      throw timeoutError
    }
    throw err
  } finally {
    clearTimeout(timeout)
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

  const { error } = await supabase.storage
    .from('shared-media')
    .uploadToSignedUrl(ticket.uploadPath, ticket.uploadToken, file)

  if (error) throw error
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
