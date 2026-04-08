import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, conflict, notFound, serverError, json } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { audit } from '../_shared/audit.ts'
import { processOneMediaAsset } from '../_shared/media-processor.ts'
import { BUCKET } from '../_shared/constants.ts'
import { extractCaptureTimestamp } from '../_shared/media-metadata.ts'
import { CAPTURE_WINDOW_END_ISO, CAPTURE_WINDOW_START_ISO, captureWindowLabel, isWithinCaptureWindow } from '../_shared/capture-window.ts'

type CompleteUploadBody = {
  mediaId?: string
}

type MediaRow = {
  id: string
  owner_id: string
  media_type: 'image' | 'video'
  mime_type: string
  status: 'uploading' | 'processing' | 'published' | 'failed' | 'removed'
  original_path: string
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  let payload: CompleteUploadBody
  try {
    payload = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const mediaId = String(payload.mediaId ?? '').trim()
  if (!mediaId) {
    return badRequest('mediaId is required')
  }

  const { data: media, error: mediaErr } = await auth.admin
    .from('media_assets')
    .select('id,owner_id,media_type,mime_type,status,original_path')
    .eq('id', mediaId)
    .maybeSingle<MediaRow>()

  if (mediaErr) {
    return serverError('Failed to load media record', mediaErr.message)
  }

  if (!media) {
    return notFound('Media record not found')
  }

  if (media.owner_id !== auth.user.id && auth.profile.role !== 'admin') {
    return json({ error: 'Cannot finalize another user media upload' }, 403)
  }

  if (media.status !== 'uploading') {
    return conflict('Media cannot be finalized from current status', { status: media.status })
  }

  const { data: sourceBlob, error: downloadErr } = await auth.admin.storage
    .from(BUCKET)
    .download(media.original_path)

  if (downloadErr || !sourceBlob) {
    await auth.admin
      .from('media_assets')
      .update({
        status: 'failed',
        failure_reason: 'Could not read uploaded media from storage',
        processed_at: new Date().toISOString(),
      })
      .eq('id', media.id)

    return serverError('Unable to inspect uploaded media', downloadErr?.message)
  }

  const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer())
  const capture = await extractCaptureTimestamp(media.media_type, sourceBytes)
  const enforceCaptureWindow = auth.profile.role !== 'admin'

  if (enforceCaptureWindow) {
    if (!capture) {
      await auth.admin
        .from('media_assets')
        .update({
          status: 'failed',
          uploaded_at: new Date().toISOString(),
          processed_at: new Date().toISOString(),
          failure_reason: `Missing capture timestamp metadata. Allowed window: ${captureWindowLabel()}.`,
        })
        .eq('id', media.id)

      await auth.admin.storage.from(BUCKET).remove([media.original_path])

      await audit(auth.admin, {
        actorId: auth.user.id,
        action: 'media.capture_window_rejected',
        entity: 'media_assets',
        entityId: media.id,
        details: {
          reason: 'missing_capture_metadata',
        },
      })

      return json(
        {
          status: 'failed',
          mediaId: media.id,
          reason: `Missing capture timestamp metadata. Allowed window: ${captureWindowLabel()}.`,
        },
        422,
      )
    }

    if (!isWithinCaptureWindow(capture.capturedAt)) {
      await auth.admin
        .from('media_assets')
        .update({
          status: 'failed',
          uploaded_at: new Date().toISOString(),
          processed_at: new Date().toISOString(),
          captured_at: capture.capturedAt.toISOString(),
          capture_source: capture.source,
          failure_reason: `Capture timestamp ${capture.capturedAt.toISOString()} is outside allowed window ${captureWindowLabel()}.`,
        })
        .eq('id', media.id)

      await auth.admin.storage.from(BUCKET).remove([media.original_path])

      await audit(auth.admin, {
        actorId: auth.user.id,
        action: 'media.capture_window_rejected',
        entity: 'media_assets',
        entityId: media.id,
        details: {
          reason: 'capture_out_of_window',
          captured_at: capture.capturedAt.toISOString(),
          capture_source: capture.source,
          allowed_start: CAPTURE_WINDOW_START_ISO,
          allowed_end: CAPTURE_WINDOW_END_ISO,
        },
      })

      return json(
        {
          status: 'failed',
          mediaId: media.id,
          reason: `Capture timestamp is outside allowed window ${captureWindowLabel()}.`,
        },
        422,
      )
    }
  }

  const { error: markErr } = await auth.admin
    .from('media_assets')
    .update({
      status: 'processing',
      uploaded_at: new Date().toISOString(),
      captured_at: capture?.capturedAt?.toISOString() ?? null,
      capture_source: capture?.source ?? null,
      failure_reason: null,
    })
    .eq('id', media.id)

  if (markErr) {
    return serverError('Failed to mark media as processing', markErr.message)
  }

  await audit(auth.admin, {
    actorId: auth.user.id,
    action: 'media.upload_completed',
    entity: 'media_assets',
    entityId: media.id,
  })

  const processing = await processOneMediaAsset(auth.admin, media.id, auth.user.id)

  if (!processing.ok) {
    return serverError('Media processing failed', processing.error)
  }

  return json({
    status: 'published',
    mediaId: media.id,
  })
})
