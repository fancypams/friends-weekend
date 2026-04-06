import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, forbidden, notFound, serverError, json } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { BUCKET, SIGNED_URL_TTL_SECONDS } from '../_shared/constants.ts'

type SignUrlBody = {
  mediaId?: string
  variant?: 'original' | 'processed' | 'thumb' | 'poster'
}

type MediaRow = {
  id: string
  owner_id: string
  status: 'uploading' | 'processing' | 'published' | 'failed' | 'removed'
  original_path: string
  processed_path: string | null
  thumbnail_path: string | null
  poster_path: string | null
}

function resolvePath(media: MediaRow, variant: NonNullable<SignUrlBody['variant']>) {
  if (variant === 'original') return media.original_path
  if (variant === 'processed') return media.processed_path ?? media.original_path
  if (variant === 'thumb') return media.thumbnail_path ?? media.processed_path ?? media.original_path
  if (variant === 'poster') return media.poster_path
  return null
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  let payload: SignUrlBody
  try {
    payload = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const mediaId = String(payload.mediaId ?? '').trim()
  const variant = (payload.variant ?? 'processed') as NonNullable<SignUrlBody['variant']>

  if (!mediaId) {
    return badRequest('mediaId is required')
  }

  if (!['original', 'processed', 'thumb', 'poster'].includes(variant)) {
    return badRequest('variant must be one of original, processed, thumb, poster')
  }

  const { data: media, error: mediaErr } = await auth.admin
    .from('media_assets')
    .select('id,owner_id,status,original_path,processed_path,thumbnail_path,poster_path')
    .eq('id', mediaId)
    .maybeSingle<MediaRow>()

  if (mediaErr) {
    return serverError('Failed to load media', mediaErr.message)
  }

  if (!media) {
    return notFound('Media not found')
  }

  const isOwner = media.owner_id === auth.user.id
  const isAdmin = auth.profile.role === 'admin'
  const canView = media.status === 'published' || isOwner || isAdmin

  if (!canView) {
    return forbidden('Media is not available')
  }

  const objectPath = resolvePath(media, variant)
  if (!objectPath) {
    return badRequest('Requested variant is unavailable for this media')
  }

  const { data: signed, error: signedErr } = await auth.admin.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS)

  if (signedErr || !signed) {
    return serverError('Failed to create signed URL', signedErr?.message)
  }

  return json({
    mediaId,
    variant,
    signedUrl: signed.signedUrl,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  })
})
