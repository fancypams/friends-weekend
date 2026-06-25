export function flightGroupKey(f) {
  return [
    f.family,
    f.direction,
    f.homeAirport,
    f.flightNumber,
    f.dateSort || f.date,
    f.departSort || f.departureTime,
    f.arriveSort || f.arrivalTime,
    f.origin,
    f.destination,
  ].join('||')
}

export function isArriving(f) {
  return f.direction.toLowerCase().includes('arriv')
}

export function getRoute(f) {
  return `${f.origin} → ${f.destination}`
}

export function tripLegLabel(f) {
  return isArriving(f) ? 'Heading to Seattle' : 'Leaving Seattle'
}

const AIRPORT_TIME_ZONES = {
  ABQ: 'America/Denver',
  ADD: 'Africa/Addis_Ababa',
  AMS: 'Europe/Amsterdam',
  ATL: 'America/New_York',
  AUS: 'America/Chicago',
  BHM: 'America/Chicago',
  BNA: 'America/Chicago',
  BOI: 'America/Boise',
  BOS: 'America/New_York',
  BUR: 'America/Los_Angeles',
  BWI: 'America/New_York',
  CDG: 'Europe/Paris',
  CLE: 'America/New_York',
  CLT: 'America/New_York',
  CMH: 'America/New_York',
  CVG: 'America/New_York',
  DAL: 'America/Chicago',
  DCA: 'America/New_York',
  DEN: 'America/Denver',
  DFW: 'America/Chicago',
  DOH: 'Asia/Qatar',
  DTW: 'America/Detroit',
  DXB: 'Asia/Dubai',
  ELP: 'America/Denver',
  EWR: 'America/New_York',
  FLL: 'America/New_York',
  FRA: 'Europe/Berlin',
  GEG: 'America/Los_Angeles',
  HOU: 'America/Chicago',
  IAD: 'America/New_York',
  IAH: 'America/Chicago',
  IND: 'America/Indiana/Indianapolis',
  JAX: 'America/New_York',
  JFK: 'America/New_York',
  LAS: 'America/Los_Angeles',
  LAX: 'America/Los_Angeles',
  LGA: 'America/New_York',
  LGB: 'America/Los_Angeles',
  LHR: 'Europe/London',
  MBA: 'Africa/Nairobi',
  MCO: 'America/New_York',
  MDT: 'America/New_York',
  MDW: 'America/Chicago',
  MEM: 'America/Chicago',
  MIA: 'America/New_York',
  MKE: 'America/Chicago',
  MSP: 'America/Chicago',
  MSY: 'America/Chicago',
  NBO: 'Africa/Nairobi',
  OAK: 'America/Los_Angeles',
  OKC: 'America/Chicago',
  ONT: 'America/Los_Angeles',
  ORD: 'America/Chicago',
  PDX: 'America/Los_Angeles',
  PHL: 'America/New_York',
  PHX: 'America/Phoenix',
  PIT: 'America/New_York',
  RDU: 'America/New_York',
  RNO: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles',
  SAT: 'America/Chicago',
  SEA: 'America/Los_Angeles',
  SFO: 'America/Los_Angeles',
  SGF: 'America/Chicago',
  SJC: 'America/Los_Angeles',
  SLC: 'America/Denver',
  SMF: 'America/Los_Angeles',
  STL: 'America/Chicago',
  TPA: 'America/New_York',
  TUL: 'America/Chicago',
  TUS: 'America/Phoenix',
  YVR: 'America/Vancouver',
}

function airportTimeZone(code) {
  return AIRPORT_TIME_ZONES[String(code || '').trim().toUpperCase()] || ''
}

export function formatStatusTime(value, timeZone = '') {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const options = { hour: 'numeric', minute: '2-digit' }
  if (timeZone) options.timeZone = timeZone
  return d.toLocaleTimeString('en-US', options)
}

export function liveStatusLabel(f) {
  const label = f.liveStatus?.statusLabel || 'Status unavailable'
  return label === 'On time' ? 'Scheduled' : label
}

export function liveStatusTone(status) {
  const label = String(status?.statusLabel || '').toLowerCase()
  if (label.includes('cancel') || label.includes('divert')) return 'status-chip--critical'
  if (label.includes('delay')) return 'status-chip--warning'
  if (label.includes('depart') || label.includes('land') || label.includes('sched') || label.includes('on time')) return 'status-chip--ok'
  return 'status-chip--muted'
}

export function liveStatusDetail(status, flight = null) {
  if (!status || status.unavailable) return ''
  const arrivalTimeZone = airportTimeZone(flight?.destination)
  const departureTimeZone = airportTimeZone(flight?.origin)
  if (status.actualArrivalAt) return `Landed ${formatStatusTime(status.actualArrivalAt, arrivalTimeZone)}`
  if (status.estimatedArrivalAt) return `Est. arrival ${formatStatusTime(status.estimatedArrivalAt, arrivalTimeZone)}`
  if (status.actualDepartureAt) return `Departed ${formatStatusTime(status.actualDepartureAt, departureTimeZone)}`
  if (status.estimatedDepartureAt) return `Est. depart ${formatStatusTime(status.estimatedDepartureAt, departureTimeZone)}`
  return ''
}

export function liveArrivalTime(flight) {
  const status = flight.liveStatus
  return formatStatusTime(status?.actualArrivalAt, airportTimeZone(flight.destination))
    || formatStatusTime(status?.estimatedArrivalAt, airportTimeZone(flight.destination))
    || flight.arrivalTime
}

export function liveDepartureTime(flight) {
  const status = flight.liveStatus
  return formatStatusTime(status?.actualDepartureAt, airportTimeZone(flight.origin))
    || formatStatusTime(status?.estimatedDepartureAt, airportTimeZone(flight.origin))
    || flight.departureTime
}

export function liveArrivalSort(flight) {
  const status = flight.liveStatus
  return status?.actualArrivalAt || status?.estimatedArrivalAt || flight.arriveSort
}

export function liveDepartureSort(flight) {
  const status = flight.liveStatus
  return status?.actualDepartureAt || status?.estimatedDepartureAt || flight.departSort
}

export function flightOperationalDetails(flight) {
  const status = flight.liveStatus
  if (!status || status.unavailable) return []
  const details = []
  if (liveStatusDetail(status, flight)) details.push(liveStatusDetail(status, flight))
  if (status.departureTerminal) details.push(`Dep terminal ${status.departureTerminal}`)
  if (status.departureGate) details.push(`Dep gate ${status.departureGate}`)
  if (status.arrivalTerminal) details.push(`Arr terminal ${status.arrivalTerminal}`)
  if (status.arrivalGate) details.push(`Arr gate ${status.arrivalGate}`)
  if (status.baggageClaim) details.push(`Baggage ${status.baggageClaim}`)
  return details
}

export function buildFlightJourneys(flights) {
  const groups = new Map()

  flights.forEach((flight) => {
    const key = [
      flight.family,
      flight.travelerDisplay,
      flight.direction,
      flight.homeAirport,
      flight.dateSort,
    ].join('||')
    const existing = groups.get(key)

    if (!existing) {
      groups.set(key, {
        key,
        family: flight.family,
        travelerDisplay: flight.travelerDisplay,
        date: flight.date,
        dateSort: flight.dateSort,
        direction: flight.direction,
        homeAirport: flight.homeAirport,
        flights: [flight],
      })
      return
    }

    existing.flights.push(flight)
  })

  return [...groups.values()].map((journey) => ({
    ...journey,
    flights: journey.flights.sort((a, b) => a.departSort.localeCompare(b.departSort)),
  }))
}

export function buildMobileFlightJourneys(flights) {
  return buildFlightJourneys(flights)
}

export function journeyTripLegLabel(journey) {
  return tripLegLabel(journey.flights[0])
}

export function journeyRoute(journey) {
  if (!journey.flights.length) return ''
  const airports = [journey.flights[0].origin]
  journey.flights.forEach((flight) => {
    if (airports[airports.length - 1] !== flight.destination) airports.push(flight.destination)
  })
  return airports.join(' → ')
}

export function journeyStatus(journey) {
  const priority = ['Cancelled', 'Diverted', 'Delayed', 'Departed', 'Landed', 'Scheduled']
  const statuses = journey.flights.map((flight) => liveStatusLabel(flight))
  return priority.find((label) => statuses.includes(label)) || statuses[0] || 'Status unavailable'
}

export function journeyStatusTone(journey) {
  return liveStatusTone({ statusLabel: journeyStatus(journey) })
}
