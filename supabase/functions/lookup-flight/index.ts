import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, serverError, json, notFound } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  let body: { flightNumber?: unknown }
  try {
    body = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const raw = String(body.flightNumber ?? '').trim()
  const flightNumber = raw.replace(/\s+/g, '').toUpperCase()
  if (!flightNumber || flightNumber.length < 3) return badRequest('Invalid flight number')

  const apiKey = Deno.env.get('RAPIDAPI_KEY')
  if (!apiKey) return serverError('RapidAPI key not configured')

  let data: unknown
  try {
    const res = await fetch(
      `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}`,
      {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
        },
      },
    )

    if (res.status === 404) return notFound('Flight not found')
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`AeroDataBox error ${res.status}: ${err}`)
    }

    data = await res.json()
  } catch (err) {
    console.error('[lookup-flight]', err)
    return serverError('Failed to look up flight', String(err))
  }

  if (!Array.isArray(data) || data.length === 0) return notFound('No schedule found for this flight')

  type FlightEntry = {
    departure?: { scheduledTime?: { local?: string }; airport?: { iata?: string } }
    arrival?: { scheduledTime?: { local?: string }; airport?: { iata?: string } }
  }

  const results = (data as FlightEntry[])
    .map((flight) => {
      const depLocal = flight.departure?.scheduledTime?.local ?? ''
      const arrLocal = flight.arrival?.scheduledTime?.local ?? ''
      const spaceIdx = depLocal.indexOf(' ')
      const arrSpaceIdx = arrLocal.indexOf(' ')
      const date = spaceIdx > 0 ? depLocal.slice(0, spaceIdx) : ''
      const departureTime = spaceIdx > 0 ? depLocal.slice(spaceIdx + 1, spaceIdx + 6) : ''
      const arrivalTime = arrSpaceIdx > 0 ? arrLocal.slice(arrSpaceIdx + 1, arrSpaceIdx + 6) : ''
      return {
        date,
        departureTime,
        arrivalTime,
        from: flight.departure?.airport?.iata ?? '',
        to: flight.arrival?.airport?.iata ?? '',
      }
    })
    .filter((r) => r.date && r.departureTime)
    .slice(0, 7)

  if (results.length === 0) return notFound('Could not parse flight schedule')

  return json({ results })
})
