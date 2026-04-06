import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, serverError, json } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import {
  ALLOWED_MIME,
  BUCKET,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  UPLOADS_PER_HOUR_LIMIT,
} from '../_shared/constants.ts'
import { buildOriginalPath, mediaTypeFromMime } from '../_shared/media-paths.ts'
import { audit } from '../_shared/audit.ts'

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

  const { data: signedUpload, error: signedErr } = await auth.admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(objectPath)

  if (signedErr || !signedUpload) {
    await auth.admin.from('media_assets').delete().eq('id', mediaId)
    return serverError('Failed to create upload URL', signedErr?.message)
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
    uploadPath: signedUpload.path,
    uploadToken: signedUpload.token,
    uploadUrl: signedUpload.signedUrl,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  })
})
