import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, conflict, forbidden, serverError, json } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import {
  ALLOWED_MIME,
  BUCKET,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  UPLOADS_PER_HOUR_LIMIT,
} from '../_shared/constants.ts'
import { buildDerivedPaths, buildOriginalPath, mediaTypeFromMime } from '../_shared/media-paths.ts'
import { audit } from '../_shared/audit.ts'
import { resolveUploadWindow } from '../_shared/upload-window.ts'

type CreateUploadTicketBody = {
  filename?: string
  mimeType?: string
  bytes?: number
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  let uploadWindow
  try {
    uploadWindow = await resolveUploadWindow(auth.admin, auth.profile)
  } catch (err) {
    console.error('[create-upload-ticket] upload window', err)
    return serverError('Failed to resolve upload window', err instanceof Error ? err.message : String(err))
  }

  if (!uploadWindow.allowed) {
    return forbidden(uploadWindow.reason)
  }

  let payload: CreateUploadTicketBody
  try {
    payload = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const filename = String(payload.filename ?? '').trim()
  const mimeType = String(payload.mimeType ?? '').trim().toLowerCase()
  const bytes = Number(payload.bytes ?? NaN)

  if (!filename || !mimeType || !Number.isFinite(bytes)) {
    return badRequest('filename, mimeType, and bytes are required')
  }

  if (!ALLOWED_MIME.has(mimeType)) {
    return badRequest('Unsupported media type', { mimeType })
  }

  if (bytes <= 0) {
    return badRequest('File size must be greater than zero')
  }

  const mediaType = mediaTypeFromMime(mimeType)
  if (!mediaType) {
    return badRequest('Unsupported media type', { mimeType })
  }

  if (mediaType === 'image' && bytes > IMAGE_MAX_BYTES) {
    return badRequest(`Image exceeds max size of ${IMAGE_MAX_BYTES} bytes`)
  }

  if (mediaType === 'video' && bytes > VIDEO_MAX_BYTES) {
    return badRequest(`Video exceeds max size of ${VIDEO_MAX_BYTES} bytes`)
  }

  const { data: duplicates, error: duplicateErr } = await auth.admin
    .from('media_assets')
    .select('id,status,created_at')
    .eq('original_filename', filename)
    .eq('bytes', bytes)
    .in('status', ['uploading', 'processing', 'published'])
    .is('removed_at', null)
    .order('created_at', { ascending: false })
    .limit(5)

  if (duplicateErr) {
    return serverError('Failed to check for duplicate media', duplicateErr.message)
  }

  const duplicate = duplicates?.find((row) => row.status === 'published')
  if (duplicate?.id) {
    return conflict('Duplicate media already exists')
  }

  const staleCutoffMs = Date.now() - (5 * 60 * 1000)
  const staleDuplicates = (duplicates || []).filter((row) => {
    const createdMs = Date.parse(String(row.created_at || ''))
    return row.status !== 'published' && Number.isFinite(createdMs) && createdMs < staleCutoffMs
  })

  if (staleDuplicates.length) {
    await auth.admin
      .from('media_assets')
      .update({
        status: 'failed',
        failure_reason: 'Upload was replaced by a retry.',
        processed_at: new Date().toISOString(),
      })
      .in('id', staleDuplicates.map((row) => row.id))
  }

  const { data: allowedByQuota, error: quotaErr } = await auth.admin
    .rpc('consume_upload_quota', {
      p_user_id: auth.user.id,
      p_limit: UPLOADS_PER_HOUR_LIMIT,
    })

  if (quotaErr) {
    return serverError('Failed to enforce upload rate limit', quotaErr.message)
  }

  if (!allowedByQuota) {
    return json(
      {
        error: 'Upload rate limit reached. Try again later.',
      },
      429,
    )
  }

  const mediaId = crypto.randomUUID()
  const objectPath = buildOriginalPath(auth.user.id, mediaId, mimeType, filename)
  const derivedPaths = buildDerivedPaths(auth.user.id, mediaId, mediaType, mimeType, objectPath)

  let derivedUploads = null
  if (mediaType === 'image') {
    const { data: processedUpload, error: processedUploadErr } = await auth.admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(derivedPaths.processedPath)

    if (processedUploadErr || !processedUpload) {
      return serverError('Failed to create processed media upload URL', processedUploadErr?.message)
    }

    const { data: thumbUpload, error: thumbUploadErr } = await auth.admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(derivedPaths.thumbPath)

    if (thumbUploadErr || !thumbUpload) {
      return serverError('Failed to create thumbnail upload URL', thumbUploadErr?.message)
    }

    derivedUploads = {
      processed: {
        path: derivedPaths.processedPath,
        token: processedUpload.token,
      },
      thumb: {
        path: derivedPaths.thumbPath,
        token: thumbUpload.token,
      },
    }
  } else if (derivedPaths.posterPath) {
    const { data: posterUpload, error: posterUploadErr } = await auth.admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(derivedPaths.posterPath)

    if (posterUploadErr || !posterUpload) {
      return serverError('Failed to create video poster upload URL', posterUploadErr?.message)
    }

    derivedUploads = {
      poster: {
        path: derivedPaths.posterPath,
        token: posterUpload.token,
      },
    }
  }

  const { error: insertErr } = await auth.admin.from('media_assets').insert({
    id: mediaId,
    owner_id: auth.user.id,
    media_type: mediaType,
    mime_type: mimeType,
    original_filename: filename,
    bytes,
    status: 'uploading',
    original_path: objectPath,
  })

  if (insertErr) {
    return serverError('Failed to create media record', insertErr.message)
  }

  await audit(auth.admin, {
    actorId: auth.user.id,
    action: 'media.upload_ticket_created',
    entity: 'media_assets',
    entityId: mediaId,
    details: {
      mimeType,
      bytes,
      mediaType,
      objectPath,
    },
  })

  return json({
    mediaId,
    objectPath,
    mediaType,
    bucket: BUCKET,
    derivedUploads,
    uploadProtocol: 'tus',
    tusEndpoint: '/storage/v1/upload/resumable',
  })
})
