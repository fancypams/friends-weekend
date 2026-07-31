import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ProfileRow } from './auth.ts'
import { CAPTURE_WINDOW_END } from './capture-window.ts'

const SHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Flight Info'
const SEATTLE_ORIGINS = new Set(['SEA', 'SEATTLE', 'SEATTLE-TACOMA', 'SEATTLE TACOMA'])
const OPEN_BEFORE_DEPARTURE_MS = 2 * 60 * 60 * 1000
const CLOSE_AFTER_ARRIVAL_MS = 60 * 60 * 1000
const MISSING_ACTUAL_ARRIVAL_CAP_MS = 48 * 60 * 60 * 1000
const SEATTLE_SUMMER_UTC_OFFSET_MS = 7 * 60 * 60 * 1000
const SEATTLE_UPLOAD_WINDOW_START_MS = Date.parse('2026-07-30T07:00:00.000Z') // Jul 30 00:00 Seattle (PDT)

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

type AdminFamilyRow = {
  family: string | null
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
  source: 'flight_status_cache' | 'flight_sheet' | 'fallback_cap' | 'first_arriving_traveler' | null
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

function normalizeNameToken(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

function travelerNameTokens(value: unknown) {
  return normalizeNameToken(value)
    .split(/\s+(?:and|or)\s+|[,&/+]+/)
    .map((token) => normalizeNameToken(token))
    .filter(Boolean)
}

function travelerMatchesProfile(row: FlightRow, profile: ProfileRow) {
  const traveler = normalizeNameToken(row.traveler)
  const displayName = normalizeNameToken(profile.display_name)
  const displayFirstName = firstName(profile.display_name)
  const travelerTokens = travelerNameTokens(row.traveler)
  if (!traveler || !displayName) return false
  return traveler === displayName
    || traveler === displayFirstName
    || travelerTokens.includes(displayName)
    || travelerTokens.includes(displayFirstName)
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

function candidateJourneys(rows: FlightRow[], profile: ProfileRow, directionNeedle: string, requireFamily = true) {
  const family = normalizeText(profile.family).toLowerCase()
  if (!normalizeText(profile.display_name)) return []

  const grouped = new Map<string, FlightRow[]>()
  for (const row of rows) {
    if (!row.direction.toLowerCase().includes(directionNeedle)) continue
    if (!travelerMatchesProfile(row, profile)) continue
    if (requireFamily && family && row.family.toLowerCase() !== family) continue

    const key = [row.family, row.traveler, row.direction, row.homeAirport].join('||')
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }

  return [...grouped.values()]
    .map((legs) => legs.sort((a, b) => {
      const left = `${a.dateSort}T${a.departSort}`
      const right = `${b.dateSort}T${b.departSort}`
      return left.localeCompare(right)
    }))
    .sort((a, b) => {
      const left = `${a[0].dateSort}T${a[0].departSort}`
      const right = `${b[0].dateSort}T${b[0].departSort}`
      return left.localeCompare(right)
    })
}

function pickArrivingToSeattleJourney(rows: FlightRow[], profile: ProfileRow) {
  const pick = (requireFamily: boolean) => candidateJourneys(rows, profile, 'arriv', requireFamily)
    .filter((legs) => legs[legs.length - 1] && SEATTLE_ORIGINS.has(legs[legs.length - 1].destination))[0] ?? null

  return pick(true) ?? pick(false)
}

function pickDepartingHomeJourney(rows: FlightRow[], profile: ProfileRow) {
  const pick = (requireFamily: boolean) => candidateJourneys(rows, profile, 'depart', requireFamily)
    .filter((legs) => legs[0] && SEATTLE_ORIGINS.has(legs[0].origin))[0] ?? null

  return pick(true) ?? pick(false)
}

function pickFirstArrivingToSeattleJourney(rows: FlightRow[]) {
  const grouped = new Map<string, FlightRow[]>()

  for (const row of rows) {
    if (!row.direction.toLowerCase().includes('arriv')) continue
    if (!normalizeText(row.traveler)) continue

    const key = [row.family, row.traveler, row.direction, row.homeAirport].join('||')
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }

  return [...grouped.values()]
    .map((legs) => legs.sort((a, b) => {
      const left = `${a.dateSort}T${a.departSort}`
      const right = `${b.dateSort}T${b.departSort}`
      return left.localeCompare(right)
    }))
    .filter((legs) => legs[legs.length - 1] && SEATTLE_ORIGINS.has(legs[legs.length - 1].destination))
    .sort((a, b) => {
      const left = `${a[0].dateSort}T${a[0].departSort}`
      const right = `${b[0].dateSort}T${b[0].departSort}`
      return left.localeCompare(right)
    })[0] ?? null
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

async function resolveNonTravelerUploadWindow(admin: SupabaseClient, rows: FlightRow[], now: Date): Promise<UploadWindow> {
  const firstArrivingJourney = pickFirstArrivingToSeattleJourney(rows)
  if (!firstArrivingJourney) {
    return buildUnavailable('No Seattle arrivals were found for this trip.')
  }

  const firstInboundLeg = firstArrivingJourney[0]
  const statuses = await loadStatuses(admin, [firstInboundLeg])
  const firstInboundStatus = statuses.get(statusKey(firstInboundLeg))
  const scheduledDepartureAt = firstInboundStatus?.scheduled_departure_at
    ?? parseSeattleLocalDateTime(firstInboundLeg.dateSort, firstInboundLeg.departSort)
  const scheduledDeparture = parseIso(scheduledDepartureAt)
  if (!scheduledDeparture) {
    return buildUnavailable('Scheduled departure time is unavailable for the first Seattle arrival.')
  }

  const scheduledOpenMs = scheduledDeparture.getTime() - OPEN_BEFORE_DEPARTURE_MS
  const opensAtDate = new Date(Math.min(scheduledOpenMs, SEATTLE_UPLOAD_WINDOW_START_MS))
  const closesAtDate = CAPTURE_WINDOW_END
  const nowMs = now.getTime()

  let reason = 'Uploads are open.'
  if (nowMs < opensAtDate.getTime()) {
    reason = 'Uploads open when the first arriving traveler can upload.'
  } else if (nowMs > closesAtDate.getTime()) {
    reason = 'Uploads closed when the Seattle media window ended.'
  }

  return {
    allowed: nowMs >= opensAtDate.getTime() && nowMs <= closesAtDate.getTime(),
    reason,
    opensAt: opensAtDate.toISOString(),
    closesAt: closesAtDate.toISOString(),
    scheduledDepartureAt: scheduledDeparture.toISOString(),
    actualFinalArrivalAt: null,
    finalArrivalFallbackAt: null,
    finalDestination: null,
    source: 'first_arriving_traveler',
  }
}

async function canUseHostFamilyUploadWindow(admin: SupabaseClient, profile: ProfileRow) {
  if (profile.role === 'admin') return true

  const family = normalizeText(profile.family).toLowerCase()
  if (!family) return false

  const { data, error } = await admin
    .from('profiles')
    .select('family')
    .eq('active', true)
    .eq('role', 'admin')
    .returns<AdminFamilyRow[]>()

  if (error) throw new Error(error.message)

  return (data ?? []).some((row) => normalizeText(row.family).toLowerCase() === family)
}

export async function resolveUploadWindow(
  _admin: SupabaseClient,
  _profile: ProfileRow,
  _now = new Date(),
): Promise<UploadWindow> {
  return {
    allowed: true,
    reason: 'Uploads are open.',
    opensAt: '2026-07-30T07:00:00.000Z',
    closesAt: '2099-12-31T23:59:59.999Z',
    scheduledDepartureAt: null,
    actualFinalArrivalAt: null,
    finalArrivalFallbackAt: null,
    finalDestination: null,
    source: null,
  }
}
