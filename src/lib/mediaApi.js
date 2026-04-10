import * as tus from 'tus-js-client'
import { bypassAuth, supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient'
import { callFunction, getValidSession } from './functionsApi'

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

export function removeMedia(mediaId) {
  return callFunction(`media/${encodeURIComponent(mediaId)}`, {
    method: 'DELETE',
  })
}
