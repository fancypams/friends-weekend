<script setup>
import { ref, onMounted } from 'vue'
import HeroHeader from './HeroHeader.vue'

const SHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Itinerary'

// Actual column indices (0-based) from the spreadsheet:
// 0: time  |  4-5: Thu  |  6-7: Fri  |  8-9: Sat
// 10-11: Sun  |  12-13: Mon  |  14-15: Tue  |  16-17: Wed
const DAY_COLS = [
  { actCol: 6, notesCol: 7 },   // Friday
  { actCol: 8, notesCol: 9 },   // Saturday
  { actCol: 10, notesCol: 11 }, // Sunday
  { actCol: 12, notesCol: 13 }, // Monday
  { actCol: 14, notesCol: 15 }, // Tuesday
]

const loading = ref(true)
const errorMsg = ref(null)
const activeDay = ref(0)

const days = ref([
  { label: 'Friday', date: 'July 31', activities: [] },
  { label: 'Saturday', date: 'Aug 1', activities: [] },
  { label: 'Sunday', date: 'Aug 2', activities: [] },
  { label: 'Monday', date: 'Aug 3', activities: [] },
  { label: 'Tuesday', date: 'Aug 4', activities: [] },
])

// Convert GViz Date string "Date(1899,11,30,H,M,S)" → "8:00 AM"
function parseTime(v) {
  const m = String(v).match(/Date\(\d+,\d+,\d+,(\d+),(\d+)/)
  if (!m) return null
  const h = parseInt(m[1])
  const min = parseInt(m[2])
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${min.toString().padStart(2, '0')} ${period}`
}

function cellStr(row, index) {
  const cell = row.c[index]
  if (!cell || cell.v == null) return ''
  return String(cell.v).trim()
}

function mapsUrl(activity) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity + ', Seattle')}`
}

onMounted(async () => {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=0&sheet=${encodeURIComponent(SHEET_NAME)}`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()

    const match = text.match(/google\.visualization\.Query\.setResponse\((.+)\)/)
    if (!match) throw new Error('Unexpected response format')

    const data = JSON.parse(match[1])
    if (data.status === 'error') {
      throw new Error(data.errors?.[0]?.message ?? 'Spreadsheet error')
    }

    // Rows 0-1 are headers (day names + Activity/Notes labels); data starts at row 2
    const dataRows = data.table.rows.slice(2)

    dataRows.forEach((row) => {
      const time = parseTime(row.c[0]?.v)
      if (!time) return

      DAY_COLS.forEach(({ actCol, notesCol }, i) => {
        const activity = cellStr(row, actCol)
        if (!activity) return
        days.value[i].activities.push({ time, activity, notes: cellStr(row, notesCol) })
      })
    })
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

    <main class="itinerary-body">
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
              :key="i"
              :class="['day-btn', { active: activeDay === i }]"
              @click="activeDay = i"
            >
              {{ day.label }}
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
  background: var(--bg-page);
  font-family: var(--font-sans);
  color: var(--green-darkest);
}

/* ── Body ── */
.itinerary-body {
  max-width: 100%;
  margin: 15px auto;
  padding: 60px 100px 80px;
}

/* ── Two-column layout ── */
.itinerary-layout {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0 48px;
  align-items: start;
}

/* ── Left Day Nav ── */
.day-nav {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
  padding-top: 8px;
  position: sticky;
  top: 80px;
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
  width: calc(48px + 4px);
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
  min-height: 200px;
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
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
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
  padding: 40px 0;
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
    padding: 0 10px 60px;
  }
.itinerary-layout {
    grid-template-columns: 90px 1fr;
    gap: 0 24px;
  }
  .day-btn {
    font-size: 12px;
    padding: 12px 0;
  }
}
</style>
