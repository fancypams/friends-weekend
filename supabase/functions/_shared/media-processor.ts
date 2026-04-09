import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { BUCKET } from './constants.ts'
import { buildDerivedPaths } from './media-paths.ts'
import { audit } from './audit.ts'

// This v1 processor currently does secure copy-through publication.
// Replace with actual conversion/transcoding + metadata stripping in a dedicated worker.
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
