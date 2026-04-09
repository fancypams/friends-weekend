import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, serverError, json } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { decodeCursor, encodeCursor } from '../_shared/cursor.ts'
import { isEmbargoedForViewer } from '../_shared/daily-reveal.ts'

type FeedCursor = {
  publishedAt: string
}

type MediaAssetListRow = {
  id: string
  owner_id: string
  media_type: 'image' | 'video'
  mime_type: string
  original_filename: string
  bytes: number
  status: 'published'
  captured_at: string | null
  capture_source: string | null
  processed_path: string | null
  thumbnail_path: string | null
  poster_path: string | null
  created_at: string
  published_at: string
}

type ProfileEmail = {
  user_id: string
  email: string
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

  const cursor = decodeCursor<FeedCursor>(url.searchParams.get('cursor'))
  if (url.searchParams.get('cursor') && !cursor) {
    return badRequest('Invalid cursor')
  }

  let query = auth.admin
    .from('media_assets')
    .select(
      'id,owner_id,media_type,mime_type,original_filename,bytes,status,captured_at,capture_source,processed_path,thumbnail_path,poster_path,created_at,published_at',
    )
    .eq('status', 'published')
    .is('removed_at', null)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (cursor?.publishedAt) {
    query = query.lt('published_at', cursor.publishedAt)
  }

  const { data, error } = await query.returns<MediaAssetListRow[]>()

  if (error || !data) {
    return serverError('Failed to load gallery feed', error?.message)
  }

  const hasMore = data.length > limit
  const rows = hasMore ? data.slice(0, limit) : data

  const ownerIds = Array.from(new Set(rows.map((row) => row.owner_id)))
  const ownerEmailById: Record<string, string> = {}

  if (ownerIds.length > 0) {
    const { data: owners, error: ownerErr } = await auth.admin
      .from('profiles')
      .select('user_id,email')
      .in('user_id', ownerIds)
      .returns<ProfileEmail[]>()

    if (ownerErr) {
      return serverError('Failed to load owner profiles', ownerErr.message)
    }

    for (const owner of owners ?? []) {
      ownerEmailById[owner.user_id] = owner.email
    }
  }

  const nextCursor = hasMore && rows.length
    ? encodeCursor({
        publishedAt: rows[rows.length - 1].published_at,
      })
    : null

  return json({
    items: rows.map((row) => {
      const isOwner = row.owner_id === auth.user.id
      const uploadTime = row.published_at || row.created_at
      const embargo = isEmbargoedForViewer(uploadTime)
      const lockedForViewer = !isOwner && embargo.embargoed

      return {
        ...row,
        owner_email: lockedForViewer ? null : ownerEmailById[row.owner_id] ?? null,
        processed_path: lockedForViewer ? null : row.processed_path,
        thumbnail_path: lockedForViewer ? null : row.thumbnail_path,
        poster_path: lockedForViewer ? null : row.poster_path,
        embargoed_for_viewer: lockedForViewer,
        reveal_at: embargo.revealAt,
      }
    }),
    nextCursor,
  })
})
