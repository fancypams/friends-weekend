import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ProfileRow } from './auth.ts'

const SHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Flight Info'
const SEATTLE_ORIGINS = new Set(['SEA', 'SEATTLE', 'SEATTLE-TACOMA', 'SEATTLE TACOMA'])
const OPEN_BEFORE_DEPARTURE_MS = 2 * 60 * 60 * 1000
const CLOSE_AFTER_ARRIVAL_MS = 60 * 60 * 1000
const MISSING_ACTUAL_ARRIVAL_CAP_MS = 48 * 60 * 60 * 1000
const SEATTLE_SUMMER_UTC_OFFSET_MS = 7 * 60 * 60 * 1000

type FlightRow = {
  family: string
  direction: string
  homeAirport: string
  flightNumber: string
  date: string
  dateSort: string
  departureTime: string
  departSort: string
  arrivalTime: string
  arriveSort: string
  origin: string
  destination: string
  traveler: string
}

type StatusRow = {
  flight_number: string
  flight_date: string
  origin: string
  destination: string
  scheduled_departure_at: string | null
  estimated_departure_at: string | null
  actual_departure_at: string | null
  scheduled_arrival_at: string | null
  estimated_arrival_at: string | null
  actual_arrival_at: string | null
}

type UploadWindow = {
  allowed: boolean
  reason: string
  opensAt: string | null
  closesAt: string | null
  scheduledDepartureAt: string | null
  actualFinalArrivalAt: string | null
  finalArrivalFallbackAt: string | null
  finalDestination: string | null
  source: 'flight_status_cache' | 'flight_sheet' | 'fallback_cap' | null
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeAirport(value: unknown) {
  return normalizeText(value).toUpperCase()
}

function normalizeFlightNumber(value: unknown) {
  return normalizeText(value).replace(/\s+/g, '').toUpperCase()
}

function firstName(value: unknown) {
  return normalizeText(value).split(/\s+/)[0]?.toLowerCase() || ''
}

function travelerMatchesProfile(row: FlightRow, profile: ProfileRow) {
  const traveler = normalizeText(row.traveler).toLowerCase()
  const displayName = normalizeText(profile.display_name).toLowerCase()
  const displayFirstName = firstName(profile.display_name)
  if (!traveler || !displayName) return false
  return traveler === displayName || traveler === displayFirstName
}

function parseGvizCell(value: unknown) {
  const raw = String(value ?? '')
  if (!raw.startsWith('Date(')) return { display: raw.trim(), sort: raw.trim() }

  const match = raw.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+))?/)
  if (!match) return { display: raw, sort: raw }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (year === 1899 && match[4] !== undefined) {
    const hour = Number(match[4])
    const minute = Number(match[5])
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return {
      display: `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`,
      sort: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    }
  }

  return {
    display: `${month + 1}/${day}/${year}`,
    sort: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

function cell(row: Record<string, unknown>, index: number) {
  const cells = Array.isArray(row.c) ? row.c : []
  const item = cells[index] as { v?: unknown } | null | undefined
  return item?.v == null ? { display: '', sort: '' } : parseGvizCell(item.v)
}

function parseSeattleLocalDateTime(dateSort: string, timeSort: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateSort) || !/^\d{2}:\d{2}$/.test(timeSort)) return null
  const [year, month, day] = dateSort.split('-').map(Number)
  const [hour, minute] = timeSort.split(':').map(Number)
  const ms = Date.UTC(year, month - 1, day, hour, minute) + SEATTLE_SUMMER_UTC_OFFSET_MS
  return new Date(ms).toISOString()
}

function parseIso(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function statusKey(row: Pick<FlightRow, 'flightNumber' | 'dateSort' | 'origin' | 'destination'>) {
  return [
    normalizeFlightNumber(row.flightNumber),
    row.dateSort,
    normalizeAirport(row.origin),
    normalizeAirport(row.destination),
  ].join('|')
}

async function fetchFlightRows() {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json&headers=1&sheet=${encodeURIComponent(SHEET_NAME)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Flight sheet HTTP ${res.status}`)

  const text = await res.text()
  const match = text.match(/google\.visualization\.Query\.setResponse\((\{.+\})\)/)
  if (!match) throw new Error('Unexpected flight sheet response')

  const data = JSON.parse(match[1])
  if (data.status === 'error') {
    throw new Error(data.errors?.[0]?.message ?? 'Flight sheet error')
  }

  return ((data.table?.rows ?? []) as Record<string, unknown>[]).map((row) => {
    const date = cell(row, 4)
    const depart = cell(row, 5)
    const arrive = cell(row, 6)
    return {
      family: cell(row, 0).display,
      direction: cell(row, 1).display,
      homeAirport: normalizeAirport(cell(row, 2).display),
      flightNumber: normalizeText(cell(row, 3).display),
      date: date.display,
      dateSort: date.sort,
      departureTime: depart.display,
      departSort: depart.sort,
      arrivalTime: arrive.display,
      arriveSort: arrive.sort,
      origin: normalizeAirport(cell(row, 7).display),
      destination: normalizeAirport(cell(row, 8).display),
      traveler: normalizeText(cell(row, 9).display),
    }
  }).filter((row: FlightRow) => (
    row.family
    && row.direction
    && row.flightNumber
    && row.dateSort
    && row.origin
    && row.destination
  ))
}

function candidateJourneys(rows: FlightRow[], profile: ProfileRow, directionNeedle: string) {
  const family = normalizeText(profile.family).toLowerCase()
  if (!normalizeText(profile.display_name)) return []

  const grouped = new Map<string, FlightRow[]>()
  for (const row of rows) {
    if (!row.direction.toLowerCase().includes(directionNeedle)) continue
    if (!travelerMatchesProfile(row, profile)) continue
    if (family && row.family.toLowerCase() !== family) continue

    const key = [row.family, row.traveler, row.direction, row.homeAirport].join('||')
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }

  return [...grouped.values()]
    .map((legs) => legs.sort((a, b) => a.departSort.localeCompare(b.departSort)))
    .sort((a, b) => {
      const left = `${a[0].dateSort}T${a[0].departSort}`
      const right = `${b[0].dateSort}T${b[0].departSort}`
      return left.localeCompare(right)
    })
}

function pickArrivingToSeattleJourney(rows: FlightRow[], profile: ProfileRow) {
  const journeys = candidateJourneys(rows, profile, 'arriv')
    .filter((legs) => legs[legs.length - 1] && SEATTLE_ORIGINS.has(legs[legs.length - 1].destination))

  return journeys[0] ?? null
}

function pickDepartingHomeJourney(rows: FlightRow[], profile: ProfileRow) {
  const journeys = candidateJourneys(rows, profile, 'depart')
    .filter((legs) => legs[0] && SEATTLE_ORIGINS.has(legs[0].origin))

  return journeys[0] ?? null
}

async function loadStatuses(admin: SupabaseClient, legs: FlightRow[]) {
  if (legs.length === 0) return new Map<string, StatusRow>()

  const numbers = [...new Set(legs.map((leg) => normalizeFlightNumber(leg.flightNumber)))]
  const dates = [...new Set(legs.map((leg) => leg.dateSort))]
  const { data, error } = await admin
    .from('flight_status_cache')
    .select('flight_number,flight_date,origin,destination,scheduled_departure_at,estimated_departure_at,actual_departure_at,scheduled_arrival_at,estimated_arrival_at,actual_arrival_at')
    .eq('provider', 'aerodatabox')
    .in('flight_number', numbers)
    .in('flight_date', dates)
    .returns<StatusRow[]>()

  if (error) throw new Error(error.message)

  const byKey = new Map<string, StatusRow>()
  for (const row of data ?? []) {
    const key = [
      normalizeFlightNumber(row.flight_number),
      row.flight_date,
      normalizeAirport(row.origin),
      normalizeAirport(row.destination),
    ].join('|')
    byKey.set(key, row)
  }
  return byKey
}

function buildUnavailable(reason: string): UploadWindow {
  return {
    allowed: false,
    reason,
    opensAt: null,
    closesAt: null,
    scheduledDepartureAt: null,
    actualFinalArrivalAt: null,
    finalArrivalFallbackAt: null,
    finalDestination: null,
    source: null,
  }
}

export async function resolveUploadWindow(admin: SupabaseClient, profile: ProfileRow, now = new Date()): Promise<UploadWindow> {
  const rows = await fetchFlightRows()
  const arrivingJourney = pickArrivingToSeattleJourney(rows, profile)
  const departingJourney = pickDepartingHomeJourney(rows, profile)
  if (!arrivingJourney) {
    return buildUnavailable('No itinerary to Seattle was found for this profile.')
  }
  if (!departingJourney) {
    return buildUnavailable('No return-home itinerary from Seattle was found for this profile.')
  }

  const firstInboundLeg = arrivingJourney[0]
  const finalHomeLeg = departingJourney[departingJourney.length - 1]
  const statuses = await loadStatuses(admin, [...arrivingJourney, ...departingJourney])
  const firstInboundStatus = statuses.get(statusKey(firstInboundLeg))
  const finalHomeStatus = statuses.get(statusKey(finalHomeLeg))

  const scheduledDepartureAt = firstInboundStatus?.scheduled_departure_at
    ?? parseSeattleLocalDateTime(firstInboundLeg.dateSort, firstInboundLeg.departSort)
  const scheduledDeparture = parseIso(scheduledDepartureAt)
  if (!scheduledDeparture) {
    return buildUnavailable('Scheduled departure time is unavailable for the trip to Seattle.')
  }

  const opensAtDate = new Date(scheduledDeparture.getTime() - OPEN_BEFORE_DEPARTURE_MS)
  const actualFinalArrival = parseIso(finalHomeStatus?.actual_arrival_at)
  const scheduledOrEstimatedArrival = parseIso(finalHomeStatus?.estimated_arrival_at)
    ?? parseIso(finalHomeStatus?.scheduled_arrival_at)
  const finalArrivalFallback = scheduledOrEstimatedArrival
    ? new Date(scheduledOrEstimatedArrival.getTime() + MISSING_ACTUAL_ARRIVAL_CAP_MS)
    : new Date(scheduledDeparture.getTime() + MISSING_ACTUAL_ARRIVAL_CAP_MS)
  const closeBase = actualFinalArrival ?? finalArrivalFallback
  const closesAtDate = new Date(closeBase.getTime() + CLOSE_AFTER_ARRIVAL_MS)
  const nowMs = now.getTime()

  let reason = 'Uploads are open.'
  if (nowMs < opensAtDate.getTime()) {
    reason = 'Uploads open 2 hours before your scheduled departure to Seattle.'
  } else if (nowMs > closesAtDate.getTime()) {
    reason = actualFinalArrival
      ? 'Uploads closed 1 hour after you arrived at your home destination.'
      : 'Uploads closed after the safety window because actual arrival was unavailable.'
  } else if (!actualFinalArrival) {
    reason = 'Uploads are open while we wait for your actual arrival home.'
  }

  return {
    allowed: nowMs >= opensAtDate.getTime() && nowMs <= closesAtDate.getTime(),
    reason,
    opensAt: opensAtDate.toISOString(),
    closesAt: closesAtDate.toISOString(),
    scheduledDepartureAt: scheduledDeparture.toISOString(),
    actualFinalArrivalAt: actualFinalArrival?.toISOString() ?? null,
    finalArrivalFallbackAt: actualFinalArrival ? null : finalArrivalFallback.toISOString(),
    finalDestination: finalHomeLeg.destination,
    source: actualFinalArrival
      ? 'flight_status_cache'
      : 'fallback_cap',
  }
}
