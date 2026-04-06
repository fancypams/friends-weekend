import { bypassAuth, supabase, supabaseFunctionUrl } from './supabaseClient'

async function getValidSession() {
  if (!supabase) return null

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  let session = data.session ?? null
  if (!session) return null

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = Number(session.expires_at ?? 0)
  const expiresSoon = !expiresAt || expiresAt <= now + 60

  if (expiresSoon) {
    const refreshed = await supabase.auth.refreshSession()
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

  const res = await fetch(supabaseFunctionUrl(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  return parseResponse(res)
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
