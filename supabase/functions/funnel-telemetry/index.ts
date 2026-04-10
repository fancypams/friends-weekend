import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'

function parseWindowMinutes(url: URL) {
  const raw = Number(url.searchParams.get('window_minutes') || 1440)
  if (!Number.isFinite(raw) || raw <= 0) return 1440
  return Math.min(Math.floor(raw), 10080)
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['GET'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireAdmin: true, requireActive: true })
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const windowMinutes = parseWindowMinutes(url)

  const { data: summaryRows, error: summaryError } = await auth.admin
    .rpc('funnel_summary', { window_minutes: windowMinutes })

  if (summaryError) {
    return serverError('Failed to load funnel summary', summaryError.message)
  }

  const summary = Array.isArray(summaryRows) && summaryRows[0] ? summaryRows[0] : {}

  const { data: topFailuresRows, error: topFailuresError } = await auth.admin
    .from('funnel_events')
    .select('error_code,error_message,step')
    .eq('journey', 'invite_auth')
    .gte('created_at', new Date(Date.now() - windowMinutes * 60 * 1000).toISOString())
    .in('status', ['failed', 'expired', 'invalid', 'rate_limited'])
    .order('created_at', { ascending: false })
    .limit(500)

  if (topFailuresError) {
    return serverError('Failed to load funnel failures', topFailuresError.message)
  }

  const grouped = new Map()
  for (const row of (Array.isArray(topFailuresRows) ? topFailuresRows : [])) {
    const step = String(row?.step || '').trim() || 'unknown_step'
    const code = String(row?.error_code || '').trim() || 'unknown_error'
    const message = String(row?.error_message || '').trim() || 'Unknown error'
    const key = `${step}::${code}::${message}`
    grouped.set(key, {
      step,
      error_code: code,
      error_message: message,
      count: Number(grouped.get(key)?.count || 0) + 1,
    })
  }

  const topFailures = [...grouped.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return json({
    window_minutes: windowMinutes,
    summary,
    top_failures: topFailures,
  })
})
