<script setup>
import { computed, onMounted, ref } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import { FAMILIES } from '../lib/families'
import { supabase } from '../lib/supabaseClient'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function dateInputValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const today = dateInputValue(new Date())

const loading = ref(true)
const listError = ref(null)
const expenses = ref([])
const deletingId = ref(null)

const formDate = ref(today)
const formDescription = ref('')
const formAmount = ref('')
const formFamily = ref('')
const submitting = ref(false)
const submitError = ref(null)
const successMsg = ref(null)
const fieldErrors = ref({})

const totalCents = computed(() => expenses.value.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0))

const familyTotals = computed(() => {
  const totals = new Map(FAMILIES.map((family) => [family, 0]))
  for (const row of expenses.value) {
    totals.set(row.paid_by_family, (totals.get(row.paid_by_family) || 0) + Number(row.amount_cents || 0))
  }
  return FAMILIES.map((family) => ({
    family,
    amountCents: totals.get(family) || 0,
  }))
})

function formatCurrency(cents) {
  return currency.format(Number(cents || 0) / 100)
}

function parseAmountCents(value) {
  const normalized = String(value || '').trim().replace(/[$,]/g, '')
  if (!normalized) return null
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100)
}

function sanitizeAmountInput(value) {
  const raw = String(value || '')
  let next = ''
  let hasDecimal = false
  let decimalPlaces = 0

  for (const char of raw) {
    if (/\d/.test(char)) {
      if (hasDecimal) {
        if (decimalPlaces >= 2) continue
        decimalPlaces += 1
      }
      next += char
      continue
    }

    if (char === '.' && !hasDecimal) {
      hasDecimal = true
      next += char
    }
  }

  if (next.startsWith('.')) next = `0${next}`
  return next
}

function handleAmountInput(event) {
  formAmount.value = sanitizeAmountInput(event.target.value)
  clearFieldError('amount')
}

function normalizeAmountOnBlur() {
  const amountCents = parseAmountCents(formAmount.value)
  if (!amountCents) return
  formAmount.value = (amountCents / 100).toFixed(2)
}

function validateExpenseForm() {
  const errors = {}
  const description = formDescription.value.trim()
  const amountCents = parseAmountCents(formAmount.value)
  const date = new Date(`${formDate.value}T00:00:00`)

  if (!formDate.value) {
    errors.date = 'Choose a date.'
  } else if (Number.isNaN(date.getTime())) {
    errors.date = 'Choose a valid date.'
  }

  if (!description) {
    errors.description = 'Add a description.'
  } else if (description.length > 120) {
    errors.description = 'Keep the description to 120 characters or fewer.'
  }

  if (!String(formAmount.value || '').trim()) {
    errors.amount = 'Enter an amount.'
  } else if (!amountCents) {
    errors.amount = 'Use dollars and cents, like 24.50.'
  } else if (amountCents > 9999999) {
    errors.amount = 'Enter an amount under $100,000.'
  }

  if (!FAMILIES.includes(formFamily.value)) {
    errors.family = 'Choose who paid.'
  }

  fieldErrors.value = errors

  return {
    valid: Object.keys(errors).length === 0,
    description,
    amountCents,
  }
}

function clearFieldError(field) {
  if (!fieldErrors.value[field]) return
  fieldErrors.value = {
    ...fieldErrors.value,
    [field]: '',
  }
}

async function loadExpenses() {
  loading.value = true
  listError.value = null

  if (!supabase) {
    listError.value = 'Supabase is not configured'
    loading.value = false
    return
  }

  try {
    const { data, error } = await supabase
      .from('expenses')
      .select('id,expense_date,description,amount_cents,paid_by_family,created_by,created_at')
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) throw error
    expenses.value = data || []
  } catch (err) {
    console.error('[ExpensesPage] load', err)
    listError.value = err.message || 'Could not load expenses'
  }

  loading.value = false
}

async function loadProfileFamily() {
  if (!supabase) return

  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData.session?.user?.id
    if (!userId) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('family')
      .eq('user_id', userId)
      .maybeSingle()

    if (profile?.family && FAMILIES.includes(profile.family)) {
      formFamily.value = profile.family
    }
  } catch (err) {
    console.error('[ExpensesPage] profile family', err)
  }
}

async function handleSubmit() {
  submitError.value = null
  successMsg.value = null

  if (!supabase) {
    submitError.value = 'Supabase is not configured'
    return
  }

  const validation = validateExpenseForm()
  if (!validation.valid) return

  submitting.value = true

  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw sessionError

    const userId = sessionData.session?.user?.id
    if (!userId) throw new Error('No active session')

    const { error } = await supabase.from('expenses').insert({
      expense_date: formDate.value,
      description: validation.description,
      amount_cents: validation.amountCents,
      paid_by_family: formFamily.value,
      created_by: userId,
    })

    if (error) throw error

    successMsg.value = `${validation.description} added`
    formDescription.value = ''
    formAmount.value = ''
    fieldErrors.value = {}
    await loadExpenses()
    window.setTimeout(() => { successMsg.value = null }, 4000)
  } catch (err) {
    console.error('[ExpensesPage] submit', err)
    submitError.value = err.message || 'Could not add expense'
  }

  submitting.value = false
}

async function handleDelete(row) {
  if (!supabase || deletingId.value) return

  deletingId.value = row.id
  submitError.value = null

  try {
    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', row.id)

    if (error) throw error

    expenses.value = expenses.value.filter((expense) => expense.id !== row.id)
  } catch (err) {
    console.error('[ExpensesPage] delete', err)
    submitError.value = err.message || 'Could not remove expense'
  }

  deletingId.value = null
}

onMounted(async () => {
  await Promise.all([
    loadExpenses(),
    loadProfileFamily(),
  ])
})
</script>

<template>
  <div class="expenses-page">
    <HeroHeader show-back />

    <main class="expenses-body page-main">
      <section class="summary-section" aria-label="Expense totals">
        <div class="total-panel">
          <p class="summary-label">Total Spent</p>
          <p class="total-amount">{{ formatCurrency(totalCents) }}</p>
        </div>

        <div class="family-totals">
          <div
            v-for="row in familyTotals"
            :key="row.family"
            class="family-total"
          >
            <span class="family-name">{{ row.family }}</span>
            <span class="family-amount">{{ formatCurrency(row.amountCents) }}</span>
          </div>
        </div>
      </section>

      <section class="form-card">
        <h2 class="section-title">Add Expense</h2>

        <div class="form-fields">
          <div class="field field--date">
            <label class="field-label" for="expense-date">Date</label>
            <input
              id="expense-date"
              v-model="formDate"
              type="date"
              class="field-input"
              :class="{ 'field-input--error': fieldErrors.date }"
              :disabled="submitting"
              :aria-invalid="Boolean(fieldErrors.date)"
              aria-describedby="expense-date-error"
              @input="clearFieldError('date')"
            />
            <p
              id="expense-date-error"
              class="field-error"
              :class="{ 'field-error--hidden': !fieldErrors.date }"
              aria-live="polite"
            >
              {{ fieldErrors.date || ' ' }}
            </p>
          </div>

          <div class="field">
            <label class="field-label" for="expense-description">Description</label>
            <input
              id="expense-description"
              v-model="formDescription"
              type="text"
              class="field-input"
              :class="{ 'field-input--error': fieldErrors.description }"
              placeholder="e.g. Ferry snacks"
              maxlength="120"
              :disabled="submitting"
              :aria-invalid="Boolean(fieldErrors.description)"
              aria-describedby="expense-description-error"
              @input="clearFieldError('description')"
            />
            <p
              id="expense-description-error"
              class="field-error"
              :class="{ 'field-error--hidden': !fieldErrors.description }"
              aria-live="polite"
            >
              {{ fieldErrors.description || ' ' }}
            </p>
          </div>

          <div class="field field--amount">
            <label class="field-label" for="expense-amount">Amount</label>
            <input
              id="expense-amount"
              v-model="formAmount"
              type="text"
              inputmode="decimal"
              class="field-input"
              :class="{ 'field-input--error': fieldErrors.amount }"
              placeholder="24.50"
              :disabled="submitting"
              :aria-invalid="Boolean(fieldErrors.amount)"
              aria-describedby="expense-amount-error"
              @input="handleAmountInput"
              @blur="normalizeAmountOnBlur"
            />
            <p
              id="expense-amount-error"
              class="field-error"
              :class="{ 'field-error--hidden': !fieldErrors.amount }"
              aria-live="polite"
            >
              {{ fieldErrors.amount || ' ' }}
            </p>
          </div>

          <div class="field field--family">
            <label class="field-label" for="expense-family">Paid By</label>
            <select
              id="expense-family"
              v-model="formFamily"
              class="field-input field-select"
              :class="{ 'field-input--error': fieldErrors.family }"
              :disabled="submitting"
              :aria-invalid="Boolean(fieldErrors.family)"
              aria-describedby="expense-family-error"
              @change="clearFieldError('family')"
            >
              <option value="" disabled>Select...</option>
              <option v-for="family in FAMILIES" :key="family" :value="family">{{ family }}</option>
            </select>
            <p
              id="expense-family-error"
              class="field-error"
              :class="{ 'field-error--hidden': !fieldErrors.family }"
              aria-live="polite"
            >
              {{ fieldErrors.family || ' ' }}
            </p>
          </div>
        </div>

        <div class="form-footer">
          <p v-if="submitError" class="form-error">{{ submitError }}</p>
          <p v-if="successMsg" class="form-success">{{ successMsg }}</p>
          <button class="submit-btn" type="button" :disabled="submitting" @click="handleSubmit">
            <span v-if="submitting" class="btn-spinner"></span>
            {{ submitting ? 'Adding...' : 'Add Expense' }}
          </button>
        </div>
      </section>

      <section class="list-section">
        <h2 class="section-title">Expenses</h2>

        <div v-if="loading" class="state-msg">
          <div class="spinner"></div>
          Loading...
        </div>

        <div v-else-if="listError" class="state-msg error">{{ listError }}</div>

        <div v-else-if="expenses.length === 0" class="empty-msg">
          No expenses yet. Add the first shared cost when one comes up.
        </div>

        <div v-else class="expense-table">
          <div class="table-header">
            <span>Date</span>
            <span>Description</span>
            <span>Paid By</span>
            <span class="amount-cell">Amount</span>
            <span></span>
          </div>

          <div v-for="row in expenses" :key="row.id" class="table-row">
            <span class="row-date">{{ row.expense_date }}</span>
            <span class="row-description">{{ row.description }}</span>
            <span class="row-family">{{ row.paid_by_family }}</span>
            <span class="row-amount amount-cell">{{ formatCurrency(row.amount_cents) }}</span>
            <button
              class="delete-btn"
              type="button"
              :disabled="deletingId !== null"
              :aria-label="`Remove ${row.description}`"
              @click="handleDelete(row)"
            >
              <span v-if="deletingId === row.id" class="delete-spinner"></span>
              <svg v-else viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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
.expenses-page {
  min-height: 100vh;
  font-family: var(--font-sans);
  color: var(--forest);
}

.expenses-body {
  padding-bottom: 80px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.section-title {
  font-family: var(--font-sign);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--driftwood);
  margin: 0 0 20px;
}

.summary-section {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) 1.8fr;
  gap: 18px;
  align-items: stretch;
}

.total-panel,
.family-totals,
.form-card,
.expense-table {
  background: var(--bg-white);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
}

.total-panel {
  border-top: 4px solid var(--terracotta);
  border-radius: 0 0 6px 6px;
  padding: 24px;
}

.summary-label {
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--driftwood);
  margin: 0 0 8px;
}

.total-amount {
  font-family: var(--font-display);
  font-size: clamp(36px, 7vw, 54px);
  font-weight: 700;
  color: var(--forest);
  margin: 0;
  line-height: 1;
}

.family-totals {
  border-left: 4px solid var(--steel-sky);
  border-radius: 0 6px 6px 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  overflow: hidden;
}

.family-total {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border-right: 1px solid rgba(0, 0, 0, 0.05);
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.family-name {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--terracotta);
}

.family-amount {
  font-size: 13px;
  font-weight: 700;
  color: var(--forest);
  white-space: nowrap;
}

.form-card {
  border-radius: 0 0 6px 6px;
  border-top: 4px solid var(--terracotta);
  padding: 28px 28px 24px;
}

.form-fields {
  display: grid;
  grid-template-columns: 150px minmax(180px, 1fr) 130px 150px;
  gap: 16px;
  align-items: start;
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

.field-input--error {
  border-color: var(--red-error);
  background: #fff7f6;
}

.field-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.field-error {
  color: var(--red-error);
  font-size: 12px;
  line-height: 1.35;
  min-height: 17px;
  margin: 0;
}

.field-error--hidden {
  visibility: hidden;
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

.submit-btn:hover:not(:disabled) {
  background: #b06030;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-spinner,
.spinner,
.delete-spinner {
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

.btn-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
}

.expense-table {
  border-left: 4px solid var(--terracotta);
  border-radius: 0 6px 6px 0;
  overflow: hidden;
}

.table-header,
.table-row {
  display: grid;
  grid-template-columns: 120px minmax(180px, 1fr) 130px 110px 36px;
  align-items: center;
  gap: 12px;
}

.table-header {
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
  padding: 13px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.table-row:last-child {
  border-bottom: none;
}

.row-date,
.row-amount {
  font-size: 13px;
  color: var(--driftwood);
}

.row-description {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  color: var(--forest);
  overflow-wrap: anywhere;
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
  width: fit-content;
}

.amount-cell {
  text-align: right;
}

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

.delete-btn svg {
  width: 14px;
  height: 14px;
}

.delete-btn:hover:not(:disabled) {
  color: var(--red-error);
  border-color: rgba(185, 64, 64, 0.3);
  background: rgba(185, 64, 64, 0.05);
}

.delete-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.delete-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--green-border);
  border-top-color: var(--driftwood);
  display: block;
}

.state-msg {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--green-muted);
  font-size: 15px;
}

.state-msg.error {
  color: var(--red-error);
}

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
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 820px) {
  .summary-section,
  .form-fields {
    grid-template-columns: 1fr;
  }

  .family-totals {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .expenses-body {
    padding: 0 16px 60px;
  }

  .form-card,
  .total-panel {
    padding: 20px 16px 18px;
  }

  .family-totals {
    grid-template-columns: 1fr;
  }

  .family-total {
    flex-direction: column;
    justify-content: flex-start;
    gap: 4px;
  }

  .table-header {
    display: none;
  }

  .table-row {
    grid-template-columns: 1fr 34px;
    gap: 8px 12px;
    padding: 14px;
  }

  .row-date,
  .row-description,
  .row-family,
  .row-amount {
    grid-column: 1;
  }

  .row-description {
    font-size: 19px;
  }

  .amount-cell {
    text-align: left;
  }

  .delete-btn {
    grid-column: 2;
    grid-row: 1 / span 4;
    align-self: center;
  }
}
</style>
