import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'
import { resolveUploadWindow } from '../_shared/upload-window.ts'

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['GET'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  try {
    const window = await resolveUploadWindow(auth.admin, auth.profile)
    return json({
      ok: true,
      ...window,
    })
  } catch (err) {
    console.error('[upload-window]', err)
    return serverError('Failed to resolve upload window', err instanceof Error ? err.message : String(err))
  }
})
