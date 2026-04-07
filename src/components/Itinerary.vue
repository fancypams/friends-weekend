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
        <nav class="day-nav">
          <button
            v-for="(day, i) in days"
            :key="i"
            :class="['day-btn', { active: activeDay === i }]"
            @click="activeDay = i"
          >
            <span class="day-label">{{ day.label }}</span>
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
            <div class="time-col">
              <span class="time-label">{{ item.time }}</span>
            </div>
            <div class="connector">
              <div class="dot" />
              <div v-if="i < days[activeDay].activities.length - 1" class="line" />
            </div>
            <div class="activity-card">
              <a
                :href="mapsUrl(item.activity)"
                target="_blank"
                rel="noopener noreferrer"
                class="activity-name"
              >
                {{ item.activity }}
                <svg class="pin-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                </svg>
              </a>
              <p v-if="item.notes" class="activity-notes">{{ item.notes }}</p>
            </div>
          </div>
        </section>
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
  max-width: 680px;
  margin: 0 auto;
  padding: 70px 20px 60px;
}

/* ── Day Nav ── */
.day-nav {
  display: flex;
  gap: 8px;
  padding: 24px 0 32px;
  overflow-x: auto;
  scrollbar-width: none;
}
.day-nav::-webkit-scrollbar { display: none; }

.day-btn {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 14px;
  border: 1.5px solid var(--forest);
  border-bottom: 4px solid var(--forest);
  border-radius: 0;
  background: var(--parchment);
  color: var(--forest);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  min-width: 86px;
}
.day-btn:hover { border-bottom-color: var(--gold); }
.day-btn.active {
  background: var(--forest);
  border-color: var(--forest);
  border-bottom-color: var(--gold);
  color: var(--bg-white);
}
.day-label {
  font-size: 13px;
  font-weight: 600;
}
.day-date {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 2px;
}

/* ── Timeline ── */
.timeline {
  display: flex;
  flex-direction: column;
}

.timeline-row {
  display: grid;
  grid-template-columns: 72px 28px 1fr;
  align-items: flex-start;
}

.time-col {
  padding-top: 16px;
  text-align: right;
  padding-right: 6px;
}
.time-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--green-muted);
  white-space: nowrap;
  letter-spacing: 0.2px;
}

.connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 20px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--terracotta);
  border: 2px solid var(--forest);
  flex-shrink: 0;
}
.line {
  width: 2px;
  background: var(--green-border);
  flex: 1;
  min-height: 20px;
  margin-top: 4px;
}

.activity-card {
  background: var(--bg-white);
  border: 1px solid var(--green-border);
  border-radius: 0;
  padding: 12px 16px;
  margin: 6px 0 14px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.activity-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 15px;
  font-weight: 600;
  color: var(--green-primary);
  text-decoration: none;
  line-height: 1.3;
}
.activity-name:hover {
  color: var(--red-accent);
  text-decoration: underline;
}
.pin-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  opacity: 0.65;
}

.activity-notes {
  margin: 5px 0 0;
  font-size: 13px;
  color: var(--green-muted);
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

@media (max-width: 480px) {
  .timeline-row { grid-template-columns: 60px 24px 1fr; }
  .time-label { font-size: 10px; }
}
</style>
