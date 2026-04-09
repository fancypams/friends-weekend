<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import HeroHeader from '../components/HeroHeader.vue'

const loading = ref(true)
const errorMsg = ref(null)
const allSightings = ref([])
const days = ref(1)
const mapEl = ref(null)

const DAY_OPTIONS = [1, 3, 5, 7, 10]

const sightings = computed(() => {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days.value)
  return allSightings.value.filter((s) => !s.created || new Date(s.created) >= cutoff)
})

let map = null
let markers = []

function sinceDate(n = 10) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function speciesEmoji(species) {
  const s = (species || '').toLowerCase()
  if (s.includes('orca') || s.includes('killer')) return '🐋'
  if (s.includes('humpback')) return '🐳'
  if (s.includes('gray') || s.includes('grey')) return '🐳'
  return '🐬'
}

function markerColor(species) {
  const s = (species || '').toLowerCase()
  if (s.includes('orca') || s.includes('killer')) return '#1a4d6e'
  if (s.includes('humpback')) return '#1a7a5e'
  if (s.includes('gray') || s.includes('grey')) return '#5a6472'
  return '#2471a3'
}

function makeIcon(species) {
  const color = markerColor(species)
  const emoji = speciesEmoji(species)
  return L.divIcon({
    className: '',
    html: `<div class="whale-marker" style="background:${color}">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -20],
  })
}

// Puget Sound / Salish Sea bounding box
const BOUNDS = { minLat: 47, maxLat: 50, minLng: -125, maxLng: -121 }

function inRegion(s) {
  const lat = parseFloat(s.latitude)
  const lng = parseFloat(s.longitude)
  return (
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= BOUNDS.minLat &&
    lat <= BOUNDS.maxLat &&
    lng >= BOUNDS.minLng &&
    lng <= BOUNDS.maxLng
  )
}

function addMarkers(data) {
  markers.forEach((m) => map.removeLayer(m))
  markers = []

  data.forEach((s) => {
    const lat = parseFloat(s.latitude)
    const lng = parseFloat(s.longitude)
    const qty = s.no_sighted > 1 ? ` <span style="color:#7a6650">(${s.no_sighted})</span>` : ''
    const comments = (s.data_source_comments || '').replace(/<[^>]+>/g, '').trim()
    const desc = comments
      ? `<br><span style="font-size:12px;color:#555">${comments}</span>`
      : ''

    const marker = L.marker([lat, lng], { icon: makeIcon(s.type) })
      .addTo(map)
      .bindPopup(
        `<strong>${s.type}</strong>${qty}<br>
         <span style="color:#aaa;font-size:11px">${formatDate(s.created)}</span>${desc}`,
        { maxWidth: 260 },
      )
    markers.push(marker)
  })

  if (data.length > 1) {
    map.fitBounds(
      data.map((s) => [parseFloat(s.latitude), parseFloat(s.longitude)]),
      { padding: [40, 40], maxZoom: 11 },
    )
  } else if (data.length === 1) {
    map.setView([parseFloat(data[0].latitude), parseFloat(data[0].longitude)], 10)
  }
}

onMounted(async () => {
  map = L.map(mapEl.value, {
    center: [48.2, -122.8],
    zoom: 8,
  })

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map)

  try {
    const res = await fetch('https://acartia.io/api/v1/sightings/current')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    // Store all region-filtered sightings; day filtering is done via computed
    const cutoff = new Date(sinceDate(10))
    allSightings.value = data
      .filter((s) => inRegion(s) && (!s.created || new Date(s.created) >= cutoff))
      .sort((a, b) => new Date(b.created) - new Date(a.created))

    addMarkers(sightings.value)
  } catch (err) {
    console.error('[WhaleSightings]', err)
    errorMsg.value = 'Could not load sightings. Try again later.'
  }

  loading.value = false
})

watch(sightings, (data) => {
  if (map) addMarkers(data)
})

onUnmounted(() => {
  if (map) map.remove()
})
</script>

<template>
  <div class="whale-page">
    <HeroHeader show-back />

    <main class="whale-body page-main">

      <div class="map-wrap">
        <div ref="mapEl" class="map-container" />
      </div>

      <div v-if="loading" class="state-msg">
        <div class="spinner" />
        Loading sightings…
      </div>

      <div v-else-if="errorMsg" class="state-msg error">
        {{ errorMsg }}
      </div>

      <template v-else>
        <div class="filter-row">
          <span class="filter-label">Last</span>
          <button
            v-for="n in DAY_OPTIONS"
            :key="n"
            class="filter-btn"
            :class="{ active: days === n }"
            @click="days = n"
          >{{ n }}d</button>
        </div>

        <p v-if="sightings.length === 0" class="empty-msg">
          No sightings in the last {{ days }} day{{ days === 1 ? '' : 's' }}.
        </p>

        <div v-else class="sightings-list">
          <div
            v-for="s in sightings"
            :key="s.entry_id"
            class="sighting-card"
          >
            <div class="sighting-icon">{{ speciesEmoji(s.type) }}</div>
            <div class="sighting-details">
              <div class="sighting-species">{{ s.type }}</div>
              <div class="sighting-meta">
                <span v-if="s.no_sighted > 1" class="sighting-qty">{{ s.no_sighted }} animals</span>
                <span v-if="s.trusted" class="sighting-trusted">verified</span>
              </div>
              <div v-if="s.data_source_comments" class="sighting-desc">
                {{ s.data_source_comments.replace(/<[^>]+>/g, '').trim() }}
              </div>
            </div>
            <div class="sighting-date">{{ formatDate(s.created) }}</div>
          </div>
        </div>

        <p class="attribution">
          Data from <a href="https://acartia.io" target="_blank" rel="noopener">Acartia</a> &amp; <a href="https://www.orcanetwork.org" target="_blank" rel="noopener">Orca Network</a> via Conserve.io
        </p>
      </template>
    </main>
  </div>
</template>

<style scoped>
.whale-page {
  min-height: 100vh;
  background: transparent;
  font-family: var(--font-sans);
  color: var(--green-darkest);
}

.whale-body {
  padding-bottom: 64px;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-family: var(--font-sign);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--green-darkest);
  margin: 0 0 4px;
}

.page-sub {
  font-family: var(--font-playfair);
  font-style: italic;
  font-size: 14px;
  color: var(--driftwood);
  margin: 0;
}

/* ── Map ── */
.map-wrap {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--green-border);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  margin-bottom: 32px;
}

.map-container {
  height: 440px;
  width: 100%;
  background: var(--bg-cream);
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

.empty-msg {
  color: var(--green-muted);
  font-style: italic;
  padding: 24px 0;
}

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

/* ── Filter ── */
.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}

.filter-label {
  font-family: var(--font-sign);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--green-muted);
}

.filter-btn {
  border: 1px solid var(--green-border);
  background: var(--bg-white);
  border-radius: 20px;
  padding: 5px 14px;
  font-family: var(--font-sign);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--green-darkest);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.filter-btn:hover {
  border-color: var(--deep-sky, #2e86ab);
  color: var(--deep-sky, #2e86ab);
}
.filter-btn.active {
  background: var(--deep-sky, #2e86ab);
  border-color: var(--deep-sky, #2e86ab);
  color: #fff;
}

/* ── Sightings list ── */
.sightings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sighting-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: var(--bg-white);
  border-radius: 0 6px 6px 0;
  padding: 16px 18px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border-left: 3px solid var(--deep-sky, #2e86ab);
}

.sighting-icon {
  font-size: 22px;
  flex-shrink: 0;
  margin-top: 1px;
}

.sighting-details {
  flex: 1;
  min-width: 0;
}

.sighting-species {
  font-family: var(--font-sign);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--forest);
  margin-bottom: 3px;
}

.sighting-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: var(--driftwood);
}

.sighting-qty {
  background: var(--green-light);
  border-radius: 20px;
  padding: 1px 8px;
  font-size: 12px;
  color: var(--green-darkest);
}

.sighting-trusted {
  background: #e8f4f0;
  color: #1a7a5e;
  border-radius: 20px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.sighting-desc {
  margin-top: 5px;
  font-size: 13px;
  color: var(--green-muted);
  line-height: 1.45;
}

.sighting-date {
  font-size: 12px;
  color: var(--green-muted);
  white-space: nowrap;
  flex-shrink: 0;
  padding-top: 2px;
}

/* ── Attribution ── */
.attribution {
  margin-top: 28px;
  font-size: 12px;
  color: var(--green-muted);
}
.attribution a {
  color: var(--green-primary);
  text-decoration: none;
}
.attribution a:hover { text-decoration: underline; }

/* ── Mobile ── */
@media (max-width: 520px) {
  .map-container { height: 300px; }
  .sighting-card { flex-wrap: wrap; }
  .sighting-date { width: 100%; padding-top: 4px; }
}
</style>

<!-- Unscoped: Leaflet-injected DOM -->
<style>
.whale-marker {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  border: 2px solid #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}
</style>
