<script setup>
import { ref, computed, onMounted } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import { supabase, supabaseAnonKey, bypassAuth, supabaseFunctionUrl } from '../lib/supabaseClient'

const SHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Flight Info'

const activeTab = ref('map')
const tabs = [
  { id: 'map', label: 'Arc map' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'table', label: 'Table' },
  { id: 'add', label: '+ Add flight' },
]

// ── Data state ──
const loading = ref(true)
const errorMsg = ref(null)
const flights = ref([])

// ── Airport coordinates ──
const AIRPORTS = {
  SEA: { lat: 47.45, lon: -122.31, city: 'Seattle' },
  BOS: { lat: 42.36, lon: -71.00, city: 'Boston' },
  JFK: { lat: 40.64, lon: -73.78, city: 'New York' },
  LGA: { lat: 40.78, lon: -73.87, city: 'New York' },
  EWR: { lat: 40.69, lon: -74.17, city: 'Newark' },
  LAX: { lat: 33.94, lon: -118.41, city: 'Los Angeles' },
  BUR: { lat: 34.20, lon: -118.36, city: 'Burbank' },
  LGB: { lat: 33.82, lon: -118.15, city: 'Long Beach' },
  ONT: { lat: 34.06, lon: -117.60, city: 'Ontario' },
  SFO: { lat: 37.62, lon: -122.38, city: 'San Francisco' },
  SJC: { lat: 37.36, lon: -121.93, city: 'San Jose' },
  OAK: { lat: 37.72, lon: -122.22, city: 'Oakland' },
  SMF: { lat: 38.70, lon: -121.59, city: 'Sacramento' },
  ORD: { lat: 41.97, lon: -87.90, city: 'Chicago' },
  MDW: { lat: 41.79, lon: -87.75, city: 'Chicago Midway' },
  DEN: { lat: 39.86, lon: -104.67, city: 'Denver' },
  MIA: { lat: 25.80, lon: -80.29, city: 'Miami' },
  FLL: { lat: 26.07, lon: -80.15, city: 'Fort Lauderdale' },
  MCO: { lat: 28.43, lon: -81.31, city: 'Orlando' },
  TPA: { lat: 27.98, lon: -82.53, city: 'Tampa' },
  JAX: { lat: 30.49, lon: -81.69, city: 'Jacksonville' },
  ATL: { lat: 33.64, lon: -84.43, city: 'Atlanta' },
  CLT: { lat: 35.21, lon: -80.94, city: 'Charlotte' },
  RDU: { lat: 35.88, lon: -78.79, city: 'Raleigh' },
  DFW: { lat: 32.90, lon: -97.04, city: 'Dallas' },
  DAL: { lat: 32.85, lon: -96.85, city: 'Dallas Love' },
  PHX: { lat: 33.44, lon: -112.01, city: 'Phoenix' },
  TUS: { lat: 32.12, lon: -110.94, city: 'Tucson' },
  LAS: { lat: 36.08, lon: -115.15, city: 'Las Vegas' },
  SAN: { lat: 32.73, lon: -117.19, city: 'San Diego' },
  MSP: { lat: 44.88, lon: -93.22, city: 'Minneapolis' },
  DTW: { lat: 42.21, lon: -83.35, city: 'Detroit' },
  CLE: { lat: 41.41, lon: -81.85, city: 'Cleveland' },
  PIT: { lat: 40.49, lon: -80.23, city: 'Pittsburgh' },
  CMH: { lat: 39.99, lon: -82.89, city: 'Columbus' },
  CVG: { lat: 39.05, lon: -84.67, city: 'Cincinnati' },
  IND: { lat: 39.72, lon: -86.29, city: 'Indianapolis' },
  MKE: { lat: 42.95, lon: -87.90, city: 'Milwaukee' },
  IAH: { lat: 29.99, lon: -95.34, city: 'Houston' },
  HOU: { lat: 29.65, lon: -95.28, city: 'Houston Hobby' },
  AUS: { lat: 30.20, lon: -97.67, city: 'Austin' },
  SAT: { lat: 29.53, lon: -98.47, city: 'San Antonio' },
  OKC: { lat: 35.39, lon: -97.60, city: 'Oklahoma City' },
  TUL: { lat: 36.20, lon: -95.89, city: 'Tulsa' },
  STL: { lat: 38.75, lon: -90.37, city: 'St. Louis' },
  SGF: { lat: 37.25, lon: -93.39, city: 'Springfield MO' },
  MEM: { lat: 35.04, lon: -89.98, city: 'Memphis' },
  BNA: { lat: 36.12, lon: -86.68, city: 'Nashville' },
  MSY: { lat: 29.99, lon: -90.26, city: 'New Orleans' },
  BHM: { lat: 33.56, lon: -86.75, city: 'Birmingham' },
  SLC: { lat: 40.79, lon: -111.98, city: 'Salt Lake City' },
  ABQ: { lat: 35.04, lon: -106.61, city: 'Albuquerque' },
  ELP: { lat: 31.81, lon: -106.38, city: 'El Paso' },
  PHL: { lat: 39.87, lon: -75.24, city: 'Philadelphia' },
  BWI: { lat: 39.18, lon: -76.67, city: 'Baltimore' },
  DCA: { lat: 38.85, lon: -77.04, city: 'Washington' },
  IAD: { lat: 38.94, lon: -77.45, city: 'Dulles' },
  MDT: { lat: 40.19, lon: -76.76, city: 'Harrisburg' },
  PDX: { lat: 45.59, lon: -122.60, city: 'Portland' },
  GEG: { lat: 47.62, lon: -117.53, city: 'Spokane' },
  BOI: { lat: 43.56, lon: -116.22, city: 'Boise' },
  RNO: { lat: 39.50, lon: -119.77, city: 'Reno' },
  YVR: { lat: 49.19, lon: -123.18, city: 'Vancouver' },
  // East Africa
  NBO: { lat: -1.32, lon: 36.93, city: 'Nairobi' },
  ADD: { lat:  8.98, lon: 38.80, city: 'Addis Ababa' },
  MBA: { lat: -4.03, lon: 39.59, city: 'Mombasa' },
  // European hubs (common Kenya→US connections)
  AMS: { lat: 52.31, lon:  4.76, city: 'Amsterdam' },
  LHR: { lat: 51.48, lon: -0.45, city: 'London' },
  CDG: { lat: 49.01, lon:  2.55, city: 'Paris' },
  FRA: { lat: 50.03, lon:  8.57, city: 'Frankfurt' },
  // Gulf hubs
  DXB: { lat: 25.25, lon: 55.36, city: 'Dubai' },
  DOH: { lat: 25.27, lon: 51.57, city: 'Doha' },
}

// ── SVG map projection ──
// Both SVG_W and maxLon are scaled together so the lon scale (px/°) is preserved.
// Old: 2200px / 188° lon. New maxLon=120 → 248° → SVG_W = 248/188 × 2200 = 2902.
// This keeps ALL existing x-coordinates identical (SEA, CDG, NBO unchanged).
// SVG_H likewise preserves the original lat scale: 58° × 15.33 px/° = 889px.
const SVG_W = 2902
const SVG_H = 889
const MAP_BOUNDS = { minLon: -128, maxLon: 120, minLat: -5, maxLat: 53 }

// VIEW_US: exactly the same as the original US-only map.
// VIEW_EUROPE: same 1.739:1 AR (card height stays 460px), full canvas height shown so
//   Europe is at the top and East Africa / NBO appears in the lower portion.
const VIEW_US     = [0,   0, 800,  460]
const VIEW_EUROPE = [870, 0, 1546, 889]

function project(lon, lat) {
  const { minLon, maxLon, minLat, maxLat } = MAP_BOUNDS
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return null
  return {
    x: ((lon - minLon) / (maxLon - minLon)) * SVG_W,
    y: SVG_H - ((lat - minLat) / (maxLat - minLat)) * SVG_H,
  }
}

function airportPos(code) {
  const airport = AIRPORTS[code?.toUpperCase()]
  if (!airport) {
    console.warn(`[FlightsPage] No coordinates for airport "${code}" — add it to AIRPORTS to show on map`)
    return null
  }
  return { pos: project(airport.lon, airport.lat), city: airport.city, lon: airport.lon, lat: airport.lat }
}

function buildArc(originCode, destCode, isArriving) {
  const origin = airportPos(originCode)
  const dest = airportPos(destCode)
  if (!origin || !dest) return null
  // Both off-map: skip (the Africa view handles these legs)
  if (!origin.pos && !dest.pos) return null

  // Clamp off-map endpoint to nearest map edge so international → US legs draw correctly
  function clampEdge({ lon, lat }) {
    const { minLon, maxLon, minLat, maxLat } = MAP_BOUNDS
    return {
      x: Math.max(0, Math.min(SVG_W, ((lon - minLon) / (maxLon - minLon)) * SVG_W)),
      y: Math.max(0, Math.min(SVG_H, SVG_H - ((lat - minLat) / (maxLat - minLat)) * SVG_H)),
    }
  }

  const from = origin.pos ?? clampEdge(origin)
  const to = dest.pos ?? clampEdge(dest)

  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2)
  // Arriving arcs bow north (lower y), departing bow south (higher y).
  // Cap the bow so trans-oceanic arcs don't fly far off-canvas.
  const maxBow = isArriving
    ? Math.min(dist * 0.28, my - 8)
    : Math.min(dist * 0.28, SVG_H - my - 8)
  const cy = my - (isArriving ? 1 : -1) * Math.max(maxBow, 0)

  return {
    path: `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${mx.toFixed(1)} ${cy.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
    isArriving,
  }
}

const seaPos = computed(() => project(AIRPORTS.SEA.lon, AIRPORTS.SEA.lat))

// ── Map background (world countries) ──
const usPaths = ref([])
const contextPaths = ref([])  // all non-US countries in map bounds (Canada, Mexico, Europe, etc.)

// ── Pan animation ──
const arcMapViewBox = ref([...VIEW_US])
const isPannedRight = ref(false)
let panRaf = null

function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t }

function animatePan(target, duration = 1300) {
  const start = [...arcMapViewBox.value]
  if (panRaf) cancelAnimationFrame(panRaf)
  let startTs = null

  function step(ts) {
    if (!startTs) startTs = ts
    const t = Math.min((ts - startTs) / duration, 1)
    const e = easeInOut(t)
    arcMapViewBox.value = start.map((s, i) => s + (target[i] - s) * e)
    if (t < 1) {
      panRaf = requestAnimationFrame(step)
    } else {
      arcMapViewBox.value = [...target]
      panRaf = null
    }
  }
  panRaf = requestAnimationFrame(step)
}

function panToUS() {
  isPannedRight.value = false
  animatePan(VIEW_US)
}
function panToAfrica() {
  isPannedRight.value = true
  animatePan(VIEW_EUROPE)
}

async function loadMapData() {
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const topo = await res.json()

    const { scale, translate } = topo.transform
    const topoArcs = topo.arcs

    function decodeArc(index) {
      const reversed = index < 0
      const arc = topoArcs[reversed ? ~index : index]
      let x = 0, y = 0
      const pts = arc.map(([dx, dy]) => {
        x += dx; y += dy
        return [x * scale[0] + translate[0], y * scale[1] + translate[1]]
      })
      return reversed ? pts.slice().reverse() : pts
    }

    function ringToPath(projFn, ring) {
      const allPts = []
      for (let i = 0; i < ring.length; i++) {
        const decoded = decodeArc(ring[i])
        allPts.push(...(i === 0 ? decoded : decoded.slice(1)))
      }
      const svgPts = allPts
        .map(([lon, lat]) => {
          const p = projFn(lon, lat)
          return p ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : null
        })
        .filter(Boolean)
      return svgPts.length >= 3 ? `M ${svgPts.join(' L ')} Z` : ''
    }

    const us = []
    const context = []

    topo.objects.countries.geometries.forEach((geom) => {
      const polygons = geom.type === 'Polygon' ? [geom.arcs] : geom.arcs
      const target = String(geom.id) === '840' ? us : context
      polygons.forEach((rings) => {
        const d = rings.map((r) => ringToPath(project, r)).filter(Boolean).join(' ')
        if (d) target.push(d)
      })
    })

    usPaths.value = us
    contextPaths.value = context
  } catch (err) {
    console.warn('[FlightsPage] Map data failed:', err.message)
  }
}

// One arc per unique leg (origin → destination), so connecting flights draw as separate segments
const mapArcs = computed(() => {
  const seen = new Set()
  return flights.value.reduce((arcs, f) => {
    const arriving = f.direction.toLowerCase().includes('arriv')
    const key = `${f.origin}-${f.destination}-${arriving ? 'in' : 'out'}`
    if (seen.has(key)) return arcs
    seen.add(key)
    const arc = buildArc(f.origin, f.destination, arriving)
    if (arc) arcs.push(arc)
    return arcs
  }, [])
})

// Dots + labels for every non-SEA airport touched by any leg (home airports and connection cities)
const mapWaypoints = computed(() => {
  const seen = new Map()
  flights.value.forEach((f) => {
    ;[f.origin, f.destination].forEach((rawCode) => {
      const code = rawCode?.toUpperCase()
      if (!code || code === 'SEA' || seen.has(code)) return
      const airport = airportPos(code)
      if (!airport?.pos) return
      seen.set(code, { code, city: airport.city, pos: airport.pos })
    })
  })
  return [...seen.values()]
})

// Show pan buttons when any flight touches an airport east of the US (lon > -62)
const hasEasternFlights = computed(() =>
  flights.value.some((f) =>
    [f.origin, f.destination].some((code) => {
      const airport = AIRPORTS[code?.toUpperCase()]
      return airport && airport.lon > -62
    })
  )
)

// ── GViz cell parsers ──
// GViz returns dates as "Date(year,month0,day)" and times as "Date(1899,11,30,h,m,s)"
function parseGvizCell(v) {
  const s = String(v)
  if (!s.startsWith('Date(')) return { display: s.trim(), sort: s.trim() }

  const m = s.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+))?/)
  if (!m) return { display: s, sort: s }

  const year = parseInt(m[1])
  if (year === 1899 && m[4] !== undefined) {
    // Time value — hours/minutes encoded in args 4 & 5
    const h = parseInt(m[4])
    const min = parseInt(m[5])
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return {
      display: `${h12}:${String(min).padStart(2, '0')} ${ampm}`,
      sort: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    }
  }

  // Date value — month is 0-based in GViz
  const month = parseInt(m[2])
  const day = parseInt(m[3])
  const d = new Date(year, month, day)
  return {
    display: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    sort: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

function cellStr(row, col) {
  const c = row?.c?.[col]
  if (!c || c.v == null) return ''
  return parseGvizCell(c.v).display
}

// ── Sorting & grouping ──
const sortedFlights = computed(() =>
  [...flights.value].sort((a, b) => {
    if (a.dateSort !== b.dateSort) return a.dateSort.localeCompare(b.dateSort)
    return a.departSort.localeCompare(b.departSort)
  })
)

const flightsByDate = computed(() => {
  const groups = []
  let last = null
  for (const f of sortedFlights.value) {
    if (f.dateSort !== last) {
      last = f.dateSort
      groups.push({ dateDisplay: f.date, dateSort: f.dateSort, flights: [] })
    }
    groups[groups.length - 1].flights.push(f)
  }
  return groups
})

// ── Helpers ──
function isArriving(f) {
  return f.direction.toLowerCase().includes('arriv')
}

function getRoute(f) {
  return `${f.origin} → ${f.destination}`
}

function formatDateLong(dateSort) {
  if (!dateSort || !dateSort.match(/^\d{4}-\d{2}-\d{2}$/)) return dateSort || '—'
  const d = new Date(dateSort + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

// ── Load data ──
async function loadFlights() {
  loading.value = true
  errorMsg.value = null

  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json&headers=1&sheet=${encodeURIComponent(SHEET_NAME)}`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const match = text.match(/google\.visualization\.Query\.setResponse\((\{.+\})\)/)
    if (!match) throw new Error('Unexpected response format')
    const data = JSON.parse(match[1])
    if (data.status === 'error') throw new Error(data.errors?.[0]?.message ?? 'Spreadsheet error')

    flights.value = (data.table.rows ?? [])
      .map((row) => {
        const dateCell = row?.c?.[4]
        const departCell = row?.c?.[5]
        const arriveCell = row?.c?.[6]
        const dateParsed = dateCell?.v != null ? parseGvizCell(dateCell.v) : { display: '', sort: '' }
        const departParsed = departCell?.v != null ? parseGvizCell(departCell.v) : { display: '', sort: '' }
        const arriveParsed = arriveCell?.v != null ? parseGvizCell(arriveCell.v) : { display: '', sort: '' }
        const direction = cellStr(row, 1)
        return {
          family: cellStr(row, 0),
          direction,
          flightNumber: cellStr(row, 3),
          date: dateParsed.display,
          dateSort: dateParsed.sort,
          departureTime: departParsed.display,
          departSort: departParsed.sort,
          arrivalTime: arriveParsed.display,
          origin: cellStr(row, 7).toUpperCase(),
          destination: cellStr(row, 8).toUpperCase(),
        }
      })
      .filter((r) => r.family && r.direction && r.origin && r.destination)
  } catch (err) {
    console.error('[FlightsPage] load', err)
    errorMsg.value = err.message || 'Could not load flight data'
  }

  loading.value = false
}

// ── Auth ──
async function getAuthHeaders() {
  if (!supabase) throw new Error('Supabase is not configured')
  if (bypassAuth) {
    return { apikey: supabaseAnonKey, 'Content-Type': 'application/json' }
  }
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('No active session')
  return {
    Authorization: `Bearer ${token}`,
    apikey: supabaseAnonKey,
    'Content-Type': 'application/json',
  }
}

// ── Form ──
const FAMILIES = ['Ekanger', 'Dzambo', 'Schambach', 'Montañez', 'Habibi', 'Donaldson']

function createLeg(origin = '', destination = '') {
  return {
    origin,
    destination,
    flight: '',
    date: '',
    depart: '',
    arrive: '',
    looking: false,
    lookupMsg: null,
  }
}

const formFamily = ref('')
const tripType = ref('roundtrip') // 'roundtrip' | 'arriving' | 'departing'
const arrLegs = ref([createLeg()])
const depLegs = ref([createLeg()])

const submitting = ref(false)
const submitError = ref(null)
const successMsg = ref(null)

// The family's home airport, used for the arc map — derived from the outer legs
const homeAirportCode = computed(() => {
  if (tripType.value !== 'departing') {
    const arrOrigin = arrLegs.value[0]?.origin?.trim().toUpperCase()
    if (arrOrigin) return arrOrigin
  }
  if (tripType.value !== 'arriving') {
    const depDestination = depLegs.value[depLegs.value.length - 1]?.destination?.trim().toUpperCase()
    if (depDestination) return depDestination
  }
  return ''
})

function addArrLeg() {
  arrLegs.value.push(createLeg())
}

function removeArrLeg(index) {
  if (arrLegs.value.length > 1) arrLegs.value.splice(index, 1)
}

function addDepLeg() {
  depLegs.value.push(createLeg())
}

function removeDepLeg(index) {
  if (depLegs.value.length > 1) depLegs.value.splice(index, 1)
}

async function lookupLeg(leg) {
  const num = leg.flight.trim()
  if (!num) return

  leg.looking = true
  leg.lookupMsg = null

  try {
    const headers = await getAuthHeaders()
    const res = await fetch(supabaseFunctionUrl('lookup-flight'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ flightNumber: num }),
    })

    const body = await res.json()

    if (!res.ok) {
      leg.lookupMsg = { type: 'error', text: body.error || 'Flight not found' }
      return
    }

    const first = body.results?.[0]
    if (!first) {
      leg.lookupMsg = { type: 'error', text: 'No schedule found' }
      return
    }

    leg.depart = first.departureTime
    leg.arrive = first.arrivalTime
    if (first.from) leg.origin = first.from
    if (first.to) leg.destination = first.to
    leg.lookupMsg = { type: 'success', text: 'Times auto-filled — please enter the date yourself' }
  } catch {
    leg.lookupMsg = { type: 'error', text: 'Could not look up flight' }
  } finally {
    leg.looking = false
  }
}

function resetForm() {
  formFamily.value = ''
  tripType.value = 'roundtrip'
  arrLegs.value = [createLeg()]
  depLegs.value = [createLeg()]
}

function validateLegs(legs, label) {
  for (const leg of legs) {
    if (!leg.origin.trim()) return `${label} origin is required`
    if (!leg.destination.trim()) return `${label} destination is required`
    if (!leg.flight.trim()) return `${label} flight number is required`
    if (!leg.date) return `${label} date is required`
    if (!leg.depart) return `${label} departure time is required`
    if (!leg.arrive) return `${label} arrival time is required`
  }
  return null
}

function serializeLegs(legs) {
  return legs.map((leg) => ({
    flight: leg.flight.trim().toUpperCase(),
    date: leg.date,
    departTime: leg.depart,
    arriveTime: leg.arrive,
    origin: leg.origin.trim().toUpperCase(),
    destination: leg.destination.trim().toUpperCase(),
  }))
}

function createFlightPayload() {
  return {
    family: formFamily.value,
    homeAirport: homeAirportCode.value,
    arriving: tripType.value !== 'departing' ? serializeLegs(arrLegs.value) : [],
    departing: tripType.value !== 'arriving' ? serializeLegs(depLegs.value) : [],
  }
}

async function handleSubmit() {
  submitError.value = null
  successMsg.value = null

  if (!formFamily.value) { submitError.value = 'Please select your family'; return }
  if (!homeAirportCode.value) { submitError.value = 'Home airport is required'; return }

  if (tripType.value !== 'departing') {
    const arrError = validateLegs(arrLegs.value, 'Arriving flight')
    if (arrError) { submitError.value = arrError; return }
  }
  if (tripType.value !== 'arriving') {
    const depError = validateLegs(depLegs.value, 'Departing flight')
    if (depError) { submitError.value = depError; return }
  }

  submitting.value = true

  try {
    const headers = await getAuthHeaders()
    const res = await fetch(supabaseFunctionUrl('append-flight'), {
      method: 'POST',
      headers,
      body: JSON.stringify(createFlightPayload()),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Error ${res.status}`)
    }

    successMsg.value = 'Flights saved!'
    resetForm()
    await loadFlights()
    activeTab.value = 'table'
  } catch (err) {
    submitError.value = err.message || 'Failed to save flights'
  }

  submitting.value = false
}

onMounted(() => {
  loadFlights()
  loadMapData()
})
</script>

<template>
  <div class="page">
    <HeroHeader show-back />
    <main class="page-main">

      <div class="page-header">
        <p class="section-label">Getting Here</p>
        <h1 class="page-title">Flights</h1>
      </div>

      <!-- Tab bar -->
      <div class="tab-bar" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab-btn', { active: activeTab === tab.id }]"
          role="tab"
          :aria-selected="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- ── Arc Map ── -->
      <div v-show="activeTab === 'map'" class="tab-content">
        <div v-if="loading" class="state-msg"><div class="spinner"></div>Loading…</div>
        <div v-else-if="errorMsg" class="state-msg error">{{ errorMsg }}</div>
        <div v-else class="map-card">
          <div class="map-pan-btns">
            <button v-if="isPannedRight" class="pan-btn" @click="panToUS">← Pan Left</button>
            <button v-if="hasEasternFlights && !isPannedRight" class="pan-btn" @click="panToAfrica">Pan Right →</button>
          </div>
          <svg
            :viewBox="arcMapViewBox.join(' ')"
            class="arc-map"
            aria-label="Flight arc map"
          >
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2a3530" stroke-width="0.5" />
              </pattern>
            </defs>
            <rect :width="SVG_W" height="950" fill="#161d1a" />
            <rect :width="SVG_W" height="950" fill="url(#grid)" />

            <!-- World countries + neighbors -->
            <path
              v-for="(d, i) in contextPaths"
              :key="`ctx-${i}`"
              :d="d"
              class="land-country"
            />

            <!-- US outline -->
            <path
              v-for="(d, i) in usPaths"
              :key="`us-${i}`"
              :d="d"
              class="us-state"
            />

            <!-- Flight arcs -->
            <path
              v-for="(arc, i) in mapArcs"
              :key="i"
              :d="arc.path"
              fill="none"
              :stroke="arc.isArriving ? '#5dab6c' : '#c0614a'"
              stroke-width="2"
              stroke-dasharray="8 4"
              :class="arc.isArriving ? 'arc-arriving' : 'arc-departing'"
            />

            <!-- Waypoint dots + labels -->
            <g v-for="wp in mapWaypoints" :key="wp.code">
              <circle :cx="wp.pos.x" :cy="wp.pos.y" r="4.5" fill="#e8c468" />
              <text :x="wp.pos.x + 9" :y="wp.pos.y + 4" class="map-label">{{ wp.city }}</text>
            </g>

            <!-- SEA hub -->
            <template v-if="seaPos">
              <circle :cx="seaPos.x" :cy="seaPos.y" r="9" fill="rgba(255,255,255,0.15)" />
              <circle :cx="seaPos.x" :cy="seaPos.y" r="5" fill="white" />
              <circle :cx="seaPos.x" :cy="seaPos.y" r="2" fill="#161d1a" />
              <text :x="seaPos.x + 13" :y="seaPos.y + 5" class="map-label map-label--sea">SEA</text>
            </template>

            <text v-if="!loading && flights.length === 0" x="50%" y="50%" text-anchor="middle" class="map-empty">
              No flights added yet
            </text>
          </svg>

          <div class="map-legend">
            <span class="legend-item">
              <svg width="24" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="24" y2="4" stroke="#5dab6c" stroke-width="2" stroke-dasharray="6 3" />
              </svg>
              Heading to Friends Weekend
            </span>
            <span class="legend-item">
              <svg width="24" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="24" y2="4" stroke="#c0614a" stroke-width="2" stroke-dasharray="6 3" />
              </svg>
              Leaving Friends Weekend
            </span>
            <span class="legend-item">
              <svg width="16" height="16" aria-hidden="true">
                <circle cx="8" cy="8" r="5" fill="white" />
                <circle cx="8" cy="8" r="2" fill="#161d1a" />
              </svg>
              Seattle (SEA)
            </span>
          </div>
        </div>
      </div>

      <!-- ── Timeline ── -->
      <div v-show="activeTab === 'timeline'" class="tab-content">
        <div v-if="loading" class="state-msg"><div class="spinner"></div>Loading…</div>
        <div v-else-if="errorMsg" class="state-msg error">{{ errorMsg }}</div>
        <div v-else-if="flights.length === 0" class="empty-state">No flights added yet. Use + Add flight to get started.</div>
        <div v-else class="timeline">
          <div v-for="group in flightsByDate" :key="group.dateSort" class="timeline-day">
            <div class="timeline-date-header">{{ formatDateLong(group.dateSort) }}</div>
            <div class="timeline-flights">
              <div
                v-for="f in group.flights"
                :key="f.family + f.flightNumber"
                class="timeline-card"
                :class="isArriving(f) ? 'timeline-card--arriving' : 'timeline-card--departing'"
              >
                <div class="timeline-card-accent" />
                <div class="timeline-card-body">
                  <div class="timeline-card-top">
                    <span class="timeline-family">{{ f.family }}</span>
                    <span class="dir-badge" :class="isArriving(f) ? 'dir-badge--arriving' : 'dir-badge--departing'">
                      {{ isArriving(f) ? '↓ Arriving' : '↑ Departing' }}
                    </span>
                  </div>
                  <div class="timeline-route">{{ getRoute(f) }}</div>
                  <div class="timeline-meta">
                    <span>{{ f.flightNumber }}</span>
                    <span class="meta-sep">·</span>
                    <span>{{ f.departureTime }} → {{ f.arrivalTime }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Table ── -->
      <div v-show="activeTab === 'table'" class="tab-content">
        <div v-if="loading" class="state-msg"><div class="spinner"></div>Loading…</div>
        <div v-else-if="errorMsg" class="state-msg error">{{ errorMsg }}</div>
        <div v-else-if="flights.length === 0" class="empty-state">No flights added yet. Use + Add flight to get started.</div>
        <div v-else class="table-wrap">
          <table class="flights-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Direction</th>
                <th>Route</th>
                <th>Flight</th>
                <th>Date</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in sortedFlights" :key="f.family + f.direction + f.flightNumber">
                <td>{{ f.family }}</td>
                <td>
                  <span class="dir-badge" :class="isArriving(f) ? 'dir-badge--arriving' : 'dir-badge--departing'">
                    {{ isArriving(f) ? '↓ Arriving' : '↑ Departing' }}
                  </span>
                </td>
                <td class="route-cell">{{ getRoute(f) }}</td>
                <td>{{ f.flightNumber }}</td>
                <td>{{ f.date }}</td>
                <td class="time-cell">{{ f.departureTime }} → {{ f.arrivalTime }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── Add Flight ── -->
      <div v-show="activeTab === 'add'" class="tab-content">
        <div class="add-form">

          <div class="form-group">
            <label class="form-label">Your family</label>
            <select v-model="formFamily" class="form-select">
              <option value="" disabled>Select family…</option>
              <option v-for="f in FAMILIES" :key="f" :value="f">{{ f }}</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Trip type</label>
            <div class="trip-type-group" role="group" aria-label="Trip type">
              <button type="button" :class="['trip-type-btn', { active: tripType === 'roundtrip' }]" @click="tripType = 'roundtrip'">Round trip</button>
              <button type="button" :class="['trip-type-btn', { active: tripType === 'arriving' }]" @click="tripType = 'arriving'">Arriving</button>
              <button type="button" :class="['trip-type-btn', { active: tripType === 'departing' }]" @click="tripType = 'departing'">Departing</button>
            </div>
          </div>

          <!-- Arriving + Departing side by side on desktop -->
          <div :class="['flight-sections-row', { 'flight-sections-row--single': tripType !== 'roundtrip' }]">
          <!-- Arriving section -->
          <div v-if="tripType !== 'departing'" class="flight-section flight-section--arriving">
            <div class="flight-section-header">
              <span class="dir-icon">↓</span>
              Heading to Friends Weekend
            </div>
            <div class="flight-section-body">
              <div v-for="(leg, i) in arrLegs" :key="i" class="leg-block">
                <div class="leg-block-header" v-if="arrLegs.length > 1">
                  <span class="leg-label">{{ i === 0 ? 'Flight 1' : `Connection ${i + 1}` }}</span>
                  <button type="button" class="btn-remove-leg" @click="removeArrLeg(i)">Remove</button>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Origin</label>
                    <input
                      v-model="leg.origin"
                      class="form-input"
                      placeholder="e.g. BOS"
                      maxlength="4"
                      @input="leg.origin = leg.origin.toUpperCase()"
                    />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Destination</label>
                    <input
                      v-model="leg.destination"
                      class="form-input"
                      placeholder="e.g. SEA"
                      maxlength="4"
                      @input="leg.destination = leg.destination.toUpperCase()"
                    />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Flight number</label>
                    <input v-model="leg.flight" class="form-input" placeholder="e.g. AA 412" @blur="lookupLeg(leg)" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Date</label>
                    <input v-model="leg.date" type="date" class="form-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Departs</label>
                    <input v-model="leg.depart" type="time" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Arrives</label>
                    <input v-model="leg.arrive" type="time" class="form-input" />
                  </div>
                </div>
                <div v-if="leg.looking" class="lookup-status lookup-status--loading">
                  <div class="spinner spinner--sm"></div> Looking up schedule…
                </div>
                <div v-else-if="leg.lookupMsg" class="lookup-status" :class="leg.lookupMsg.type === 'success' ? 'lookup-status--success' : 'lookup-status--error'">
                  {{ leg.lookupMsg.text }}
                </div>
              </div>
              <button type="button" class="btn-add-leg" @click="addArrLeg">+ Add connecting flight</button>
            </div>
          </div>

          <!-- Departing section -->
          <div v-if="tripType !== 'arriving'" class="flight-section flight-section--departing">
            <div class="flight-section-header">
              <span class="dir-icon">↑</span>
              Leaving Friends Weekend
            </div>
            <div class="flight-section-body">
              <div v-for="(leg, i) in depLegs" :key="i" class="leg-block">
                <div class="leg-block-header" v-if="depLegs.length > 1">
                  <span class="leg-label">{{ i === 0 ? 'Flight 1' : `Connection ${i + 1}` }}</span>
                  <button type="button" class="btn-remove-leg" @click="removeDepLeg(i)">Remove</button>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Origin</label>
                    <input
                      v-model="leg.origin"
                      class="form-input"
                      placeholder="e.g. SEA"
                      maxlength="4"
                      @input="leg.origin = leg.origin.toUpperCase()"
                    />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Destination</label>
                    <input
                      v-model="leg.destination"
                      class="form-input"
                      placeholder="e.g. BOS"
                      maxlength="4"
                      @input="leg.destination = leg.destination.toUpperCase()"
                    />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Flight number</label>
                    <input v-model="leg.flight" class="form-input" placeholder="e.g. AA 413" @blur="lookupLeg(leg)" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Date</label>
                    <input v-model="leg.date" type="date" class="form-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Departs</label>
                    <input v-model="leg.depart" type="time" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Arrives</label>
                    <input v-model="leg.arrive" type="time" class="form-input" />
                  </div>
                </div>
                <div v-if="leg.looking" class="lookup-status lookup-status--loading">
                  <div class="spinner spinner--sm"></div> Looking up schedule…
                </div>
                <div v-else-if="leg.lookupMsg" class="lookup-status" :class="leg.lookupMsg.type === 'success' ? 'lookup-status--success' : 'lookup-status--error'">
                  {{ leg.lookupMsg.text }}
                </div>
              </div>
              <button type="button" class="btn-add-leg" @click="addDepLeg">+ Add connecting flight</button>
            </div>
          </div>
          </div> <!-- end flight-sections-row -->

          <div v-if="submitError" class="form-error">{{ submitError }}</div>
          <div v-if="successMsg" class="form-success">{{ successMsg }}</div>

          <div class="form-actions">
            <button class="btn-cancel" type="button" @click="activeTab = 'table'">Cancel</button>
            <button class="btn-save" type="button" :disabled="submitting" @click="handleSubmit">
              {{ submitting ? 'Saving…' : 'Save flight info →' }}
            </button>
          </div>
        </div>
      </div>

    </main>
  </div>
</template>

<style scoped>
/* ── Page shell ── */
.page {
  min-height: 100vh;
  font-family: var(--font-sans);
  display: flex;
  flex-direction: column;
}

.page-main {
  max-width: var(--page-shell-max-width, 960px);
  margin: 0 auto;
  padding: 40px 24px 80px;
  width: 100%;
}

.page-header {
  margin-bottom: 28px;
}

.section-label {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--sky-label);
  margin: 0 0 8px;
}

.page-title {
  font-family: var(--font-display);
  font-size: clamp(24px, 4vw, 32px);
  color: var(--forest);
  margin: 0;
  letter-spacing: -0.4px;
}

/* ── Tabs ── */
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--parchment, #e8e0d4);
  margin-bottom: 28px;
}

.tab-btn {
  font-family: var(--font-sign);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--driftwood);
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  padding: 10px 18px;
  margin-bottom: -2px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.tab-btn:hover {
  color: var(--forest);
}

.tab-btn.active {
  color: var(--forest);
  border-bottom-color: var(--forest);
}

/* ── States ── */
.state-msg {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--driftwood);
  padding: 48px 0;
  justify-content: center;
}

.state-msg.error {
  color: var(--red-error, #b94a3c);
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--parchment);
  border-top-color: var(--forest);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }

.empty-state {
  font-family: var(--font-playfair);
  font-size: 15px;
  font-style: italic;
  color: var(--driftwood);
  text-align: center;
  padding: 52px 24px;
}

/* ── Arc Map ── */
.map-card {
  background: #161d1a;
  border-radius: 8px;
  overflow: hidden;
}

.map-pan-btns {
  display: flex;
  gap: 8px;
  padding: 8px 12px 4px;
}

.pan-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  color: rgba(255, 255, 255, 0.7);
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.pan-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.arc-map {
  display: block;
  width: 100%;
  height: auto;
}

.land-country {
  fill: #1a2820;
  stroke: #3a5540;
  stroke-width: 0.5;
  stroke-linejoin: round;
}

.us-state {
  fill: #1d2e22;
  stroke: #4a6b50;
  stroke-width: 0.7;
  stroke-linejoin: round;
}

.map-label {
  fill: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  font-family: var(--font-sans, sans-serif);
}

.map-label--sea {
  font-size: 13px;
  font-weight: 700;
  fill: white;
}

.map-empty {
  fill: #4a5a50;
  font-size: 14px;
  font-family: var(--font-sans, sans-serif);
}

@keyframes march-in {
  to { stroke-dashoffset: -24; }
}

@keyframes march-out {
  to { stroke-dashoffset: 24; }
}

.arc-arriving {
  animation: march-in 1.4s linear infinite;
}

.arc-departing {
  animation: march-out 1.4s linear infinite;
}

.map-legend {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  padding: 14px 20px;
  border-top: 1px solid #2a3530;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

/* ── Direction badges ── */
.dir-badge {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 3px;
  white-space: nowrap;
}

.dir-badge--arriving {
  background: rgba(93, 171, 108, 0.15);
  color: #3d8a4e;
}

.dir-badge--departing {
  background: rgba(192, 97, 74, 0.12);
  color: #a0513f;
}

/* ── Timeline ── */
.timeline {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.timeline-date-header {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sky-label);
  margin-bottom: 12px;
}

.timeline-flights {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.timeline-card {
  display: flex;
  background: var(--bg-white, white);
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.07);
  overflow: hidden;
}

.timeline-card-accent {
  width: 4px;
  flex-shrink: 0;
}

.timeline-card--arriving .timeline-card-accent {
  background: var(--green-primary);
}

.timeline-card--departing .timeline-card-accent {
  background: var(--terracotta);
}

.timeline-card-body {
  padding: 14px 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.timeline-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.timeline-family {
  font-family: var(--font-sign);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--forest);
}

.timeline-route {
  font-family: var(--font-display);
  font-size: 17px;
  color: var(--forest);
  letter-spacing: -0.2px;
}

.timeline-meta {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--driftwood);
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-sep {
  opacity: 0.4;
}

/* ── Table ── */
.table-wrap {
  overflow-x: auto;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
}

.flights-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-sans);
  font-size: 14px;
  background: var(--bg-white, white);
}

.flights-table th {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sky-label);
  padding: 12px 16px;
  text-align: left;
  border-bottom: 2px solid var(--parchment, #e8e0d4);
  white-space: nowrap;
}

.flights-table td {
  padding: 13px 16px;
  border-bottom: 1px solid var(--parchment, #e8e0d4);
  color: var(--forest);
  vertical-align: middle;
}

.flights-table tbody tr:last-child td {
  border-bottom: none;
}

.flights-table tbody tr:hover td {
  background: rgba(0, 0, 0, 0.015);
}

.route-cell {
  font-family: var(--font-display);
  font-size: 15px;
  white-space: nowrap;
}

.time-cell {
  white-space: nowrap;
  color: var(--driftwood);
}

/* ── Add Flight Form ── */
.add-form {
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.trip-type-group {
  display: flex;
  border: 1px solid var(--driftwood);
  border-radius: 4px;
  overflow: hidden;
  width: fit-content;
}

.trip-type-btn {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--driftwood);
  background: var(--parchment);
  border: none;
  border-right: 1px solid var(--driftwood);
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.trip-type-btn:last-child {
  border-right: none;
}

.trip-type-btn:hover:not(.active) {
  background: var(--parchment);
  color: var(--forest);
}

.trip-type-btn.active {
  background: var(--forest);
  color: white;
}

.flight-sections-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}

.flight-sections-row--single {
  grid-template-columns: 1fr;
  max-width: 480px;
}

.flight-section {
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.07);
}

.flight-section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 18px;
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.flight-section--arriving .flight-section-header {
  background: rgba(93, 171, 108, 0.12);
  color: #3d8a4e;
  border-bottom: 1px solid rgba(93, 171, 108, 0.2);
}

.flight-section--departing .flight-section-header {
  background: rgba(192, 97, 74, 0.1);
  color: #a0513f;
  border-bottom: 1px solid rgba(192, 97, 74, 0.15);
}

.dir-icon {
  font-size: 14px;
}

.flight-section-body {
  background: var(--bg-white, white);
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.leg-block {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: 1px dashed var(--parchment, #e0d8cc);
}

.leg-block:last-of-type {
  padding-bottom: 0;
  border-bottom: none;
}

.leg-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.leg-label {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sky-label);
}

.btn-remove-leg {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--red-error, #b94a3c);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.btn-add-leg {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--forest);
  background: none;
  border: 1px dashed var(--driftwood);
  border-radius: 4px;
  padding: 9px 14px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  align-self: flex-start;
}

.btn-add-leg:hover {
  border-color: var(--forest);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-label {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sky-label);
}

.form-input,
.form-select {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--forest);
  background: var(--parchment);
  border: 1px solid var(--driftwood);
  border-radius: 4px;
  padding: 9px 12px;
  transition: border-color 0.15s;
  width: 100%;
  box-sizing: border-box;
  appearance: none;
}

.form-select {
  padding-right: 28px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238a7a5e' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  cursor: pointer;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--terracotta);
}

.form-input[type="date"],
.form-input[type="time"] {
  color-scheme: light;
}

.lookup-status {
  font-family: var(--font-sans);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 4px;
}

.lookup-status--loading {
  color: var(--driftwood);
  background: rgba(0, 0, 0, 0.04);
}

.lookup-status--success {
  color: #3d8a4e;
  background: rgba(93, 171, 108, 0.1);
}

.lookup-status--error {
  color: var(--red-error, #b94a3c);
  background: rgba(185, 74, 60, 0.07);
}

.spinner--sm {
  width: 12px;
  height: 12px;
  border-width: 1.5px;
}

.form-error {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--red-error, #b94a3c);
  background: rgba(185, 74, 60, 0.07);
  border-radius: 4px;
  padding: 10px 14px;
}

.form-success {
  font-family: var(--font-sans);
  font-size: 13px;
  color: #3d8a4e;
  background: rgba(93, 171, 108, 0.1);
  border-radius: 4px;
  padding: 10px 14px;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn-cancel {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--driftwood);
  background: none;
  border: 1px solid var(--parchment, #e0d8cc);
  border-radius: 4px;
  padding: 10px 20px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.btn-cancel:hover {
  border-color: var(--driftwood);
  color: var(--forest);
}

.btn-save {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: white;
  background: var(--forest);
  border: none;
  border-radius: 4px;
  padding: 10px 24px;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.btn-save:hover:not(:disabled) {
  background: var(--deep-sky, #2a6b8a);
}

.btn-save:disabled {
  opacity: 0.55;
  cursor: default;
}

/* ── Responsive ── */
@media (max-width: 600px) {
  .page-main {
    padding: 28px 16px 64px;
  }

  .tab-btn {
    font-size: 11px;
    padding: 10px 12px;
  }

  .flight-sections-row {
    grid-template-columns: 1fr;
  }

  .form-row {
    grid-template-columns: 1fr;
  }

  .form-actions {
    flex-direction: column;
  }

  .btn-cancel,
  .btn-save {
    width: 100%;
    text-align: center;
  }

  .map-legend {
    gap: 14px;
  }
}
</style>
