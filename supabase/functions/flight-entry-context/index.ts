import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'

function firstName(value: string | null | undefined) {
  return String(value ?? '').trim().split(/\s+/)[0] || ''
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['GET'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  const family = String(auth.profile.family ?? '').trim()
  const travelerName = String(auth.profile.display_name ?? '').trim()

  if (!family) return badRequest('No family found for this profile')
  if (!travelerName) return badRequest('No traveler name found for this profile')

  const { data: spouseProfile, error: spouseErr } = await auth.admin
    .from('profiles')
    .select('display_name,email')
    .eq('active', true)
    .eq('family', family)
    .neq('user_id', auth.user.id)
    .order('display_name', { ascending: true, nullsFirst: false })
    .order('email', { ascending: true })
    .limit(1)
    .maybeSingle<{ display_name: string | null; email: string | null }>()

  if (spouseErr) return serverError('Failed to load spouse profile', spouseErr.message)

  const spouseName = String(spouseProfile?.display_name ?? '').trim()

  return json({
    family,
    travelerName,
    travelerFirstName: firstName(travelerName),
    spouseName,
    spouseFirstName: firstName(spouseName),
  })
})
