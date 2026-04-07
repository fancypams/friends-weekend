<script setup>
import { ref, onMounted } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import airbnbPhoto from '../assets/airbnb.jpg'
import moHomePhoto from '../assets/mo-home.jpg'

const SHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Basics'

const loading = ref(true)
const errorMsg = ref(null)
const lodging = ref([])
const transport = ref(null)

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address + ', Seattle, WA')}`
}

function cellStr(row, col) {
  const c = row?.c?.[col]
  if (!c || c.v == null) return ''
  return String(c.v).trim()
}

// Strip leading emoji + optional space from a string without regex character classes
function stripLeadingEmoji(s) {
  // Remove any leading non-letter, non-digit, non-space char sequences (emoji)
  return s.replace(/^[\s\S]{1,3}?\s/, (match) => {
    // Only strip if the first char is likely an emoji (code point > 0x2000)
    return match.codePointAt(0) > 0x2000 ? '' : match
  }).trim()
}

onMounted(async () => {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json&headers=0&sheet=${encodeURIComponent(SHEET_NAME)}`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const text = await res.text()
    const match = text.match(/google\.visualization\.Query\.setResponse\((\{.+\})\)/)
    if (!match) throw new Error('Unexpected response format')

    const data = JSON.parse(match[1])
    if (data.status === 'error') {
      throw new Error(data.errors?.[0]?.message ?? 'Spreadsheet error')
    }

    const rows = data.table.rows

    // ── LODGING ──
    // Row 1 col 6: "Airbnb"   rows 2-5: address/code/notes at col 7
    // Row 6 col 6: "Mo Home"  rows 7-9: address/code/notes at col 7
    lodging.value = [
      {
        name: cellStr(rows[1], 6),
        photo: airbnbPhoto,
        address: cellStr(rows[2], 7),
        code: cellStr(rows[3], 7),
        notes: [cellStr(rows[4], 7), cellStr(rows[5], 7)].filter(Boolean),
      },
      {
        name: cellStr(rows[6], 6),
        photo: moHomePhoto,
        address: cellStr(rows[7], 7),
        code: cellStr(rows[8], 7),
        notes: [cellStr(rows[9], 7)].filter(Boolean),
      },
    ]

    // ── TRANSPORTATION ──
    // Row 12 col 2: company name
    // Row 14 col 2: "📍 address", rows 15-16 col 2: pickup / dropoff text
    // Rows 13-16 cols 6,7,11: vehicle icon, name, capacity
    const rawAddress = cellStr(rows[14], 2)
    const rawPickup  = cellStr(rows[15], 2)
    const rawDropoff = cellStr(rows[16], 2)

    transport.value = {
      company: cellStr(rows[12], 2),
      address: rawAddress.replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{27FF}]\s*/u, '').trim(),
      pickup:  rawPickup.replace(/^pick.up:\s*/i, '').trim(),
      dropoff: rawDropoff.replace(/^drop.off:\s*/i, '').trim(),
      vehicles: [13, 14, 15, 16]
        .map((ri) => {
          const name = cellStr(rows[ri], 7)
          if (!name) return null
          const cap = parseFloat(cellStr(rows[ri], 11))
          return {
            icon: cellStr(rows[ri], 6),
            name,
            capacity: isNaN(cap) ? null : Math.round(cap),
          }
        })
        .filter(Boolean),
    }
  } catch (err) {
    console.error('[BasicsPage]', err)
    errorMsg.value = err.message || 'Could not load data'
  }

  loading.value = false
})
</script>

<template>
  <div class="basics-page">
    <HeroHeader show-back />

    <main class="basics-body">
      <div v-if="loading" class="state-msg">
        <div class="spinner"></div>
        Loading…
      </div>

      <div v-if="!loading && errorMsg" class="state-msg error">
        {{ errorMsg }}
      </div>

      <div v-if="!loading && !errorMsg">
        <!-- ── LODGING ── -->
        <section class="section">

          <div v-for="place in lodging" :key="place.name" class="property-card">
            <div class="property-photo">
              <img v-if="place.photo" :src="place.photo" :alt="place.name" />
              <div v-else class="photo-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
                </svg>
              </div>
            </div>

            <div class="property-divider"></div>

            <div class="property-details">
              <h3 class="property-name">{{ place.name }}</h3>

              <a :href="mapsUrl(place.address)" target="_blank" rel="noopener" class="detail-row link">
                <span class="detail-icon">📍</span>
                <span>{{ place.address }}</span>
              </a>

              <div v-if="place.code" class="detail-row">
                <span class="detail-icon">🔑</span>
                <span class="code">{{ place.code }}</span>
              </div>

              <div v-if="place.notes.length" class="detail-row">
                <span class="detail-icon">✏️</span>
                <div>
                  <div v-for="note in place.notes" :key="note">{{ note }}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ── TRANSPORTATION ── -->
        <section v-if="transport" class="section">

          <div class="transport-card">
            <h3 class="property-name">{{ transport.company }}</h3>

            <a :href="mapsUrl(transport.address)" target="_blank" rel="noopener" class="detail-row link">
              <span class="detail-icon">📍</span>
              <span>{{ transport.address }}</span>
            </a>

            <div class="detail-row">
              <span class="detail-icon">📅</span>
              <div>
                <div>Pick-up: {{ transport.pickup }}</div>
                <div>Drop-off: {{ transport.dropoff }}</div>
              </div>
            </div>

            <div class="vehicles">
              <div v-for="(v, i) in transport.vehicles" :key="i" class="vehicle-row">
                <span class="vehicle-icon">{{ v.icon }}</span>
                <span class="vehicle-name">{{ v.name }}</span>
                <span v-if="v.capacity" class="vehicle-cap">{{ v.capacity }} seats</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.basics-page {
  min-height: 100vh;
  background: var(--bg-page);
  font-family: var(--font-sans);
  color: var(--green-darkest);
}

/* ── Body ── */
.basics-body {
  max-width: 760px;
  margin: 0 auto;
  padding: 70px 24px 64px;
}

/* ── Section ── */
.section { margin-bottom: 48px; }

.section-title {
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 700;
  color: var(--green-darkest);
  margin: 0 0 20px;
}

/* ── Property Card ── */
.property-card {
  display: flex;
  align-items: stretch;
  background: var(--bg-white);
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  margin-bottom: 20px;
  min-height: 220px;
}

.property-photo {
  width: 42%;
  flex-shrink: 0;
  overflow: hidden;
}
.property-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.photo-placeholder {
  width: 100%;
  height: 100%;
  min-height: 220px;
  background: linear-gradient(135deg, #7AA898 0%, #A8B89A 60%, var(--green-border) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--green-muted);
}
.photo-placeholder svg { width: 52px; height: 52px; }

.property-divider {
  width: 3px;
  background: var(--red-accent);
  flex-shrink: 0;
}

.property-details {
  flex: 1;
  padding: 24px 24px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.property-name {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 700;
  color: var(--green-darkest);
  margin: 0 0 4px;
  line-height: 1.1;
}

.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 15px;
  color: var(--green-darkest);
  line-height: 1.5;
  text-decoration: none;
}
.detail-row.link { color: var(--green-primary); transition: color 0.15s; }
.detail-row.link:hover { color: var(--red-accent); text-decoration: underline; }

.detail-icon { font-size: 17px; flex-shrink: 0; margin-top: 1px; }

.code {
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 2px;
}

/* ── Transport Card ── */
.transport-card {
  background: var(--bg-white);
  padding: 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.vehicles {
  margin-top: 8px;
  border-top: 1px solid var(--green-border);
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vehicle-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.vehicle-icon { font-size: 20px; width: 28px; text-align: center; }
.vehicle-name { flex: 1; font-size: 15px; font-weight: 500; }
.vehicle-cap {
  font-size: 13px;
  color: var(--green-muted);
  background: var(--green-light);
  border-radius: 20px;
  padding: 2px 10px;
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

/* ── Mobile ── */
@media (max-width: 520px) {
  .property-card { flex-direction: column; }
  .property-photo { width: 100%; height: 180px; }
  .photo-placeholder { min-height: 180px; }
  .property-divider { width: 100%; height: 3px; }
}
</style>
