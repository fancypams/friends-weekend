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
const settlements = ref([])
const deletingId = ref(null)
const deletingSettlementId = ref(null)
const currentUserId = ref('')
const currentUserFamily = ref('')
const recordingSettlementKey = ref('')
const uploadingSettlementKey = ref('')
const updatingSettlementId = ref('')
const proofError = ref(null)

const formDate = ref(today)
const formDescription = ref('')
const formAmount = ref('')
const formFamily = ref('')
const formSplitFamilies = ref([])
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

const settlementRows = computed(() => {
  const debts = new Map()
  const paid = new Map()

  for (const row of expenses.value) {
    const payer = row.paid_by_family
    for (const share of allocatedShares(row)) {
      if (share.family === payer || share.amountCents <= 0) continue
      const key = debtKey(share.family, payer)
      debts.set(key, (debts.get(key) || 0) + share.amountCents)
    }
  }

  for (const row of settlements.value) {
    const key = debtKey(row.from_family, row.to_family)
    paid.set(key, (paid.get(key) || 0) + Number(row.amount_cents || 0))
  }

  const rows = []
  for (let i = 0; i < FAMILIES.length; i += 1) {
    for (let j = i + 1; j < FAMILIES.length; j += 1) {
      const a = FAMILIES[i]
      const b = FAMILIES[j]
      const aOwesB = debts.get(debtKey(a, b)) || 0
      const bOwesA = debts.get(debtKey(b, a)) || 0
      const aPaidB = paid.get(debtKey(a, b)) || 0
      const bPaidA = paid.get(debtKey(b, a)) || 0
      const aRemainingB = Math.max(aOwesB - aPaidB, 0)
      const bRemainingA = Math.max(bOwesA - bPaidA, 0)
      const net = aRemainingB - bRemainingA
      const pairSettlements = settlementsForPair(a, b)
      if (!aOwesB && !bOwesA && !pairSettlements.length) continue

      rows.push({
        familyA: a,
        familyB: b,
        aOwesB,
        bOwesA,
        aPaidB,
        bPaidA,
        aRemainingB,
        bRemainingA,
        totalSettlementCents: Math.abs(aOwesB - bOwesA),
        paidCents: aPaidB + bPaidA,
        remainingCents: Math.abs(net),
        settlementFrom: net > 0 ? a : b,
        settlementTo: net > 0 ? b : a,
        settlementCents: Math.abs(net),
        settlements: pairSettlements,
      })
    }
  }

  return rows.sort((a, b) => (
    b.settlementCents - a.settlementCents
    || (b.aOwesB + b.bOwesA) - (a.aOwesB + a.bOwesA)
    || a.familyA.localeCompare(b.familyA)
  ))
})

function settlementsForPair(a, b) {
  return settlements.value
    .filter((row) => (
      (row.from_family === a && row.to_family === b)
      || (row.from_family === b && row.to_family === a)
    ))
    .sort((aRow, bRow) => new Date(bRow.created_at).getTime() - new Date(aRow.created_at).getTime())
}

function formatCurrency(cents) {
  return currency.format(Number(cents || 0) / 100)
}

function debtKey(from, to) {
  return `${from}=>${to}`
}

function splitFamiliesFor(row) {
  const selected = Array.isArray(row?.split_families)
    ? row.split_families.filter((family) => FAMILIES.includes(family))
    : []
  if (selected.length) return FAMILIES.filter((family) => selected.includes(family))
  return [...FAMILIES]
}

function allocatedShares(row) {
  const selected = splitFamiliesFor(row)
  const amountCents = Number(row?.amount_cents || 0)
  if (!selected.length || amountCents <= 0) return []

  const base = Math.floor(amountCents / selected.length)
  let remainder = amountCents % selected.length

  return selected.map((family) => {
    const amount = base + (remainder > 0 ? 1 : 0)
    remainder -= 1
    return {
      family,
      amountCents: amount,
    }
  })
}

function perFamilyLabel(row) {
  const shares = allocatedShares(row)
  if (!shares.length) return formatCurrency(0)
  const amounts = [...new Set(shares.map((share) => share.amountCents))]
  if (amounts.length === 1) return formatCurrency(amounts[0])
  return `${formatCurrency(Math.min(...amounts))}-${formatCurrency(Math.max(...amounts))}`
}

function parseAmountCents(value) {
  const normalized = String(value || '').trim().replace(/[$,]/g, '')
  if (!normalized) return null
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100)
}

function isSplitFamilySelected(family) {
  return formSplitFamilies.value.includes(family)
}

function setSplitFamilies(families) {
  formSplitFamilies.value = FAMILIES.filter((family) => families.includes(family))
}

function ensurePayerInSplit() {
  if (!FAMILIES.includes(formFamily.value)) return
  if (formSplitFamilies.value.includes(formFamily.value)) return
  setSplitFamilies([...formSplitFamilies.value, formFamily.value])
}

function toggleSplitFamily(family) {
  if (!FAMILIES.includes(family)) return
  if (family === formFamily.value) {
    ensurePayerInSplit()
    return
  }

  const next = formSplitFamilies.value.includes(family)
    ? formSplitFamilies.value.filter((selected) => selected !== family)
    : [...formSplitFamilies.value, family]

  setSplitFamilies(next)
  ensurePayerInSplit()
  clearFieldError('split')
}

function handlePaidByChange() {
  ensurePayerInSplit()
  clearFieldError('family')
  clearFieldError('split')
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

  if (!formSplitFamilies.value.length) {
    errors.split = 'Choose at least one family to split with.'
  } else if (!formSplitFamilies.value.includes(formFamily.value)) {
    errors.split = 'The paying family must be included.'
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

function canDeleteExpense(row) {
  return Boolean(row?.created_by && currentUserId.value && row.created_by === currentUserId.value)
}

function currentSettlementKey(row) {
  if (!row?.settlementFrom || !row?.settlementTo || !row?.settlementCents) return ''
  return debtKey(row.settlementFrom, row.settlementTo)
}

function canRecordSettlement(row) {
  return Boolean(
    row?.settlementCents > 0
    && currentUserFamily.value
    && currentUserFamily.value === row.settlementTo
  )
}

function canUploadProof(row) {
  return Boolean(row?.from_family && currentUserFamily.value === row.from_family)
}

function canUploadProofForSettlementRow(row) {
  return Boolean(row?.settlementFrom && currentUserFamily.value === row.settlementFrom)
}

function canConfirmReceived(row) {
  return Boolean(row?.to_family && !row.settled && currentUserFamily.value === row.to_family)
}

function canCreateSettlement(row) {
  return Boolean(
    row?.settlementCents > 0
    && currentUserFamily.value
    && [row.settlementFrom, row.settlementTo].includes(currentUserFamily.value)
  )
}

function canDeleteSettlement(row) {
  return Boolean(row?.created_by && currentUserId.value && row.created_by === currentUserId.value)
}

function proofLabel(row) {
  if (uploadingSettlementKey.value === row.id) return 'Uploading...'
  return row.confirmation_path ? 'Replace Proof' : 'Upload Proof'
}

function settlementStatus(row) {
  if (row.settled) return 'Received'
  if (row.confirmation_path) return 'Proof uploaded'
  return 'Payment recorded'
}

function validProofFile(file) {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
  return Boolean(file && allowed.has(file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024)
}

function proofExtension(file) {
  const byType = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  }
  return byType[file?.type] || 'jpg'
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
    const { data: expenseData, error: expenseError } = await supabase
      .from('expenses')
      .select('id,expense_date,description,amount_cents,paid_by_family,split_families,created_by,created_at')
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (expenseError) throw expenseError

    const { data: settlementData, error: settlementError } = await supabase
      .from('expense_settlements')
      .select('id,from_family,to_family,amount_cents,confirmation_path,settled,settled_by,settled_at,created_by,created_at')
      .order('created_at', { ascending: false })

    if (settlementError) throw settlementError

    expenses.value = expenseData || []
    settlements.value = settlementData || []
  } catch (err) {
    console.error('[ExpensesPage] load', err)
    listError.value = err.message || 'Could not load expenses'
  }

  loading.value = false
}

async function loadCurrentUserProfile() {
  if (!supabase) return

  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData.session?.user?.id
    if (!userId) return
    currentUserId.value = userId

    const { data: profile } = await supabase
      .from('profiles')
      .select('family')
      .eq('user_id', userId)
      .maybeSingle()

    if (profile?.family && FAMILIES.includes(profile.family)) {
      currentUserFamily.value = profile.family
      formFamily.value = profile.family
      setSplitFamilies([profile.family])
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
      split_families: formSplitFamilies.value,
      created_by: userId,
    })

    if (error) throw error

    successMsg.value = `${validation.description} added`
    formDescription.value = ''
    formAmount.value = ''
    setSplitFamilies(formFamily.value ? [formFamily.value] : [])
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
  if (!canDeleteExpense(row)) {
    submitError.value = 'Only the person who added an expense can remove it.'
    return
  }

  deletingId.value = row.id
  submitError.value = null

  try {
    const { data, error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', row.id)
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!data?.id) {
      throw new Error('Could not remove that expense. Refresh and try again.')
    }

    expenses.value = expenses.value.filter((expense) => expense.id !== row.id)
  } catch (err) {
    console.error('[ExpensesPage] delete', err)
    submitError.value = err.message || 'Could not remove expense'
  }

  deletingId.value = null
}

async function createSettlement(row) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!canCreateSettlement(row)) throw new Error('Only involved families can record this payment.')

  const key = currentSettlementKey(row)
  recordingSettlementKey.value = key
  proofError.value = null
  const receivedByReceiver = currentUserFamily.value === row.settlementTo

  const { data, error } = await supabase
    .from('expense_settlements')
    .insert({
      from_family: row.settlementFrom,
      to_family: row.settlementTo,
      amount_cents: row.settlementCents,
      settled: receivedByReceiver,
      settled_by: receivedByReceiver ? currentUserId.value : null,
      settled_at: receivedByReceiver ? new Date().toISOString() : null,
      created_by: currentUserId.value,
    })
    .select('id,from_family,to_family,amount_cents,confirmation_path,settled,settled_by,settled_at,created_by,created_at')
    .single()

  recordingSettlementKey.value = ''
  if (error) throw error
  settlements.value = [data, ...settlements.value]
  return data
}

async function handleRecordSettlement(row) {
  if (!canRecordSettlement(row)) {
    proofError.value = 'Only the receiving family can record this payment.'
    return
  }

  try {
    await createSettlement(row)
  } catch (err) {
    console.error('[ExpensesPage] record settlement', err)
    proofError.value = err.message || 'Could not record payment'
    recordingSettlementKey.value = ''
  }
}

async function handleProofSelected(row, settlement, event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  if (!validProofFile(file)) {
    proofError.value = 'Upload a JPG, PNG, WEBP, HEIC, or HEIF image under 10 MB.'
    return
  }

  let target = settlement

  try {
    if (!target) {
      target = await createSettlement(row)
    }

    if (!canUploadProof(target)) {
      throw new Error('Only the paying family can upload payment confirmation.')
    }

    uploadingSettlementKey.value = target.id
    proofError.value = null

    const extension = proofExtension(file)
    const path = `${target.from_family}/${target.to_family}/${target.id}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage
      .from('expense-confirmations')
      .upload(path, file, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) throw uploadError

    const { data, error: updateError } = await supabase
      .from('expense_settlements')
      .update({ confirmation_path: path })
      .eq('id', target.id)
      .select('id,from_family,to_family,amount_cents,confirmation_path,settled,settled_by,settled_at,created_by,created_at')
      .single()

    if (updateError) throw updateError
    settlements.value = settlements.value.map((item) => (item.id === data.id ? data : item))
  } catch (err) {
    console.error('[ExpensesPage] proof upload', err)
    proofError.value = err.message || 'Could not upload proof'
  }

  uploadingSettlementKey.value = ''
}

async function handleOpenProof(row) {
  if (!supabase || !row?.confirmation_path) return

  try {
    proofError.value = null
    const { data, error } = await supabase.storage
      .from('expense-confirmations')
      .createSignedUrl(row.confirmation_path, 300)

    if (error) throw error
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  } catch (err) {
    console.error('[ExpensesPage] open proof', err)
    proofError.value = err.message || 'Could not open proof'
  }
}

async function handleConfirmReceived(row) {
  if (!supabase || !canConfirmReceived(row)) {
    proofError.value = 'Only the family being paid can confirm receipt.'
    return
  }

  updatingSettlementId.value = row.id
  proofError.value = null

  try {
    const { data, error } = await supabase
      .from('expense_settlements')
      .update({ settled: true })
      .eq('id', row.id)
      .select('id,from_family,to_family,amount_cents,confirmation_path,settled,settled_by,settled_at,created_by,created_at')
      .single()

    if (error) throw error
    settlements.value = settlements.value.map((item) => (item.id === data.id ? data : item))
  } catch (err) {
    console.error('[ExpensesPage] confirm receipt', err)
    proofError.value = err.message || 'Could not confirm receipt'
  }

  updatingSettlementId.value = ''
}

async function handleDeleteSettlement(row) {
  if (!supabase || deletingSettlementId.value) return
  if (!canDeleteSettlement(row)) {
    proofError.value = 'Only the person who recorded a payment can remove it.'
    return
  }

  deletingSettlementId.value = row.id
  proofError.value = null

  try {
    const { data, error } = await supabase
      .from('expense_settlements')
      .delete()
      .eq('id', row.id)
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!data?.id) throw new Error('Could not remove that payment. Refresh and try again.')
    settlements.value = settlements.value.filter((item) => item.id !== row.id)
  } catch (err) {
    console.error('[ExpensesPage] delete settlement', err)
    proofError.value = err.message || 'Could not remove payment'
  }

  deletingSettlementId.value = null
}

onMounted(async () => {
  await Promise.all([
    loadExpenses(),
    loadCurrentUserProfile(),
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
              @change="handlePaidByChange"
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

        <div class="split-field">
          <div class="split-head">
            <span class="field-label">Split With</span>
            <p
              id="expense-split-error"
              class="field-error split-error"
              :class="{ 'field-error--hidden': !fieldErrors.split }"
              aria-live="polite"
            >
              {{ fieldErrors.split || ' ' }}
            </p>
          </div>

          <div class="split-options" role="group" aria-describedby="expense-split-error">
            <label
              v-for="family in FAMILIES"
              :key="family"
              class="split-option"
              :class="{ 'split-option--locked': family === formFamily }"
            >
              <input
                type="checkbox"
                :checked="isSplitFamilySelected(family)"
                :disabled="submitting || family === formFamily"
                @change="toggleSplitFamily(family)"
              />
              <span>{{ family }}</span>
            </label>
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
            <span>Split With</span>
            <span>Each</span>
            <span class="amount-cell">Amount</span>
            <span></span>
          </div>

          <div v-for="row in expenses" :key="row.id" class="table-row">
            <span class="row-date">{{ row.expense_date }}</span>
            <span class="row-description">{{ row.description }}</span>
            <span class="row-family">{{ row.paid_by_family }}</span>
            <span class="split-chips">
              <span
                v-for="family in splitFamiliesFor(row)"
                :key="`${row.id}-${family}`"
                class="split-chip"
              >
                {{ family }}
              </span>
            </span>
            <span class="row-each">
              <span class="mobile-value-label">Each family</span>
              <span>{{ perFamilyLabel(row) }}</span>
            </span>
            <span class="row-amount amount-cell">
              <span class="mobile-value-label">Total</span>
              <span>{{ formatCurrency(row.amount_cents) }}</span>
            </span>
            <button
              class="delete-btn"
              type="button"
              :disabled="deletingId !== null || !canDeleteExpense(row)"
              :aria-label="`Remove ${row.description}`"
              :title="canDeleteExpense(row) ? `Remove ${row.description}` : 'Only the creator can remove this expense'"
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

      <section class="settlement-section">
        <h2 class="section-title">Who Owes Who</h2>
        <p v-if="proofError" class="form-error settlement-error">{{ proofError }}</p>

        <div v-if="settlementRows.length === 0" class="empty-msg">
          Nothing to settle yet.
        </div>

        <div v-else class="settlement-list">
          <div
            v-for="row in settlementRows"
            :key="`${row.familyA}-${row.familyB}`"
            class="settlement-row"
          >
            <div class="settlement-pair">
              <span class="settlement-family">{{ row.familyA }}</span>
              <span class="settlement-copy">and</span>
              <span class="settlement-family">{{ row.familyB }}</span>
            </div>

            <div class="settlement-gross">
              <span>{{ row.familyA }} owes {{ row.familyB }} {{ formatCurrency(row.aOwesB) }}</span>
              <span>{{ row.familyB }} owes {{ row.familyA }} {{ formatCurrency(row.bOwesA) }}</span>
            </div>

            <div class="settlement-net">
              <template v-if="row.settlementCents > 0">
                <span class="settlement-family">{{ row.settlementFrom }}</span>
                <span class="settlement-copy">owes</span>
                <span class="settlement-family">{{ row.settlementTo }}</span>
                <span class="settlement-amount">{{ formatCurrency(row.settlementCents) }}</span>
              </template>
              <template v-else>
                <span class="settlement-copy">Settled evenly</span>
              </template>
            </div>

            <div class="settlement-summary">
              <span>Total net {{ formatCurrency(row.totalSettlementCents) }}</span>
              <span>Paid {{ formatCurrency(row.paidCents) }}</span>
              <span>Remaining {{ formatCurrency(row.remainingCents) }}</span>

              <div
                v-if="row.settlementCents > 0 && (canRecordSettlement(row) || canUploadProofForSettlementRow(row))"
                class="settlement-actions"
              >
                <button
                  v-if="canRecordSettlement(row)"
                  class="settlement-btn"
                  type="button"
                  :disabled="recordingSettlementKey === currentSettlementKey(row)"
                  title="Record that this payment was received"
                  @click="handleRecordSettlement(row)"
                >
                  <span v-if="recordingSettlementKey === currentSettlementKey(row)" class="delete-spinner"></span>
                  {{ recordingSettlementKey === currentSettlementKey(row) ? 'Marking...' : 'Mark as Received' }}
                </button>

                <label
                  v-if="canUploadProofForSettlementRow(row)"
                  class="settlement-btn proof-upload"
                  :class="{ 'settlement-btn--disabled': uploadingSettlementKey }"
                  title="Upload proof for this payment"
                >
                  Upload Proof
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    :disabled="Boolean(uploadingSettlementKey)"
                    @change="handleProofSelected(row, null, $event)"
                  />
                </label>
              </div>
            </div>

            <div v-if="row.settlements.length" class="payment-list">
              <div
                v-for="payment in row.settlements"
                :key="payment.id"
                class="payment-row"
              >
                <div class="payment-main">
                  <span class="settlement-family">{{ payment.from_family }}</span>
                  <span class="settlement-copy">paid</span>
                  <span class="settlement-family">{{ payment.to_family }}</span>
                  <span class="settlement-amount">{{ formatCurrency(payment.amount_cents) }}</span>
                  <span class="payment-status">{{ settlementStatus(payment) }}</span>
                </div>

                <div class="payment-actions">
                  <button
                    v-if="payment.confirmation_path"
                    class="text-btn"
                    type="button"
                    @click="handleOpenProof(payment)"
                  >
                    View Proof
                  </button>

                  <label
                    class="text-btn proof-upload"
                    :class="{ 'settlement-btn--disabled': !canUploadProof(payment) || uploadingSettlementKey === payment.id }"
                    :title="canUploadProof(payment) ? 'Upload payment confirmation' : 'Only the paying family can update proof'"
                  >
                    {{ proofLabel(payment) }}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      :disabled="!canUploadProof(payment) || uploadingSettlementKey === payment.id"
                      @change="handleProofSelected(row, payment, $event)"
                    />
                  </label>

                  <label
                    v-if="payment.settled"
                    class="received-status"
                    title="Payment receipt confirmed"
                  >
                    Received
                  </label>

                  <button
                    v-else-if="canConfirmReceived(payment)"
                    class="text-btn"
                    type="button"
                    :disabled="updatingSettlementId === payment.id"
                    title="Confirm this payment was received"
                    @click="handleConfirmReceived(payment)"
                  >
                    <span v-if="updatingSettlementId === payment.id" class="delete-spinner"></span>
                    {{ updatingSettlementId === payment.id ? 'Confirming...' : 'Confirm Received' }}
                  </button>

                  <button
                    class="delete-btn payment-delete"
                    type="button"
                    :disabled="deletingSettlementId !== null || !canDeleteSettlement(payment)"
                    :aria-label="`Remove ${payment.from_family} payment to ${payment.to_family}`"
                    :title="canDeleteSettlement(payment) ? 'Remove payment record' : 'Only the recorder can remove this payment'"
                    @click="handleDeleteSettlement(payment)"
                  >
                    <span v-if="deletingSettlementId === payment.id" class="delete-spinner"></span>
                    <svg v-else viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M3 4h10M6 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M5 4l.5 8h5L11 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
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

.split-field {
  margin-top: 4px;
}

.split-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 6px;
}

.split-error {
  min-height: 0;
}

.split-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.split-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid rgba(138, 122, 94, 0.5);
  border-radius: 4px;
  background: var(--parchment);
  color: var(--forest);
  font-size: 13px;
  cursor: pointer;
}

.split-option input {
  margin: 0;
}

.split-option--locked {
  border-color: rgba(196, 120, 72, 0.45);
  background: rgba(196, 120, 72, 0.08);
  color: var(--terracotta);
  cursor: default;
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
  grid-template-columns: 100px minmax(160px, 1fr) 110px minmax(150px, 1fr) 92px 110px 36px;
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
.row-amount,
.row-each {
  font-size: 13px;
  color: var(--driftwood);
}

.mobile-value-label {
  display: none;
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

.split-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.split-chip {
  display: inline-block;
  width: fit-content;
  border: 1px solid rgba(92, 138, 150, 0.25);
  border-radius: 20px;
  background: rgba(92, 138, 150, 0.08);
  color: var(--steel-sky);
  font-family: var(--font-sign);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 3px 8px;
}

.settlement-section {
  display: flex;
  flex-direction: column;
}

.settlement-list {
  background: var(--bg-white);
  border-left: 4px solid var(--steel-sky);
  border-radius: 0 6px 6px 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  overflow: hidden;
}

.settlement-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.85fr) minmax(250px, 1.25fr) minmax(220px, 1fr) minmax(220px, auto);
  gap: 14px;
  align-items: start;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.settlement-row:last-child {
  border-bottom: none;
}

.settlement-family {
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--terracotta);
}

.settlement-pair,
.settlement-net {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
}

.settlement-gross {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--driftwood);
  font-size: 13px;
  line-height: 1.35;
}

.settlement-copy {
  color: var(--driftwood);
  font-size: 13px;
}

.settlement-amount {
  font-weight: 700;
  color: var(--forest);
  white-space: nowrap;
}

.settlement-error {
  margin: -8px 0 14px;
}

.settlement-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--driftwood);
  font-size: 13px;
  line-height: 1.35;
  align-items: flex-end;
  text-align: right;
}

.settlement-actions,
.payment-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.settlement-actions {
  justify-self: end;
  justify-content: flex-end;
  margin-top: 8px;
}

.settlement-btn,
.text-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 30px;
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
}

.settlement-btn {
  padding: 8px 12px;
  border: 1px solid rgba(196, 120, 72, 0.35);
  background: rgba(196, 120, 72, 0.08);
  color: var(--terracotta);
}

.text-btn {
  padding: 6px 8px;
  border: 1px solid rgba(92, 138, 150, 0.25);
  background: rgba(92, 138, 150, 0.08);
  color: var(--steel-sky);
}

.settlement-btn:hover:not(:disabled),
.text-btn:hover:not(:disabled) {
  border-color: currentColor;
}

.settlement-btn:disabled,
.text-btn:disabled,
.settlement-btn--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.proof-upload {
  position: relative;
  overflow: hidden;
}

.proof-upload input {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
}

.payment-list {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 2px;
}

.payment-row {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(260px, auto);
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid rgba(92, 138, 150, 0.18);
  background: rgba(92, 138, 150, 0.05);
  border-radius: 4px;
}

.payment-main {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
}

.payment-status {
  font-size: 12px;
  color: var(--driftwood);
  font-style: italic;
}

.received-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 6px 8px;
  border: 1px solid rgba(78, 122, 91, 0.24);
  border-radius: 4px;
  background: rgba(78, 122, 91, 0.08);
  color: var(--forest);
  font-family: var(--font-sign);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.payment-delete {
  width: 30px;
  height: 30px;
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
  .split-chips,
  .row-each,
  .row-amount {
    grid-column: 1;
  }

  .row-description {
    font-size: 19px;
  }

  .amount-cell {
    text-align: left;
  }

  .row-each,
  .row-amount {
    display: grid;
    grid-template-columns: 112px auto;
    align-items: baseline;
    gap: 18px;
    width: 100%;
  }

  .row-each {
    margin-top: -4px;
  }

  .mobile-value-label {
    display: inline;
    font-family: var(--font-sign);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--driftwood);
  }

  .delete-btn {
    grid-column: 2;
    grid-row: 1 / span 6;
    align-self: center;
  }

  .settlement-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .settlement-actions,
  .payment-actions {
    justify-content: flex-start;
  }

  .payment-row {
    grid-template-columns: 1fr;
  }
}
</style>
