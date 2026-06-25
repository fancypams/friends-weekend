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

export function formatStatusTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
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

export function liveStatusDetail(status) {
  if (!status || status.unavailable) return ''
  if (status.actualArrivalAt) return `Landed ${formatStatusTime(status.actualArrivalAt)}`
  if (status.estimatedArrivalAt) return `Est. arrival ${formatStatusTime(status.estimatedArrivalAt)}`
  if (status.actualDepartureAt) return `Departed ${formatStatusTime(status.actualDepartureAt)}`
  if (status.estimatedDepartureAt) return `Est. depart ${formatStatusTime(status.estimatedDepartureAt)}`
  return ''
}

export function flightOperationalDetails(flight) {
  const status = flight.liveStatus
  if (!status || status.unavailable) return []
  const details = []
  if (liveStatusDetail(status)) details.push(liveStatusDetail(status))
  if (status.departureTerminal) details.push(`Dep terminal ${status.departureTerminal}`)
  if (status.departureGate) details.push(`Dep gate ${status.departureGate}`)
  if (status.arrivalTerminal) details.push(`Arr terminal ${status.arrivalTerminal}`)
  if (status.arrivalGate) details.push(`Arr gate ${status.arrivalGate}`)
  if (status.baggageClaim) details.push(`Baggage ${status.baggageClaim}`)
  return details
}

export function buildMobileFlightJourneys(flights) {
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
