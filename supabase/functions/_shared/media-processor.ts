import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { BUCKET } from './constants.ts'
import { buildDerivedPaths } from './media-paths.ts'
import { audit } from './audit.ts'

// Image derivatives and video posters are generated in the browser at upload
// time; videos still use copy-through for the playable asset.
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

async function storageObjectExists(admin: SupabaseClient, path: string) {
  const slashIndex = path.lastIndexOf('/')
  const folder = slashIndex >= 0 ? path.slice(0, slashIndex) : ''
  const name = slashIndex >= 0 ? path.slice(slashIndex + 1) : path
  const { data, error } = await admin.storage
    .from(BUCKET)
    .list(folder, {
      limit: 1,
      search: name,
    })

  if (error) return { exists: false, error: error.message }
  return { exists: Boolean(data?.some((item) => item.name === name)), error: null }
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

  if (asset.media_type === 'image') {
    const processedObject = await storageObjectExists(admin, processedPath)
    if (processedObject.error) {
      await markProcessingFailed(admin, asset, actorId, 'verify_converted_processed', processedObject.error)
      return { ok: false as const, error: processedObject.error }
    }

    if (!processedObject.exists) {
      const message = 'Processed JPEG derivative is missing'
      await markProcessingFailed(admin, asset, actorId, 'verify_converted_processed', message, {
        mime_type: asset.mime_type,
        processed_path: processedPath,
        thumbnail_path: thumbPath,
      })
      return { ok: false as const, error: message }
    }

    if (!thumbPath) {
      const message = 'Thumbnail derivative path is missing'
      await markProcessingFailed(admin, asset, actorId, 'verify_converted_thumb', message, {
        mime_type: asset.mime_type,
        processed_path: processedPath,
      })
      return { ok: false as const, error: message }
    }

    const thumbObject = await storageObjectExists(admin, thumbPath)
    if (thumbObject.error) {
      await markProcessingFailed(admin, asset, actorId, 'verify_converted_thumb', thumbObject.error)
      return { ok: false as const, error: thumbObject.error }
    }

    if (!thumbObject.exists) {
      const message = 'Thumbnail JPEG derivative is missing'
      await markProcessingFailed(admin, asset, actorId, 'verify_converted_thumb', message, {
        mime_type: asset.mime_type,
        processed_path: processedPath,
        thumbnail_path: thumbPath,
      })
      return { ok: false as const, error: message }
    }

    await admin
      .from('media_assets')
      .update({
        status: 'published',
        processed_path: processedPath,
        thumbnail_path: thumbPath,
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
        thumbnail_path: thumbPath,
        poster_path: posterPath,
        pipeline_mode: 'client-image-derivatives',
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

  if (!posterPath) {
    const message = 'Video poster path is missing'
    await markProcessingFailed(admin, asset, actorId, 'verify_video_poster', message, {
      mime_type: asset.mime_type,
      processed_path: processedPath,
    })
    return { ok: false as const, error: message }
  }

  const posterObject = await storageObjectExists(admin, posterPath)
  if (posterObject.error) {
    await markProcessingFailed(admin, asset, actorId, 'verify_video_poster', posterObject.error)
    return { ok: false as const, error: posterObject.error }
  }

  if (!posterObject.exists) {
    const message = 'Video poster derivative is missing'
    await markProcessingFailed(admin, asset, actorId, 'verify_video_poster', message, {
      mime_type: asset.mime_type,
      processed_path: processedPath,
      poster_path: posterPath,
    })
    return { ok: false as const, error: message }
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
