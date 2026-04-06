import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, forbidden, notFound, serverError, json } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { BUCKET } from '../_shared/constants.ts'
import { audit } from '../_shared/audit.ts'

type MediaRow = {
  id: string
  owner_id: string
  status: 'uploading' | 'processing' | 'published' | 'failed' | 'removed'
  original_path: string
  processed_path: string | null
  thumbnail_path: string | null
  poster_path: string | null
}

function parseMediaId(req: Request) {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  if (parts.length < 4) return null
  return decodeURIComponent(parts[3] ?? '').trim()
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['DELETE'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  const mediaId = parseMediaId(req)
  if (!mediaId) {
    return badRequest('Missing media ID path parameter')
  }

  const { data: media, error: loadErr } = await auth.admin
    .from('media_assets')
    .select('id,owner_id,status,original_path,processed_path,thumbnail_path,poster_path')
    .eq('id', mediaId)
    .maybeSingle<MediaRow>()

  if (loadErr) {
    return serverError('Failed to load media', loadErr.message)
  }

  if (!media) {
    return notFound('Media not found')
  }

  const canDelete = media.owner_id === auth.user.id || auth.profile.role === 'admin'
  if (!canDelete) {
    return forbidden('Only owner or admin can remove media')
  }

  if (media.status === 'removed') {
    return json({ removed: true, mediaId: media.id })
  }

  const { error: updateErr } = await auth.admin
    .from('media_assets')
    .update({
      status: 'removed',
      removed_at: new Date().toISOString(),
    })
    .eq('id', media.id)

  if (updateErr) {
    return serverError('Failed to remove media', updateErr.message)
  }

  const paths = Array.from(
    new Set(
      [media.original_path, media.processed_path, media.thumbnail_path, media.poster_path].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  )

  if (paths.length > 0) {
    await auth.admin.storage.from(BUCKET).remove(paths)
  }

  await audit(auth.admin, {
    actorId: auth.user.id,
    action: 'media.removed',
    entity: 'media_assets',
    entityId: media.id,
    details: {
      removedBy: auth.profile.role,
      removedPaths: paths,
    },
  })

  return json({ removed: true, mediaId: media.id })
})
