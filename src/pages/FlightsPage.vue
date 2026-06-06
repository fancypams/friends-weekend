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
  PDX: { lat: 45.59, lon: -122.60, city: 'Portland' },
  GEG: { lat: 47.62, lon: -117.53, city: 'Spokane' },
  BOI: { lat: 43.56, lon: -116.22, city: 'Boise' },
  RNO: { lat: 39.50, lon: -119.77, city: 'Reno' },
  YVR: { lat: 49.19, lon: -123.18, city: 'Vancouver' },
}

// ── SVG map projection ──
const SVG_W = 800
const SVG_H = 460
const MAP_BOUNDS = { minLon: -128, maxLon: -62, minLat: 23, maxLat: 51 }

function project(lon, lat) {
  const { minLon, maxLon, minLat, maxLat } = MAP_BOUNDS
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return null
  return {
    x: ((lon - minLon) / (maxLon - minLon)) * SVG_W,
    y: SVG_H - ((lat - minLat) / (maxLat - minLat)) * SVG_H,
  }
}

function buildArc(homeCode, isArriving) {
  const home = AIRPORTS[homeCode?.toUpperCase()]
  if (!home) return null
  const sea = AIRPORTS.SEA
  const from = isArriving ? project(home.lon, home.lat) : project(sea.lon, sea.lat)
  const to = isArriving ? project(sea.lon, sea.lat) : project(home.lon, home.lat)
  if (!from || !to) return null

  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2)
  // Arriving arcs bow north (lower y), departing bow south (higher y)
  const cy = my - (isArriving ? 1 : -1) * dist * 0.28

  return {
    path: `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${mx.toFixed(1)} ${cy.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
    homePos: isArriving ? from : to,
    city: home.city,
    code: homeCode.toUpperCase(),
    isArriving,
  }
}

const seaPos = computed(() => project(AIRPORTS.SEA.lon, AIRPORTS.SEA.lat))

// ── US map background ──
const usPaths = ref([])

async function loadUsMap() {
  try {
    // world-atlas@2 uses geographic lon/lat coordinates (WGS 84)
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

    function ringToPath(ring) {
      const allPts = []
      for (let i = 0; i < ring.length; i++) {
        const decoded = decodeArc(ring[i])
        allPts.push(...(i === 0 ? decoded : decoded.slice(1)))
      }
      const svgPts = allPts
        .map(([lon, lat]) => {
          const p = project(lon, lat)
          return p ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : null
        })
        .filter(Boolean)
      return svgPts.length >= 3 ? `M ${svgPts.join(' L ')} Z` : ''
    }

    // US is numeric id 840 in the countries dataset
    const usGeom = topo.objects.countries.geometries.find(
      (g) => String(g.id) === '840'
    )
    if (!usGeom) throw new Error('US geometry not found')

    const polygons = usGeom.type === 'Polygon' ? [usGeom.arcs] : usGeom.arcs
    const paths = []
    polygons.forEach((rings) => {
      const d = rings.map(ringToPath).filter(Boolean).join(' ')
      if (d) paths.push(d)
    })

    usPaths.value = paths
    console.log(`[FlightsPage] US map loaded: ${paths.length} paths`)
  } catch (err) {
    console.warn('[FlightsPage] US map failed:', err.message)
  }
}

const mapArcs = computed(() => {
  const seen = new Set()
  return flights.value.reduce((arcs, f) => {
    const arriving = f.direction.toLowerCase().includes('arriv')
    const key = `${f.homeAirport}-${arriving ? 'in' : 'out'}`
    if (seen.has(key)) return arcs
    seen.add(key)
    const arc = buildArc(f.homeAirport, arriving)
    if (arc) arcs.push(arc)
    return arcs
  }, [])
})

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
  return isArriving(f) ? `${f.homeAirport} → SEA` : `SEA → ${f.homeAirport}`
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
        return {
          family: cellStr(row, 0),
          direction: cellStr(row, 1),
          homeAirport: cellStr(row, 2).toUpperCase(),
          flightNumber: cellStr(row, 3),
          date: dateParsed.display,
          dateSort: dateParsed.sort,
          departureTime: departParsed.display,
          departSort: departParsed.sort,
          arrivalTime: arriveParsed.display,
        }
      })
      .filter((r) => r.family && r.direction && r.homeAirport)
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

const formFamily = ref('')
const homeAirport = ref('')
const arrFlight = ref('')
const arrDate = ref('')
const arrDepart = ref('')
const arrArrive = ref('')
const depFlight = ref('')
const depDate = ref('')
const depDepart = ref('')
const depArrive = ref('')

const submitting = ref(false)
const submitError = ref(null)
const successMsg = ref(null)

const arrLooking = ref(false)
const depLooking = ref(false)
const arrLookupMsg = ref(null)
const depLookupMsg = ref(null)

async function lookupFlight(flightNum, lookingRef, dateRef, departRef, arriveRef, msgRef) {
  const num = flightNum.trim()
  if (!num) return

  lookingRef.value = true
  msgRef.value = null

  try {
    const headers = await getAuthHeaders()
    const res = await fetch(supabaseFunctionUrl('lookup-flight'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ flightNumber: num }),
    })

    const body = await res.json()

    if (!res.ok) {
      msgRef.value = { type: 'error', text: body.error || 'Flight not found' }
      return
    }

    const first = body.results?.[0]
    if (!first) {
      msgRef.value = { type: 'error', text: 'No schedule found' }
      return
    }

    dateRef.value = first.date
    departRef.value = first.departureTime
    arriveRef.value = first.arrivalTime
    msgRef.value = { type: 'success', text: 'Times auto-filled from schedule' }
  } catch {
    msgRef.value = { type: 'error', text: 'Could not look up flight' }
  } finally {
    lookingRef.value = false
  }
}

function lookupArrFlight() {
  lookupFlight(arrFlight.value, arrLooking, arrDate, arrDepart, arrArrive, arrLookupMsg)
}

function lookupDepFlight() {
  lookupFlight(depFlight.value, depLooking, depDate, depDepart, depArrive, depLookupMsg)
}

function resetForm() {
  formFamily.value = ''
  homeAirport.value = ''
  arrFlight.value = ''
  arrDate.value = ''
  arrDepart.value = ''
  arrArrive.value = ''
  depFlight.value = ''
  depDate.value = ''
  depDepart.value = ''
  depArrive.value = ''
}

async function handleSubmit() {
  submitError.value = null
  successMsg.value = null

  if (!formFamily.value) { submitError.value = 'Please select your family'; return }
  const airport = homeAirport.value.trim().toUpperCase()
  if (!airport) { submitError.value = 'Home airport is required'; return }
  if (!arrFlight.value.trim()) { submitError.value = 'Arriving flight number is required'; return }
  if (!arrDate.value) { submitError.value = 'Arriving date is required'; return }
  if (!arrDepart.value) { submitError.value = 'Arriving departure time is required'; return }
  if (!arrArrive.value) { submitError.value = 'Arriving arrival time is required'; return }
  if (!depFlight.value.trim()) { submitError.value = 'Departing flight number is required'; return }
  if (!depDate.value) { submitError.value = 'Departing date is required'; return }
  if (!depDepart.value) { submitError.value = 'Departing departure time is required'; return }
  if (!depArrive.value) { submitError.value = 'Departing arrival time is required'; return }

  submitting.value = true

  try {
    const headers = await getAuthHeaders()
    const res = await fetch(supabaseFunctionUrl('append-flight'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        family: formFamily.value,
        homeAirport: airport,
        arriving: {
          flight: arrFlight.value.trim().toUpperCase(),
          date: arrDate.value,
          departTime: arrDepart.value,
          arriveTime: arrArrive.value,
        },
        departing: {
          flight: depFlight.value.trim().toUpperCase(),
          date: depDate.value,
          departTime: depDepart.value,
          arriveTime: depArrive.value,
        },
      }),
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
  loadUsMap()
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
          <svg
            :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
            class="arc-map"
            aria-label="Flight arc map"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2a3530" stroke-width="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#161d1a" />
            <rect width="100%" height="100%" fill="url(#grid)" />

            <!-- US state outlines -->
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

            <!-- Home airport dots + labels -->
            <g v-for="(arc, i) in mapArcs" :key="`dot-${i}`">
              <circle
                v-if="arc.homePos"
                :cx="arc.homePos.x"
                :cy="arc.homePos.y"
                r="4.5"
                :fill="arc.isArriving ? '#5dab6c' : '#c0614a'"
              />
              <text
                v-if="arc.homePos"
                :x="arc.homePos.x + 9"
                :y="arc.homePos.y + 4"
                class="map-label"
              >{{ arc.city }}</text>
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
              Arriving in Seattle
            </span>
            <span class="legend-item">
              <svg width="24" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="24" y2="4" stroke="#c0614a" stroke-width="2" stroke-dasharray="6 3" />
              </svg>
              Departing Seattle
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

          <!-- Arriving + Departing side by side on desktop -->
          <div class="flight-sections-row">
          <!-- Arriving section -->
          <div class="flight-section flight-section--arriving">
            <div class="flight-section-header">
              <span class="dir-icon">↓</span>
              Arriving in Seattle
            </div>
            <div class="flight-section-body">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Home airport</label>
                  <input
                    v-model="homeAirport"
                    class="form-input"
                    placeholder="e.g. BOS"
                    maxlength="4"
                    @input="homeAirport = homeAirport.toUpperCase()"
                  />
                </div>
                <div class="form-group">
                  <label class="form-label">Destination</label>
                  <div class="form-static">SEA</div>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Flight number</label>
                  <input v-model="arrFlight" class="form-input" placeholder="e.g. AA 412" @blur="lookupArrFlight" />
                </div>
                <div class="form-group">
                  <label class="form-label">Date</label>
                  <input v-model="arrDate" type="date" class="form-input" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Departs</label>
                  <input v-model="arrDepart" type="time" class="form-input" />
                </div>
                <div class="form-group">
                  <label class="form-label">Arrives in SEA</label>
                  <input v-model="arrArrive" type="time" class="form-input" />
                </div>
              </div>
              <div v-if="arrLooking" class="lookup-status lookup-status--loading">
                <div class="spinner spinner--sm"></div> Looking up schedule…
              </div>
              <div v-else-if="arrLookupMsg" class="lookup-status" :class="arrLookupMsg.type === 'success' ? 'lookup-status--success' : 'lookup-status--error'">
                {{ arrLookupMsg.text }}
              </div>
            </div>
          </div>

          <!-- Departing section -->
          <div class="flight-section flight-section--departing">
            <div class="flight-section-header">
              <span class="dir-icon">↑</span>
              Departing Seattle
            </div>
            <div class="flight-section-body">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Origin</label>
                  <div class="form-static">SEA</div>
                </div>
                <div class="form-group">
                  <label class="form-label">Home airport</label>
                  <div class="form-static" :class="{ 'form-static--placeholder': !homeAirport }">
                    {{ homeAirport || 'Auto-filled above' }}
                  </div>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Flight number</label>
                  <input v-model="depFlight" class="form-input" placeholder="e.g. AA 413" @blur="lookupDepFlight" />
                </div>
                <div class="form-group">
                  <label class="form-label">Date</label>
                  <input v-model="depDate" type="date" class="form-input" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Departs SEA</label>
                  <input v-model="depDepart" type="time" class="form-input" />
                </div>
                <div class="form-group">
                  <label class="form-label">Arrives home</label>
                  <input v-model="depArrive" type="time" class="form-input" />
                </div>
              </div>
              <div v-if="depLooking" class="lookup-status lookup-status--loading">
                <div class="spinner spinner--sm"></div> Looking up schedule…
              </div>
              <div v-else-if="depLookupMsg" class="lookup-status" :class="depLookupMsg.type === 'success' ? 'lookup-status--success' : 'lookup-status--error'">
                {{ depLookupMsg.text }}
              </div>
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

.arc-map {
  display: block;
  width: 100%;
  height: auto;
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

.flight-sections-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
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

.form-static {
  font-family: var(--font-sign);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--forest);
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid var(--parchment, #e0d8cc);
  border-radius: 4px;
  padding: 9px 12px;
}

.form-static--placeholder {
  color: var(--driftwood);
  font-weight: 400;
  font-family: var(--font-sans);
  font-size: 13px;
  font-style: italic;
  letter-spacing: 0;
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
