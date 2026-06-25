import { handleOptions } from '../_shared/cors.ts'
import { assertMethod, badRequest, json, serverError } from '../_shared/http.ts'
import { requireAuth } from '../_shared/auth.ts'

const PROVIDER = 'aerodatabox'
const MAX_LEGS = 24
const LIVE_TTL_MINUTES = 10
const FUTURE_TTL_HOURS = 6
const PAST_TTL_HOURS = 24

type FlightStatusRequest = {
  legs?: unknown
  refresh?: unknown
}

type RequestedLeg = {
  key: string
  flightNumber: string
  date: string
  origin: string
  destination: string
}

type CacheRow = {
  flight_number: string
  flight_date: string
  origin: string
  destination: string
  provider: string
  status: string | null
  status_label: string | null
  scheduled_departure_at: string | null
  estimated_departure_at: string | null
  actual_departure_at: string | null
  scheduled_arrival_at: string | null
  estimated_arrival_at: string | null
  actual_arrival_at: string | null
  departure_terminal: string | null
  departure_gate: string | null
  arrival_terminal: string | null
  arrival_gate: string | null
  baggage_claim: string | null
  fetched_at: string
  expires_at: string
}

type ProviderFlight = {
  status?: string
  departure?: ProviderEndpoint
  arrival?: ProviderEndpoint
}

type ProviderEndpoint = {
  scheduledTime?: ProviderTime
  revisedTime?: ProviderTime
  predictedTime?: ProviderTime
  actualTime?: ProviderTime
  terminal?: string
  gate?: string
  baggageBelt?: string
  airport?: { iata?: string }
}

type ProviderTime = {
  local?: string
  utc?: string
}

function normalizeFlightNumber(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase()
}

function normalizeAirport(value: unknown) {
  return String(value ?? '').trim().toUpperCase()
}

function normalizeDate(value: unknown) {
  const date = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

function legKey(leg: Omit<RequestedLeg, 'key'>) {
  return [
    leg.flightNumber,
    leg.date,
    leg.origin,
    leg.destination,
  ].join('|')
}

function parseLegs(value: unknown): RequestedLeg[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const legs: RequestedLeg[] = []

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const leg = {
      flightNumber: normalizeFlightNumber(item.flightNumber),
      date: normalizeDate(item.date),
      origin: normalizeAirport(item.origin),
      destination: normalizeAirport(item.destination),
    }
    if (!leg.flightNumber || !leg.date || !leg.origin || !leg.destination) continue
    const key = legKey(leg)
    if (seen.has(key)) continue
    seen.add(key)
    legs.push({ key, ...leg })
    if (legs.length >= MAX_LEGS) break
  }

  return legs
}

function parseProviderTime(time?: ProviderTime) {
  const raw = time?.utc || time?.local
  if (!raw) return null
  const isoish = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const parsed = new Date(isoish)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function minutesBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return 0
  const left = new Date(a).getTime()
  const right = new Date(b).getTime()
  if (Number.isNaN(left) || Number.isNaN(right)) return 0
  return Math.round((right - left) / 60000)
}

function labelStatus(status: string | undefined, scheduledDepartureAt: string | null, estimatedDepartureAt: string | null) {
  const normalized = String(status ?? '').trim().toLowerCase()
  if (normalized.includes('cancel')) return 'Cancelled'
  if (normalized.includes('divert')) return 'Diverted'
  if (normalized.includes('arriv') || normalized.includes('land')) return 'Landed'
  if (normalized.includes('route') || normalized.includes('depart')) return 'Departed'
  if (normalized.includes('delay')) return 'Delayed'

  const departureShift = minutesBetween(scheduledDepartureAt, estimatedDepartureAt)
  if (departureShift >= 15) return 'Delayed'
  if (normalized.includes('sched') || normalized.includes('expected')) return 'On time'
  return status ? status : 'Status unavailable'
}

function cacheTtl(date: string, statusLabel: string) {
  const now = new Date()
  const flightDay = new Date(`${date}T12:00:00Z`)
  const daysAway = (flightDay.getTime() - now.getTime()) / 86400000
  const ttlMs = daysAway > 2
    ? FUTURE_TTL_HOURS * 60 * 60000
    : daysAway < -1 || ['Landed', 'Cancelled', 'Diverted'].includes(statusLabel)
      ? PAST_TTL_HOURS * 60 * 60000
      : LIVE_TTL_MINUTES * 60000

  return new Date(now.getTime() + ttlMs).toISOString()
}

function chooseFlight(flights: ProviderFlight[], leg: RequestedLeg) {
  return flights.find((flight) =>
    normalizeAirport(flight.departure?.airport?.iata) === leg.origin &&
    normalizeAirport(flight.arrival?.airport?.iata) === leg.destination &&
    String(flight.departure?.scheduledTime?.local ?? '').startsWith(leg.date)
  ) ?? flights.find((flight) =>
    normalizeAirport(flight.departure?.airport?.iata) === leg.origin &&
    normalizeAirport(flight.arrival?.airport?.iata) === leg.destination
  ) ?? flights[0]
}

function normalizeProviderFlight(flight: ProviderFlight, leg: RequestedLeg) {
  const scheduledDepartureAt = parseProviderTime(flight.departure?.scheduledTime)
  const estimatedDepartureAt = parseProviderTime(flight.departure?.revisedTime)
    ?? parseProviderTime(flight.departure?.predictedTime)
    ?? scheduledDepartureAt
  const actualDepartureAt = parseProviderTime(flight.departure?.actualTime)
  const scheduledArrivalAt = parseProviderTime(flight.arrival?.scheduledTime)
  const estimatedArrivalAt = parseProviderTime(flight.arrival?.revisedTime)
    ?? parseProviderTime(flight.arrival?.predictedTime)
    ?? scheduledArrivalAt
  const actualArrivalAt = parseProviderTime(flight.arrival?.actualTime)
  const statusLabel = labelStatus(flight.status, scheduledDepartureAt, estimatedDepartureAt)
  const now = new Date().toISOString()

  return {
    flight_number: leg.flightNumber,
    flight_date: leg.date,
    origin: leg.origin,
    destination: leg.destination,
    provider: PROVIDER,
    status: flight.status ?? null,
    status_label: statusLabel,
    scheduled_departure_at: scheduledDepartureAt,
    estimated_departure_at: estimatedDepartureAt,
    actual_departure_at: actualDepartureAt,
    scheduled_arrival_at: scheduledArrivalAt,
    estimated_arrival_at: estimatedArrivalAt,
    actual_arrival_at: actualArrivalAt,
    departure_terminal: flight.departure?.terminal ?? null,
    departure_gate: flight.departure?.gate ?? null,
    arrival_terminal: flight.arrival?.terminal ?? null,
    arrival_gate: flight.arrival?.gate ?? null,
    baggage_claim: flight.arrival?.baggageBelt ?? null,
    raw_payload: flight,
    fetched_at: now,
    expires_at: cacheTtl(leg.date, statusLabel),
  }
}

function rowKey(row: Pick<CacheRow, 'flight_number' | 'flight_date' | 'origin' | 'destination'>) {
  return [
    row.flight_number,
    row.flight_date,
    row.origin,
    row.destination,
  ].join('|')
}

function serializeStatus(leg: RequestedLeg, row: CacheRow | null, stale = false, error?: string) {
  return {
    key: leg.key,
    flightNumber: leg.flightNumber,
    date: leg.date,
    origin: leg.origin,
    destination: leg.destination,
    status: row?.status ?? null,
    statusLabel: row?.status_label ?? 'Status unavailable',
    scheduledDepartureAt: row?.scheduled_departure_at ?? null,
    estimatedDepartureAt: row?.estimated_departure_at ?? null,
    actualDepartureAt: row?.actual_departure_at ?? null,
    scheduledArrivalAt: row?.scheduled_arrival_at ?? null,
    estimatedArrivalAt: row?.estimated_arrival_at ?? null,
    actualArrivalAt: row?.actual_arrival_at ?? null,
    departureTerminal: row?.departure_terminal ?? null,
    departureGate: row?.departure_gate ?? null,
    arrivalTerminal: row?.arrival_terminal ?? null,
    arrivalGate: row?.arrival_gate ?? null,
    baggageClaim: row?.baggage_claim ?? null,
    fetchedAt: row?.fetched_at ?? null,
    expiresAt: row?.expires_at ?? null,
    stale,
    unavailable: !row,
    error,
  }
}

async function fetchProviderStatus(leg: RequestedLeg, apiKey: string) {
  const res = await fetch(
    `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(leg.flightNumber)}`,
    {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
      },
    },
  )

  if (res.status === 429) return { rateLimited: true as const }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AeroDataBox error ${res.status}: ${detail}`)
  }

  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) return { notFound: true as const }
  return { flight: chooseFlight(data as ProviderFlight[], leg) }
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)
  if (optionsResponse) return optionsResponse

  const methodError = assertMethod(req, ['POST'])
  if (methodError) return methodError

  const auth = await requireAuth(req, { requireActive: true })
  if (!auth.ok) return auth.response

  let body: FlightStatusRequest
  try {
    body = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const legs = parseLegs(body.legs)
  if (legs.length === 0) return badRequest('No valid flight legs provided')

  const refresh = body.refresh === true
  const numbers = [...new Set(legs.map((leg) => leg.flightNumber))]
  const dates = [...new Set(legs.map((leg) => leg.date))]
  const { data: cacheRows, error: cacheError } = await auth.admin
    .from('flight_status_cache')
    .select('*')
    .eq('provider', PROVIDER)
    .in('flight_number', numbers)
    .in('flight_date', dates)
    .returns<CacheRow[]>()

  if (cacheError) return serverError('Failed to read flight status cache', cacheError.message)

  const cacheByKey = new Map<string, CacheRow>()
  for (const row of cacheRows ?? []) {
    cacheByKey.set(rowKey(row), row)
  }

  const now = Date.now()
  const staleOrMissing = legs.filter((leg) => {
    const row = cacheByKey.get(leg.key)
    if (!row) return true
    return refresh || new Date(row.expires_at).getTime() <= now
  })

  let rateLimited = false
  let refreshedLegKey: string | null = null
  const errorsByKey = new Map<string, string>()

  const legToRefresh = staleOrMissing[0]
  if (legToRefresh) {
    const apiKey = Deno.env.get('RAPIDAPI_KEY')
    if (!apiKey) {
      errorsByKey.set(legToRefresh.key, 'RapidAPI key not configured')
    } else {
      try {
        const providerResult = await fetchProviderStatus(legToRefresh, apiKey)
        if ('rateLimited' in providerResult) {
          rateLimited = true
          errorsByKey.set(legToRefresh.key, 'Provider rate limit reached')
        } else if ('notFound' in providerResult || !providerResult.flight) {
          errorsByKey.set(legToRefresh.key, 'Status unavailable from provider')
        } else {
          const normalized = normalizeProviderFlight(providerResult.flight, legToRefresh)
          const { data: upserted, error: upsertError } = await auth.admin
            .from('flight_status_cache')
            .upsert(normalized, {
              onConflict: 'flight_number,flight_date,origin,destination,provider',
            })
            .select('*')
            .single<CacheRow>()

          if (upsertError) {
            errorsByKey.set(legToRefresh.key, 'Failed to cache provider status')
          } else if (upserted) {
            cacheByKey.set(legToRefresh.key, upserted)
            refreshedLegKey = legToRefresh.key
          }
        }
      } catch (err) {
        console.error('[flight-status]', err)
        errorsByKey.set(legToRefresh.key, err instanceof Error ? err.message : 'Provider lookup failed')
      }
    }
  }

  return json({
    ok: true,
    provider: PROVIDER,
    fetchedAt: new Date().toISOString(),
    rateLimited,
    refreshedLegKey,
    pendingRefreshCount: Math.max(staleOrMissing.length - (legToRefresh ? 1 : 0), 0),
    statuses: legs.map((leg) => {
      const row = cacheByKey.get(leg.key) ?? null
      const stale = row ? new Date(row.expires_at).getTime() <= now : false
      return serializeStatus(leg, row, stale, errorsByKey.get(leg.key))
    }),
  })
})
