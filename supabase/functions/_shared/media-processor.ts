import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import heicConvert from 'npm:heic-convert@2.1.0'
import { BUCKET } from './constants.ts'
import { buildDerivedPaths } from './media-paths.ts'
import { audit } from './audit.ts'

// This v1 processor publishes secure derivatives. HEIC/HEIF images are converted
// to JPEG derivatives; other supported media uses copy-through publication.
export type MediaAssetRow = {
  id: string
  owner_id: string
  media_type: 'image' | 'video'
  mime_type: string
  status: 'uploading' | 'processing' | 'published' | 'failed' | 'removed'
  original_path: string
  processed_path: string | null
  thumbnail_path: string | null
  poster_path: string | null
}

function isHeicImage(asset: Pick<MediaAssetRow, 'media_type' | 'mime_type'>) {
  return asset.media_type === 'image' && (asset.mime_type === 'image/heic' || asset.mime_type === 'image/heif')
}

async function convertHeicToJpeg(bytes: Uint8Array) {
  const output = await heicConvert({
    buffer: bytes,
    format: 'JPEG',
    quality: 0.9,
  })

  return output instanceof Uint8Array ? output : new Uint8Array(output)
}

async function markProcessingFailed(
  admin: SupabaseClient,
  asset: Pick<MediaAssetRow, 'id'>,
  actorId: string | null,
  step: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  await admin
    .from('media_assets')
    .update({
      status: 'failed',
      failure_reason: message,
      processed_at: new Date().toISOString(),
    })
    .eq('id', asset.id)

  await audit(admin, {
    actorId,
    action: 'media.process_failed',
    entity: 'media_assets',
    entityId: asset.id,
    details: {
      step,
      error: message,
      ...details,
    },
  })
}

export async function processOneMediaAsset(
  admin: SupabaseClient,
  mediaId: string,
  actorId: string | null = null,
) {
  const { data: asset, error: loadErr } = await admin
    .from('media_assets')
    .select('id,owner_id,media_type,mime_type,status,original_path,processed_path,thumbnail_path,poster_path')
    .eq('id', mediaId)
    .maybeSingle<MediaAssetRow>()

  if (loadErr || !asset) {
    return { ok: false as const, error: loadErr?.message ?? 'Media not found' }
  }

  if (asset.status === 'removed') {
    return { ok: false as const, error: 'Media was removed' }
  }

  const { processedPath, thumbPath, posterPath } = buildDerivedPaths(
    asset.owner_id,
    asset.id,
    asset.media_type,
    asset.mime_type,
    asset.original_path,
  )

  if (isHeicImage(asset)) {
    const { data: sourceBlob, error: downloadErr } = await admin.storage
      .from(BUCKET)
      .download(asset.original_path)

    if (downloadErr || !sourceBlob) {
      const message = downloadErr?.message ?? 'Could not read original HEIC image'
      await markProcessingFailed(admin, asset, actorId, 'download_original', message)
      return { ok: false as const, error: message }
    }

    const heicBytes = new Uint8Array(await sourceBlob.arrayBuffer())
    let jpegBytes: Uint8Array
    try {
      jpegBytes = await convertHeicToJpeg(heicBytes)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await markProcessingFailed(admin, asset, actorId, 'convert_heic_to_jpeg', message, {
        mime_type: asset.mime_type,
        input_type: heicBytes.constructor.name,
        input_byte_length: heicBytes.byteLength,
      })
      return { ok: false as const, error: message }
    }

    const jpegBlob = new Blob([jpegBytes], { type: 'image/jpeg' })
    const uploadProcessed = await admin.storage
      .from(BUCKET)
      .upload(processedPath, jpegBlob, {
        contentType: 'image/jpeg',
        upsert: true,
      })

    if (uploadProcessed.error) {
      await markProcessingFailed(admin, asset, actorId, 'upload_converted_processed', uploadProcessed.error.message)
      return { ok: false as const, error: uploadProcessed.error.message }
    }

    let storedThumbPath: string | null = null
    if (thumbPath) {
      const uploadThumb = await admin.storage
        .from(BUCKET)
        .upload(thumbPath, jpegBlob, {
          contentType: 'image/jpeg',
          upsert: true,
        })

      if (!uploadThumb.error) {
        storedThumbPath = thumbPath
      }
    }

    await admin
      .from('media_assets')
      .update({
        status: 'published',
        processed_path: processedPath,
        thumbnail_path: storedThumbPath,
        poster_path: posterPath,
        failure_reason: null,
        processed_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
      })
      .eq('id', asset.id)

    await audit(admin, {
      actorId,
      action: 'media.published',
      entity: 'media_assets',
      entityId: asset.id,
      details: {
        media_type: asset.media_type,
        mime_type: asset.mime_type,
        processed_path: processedPath,
        thumbnail_path: storedThumbPath,
        poster_path: posterPath,
        pipeline_mode: 'heic-to-jpeg',
      },
    })

    return { ok: true as const }
  }

  const copyToProcessed = await admin.storage
    .from(BUCKET)
    .copy(asset.original_path, processedPath)

  if (copyToProcessed.error) {
    await admin
      .from('media_assets')
      .update({
        status: 'failed',
        failure_reason: copyToProcessed.error.message,
        processed_at: new Date().toISOString(),
      })
      .eq('id', asset.id)

    await audit(admin, {
      actorId,
      action: 'media.process_failed',
      entity: 'media_assets',
      entityId: asset.id,
      details: {
        step: 'copy_processed',
        error: copyToProcessed.error.message,
      },
    })

    return { ok: false as const, error: copyToProcessed.error.message }
  }

  let storedThumbPath: string | null = null
  if (thumbPath) {
    const copyThumb = await admin.storage
      .from(BUCKET)
      .copy(processedPath, thumbPath)

    if (!copyThumb.error) {
      storedThumbPath = thumbPath
    }
  }

  await admin
    .from('media_assets')
    .update({
      status: 'published',
      processed_path: processedPath,
      thumbnail_path: storedThumbPath,
      poster_path: posterPath,
      failure_reason: null,
      processed_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
    })
    .eq('id', asset.id)

  await audit(admin, {
    actorId,
    action: 'media.published',
    entity: 'media_assets',
    entityId: asset.id,
    details: {
      media_type: asset.media_type,
      mime_type: asset.mime_type,
      processed_path: processedPath,
      thumbnail_path: storedThumbPath,
      poster_path: posterPath,
      pipeline_mode: 'copy-through',
    },
  })

  return { ok: true as const }
}

export async function processPendingBatch(admin: SupabaseClient, limit = 20) {
  const { data: rows, error } = await admin
    .from('media_assets')
    .select('id')
    .eq('status', 'processing')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error || !rows) {
    return {
      processed: 0,
      failed: 0,
      errors: [error?.message ?? 'Failed to load processing queue'],
    }
  }

  let processed = 0
  let failed = 0
  const errors: string[] = []

  for (const row of rows) {
    const result = await processOneMediaAsset(admin, row.id)
    if (result.ok) {
      processed += 1
    } else {
      failed += 1
      errors.push(`${row.id}: ${result.error}`)
    }
  }

  return { processed, failed, errors }
}
