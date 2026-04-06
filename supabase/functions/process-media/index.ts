import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, forbidden, serverError, json } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/auth.ts'
import { processOneMediaAsset, processPendingBatch } from '../_shared/media-processor.ts'

type ProcessBody = {
  mediaId?: string
  limit?: number
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const expectedSecret = Deno.env.get('PROCESSOR_SECRET')
  if (!expectedSecret) {
    return serverError('PROCESSOR_SECRET is not configured')
  }

  const providedSecret = req.headers.get('x-processor-secret')
  if (!providedSecret || providedSecret !== expectedSecret) {
    return forbidden('Invalid processor secret')
  }

  let payload: ProcessBody = {}
  try {
    payload = await req.json()
  } catch {
    // body is optional
  }

  const admin = createAdminClient()

  if (payload.mediaId) {
    const mediaId = String(payload.mediaId).trim()
    if (!mediaId) {
      return badRequest('mediaId cannot be empty')
    }

    const result = await processOneMediaAsset(admin, mediaId, null)
    if (!result.ok) {
      return serverError('Failed to process media', result.error)
    }

    return json({ processed: 1, failed: 0, mediaId })
  }

  const limit = Number.isFinite(payload.limit)
    ? Math.max(1, Math.min(100, Math.floor(Number(payload.limit))))
    : 20

  const batch = await processPendingBatch(admin, limit)
  return json(batch)
})
