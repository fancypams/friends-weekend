<script setup>
import { ref, onMounted } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import { supabase, supabaseAnonKey, bypassAuth, supabaseFunctionUrl } from '../lib/supabaseClient'

const SHEET_ID = '10Vb7iKPjZC2THOPiMf50MtKMM5K3LQ70VTVdBCuSdlo'
const SHEET_NAME = 'Groceries'
const FAMILIES = ['Ekanger', 'Dzambo', 'Schambach', 'Montanez', 'Habibi', 'Donaldson']

// ── List state ──
const loading = ref(true)
const listError = ref(null)
const items = ref([])

// ── Delete state ──
const deleting = ref(null) // index of row being deleted

async function handleDelete(index) {
  if (deleting.value !== null) return
  deleting.value = index

  try {
    const headers = await getAuthHeaders()
    const res = await fetch(supabaseFunctionUrl('delete-grocery'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ rowIndex: index }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Error ${res.status}`)
    }

    // Optimistically remove from local list while sheet refreshes
    items.value.splice(index, 1)
    setTimeout(loadGroceries, 1500)
  } catch (err) {
    console.error('[GroceriesPage] delete', err)
  }

  deleting.value = null
}

// ── Form state ──
const formItem = ref('')
const formQty = ref('')
const formFamily = ref('')
const submitting = ref(false)
const submitError = ref(null)
const successMsg = ref(null)

function cellStr(row, col) {
  const c = row?.c?.[col]
  if (!c || c.v == null) return ''
  return String(c.v).trim()
}

async function loadGroceries() {
  loading.value = true
  listError.value = null

  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json&headers=1&sheet=${encodeURIComponent(SHEET_NAME)}&range=C5:E`

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

    items.value = (data.table.rows ?? [])
      .map((row) => ({
        item: cellStr(row, 0),
        qty: cellStr(row, 1),
        family: cellStr(row, 2),
      }))
      .filter((r) => r.item)
  } catch (err) {
    console.error('[GroceriesPage] load', err)
    listError.value = err.message || 'Could not load groceries'
  }

  loading.value = false
}

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

async function handleSubmit() {
  submitError.value = null
  successMsg.value = null

  if (!formItem.value.trim()) { submitError.value = 'Item name is required'; return }
  if (!formQty.value.trim()) { submitError.value = 'Quantity is required'; return }
  if (!formFamily.value) { submitError.value = 'Please select your family'; return }

  submitting.value = true

  try {
    const headers = await getAuthHeaders()
    const res = await fetch(supabaseFunctionUrl('append-grocery'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        item: formItem.value.trim(),
        qty: formQty.value.trim(),
        family: formFamily.value,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Error ${res.status}`)
    }

    successMsg.value = `"${formItem.value.trim()}" added!`
    formItem.value = ''
    formQty.value = ''
    formFamily.value = ''

    // Refresh the list after a short delay to let Sheets settle
    setTimeout(loadGroceries, 1500)
    setTimeout(() => { successMsg.value = null }, 4000)
  } catch (err) {
    console.error('[GroceriesPage] submit', err)
    submitError.value = err.message || 'Something went wrong'
  }

  submitting.value = false
}

onMounted(loadGroceries)
</script>

<template>
  <div class="groceries-page">
    <HeroHeader show-back />

    <main class="groceries-body">

      <!-- ── Add form ── -->
      <section class="form-card">
        <h2 class="section-title">Add to the List</h2>

        <div class="form-fields">
          <div class="field">
            <label class="field-label" for="g-item">Item</label>
            <input
              id="g-item"
              v-model="formItem"
              type="text"
              class="field-input"
              placeholder="e.g. Olive oil"
              :disabled="submitting"
            />
          </div>

          <div class="field field--sm">
            <label class="field-label" for="g-qty">Qty</label>
            <input
              id="g-qty"
              v-model="formQty"
              type="text"
              class="field-input"
              placeholder="e.g. 1 bottle"
              :disabled="submitting"
            />
          </div>

          <div class="field field--sm">
            <label class="field-label" for="g-family">Family</label>
            <select
              id="g-family"
              v-model="formFamily"
              class="field-input field-select"
              :disabled="submitting"
            >
              <option value="" disabled>Select…</option>
              <option v-for="f in FAMILIES" :key="f" :value="f">{{ f }}</option>
            </select>
          </div>
        </div>

        <div class="form-footer">
          <p v-if="submitError" class="form-error">{{ submitError }}</p>
          <p v-if="successMsg" class="form-success">{{ successMsg }}</p>
          <button
            class="submit-btn"
            :disabled="submitting"
            @click="handleSubmit"
          >
            <span v-if="submitting" class="btn-spinner"></span>
            {{ submitting ? 'Adding…' : 'Add Item' }}
          </button>
        </div>
      </section>

      <!-- ── Current list ── -->
      <section class="list-section">
        <h2 class="section-title">Current List</h2>

        <div v-if="loading" class="state-msg">
          <div class="spinner"></div>
          Loading…
        </div>

        <div v-else-if="listError" class="state-msg error">{{ listError }}</div>

        <div v-else-if="items.length === 0" class="empty-msg">
          Nothing here yet — be the first to add something!
        </div>

        <div v-else class="item-table">
          <div class="table-header">
            <span>Item</span>
            <span>Qty</span>
            <span>Family</span>
            <span></span>
          </div>
          <div
            v-for="(row, i) in items"
            :key="i"
            class="table-row"
          >
            <span class="row-item">{{ row.item }}</span>
            <span class="row-qty">{{ row.qty }}</span>
            <span class="row-family">{{ row.family }}</span>
            <button
              class="delete-btn"
              :disabled="deleting !== null"
              :aria-label="`Remove ${row.item}`"
              @click="handleDelete(i)"
            >
              <span v-if="deleting === i" class="delete-spinner"></span>
              <svg v-else viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 4h10M6 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M5 4l.5 8h5L11 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </section>

    </main>
  </div>
</template>

<style scoped>
.groceries-page {
  min-height: 100vh;
  font-family: var(--font-sans);
  color: var(--forest);
}

.groceries-body {
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 24px 80px;
  display: flex;
  flex-direction: column;
  gap: 40px;
}

/* ── Section title ── */
.section-title {
  font-family: var(--font-sign);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--driftwood);
  margin: 0 0 20px;
}

/* ── Form card ── */
.form-card {
  background: var(--bg-white);
  border-radius: 0 0 6px 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  border-top: 4px solid var(--terracotta);
  padding: 28px 28px 24px;
}

.form-fields {
  display: grid;
  grid-template-columns: 2fr 140px 140px;
  gap: 16px;
  align-items: end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--driftwood);
}

.field-input {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--forest);
  background: var(--parchment);
  border: 1px solid var(--driftwood);
  border-radius: 4px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 0.15s;
  width: 100%;
}
.field-input:focus {
  border-color: var(--terracotta);
}
.field-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.field-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238a7a5e' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
  cursor: pointer;
}

.form-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.form-error {
  font-size: 13px;
  color: var(--red-error);
  margin: 0;
  flex: 1;
}

.form-success {
  font-size: 13px;
  color: var(--sage);
  font-weight: 600;
  margin: 0;
  flex: 1;
}

.submit-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fff;
  background: var(--terracotta);
  border: none;
  border-radius: 4px;
  padding: 10px 20px;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  white-space: nowrap;
}
.submit-btn:hover:not(:disabled) { background: #b06030; }
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* ── List section ── */
.item-table {
  background: var(--bg-white);
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  border-left: 4px solid var(--terracotta);
  overflow: hidden;
}

.table-header {
  display: grid;
  grid-template-columns: 1fr 100px 120px 36px;
  padding: 10px 20px;
  background: var(--parchment);
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--driftwood);
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.table-row {
  display: grid;
  grid-template-columns: 1fr 100px 120px 36px;
  padding: 13px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  align-items: center;
}
.table-row:last-child { border-bottom: none; }

.row-item {
  font-size: 14px;
  font-weight: 600;
  color: var(--forest);
}

.row-qty {
  font-size: 13px;
  color: var(--driftwood);
}

.row-family {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--terracotta);
  background: rgba(196, 120, 72, 0.08);
  border: 1px solid rgba(196, 120, 72, 0.25);
  border-radius: 20px;
  padding: 3px 10px;
  white-space: nowrap;
  display: inline-block;
}

/* ── Delete button ── */
.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--driftwood);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  padding: 0;
  flex-shrink: 0;
}
.delete-btn svg { width: 14px; height: 14px; }
.delete-btn:hover:not(:disabled) {
  color: var(--red-error);
  border-color: rgba(185, 64, 64, 0.3);
  background: rgba(185, 64, 64, 0.05);
}
.delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.delete-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--green-border);
  border-top-color: var(--driftwood);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: block;
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
  padding: 40px 0;
  color: var(--driftwood);
  font-style: italic;
  font-size: 14px;
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

/* ── Mobile ── */
@media (max-width: 600px) {
  .groceries-body {
    padding: 0 16px 60px;
  }

  .form-card {
    padding: 20px 16px 18px;
  }

  .form-fields {
    grid-template-columns: 1fr;
  }

  .table-header,
  .table-row {
    grid-template-columns: 1fr 70px 100px 36px;
    padding: 10px 14px;
  }
}
</style>
