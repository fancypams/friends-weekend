<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  activities: {
    type: Array,
    default: () => [],
  },
})

const mapEl = ref(null)
const geocoding = ref(false)

let map = null
let markers = []
let currentRun = 0 // cancels stale geocode runs when day changes

// Module-level cache persists across day switches
const geocodeCache = {}

async function geocode(query) {
  if (geocodeCache[query] !== undefined) return geocodeCache[query]
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`,
    )
    const results = await res.json()
    const coords = results[0]
      ? [parseFloat(results[0].lat), parseFloat(results[0].lon)]
      : null
    geocodeCache[query] = coords
    return coords
  } catch {
    geocodeCache[query] = null
    return null
  }
}

function makeIcon(label) {
  return L.divIcon({
    className: '',
    html: `<div class="day-map-marker">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

async function updateMarkers() {
  const run = ++currentRun
  geocoding.value = true

  markers.forEach((m) => map.removeLayer(m))
  markers = []

  if (!props.activities.length) {
    geocoding.value = false
    return
  }

  // Stagger requests slightly to be polite to Nominatim
  const results = await Promise.all(
    props.activities.map((act, i) =>
      new Promise((resolve) => setTimeout(resolve, i * 250)).then(async () => {
        if (run !== currentRun) return null
        const query = `${act.activity.replace(/@.+/, '').trim()}, Seattle, WA`
        const coords = await geocode(query)
        return coords ? { act, coords, num: i + 1 } : null
      }),
    ),
  )

  if (run !== currentRun) return // day changed while geocoding

  const valid = results.filter(Boolean)

  valid.forEach(({ act, coords, num }) => {
    const marker = L.marker(coords, { icon: makeIcon(num) })
      .addTo(map)
      .bindPopup(
        `<strong>${act.activity}</strong><br><span style="color:#7a6650;font-size:12px">${act.time}${act.notes ? '<br>' + act.notes : ''}</span>`,
        { maxWidth: 200 },
      )
    markers.push(marker)
  })

  if (valid.length === 1) {
    map.setView(valid[0].coords, 14)
  } else if (valid.length > 1) {
    map.fitBounds(
      valid.map((r) => r.coords),
      { padding: [36, 36] },
    )
  }

  geocoding.value = false
}

onMounted(() => {
  map = L.map(mapEl.value, {
    center: [47.606, -122.332],
    zoom: 12,
    zoomControl: true,
  })

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map)

  updateMarkers()
})

onUnmounted(() => {
  if (map) map.remove()
})

watch(() => props.activities, updateMarkers)
</script>

<template>
  <div class="map-wrap">
    <div ref="mapEl" class="map-container" />
    <div v-if="geocoding" class="map-loading">
      <div class="spinner" />
      Finding locations…
    </div>
  </div>
</template>

<style scoped>
.map-wrap {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #f0e6cc;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  margin-bottom: 32px;
}

.map-container {
  height: 320px;
  width: 100%;
  background: #f5f0e8;
}

.map-loading {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #f0e6cc;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 13px;
  color: #7a6650;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #f0e6cc;
  border-top-color: #8b7340;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<!-- Unscoped: targets Leaflet-injected DOM outside Vue's template -->
<style>
.day-map-marker {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #8b7340;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  font-family: system-ui, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.leaflet-popup-content-wrapper {
  border-radius: 8px;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: #3d2b1f;
}

.leaflet-popup-tip-container {
  margin-top: -1px;
}
</style>
