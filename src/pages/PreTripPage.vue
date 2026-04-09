<script setup>
import { ref, onMounted } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'

const SHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Seattle Data'

const CATEGORY_COLORS = [
  'var(--deep-sky)',
  'var(--steel-sky)',
  'var(--green-primary)',
  'var(--terracotta)',
  'var(--gold)',
]

const loading = ref(true)
const errorMsg = ref(null)
const categories = ref([])
const openCategories = ref(new Set([0]))

function cellStr(row, col) {
  const c = row?.c?.[col]
  if (!c || c.v == null) return ''
  return String(c.v).trim()
}

function isUrl(val) {
  return val.startsWith('http://') || val.startsWith('https://')
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
    const numCols = data.table.cols.length

    // Row 0: category names at their starting column index
    // Row 1: field sub-headers for each category's columns
    // Row 2+: item data

    // 1. Find where each category starts
    const catMeta = []
    for (let j = 0; j < numCols; j++) {
      const label = cellStr(rows[0], j)
      if (label) catMeta.push({ label, startCol: j })
    }

    // 2. For each category, collect fields and items
    const result = catMeta.map((cat, ci) => {
      const nextStart = ci + 1 < catMeta.length ? catMeta[ci + 1].startCol : numCols

      // Fields: sub-header name + column index, for all cols in this category's range
      const fields = []
      for (let j = cat.startCol; j < nextStart; j++) {
        const name = cellStr(rows[1], j)
        fields.push({ name, colIdx: j })
      }

      // Items: rows 2+ where at least the first field has a value
      const items = []
      for (let i = 2; i < rows.length; i++) {
        const primary = cellStr(rows[i], cat.startCol)
        if (!primary) continue
        const values = fields.map(f => cellStr(rows[i], f.colIdx))
        items.push(values)
      }

      return { label: cat.label, fields, items }
    })

    categories.value = result
  } catch (err) {
    console.error('[PreTripPage]', err)
    errorMsg.value = err.message || 'Could not load data'
  }

  loading.value = false
})

function toggleCategory(i) {
  const next = new Set(openCategories.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  openCategories.value = next
}
</script>

<template>
  <div class="pretrip-page">
    <HeroHeader show-back />

    <main class="pretrip-body page-main">
      <div v-if="loading" class="state-msg">
        <div class="spinner"></div>
        Loading…
      </div>

      <div v-else-if="errorMsg" class="state-msg error">
        {{ errorMsg }}
      </div>

      <template v-else>
        <div class="accordion">
          <div
            v-for="(cat, i) in categories"
            :key="i"
            class="accordion-item"
            :class="{ open: openCategories.has(i) }"
            :style="`--cat-color: ${CATEGORY_COLORS[i % CATEGORY_COLORS.length]}`"
          >
            <button class="accordion-header" @click="toggleCategory(i)">
              <div class="accordion-text">
                <span class="accordion-label">{{ cat.label }}</span>
                <span class="accordion-sub">{{ cat.fields.map(f => f.name).filter(Boolean).join(' · ') }}</span>
              </div>
              <span class="accordion-count">{{ cat.items.length }}</span>
              <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div class="accordion-body">
              <div class="item-list">
                <div v-if="cat.items.length === 0" class="empty-msg">
                  Nothing here yet — check back soon!
                </div>

                <div
                  v-for="(values, ri) in cat.items"
                  :key="ri"
                  class="item-row"
                >
                  <span class="item-title">{{ values[0] }}</span>
                  <div class="item-extras">
                    <template v-for="(val, fi) in values.slice(1)" :key="fi">
                      <a
                        v-if="val && isUrl(val)"
                        :href="val"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="item-link"
                        :aria-label="`${values[0]} link`"
                      >
                        {{ cat.fields[fi + 1]?.name || 'Link' }} ↗
                      </a>
                      <span v-else-if="val" class="genre-badge">{{ val }}</span>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.pretrip-page {
  min-height: 100vh;
  background: transparent;
  font-family: var(--font-sans);
  color: var(--green-darkest);
}

.pretrip-body {
  padding-bottom: 80px;
}

/* ── Accordion ── */
.accordion {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.accordion-item {
  background: var(--bg-white);
  border-radius: 0 0 6px 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  border-top: 4px solid var(--cat-color);
  overflow: hidden;
  transition: box-shadow 0.15s, transform 0.15s;
}

.accordion-header {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 20px 20px;
  background: none;
  border: none;
  border-bottom: 1px solid transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
}
.accordion-item.open .accordion-header {
  border-bottom-color: rgba(0, 0, 0, 0.06);
}
.accordion-header:hover {
  background: rgba(0, 0, 0, 0.02);
}

.accordion-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.accordion-label {
  font-family: var(--font-sign);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--forest);
  line-height: 1;
}

.accordion-sub {
  font-family: var(--font-playfair);
  font-size: 13px;
  font-style: italic;
  color: var(--driftwood);
}

.accordion-count {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--driftwood);
  background: var(--parchment);
  border: 1px solid rgba(138, 122, 94, 0.25);
  border-radius: 20px;
  padding: 2px 9px;
  flex-shrink: 0;
}

.chevron {
  width: 16px;
  height: 16px;
  color: var(--driftwood);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}
.accordion-item.open .chevron {
  transform: rotate(180deg);
}

/* ── Accordion Body ── */
.accordion-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.22s ease;
}
.accordion-item.open .accordion-body {
  grid-template-rows: 1fr;
}
.accordion-body > .item-list {
  overflow: hidden;
}

/* ── Item List ── */
.item-list {
  border-top: 1px solid transparent;
  padding: 4px 0;
  transition: border-color 0.15s;
}
.accordion-item.open .item-list {
  border-top-color: rgba(0, 0, 0, 0.06);
}

.item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}
.item-row:last-child { border-bottom: none; }

.item-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--forest);
  line-height: 1.3;
  flex: 1;
  min-width: 0;
}

.item-extras {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.genre-badge {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--driftwood);
  background: var(--parchment);
  border: 1px solid rgba(138, 122, 94, 0.25);
  border-radius: 20px;
  padding: 3px 10px;
  white-space: nowrap;
}

.item-link {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--terracotta);
  text-decoration: none;
  border: 1px solid rgba(196, 120, 72, 0.4);
  border-radius: 20px;
  padding: 3px 10px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.item-link:hover {
  background: var(--terracotta);
  color: #fff;
}

.empty-msg {
  padding: 40px 24px;
  color: var(--driftwood);
  font-style: italic;
  font-size: 14px;
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
@media (max-width: 600px) {
  .accordion-header {
    padding: 14px 16px;
  }
  .accordion-label {
    font-size: 13px;
  }
  .item-row {
    padding: 12px 16px;
  }
}
</style>
