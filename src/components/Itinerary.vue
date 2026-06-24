<script setup>
import { ref, onMounted } from 'vue'
import HeroHeader from './HeroHeader.vue'

const SHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME_ITINERARY = 'Itinerary'
const SHEET_NAME_FLIGHTS = 'Flight Info'
// Column indices (0-based) for the core trip days in the Itinerary sheet
// Col 0 = time | cols 6-7 = Fri Jul 31 | 8-9 = Sat | 10-11 = Sun | 12-13 = Mon | 14-15 = Tue
const DAY_COLS = [
  { actCol: 6,  notesCol: 7,  isoDate: '2026-07-30', label: 'Thursday',  date: 'July 30' },
  { actCol: 8,  notesCol: 9,  isoDate: '2026-07-31', label: 'Friday',    date: 'July 31' },
  { actCol: 10, notesCol: 11, isoDate: '2026-08-01', label: 'Saturday',  date: 'Aug 1'   },
  { actCol: 12, notesCol: 13, isoDate: '2026-08-02', label: 'Sunday',    date: 'Aug 2'   },
  { actCol: 14, notesCol: 15, isoDate: '2026-08-03', label: 'Monday',    date: 'Aug 3'   },
  { actCol: 16, notesCol: 17, isoDate: '2026-08-04', label: 'Tuesday',   date: 'Aug 4'   },
  { actCol: 18, notesCol: 19, isoDate: '2026-08-05', label: 'Wednesday', date: 'Aug 5'   },
  { actCol: 20, notesCol: 21, isoDate: '2026-08-06', label: 'Thursday',  date: 'Aug 6'   },
  { actCol: 22, notesCol: 23, isoDate: '2026-08-07', label: 'Friday',    date: 'Aug 7'   },
  { actCol: 24, notesCol: 25, isoDate: '2026-08-08', label: 'Saturday',  date: 'Aug 8'   },
]

const loading = ref(true)
const errorMsg = ref(null)
const activeDay = ref(0)
const days = ref([])

// ── Time helpers ──
function parseItineraryTime(v) {
  // GViz time: "Date(1899,11,30,H,M,S)" → "8:00 AM"
  const m = String(v).match(/Date\(\d+,\d+,\d+,(\d+),(\d+)/)
  if (!m) return null
  const h = parseInt(m[1])
  const min = parseInt(m[2])
  return {
    display: `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`,
    sort: h * 60 + min,
  }
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 9999
  const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return 9999
  let h = parseInt(m[1])
  const min = parseInt(m[2])
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
  return h * 60 + min
}

// ── GViz cell parser for Flight Info sheet ──
function parseGvizCell(v) {
  const s = String(v)
  if (!s.startsWith('Date(')) return { display: s.trim(), sort: s.trim() }
  const m = s.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+))?/)
  if (!m) return { display: s, sort: s }
  const year = parseInt(m[1])
  if (year === 1899 && m[4] !== undefined) {
    const h = parseInt(m[4])
    const min = parseInt(m[5])
    return {
      display: `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`,
      sort: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    }
  }
  const month = parseInt(m[2])
  const day = parseInt(m[3])
  return {
    display: new Date(year, month, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    sort: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

function flightCellStr(row, col) {
  const c = row?.c?.[col]
  if (!c || c.v == null) return ''
  return parseGvizCell(c.v).display
}

function cellStr(row, index) {
  const cell = row.c[index]
  if (!cell || cell.v == null) return ''
  return String(cell.v).trim()
}

function mapsUrl(activity) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity + ', Seattle')}`
}

function isoToLabel(isoDate) {
  return new Date(isoDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
}

function isoToDateDisplay(isoDate) {
  return new Date(isoDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

onMounted(async () => {
  const itineraryUrl =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json&headers=0&sheet=${encodeURIComponent(SHEET_NAME_ITINERARY)}`
  const flightsUrl =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json&headers=1&sheet=${encodeURIComponent(SHEET_NAME_FLIGHTS)}`

  try {
    const [itinRes, flightRes] = await Promise.all([fetch(itineraryUrl), fetch(flightsUrl)])
    if (!itinRes.ok) throw new Error(`Itinerary HTTP ${itinRes.ok}`)
    if (!flightRes.ok) throw new Error(`Flights HTTP ${flightRes.status}`)

    const [itinText, flightText] = await Promise.all([itinRes.text(), flightRes.text()])

    // ── Parse itinerary ──
    const itinMatch = itinText.match(/google\.visualization\.Query\.setResponse\((.+)\)/)
    if (!itinMatch) throw new Error('Unexpected itinerary response format')
    const itinData = JSON.parse(itinMatch[1])
    if (itinData.status === 'error') throw new Error(itinData.errors?.[0]?.message ?? 'Itinerary error')

    // Build day map keyed by isoDate so we can merge flights in
    const dayMap = new Map()
    DAY_COLS.forEach(({ isoDate, label, date }) => {
      dayMap.set(isoDate, { label, date, isoDate, activities: [] })
    })

    // Rows 0-1 are headers; data starts at row 2
    itinData.table.rows.slice(2).forEach((row) => {
      const parsed = parseItineraryTime(row.c[0]?.v)
      if (!parsed) return
      DAY_COLS.forEach(({ actCol, notesCol, isoDate }) => {
        const activity = cellStr(row, actCol)
        if (!activity) return
        dayMap.get(isoDate).activities.push({
          type: 'activity',
          time: parsed.display,
          timeSort: parsed.sort,
          activity,
          notes: cellStr(row, notesCol),
        })
      })
    })

    // ── Parse flights ──
    const flightMatch = flightText.match(/google\.visualization\.Query\.setResponse\((\{.+\})\)/)
    if (flightMatch) {
      const flightData = JSON.parse(flightMatch[1])
      if (flightData.status !== 'error') {
        const flightRows = flightData.table.rows ?? []
        flightRows.forEach((row) => {
          const family = flightCellStr(row, 0)
          const direction = flightCellStr(row, 1)
          const flightNumber = flightCellStr(row, 3)
          const origin = flightCellStr(row, 7).toUpperCase()
          const destination = flightCellStr(row, 8).toUpperCase()
          if (!family || !direction || !origin || !destination) return
          if (origin !== 'SEA' && destination !== 'SEA') return

          const dateCell = row?.c?.[4]
          const departCell = row?.c?.[5]
          const arriveCell = row?.c?.[6]
          if (!dateCell?.v) return

          const dateParsed = parseGvizCell(dateCell.v)
          const isoDate = dateParsed.sort // "2026-07-31"
          if (!isoDate.match(/^\d{4}-\d{2}-\d{2}$/)) return

          const isArriving = direction.toLowerCase().includes('arriv')
          // Use arrival time for arriving flights (when they land), depart time for departing
          const timeCell = isArriving ? arriveCell : departCell
          const timeParsed = timeCell?.v != null ? parseGvizCell(timeCell.v) : { display: '', sort: '00:00' }
          const route = `${origin} → ${destination}`

          const flightItem = {
            type: 'flight',
            time: timeParsed.display,
            timeSort: timeToMinutes(timeParsed.display),
            family,
            direction: isArriving ? 'Arriving' : 'Departing',
            route,
            flightNumber,
          }

          // Find or create the day for this flight's date
          if (!dayMap.has(isoDate)) {
            dayMap.set(isoDate, {
              label: isoToLabel(isoDate),
              date: isoToDateDisplay(isoDate),
              isoDate,
              activities: [],
            })
          }
          dayMap.get(isoDate).activities.push(flightItem)
        })
      }
    }

    // ── Sort each day's items by time, then sort days by date ──
    const sorted = [...dayMap.values()]
      .map((day) => ({
        ...day,
        activities: [...day.activities].sort((a, b) => a.timeSort - b.timeSort),
      }))
      .sort((a, b) => a.isoDate.localeCompare(b.isoDate))

    days.value = sorted
  } catch (err) {
    errorMsg.value = `Could not load itinerary: ${err.message}`
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="itinerary-page">
    <HeroHeader show-back />

    <main class="itinerary-body page-main">
      <div v-if="loading" class="state-msg">
        <div class="spinner" />
        Loading itinerary…
      </div>

      <div v-else-if="errorMsg" class="state-msg error">
        {{ errorMsg }}
      </div>

      <template v-else>
        <div class="itinerary-layout">
          <nav class="day-nav">
            <button
              v-for="(day, i) in days"
              :key="day.isoDate"
              :class="['day-btn', { active: activeDay === i }]"
              @click="activeDay = i"
            >
              {{ day.label }}
              <span class="day-date">{{ day.date }}</span>
            </button>
          </nav>

          <section class="timeline">
            <div v-if="days[activeDay].activities.length === 0" class="empty-day">
              No activities planned yet — check back soon!
            </div>

            <div
              v-for="(item, i) in days[activeDay].activities"
              :key="i"
              class="timeline-row"
            >
              <!-- Flight item -->
              <template v-if="item.type === 'flight'">
                <div class="connector">
                  <div class="dot" />
                </div>
                <div class="flight-card">
                  <span class="time-label">{{ item.time }}</span>
                  <div class="flight-card-main">
                    <span class="flight-icon">✈</span>
                    <span class="flight-family">{{ item.family }}</span>
                    <span class="flight-dir-badge" :class="item.direction === 'Arriving' ? 'badge--arriving' : 'badge--departing'">
                      {{ item.direction }}
                    </span>
                  </div>
                  <p class="flight-meta">{{ item.route }} · {{ item.flightNumber }}</p>
                </div>
              </template>

              <!-- Regular activity item -->
              <template v-else>
                <div class="connector">
                  <div class="dot" />
                </div>
                <div class="activity-card">
                  <span class="time-label">{{ item.time }}</span>
                  <a
                    :href="mapsUrl(item.activity)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="activity-name"
                  >
                    {{ item.activity }}
                  </a>
                  <p v-if="item.notes" class="activity-notes">{{ item.notes }}</p>
                </div>
              </template>
            </div>
          </section>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.itinerary-page {
  min-height: 100vh;
  background: transparent;
  font-family: var(--font-sans);
  color: var(--green-darkest);
}

.itinerary-body {
  padding-bottom: 80px;
}

/* ── Two-column layout ── */
.itinerary-layout {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0 5px;
  align-items: start;
}

/* ── Left Day Nav ── */
.day-nav {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
  position: sticky;
  top: 80px;
  width: 112px;
}

.day-btn {
  display: block;
  width: 100%;
  text-align: right;
  background: none;
  border: none;
  padding: 14px 0;
  font-family: 'Montserrat', 'Impact', sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--forest);
  cursor: pointer;
  transition: color 0.15s;
  line-height: 1;
}
.day-date {
  display: block;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--driftwood);
  margin-top: 3px;
}

.day-btn:hover { color: var(--terracotta); }
.day-btn.active {
  color: var(--terracotta);
  position: relative;
}
.day-btn.active::after {
  content: '';
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 35px;
  height: 2px;
  background: var(--terracotta);
}

/* ── Timeline ── */
.timeline {
  display: flex;
  flex-direction: column;
  background: var(--bg-white);
  border-radius: 0 6px 6px 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  border-left: 4px solid var(--terracotta);
  padding: 24px 28px 8px;
  min-height: 575px;
}

.timeline-row {
  display: grid;
  grid-template-columns: 24px 1fr;
  align-items: flex-start;
}

.connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 6px;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--terracotta);
  flex-shrink: 0;
}


/* ── Activity card ── */
.activity-card {
  display: flex;
  flex-direction: column;
  padding: 0 0 28px 16px;
}

.time-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--forest);
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}

.activity-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--forest);
  text-decoration: none;
  line-height: 1.3;
}
.activity-name:hover {
  color: var(--terracotta);
  text-decoration: underline;
}

.activity-notes {
  margin: 5px 0 0;
  font-size: 13px;
  font-style: italic;
  color: var(--driftwood);
  line-height: 1.5;
  white-space: pre-line;
}

/* ── Flight card ── */
.flight-card {
  display: flex;
  flex-direction: column;
  padding: 0 0 24px 16px;
}

.flight-card-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.flight-icon {
  font-size: 15px;
  color: var(--driftwood);
  line-height: 1;
}

.flight-family {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  color: var(--forest);
  letter-spacing: 0.03em;
}

.flight-dir-badge {
  font-family: var(--font-sign);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 3px;
}

.badge--arriving {
  background: rgba(93, 171, 108, 0.15);
  color: #3d8a4e;
}

.badge--departing {
  background: rgba(192, 97, 74, 0.12);
  color: #a0513f;
}

.flight-meta {
  font-size: 12px;
  color: var(--driftwood);
  margin: 0;
  letter-spacing: 0.02em;
}

/* ── States ── */
.state-msg {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--green-muted);
  font-size: 15px;
}
.state-msg.error { color: var(--red-error); }

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--green-border);
  border-top-color: var(--green-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

.empty-day {
  padding: 0 10px;
  color: var(--green-muted);
  font-style: italic;
}

@media (max-width: 600px) {
  .timeline {
    margin-top: 15px;
    padding-left: 8px;
  }
  .day-btn.active::after {
    width: calc(20px + 4px);
  }
  .itinerary-body {
    padding-bottom: 60px;
  }
  .itinerary-layout {
    grid-template-columns: 90px 1fr;
    gap: 0 24px;
  }
  .day-btn {
    font-size: 12px;
    padding: 12px 0;
  }
  .day-nav {
    width: 90px;
    padding-top: 8px;
  }
}
</style>
