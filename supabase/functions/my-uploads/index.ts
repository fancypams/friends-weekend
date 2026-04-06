import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, serverError, json } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { decodeCursor, encodeCursor } from '../_shared/cursor.ts'

type UploadCursor = {
  createdAt: string
}

type UploadRow = {
  id: string
  media_type: 'image' | 'video'
  mime_type: string
  original_filename: string
  status: 'uploading' | 'processing' | 'published' | 'failed' | 'removed'
  captured_at: string | null
  capture_source: string | null
  failure_reason: string | null
  bytes: number
  original_path: string
  processed_path: string | null
  thumbnail_path: string | null
  poster_path: string | null
  created_at: string
  published_at: string | null
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['GET'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const limitRaw = Number(url.searchParams.get('limit') ?? 20)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20

  const cursor = decodeCursor<UploadCursor>(url.searchParams.get('cursor'))
  if (url.searchParams.get('cursor') && !cursor) {
    return badRequest('Invalid cursor')
  }

  let query = auth.admin
    .from('media_assets')
    .select(
      'id,media_type,mime_type,original_filename,status,captured_at,capture_source,failure_reason,bytes,original_path,processed_path,thumbnail_path,poster_path,created_at,published_at',
    )
    .eq('owner_id', auth.user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (cursor?.createdAt) {
    query = query.lt('created_at', cursor.createdAt)
  }

  const { data, error } = await query.returns<UploadRow[]>()

  if (error || !data) {
    return serverError('Failed to load uploads', error?.message)
  }

  const hasMore = data.length > limit
  const rows = hasMore ? data.slice(0, limit) : data

  const nextCursor = hasMore && rows.length
    ? encodeCursor({
        createdAt: rows[rows.length - 1].created_at,
      })
    : null

  return json({
    items: rows,
    nextCursor,
  })
})
