<script setup>
import { ref, computed, onMounted } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'

const SHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Seattle Data'

const loading = ref(true)
const errorMsg = ref(null)
const categories = ref([])
const activeCategory = ref(0)

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

const active = computed(() => categories.value[activeCategory.value] ?? null)
</script>

<template>
  <div class="pretrip-page">
    <HeroHeader show-back />

    <main class="pretrip-body">
      <div v-if="loading" class="state-msg">
        <div class="spinner"></div>
        Loading…
      </div>

      <div v-else-if="errorMsg" class="state-msg error">
        {{ errorMsg }}
      </div>

      <template v-else>
        <div class="pretrip-layout">
          <nav class="category-nav">
            <button
              v-for="(cat, i) in categories"
              :key="i"
              :class="['cat-btn', { active: activeCategory === i }]"
              @click="activeCategory = i"
            >
              {{ cat.label }}
            </button>
          </nav>

          <section v-if="active" class="item-list">
            <div v-if="active.items.length === 0" class="empty-msg">
              Nothing here yet — check back soon!
            </div>

            <div
              v-for="(values, i) in active.items"
              :key="i"
              class="item-row"
            >
              <!-- First field: always the primary name -->
              <span class="item-title">{{ values[0] }}</span>

              <!-- Remaining fields: link or badge -->
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
                    {{ active.fields[fi + 1]?.name || 'Link' }} ↗
                  </a>
                  <span v-else-if="val" class="genre-badge">{{ val }}</span>
                </template>
              </div>
            </div>
          </section>
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
  max-width: 1080px;
  margin: 15px auto;
  padding: 40px 24px 80px;
}

/* ── Layout ── */
.pretrip-layout {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0 5px;
  align-items: start;
}

/* ── Category Nav ── */
.category-nav {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
  position: sticky;
  top: 80px;
  width: 95px;
}

.cat-btn {
  display: block;
  width: 100%;
  text-align: right;
  background: none;
  border: none;
  padding: 14px 0;
  font-family: var(--font-sign);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--forest);
  cursor: pointer;
  transition: color 0.15s;
  line-height: 1;
}
.cat-btn:hover { color: var(--terracotta); }
.cat-btn.active {
  color: var(--terracotta);
  position: relative;
}
.cat-btn.active::after {
  content: '';
  position: absolute;
  top: 50%;
  right: calc(-48px - 4px);
  transform: translateY(-50%);
  width: calc(48px + 4px);
  height: 2px;
  background: var(--terracotta);
}

/* ── Item List ── */
.item-list {
  background: var(--bg-white);
  border-radius: 0 6px 6px 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  border-left: 4px solid var(--terracotta);
  padding: 8px 0;
  min-height: 200px;
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
  .pretrip-layout {
    grid-template-columns: 90px 1fr;
    gap: 0 24px;
  }
  .item-list {
    margin-top: 15px;
    padding-left: 8px;
  }
  .cat-btn.active::after {
    width: calc(20px + 4px);
    right: calc(-20px - 4px);
  }
  .pretrip-body {
    padding: 0 10px 60px;
  }
  .pretrip-layout {
    grid-template-columns: 90px 1fr;
    gap: 0 24px;
  }
  .cat-btn {
    font-size: 12px;
    padding: 12px 0;
  }
  .item-row {
    padding: 12px 16px;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .item-title {
    width: 100%;
  }
  .item-extras {
    width: 100%;
    justify-content: flex-start;
  }
  .category-nav {
    width: 90px;
  }
}
</style>
