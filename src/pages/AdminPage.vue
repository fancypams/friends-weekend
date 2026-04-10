<script setup>
import { computed, onMounted, ref } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import { getAuthState } from '../lib/authAccess'
import { bypassAuth } from '../lib/supabaseClient'
import {
  inviteAndSend,
  listInviteDeliveryAttempts,
  listInvites,
  listMagicLinkAttempts,
  removeInvite,
  upsertInvite,
} from '../lib/invitesApi'
import { FAMILIES } from '../lib/families'

const authLoading = ref(true)
const canManage = ref(false)
const invites = ref([])
const loadingInvites = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
const selectedEmails = ref([])
const batchResult = ref(null)
const activeInvite = ref(true)
const batchRows = ref([createBatchRow()])
const deliveryAttempts = ref([])
const loadingDeliveryAttempts = ref(false)
const deliveryAttemptsError = ref('')
const deliveryAttemptsLimit = 50
const magicLinkAttempts = ref([])
const loadingMagicLinkAttempts = ref(false)
const magicLinkAttemptsError = ref('')
const magicLinkAttemptsLimit = 50
const operationProgress = ref({
  active: false,
  label: '',
  completed: 0,
  total: 0,
})
const MAX_BATCH_CONCURRENCY = 3

const sortedInvites = computed(() => (
  [...invites.value].sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')))
))

const familyOptions = computed(() => {
  const set = new Set(FAMILIES)
  for (const row of invites.value) {
    const value = String(row?.family || '').trim()
    if (value) set.add(value)
  }
  return [...set]
})

const enteredBatchRowCount = computed(() => (
  batchRows.value.filter((row) => (
    String(row?.email || '').trim()
    || String(row?.display_name || '').trim()
    || String(row?.family || '').trim()
  )).length
))
const inviteCountLabel = computed(() => (enteredBatchRowCount.value === 1 ? 'invite' : 'invites'))
const saveOnlyLabel = computed(() => `Save ${inviteCountLabel.value}`)
const saveAndSendLabel = computed(() => `Save + send ${inviteCountLabel.value}`)
const canSubmit = computed(() => !saving.value && enteredBatchRowCount.value > 0)
const canAddAnotherRow = computed(() => {
  const lastRow = batchRows.value[batchRows.value.length - 1] || null
  if (!lastRow) return false
  return !getBatchRowValidationError(lastRow)
})
const selectedInviteRows = computed(() => {
  const selected = new Set(selectedEmails.value)
  return sortedInvites.value.filter((row) => selected.has(String(row?.email || '').toLowerCase()))
})
const allSelected = computed(() => (
  sortedInvites.value.length > 0 && selectedEmails.value.length === sortedInvites.value.length
))
const activeInviteRows = computed(() => (
  sortedInvites.value.filter((row) => row?.active !== false && String(row?.email || '').includes('@'))
))
const canSendSelected = computed(() => !saving.value && selectedInviteRows.value.length > 0)
const canSendAllActive = computed(() => !saving.value && activeInviteRows.value.length > 0)
const progressMessage = computed(() => {
  if (!operationProgress.value.active || operationProgress.value.total <= 0) return ''
  return `${operationProgress.value.label}: ${operationProgress.value.completed}/${operationProgress.value.total}`
})

function resetMessages() {
  errorMsg.value = ''
  successMsg.value = ''
  batchResult.value = null
}

function createBatchRow() {
  return {
    id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    email: '',
    display_name: '',
    family: '',
    role: 'member',
  }
}

function normalizeBatchRow(rawRow) {
  return {
    email: String(rawRow?.email || '').trim().toLowerCase(),
    display_name: String(rawRow?.display_name || '').trim(),
    family: String(rawRow?.family || '').trim(),
    role: rawRow?.role === 'admin' ? 'admin' : 'member',
  }
}

function getBatchRowValidationError(rawRow) {
  const row = normalizeBatchRow(rawRow)
  if (!row.email && !row.display_name && !row.family) return 'Row is empty.'
  if (!row.email || !row.display_name || !row.family) {
    return 'Missing required fields (email, display name, family).'
  }
  if (!row.email.includes('@')) return 'Invalid email format.'
  return ''
}

async function refreshInvites() {
  if (!canManage.value) return
  loadingInvites.value = true
  errorMsg.value = ''
  try {
    const data = await listInvites()
    invites.value = Array.isArray(data?.items) ? data.items : []
    const validEmails = new Set(
      invites.value
        .map((row) => String(row?.email || '').trim().toLowerCase())
        .filter(Boolean),
    )
    selectedEmails.value = selectedEmails.value.filter((email) => validEmails.has(email))
  } catch (err) {
    errorMsg.value = err?.message || 'Failed to load invites.'
  } finally {
    loadingInvites.value = false
  }
}

async function refreshDeliveryAttempts() {
  if (!canManage.value) return
  loadingDeliveryAttempts.value = true
  deliveryAttemptsError.value = ''
  try {
    const data = await listInviteDeliveryAttempts({ limit: deliveryAttemptsLimit })
    deliveryAttempts.value = Array.isArray(data?.items) ? data.items : []
  } catch (err) {
    deliveryAttemptsError.value = err?.message || 'Failed to load invite delivery attempts.'
  } finally {
    loadingDeliveryAttempts.value = false
  }
}

async function refreshMagicLinkAttempts() {
  if (!canManage.value) return
  loadingMagicLinkAttempts.value = true
  magicLinkAttemptsError.value = ''
  try {
    const data = await listMagicLinkAttempts({ limit: magicLinkAttemptsLimit })
    magicLinkAttempts.value = Array.isArray(data?.items) ? data.items : []
  } catch (err) {
    magicLinkAttemptsError.value = err?.message || 'Failed to load magic link attempts.'
  } finally {
    loadingMagicLinkAttempts.value = false
  }
}

function formatAttemptTime(value) {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function collectBatchRows() {
  const seen = new Set()
  const rows = []
  const failed = []

  for (const [index, rawRow] of batchRows.value.entries()) {
    const normalized = normalizeBatchRow(rawRow)
    const { email, display_name, family, role } = normalized
    const rowLabel = email || `Row ${index + 1}`
    const key = `${email}::${display_name}::${family}::${role}`

    const validationError = getBatchRowValidationError(rawRow)
    if (validationError === 'Row is empty.') continue
    if (validationError) {
      failed.push({ email: rowLabel, reason: validationError })
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)

    rows.push({
      email,
      display_name,
      family,
      role,
      active: Boolean(activeInvite.value),
    })
  }

  return { rows, failed }
}

function missingInviteFieldsReason(row) {
  const missing = []
  if (!String(row?.email || '').trim()) missing.push('email')
  if (!String(row?.display_name || '').trim()) missing.push('display name')
  if (!String(row?.family || '').trim()) missing.push('family')
  if (!missing.length) return ''
  return `Missing ${missing.join(', ')}.`
}

function setOperationSummary({ label, verb, completed, total, failed }) {
  batchResult.value = {
    label,
    total,
    sent: completed,
    failed,
  }

  if (!failed.length) {
    successMsg.value = `${label}: ${verb} ${completed} of ${total}.`
    return
  }
  if (completed > 0) {
    errorMsg.value = `${label}: ${verb} ${completed} of ${total}. ${failed.length} failed.`
    return
  }
  errorMsg.value = `${label}: all ${total} failed.`
}

function startOperationProgress(label, total) {
  operationProgress.value = {
    active: total > 0,
    label,
    completed: 0,
    total,
  }
}

function incrementOperationProgress() {
  operationProgress.value = {
    ...operationProgress.value,
    completed: operationProgress.value.completed + 1,
  }
}

function stopOperationProgress() {
  operationProgress.value = {
    ...operationProgress.value,
    active: false,
  }
}

async function processInviteRows({
  rows,
  initialFailed = [],
  label,
  verb,
  failureVerb = 'send',
  emptyError,
  onRow,
}) {
  if (!rows.length && !initialFailed.length) {
    errorMsg.value = emptyError
    return { completed: 0, failed: [], total: 0 }
  }

  saving.value = true
  resetMessages()
  startOperationProgress(label, rows.length)

  let completed = 0
  const failed = [...initialFailed]
  let nextIndex = 0

  const workers = Array.from(
    { length: Math.min(MAX_BATCH_CONCURRENCY, rows.length) },
    async () => {
      while (true) {
        const currentIndex = nextIndex
        nextIndex += 1
        if (currentIndex >= rows.length) return

        const row = rows[currentIndex]
        const email = String(row?.email || '').trim().toLowerCase()
        const missingReason = missingInviteFieldsReason(row)

        if (!email) {
          failed.push({ email: '(missing email)', reason: 'Missing email.' })
          incrementOperationProgress()
          continue
        }
        if (missingReason) {
          failed.push({ email, reason: missingReason })
          incrementOperationProgress()
          continue
        }

        try {
          await onRow(row)
          completed += 1
        } catch (err) {
          failed.push({
            email,
            reason: err?.message || `Failed to ${failureVerb} invite.`,
          })
        } finally {
          incrementOperationProgress()
        }
      }
    },
  )

  await Promise.all(workers)

  const total = rows.length + initialFailed.length
  setOperationSummary({ label, verb, completed, total, failed })

  try {
    await refreshInvites()
  } finally {
    stopOperationProgress()
    saving.value = false
  }

  return { completed, failed, total }
}

async function runInviteBatch(rows, contextLabel = 'Batch send', initialFailed = []) {
  await processInviteRows({
    rows,
    initialFailed,
    label: contextLabel,
    verb: 'sent',
    failureVerb: 'send',
    emptyError: 'No invites to send.',
    onRow: async (row) => {
      await inviteAndSend({
        email: String(row.email).trim().toLowerCase(),
        display_name: String(row.display_name).trim(),
        family: String(row.family).trim(),
        role: row?.role === 'admin' ? 'admin' : 'member',
        active: row?.active !== false,
      })
    },
  })
  await refreshDeliveryAttempts()
  await refreshMagicLinkAttempts()
}

async function saveInviteOnly() {
  if (!canSubmit.value) return
  const parsed = collectBatchRows()
  if (!parsed.rows.length) {
    errorMsg.value = 'Add at least one valid row with email, display name, family, and role.'
    successMsg.value = ''
    batchResult.value = parsed.failed.length
      ? {
        label: 'Save invites',
        total: parsed.failed.length,
        sent: 0,
        failed: parsed.failed,
      }
      : null
    return
  }

  await processInviteRows({
    rows: parsed.rows,
    initialFailed: parsed.failed,
    label: 'Save invites',
    verb: 'saved',
    failureVerb: 'save',
    emptyError: 'No invites to save.',
    onRow: async (row) => {
      await upsertInvite({
        email: row.email,
        display_name: row.display_name,
        family: row.family,
        role: row.role,
        active: row.active !== false,
      })
    },
  })
}

async function saveAndSend() {
  if (saving.value) return
  const parsed = collectBatchRows()
  if (!parsed.rows.length) {
    errorMsg.value = 'Add at least one valid row with email, display name, family, and role.'
    successMsg.value = ''
    batchResult.value = parsed.failed.length
      ? {
        label: 'Save + send invites',
        total: parsed.failed.length,
        sent: 0,
        failed: parsed.failed,
      }
      : null
    return
  }

  await runInviteBatch(parsed.rows, 'Save + send invites', parsed.failed)
}

function addBatchRow() {
  batchRows.value = [...batchRows.value, createBatchRow()]
}

function addBatchRowAfter(rowId) {
  const index = batchRows.value.findIndex((row) => row.id === rowId)
  if (index < 0) {
    addBatchRow()
    return
  }
  const next = [...batchRows.value]
  next.splice(index + 1, 0, createBatchRow())
  batchRows.value = next
}

function removeBatchRow(rowId) {
  if (batchRows.value.length <= 1) {
    batchRows.value = [createBatchRow()]
    return
  }
  batchRows.value = batchRows.value.filter((row) => row.id !== rowId)
}

function toggleSelection(email, checked) {
  const key = String(email || '').trim().toLowerCase()
  if (!key) return
  if (checked) {
    if (!selectedEmails.value.includes(key)) {
      selectedEmails.value = [...selectedEmails.value, key]
    }
    return
  }
  selectedEmails.value = selectedEmails.value.filter((value) => value !== key)
}

function isSelected(email) {
  const key = String(email || '').trim().toLowerCase()
  return selectedEmails.value.includes(key)
}

function setAllSelected(checked) {
  if (checked) {
    selectedEmails.value = sortedInvites.value
      .map((row) => String(row?.email || '').trim().toLowerCase())
      .filter(Boolean)
    return
  }
  selectedEmails.value = []
}

async function sendSelectedBatch() {
  if (!canSendSelected.value) return
  await runInviteBatch(selectedInviteRows.value, 'Send selected invites')
}

async function sendAllActiveBatch() {
  if (!canSendAllActive.value) return
  await runInviteBatch(activeInviteRows.value, 'Send all active invites')
}

async function resend(row) {
  await runInviteBatch([row], `Resend ${row?.email || 'invite'}`)
}

async function remove(row) {
  const email = String(row?.email || '').trim().toLowerCase()
  if (!email) return
  const confirmed = window.confirm(`Remove invite for ${email}?`)
  if (!confirmed) return

  saving.value = true
  resetMessages()
  try {
    await removeInvite(email)
    successMsg.value = `Removed ${email}.`
    await refreshInvites()
  } catch (err) {
    errorMsg.value = err?.message || 'Failed to remove invite.'
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  if (bypassAuth) {
    canManage.value = true
    authLoading.value = false
    await refreshInvites()
    await refreshDeliveryAttempts()
    await refreshMagicLinkAttempts()
    return
  }

  try {
    const state = await getAuthState()
    canManage.value = Boolean(state?.signedIn && state?.profile?.role === 'admin' && state?.profile?.active)
    if (canManage.value) {
      await refreshInvites()
      await refreshDeliveryAttempts()
      await refreshMagicLinkAttempts()
    }
  } catch (err) {
    errorMsg.value = err?.message || 'Could not verify admin access.'
  } finally {
    authLoading.value = false
  }
})
</script>

<template>
  <div class="admin-page">
    <HeroHeader show-back />

    <main class="admin-content page-main">
      <section class="panel admin-panel">
        <p class="section-label">Admin</p>
        <h2 class="welcome-heading">Invite Manager</h2>

        <p v-if="authLoading" class="muted">Checking access…</p>
        <p v-else-if="!canManage" class="error-text">Admin access required.</p>

        <template v-else>
          <p class="intro">
            Manage invites in one place. Add one row for an individual invite or multiple rows for batch sending.
          </p>

          <form class="invite-form" @submit.prevent="saveAndSend">
            <label class="active-check">
              <input v-model="activeInvite" type="checkbox" />
              <span>Active invite</span>
            </label>

            <section class="batch-editor">
              <div class="batch-head">
                <span>Invite rows</span>
              </div>
              <p class="batch-help">Each row requires email, display name, family, and role.</p>
              <div class="batch-grid">
                <div class="batch-grid-head">Email</div>
                <div class="batch-grid-head">Display Name</div>
                <div class="batch-grid-head">Family</div>
                <div class="batch-grid-head">Role</div>
                <div class="batch-grid-head">Action</div>

                <template v-for="(row, index) in batchRows" :key="row.id">
                  <input
                    v-model="row.email"
                    type="email"
                    autocomplete="off"
                    placeholder="friend@example.com"
                    :disabled="saving"
                  />
                  <input
                    v-model="row.display_name"
                    type="text"
                    autocomplete="off"
                    placeholder="Alex"
                    :disabled="saving"
                  />
                  <select v-model="row.family" :disabled="saving">
                    <option value="" disabled>Select family</option>
                    <option v-for="family in familyOptions" :key="`batch-${row.id}-${family}`" :value="family">
                      {{ family }}
                    </option>
                  </select>
                  <select v-model="row.role" :disabled="saving">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button class="btn danger batch-remove" type="button" :disabled="saving" @click="removeBatchRow(row.id)">
                    Remove
                  </button>
                  <div v-if="index === batchRows.length - 1" class="batch-row-add-wrap">
                    <button
                      class="batch-add-inline"
                      type="button"
                      :disabled="saving || !canAddAnotherRow"
                      :aria-label="`Add row after ${row.email || 'this row'}`"
                      @click="addBatchRowAfter(row.id)"
                    >
                      +
                    </button>
                  </div>
                </template>
              </div>
            </section>

            <div class="actions">
              <button class="btn soft" type="button" :disabled="!canSubmit" @click="saveInviteOnly">
                {{ saveOnlyLabel }}
              </button>
              <button class="btn primary" type="submit" :disabled="!canSubmit">
                {{ saveAndSendLabel }}
              </button>
            </div>
          </form>

          <p v-if="successMsg" class="success-text">{{ successMsg }}</p>
          <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>
          <p v-if="progressMessage" class="muted progress-text">{{ progressMessage }}</p>

          <div class="list-head">
            <h3>Current invites</h3>
            <div class="list-head-actions">
              <button class="btn soft" type="button" :disabled="!canSendSelected" @click="sendSelectedBatch">
                Send selected
              </button>
              <button class="btn soft" type="button" :disabled="!canSendAllActive" @click="sendAllActiveBatch">
                Send all active
              </button>
              <button class="btn soft" type="button" :disabled="loadingInvites || saving" @click="refreshInvites">
                {{ loadingInvites ? 'Refreshing…' : 'Refresh' }}
              </button>
            </div>
          </div>

          <p v-if="loadingInvites" class="muted">Loading invites…</p>
          <p v-else-if="!sortedInvites.length" class="muted">No invites yet.</p>

          <table v-else class="invite-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    :checked="allSelected"
                    :disabled="saving || !sortedInvites.length"
                    @change="setAllSelected($event.target.checked)"
                    aria-label="Select all invites"
                  />
                </th>
                <th>Email</th>
                <th>Name</th>
                <th>Family</th>
                <th>Role</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sortedInvites" :key="row.email">
                <td>
                  <input
                    type="checkbox"
                    :checked="isSelected(row.email)"
                    :disabled="saving"
                    :aria-label="`Select ${row.email}`"
                    @change="toggleSelection(row.email, $event.target.checked)"
                  />
                </td>
                <td>{{ row.email }}</td>
                <td>{{ row.display_name || '—' }}</td>
                <td>{{ row.family || '—' }}</td>
                <td>{{ row.role }}</td>
                <td>{{ row.active ? 'Yes' : 'No' }}</td>
                <td class="row-actions">
                  <button class="btn soft" type="button" :disabled="saving" @click="resend(row)">Resend</button>
                  <button class="btn danger" type="button" :disabled="saving" @click="remove(row)">Remove</button>
                </td>
              </tr>
            </tbody>
          </table>

          <section v-if="batchResult" class="batch-result" aria-live="polite">
            <p class="batch-result-title">
              {{ batchResult.label }}: {{ batchResult.sent }} sent / {{ batchResult.total }} total
            </p>
            <ul v-if="batchResult.failed?.length" class="batch-fail-list">
              <li v-for="item in batchResult.failed" :key="`${item.email}-${item.reason}`">
                <strong>{{ item.email }}:</strong> {{ item.reason }}
              </li>
            </ul>
          </section>

          <section class="delivery-attempts">
            <div class="list-head">
              <h3>Invite delivery attempts</h3>
              <button
                class="btn soft"
                type="button"
                :disabled="loadingDeliveryAttempts || saving"
                @click="refreshDeliveryAttempts"
              >
                {{ loadingDeliveryAttempts ? 'Refreshing…' : 'Refresh invite attempts' }}
              </button>
            </div>

            <p v-if="deliveryAttemptsError" class="error-text">{{ deliveryAttemptsError }}</p>
            <p v-else-if="loadingDeliveryAttempts" class="muted">Loading invite delivery attempts…</p>
            <p v-else-if="!deliveryAttempts.length" class="muted">No invite delivery attempts yet.</p>

            <table v-else class="invite-table attempts-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Stage</th>
                  <th>Error</th>
                  <th>Provider ID</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in deliveryAttempts" :key="row.id">
                  <td>{{ formatAttemptTime(row.created_at) }}</td>
                  <td>{{ row.email }}</td>
                  <td>
                    <span class="attempt-status" :class="row.status === 'success' ? 'ok' : 'fail'">
                      {{ row.status }}
                    </span>
                  </td>
                  <td>{{ row.failure_stage || '—' }}</td>
                  <td>{{ row.error_message || '—' }}</td>
                  <td>{{ row.provider_message_id || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="delivery-attempts">
            <div class="list-head">
              <h3>Magic link attempts</h3>
              <button
                class="btn soft"
                type="button"
                :disabled="loadingMagicLinkAttempts || saving"
                @click="refreshMagicLinkAttempts"
              >
                {{ loadingMagicLinkAttempts ? 'Refreshing…' : 'Refresh magic links' }}
              </button>
            </div>

            <p v-if="magicLinkAttemptsError" class="error-text">{{ magicLinkAttemptsError }}</p>
            <p v-else-if="loadingMagicLinkAttempts" class="muted">Loading magic link attempts…</p>
            <p v-else-if="!magicLinkAttempts.length" class="muted">No magic link attempts yet.</p>

            <table v-else class="invite-table attempts-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Stage</th>
                  <th>Error</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in magicLinkAttempts" :key="`magic-${row.id}`">
                  <td>{{ formatAttemptTime(row.created_at) }}</td>
                  <td>{{ row.email }}</td>
                  <td>
                    <span class="attempt-status" :class="row.status === 'success' ? 'ok' : 'fail'">
                      {{ row.status }}
                    </span>
                  </td>
                  <td>{{ row.failure_stage || '—' }}</td>
                  <td>{{ row.error_message || '—' }}</td>
                  <td>{{ row.source || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>
      </section>
    </main>
  </div>
</template>

<style scoped>
.admin-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.admin-content {
  max-width: var(--page-shell-max-width);
  margin: 0 auto;
  padding: 44px 24px 80px;
  width: 100%;
}

.admin-panel {
  display: grid;
  gap: 14px;
}

.section-label {
  font-family: var(--font-sign);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sky-label);
  margin: 0;
}

.welcome-heading {
  margin: 0;
}

.intro {
  margin: 0;
  color: var(--warm-brown-muted);
}

.muted {
  margin: 0;
  color: var(--warm-brown-muted);
}

.invite-form {
  display: grid;
  gap: 12px;
  max-width: 560px;
}

label {
  display: grid;
  gap: 6px;
}

label span {
  font-family: var(--font-sign);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sky-label);
}

input,
select {
  border: 1px solid rgba(92, 138, 150, 0.35);
  border-radius: 10px;
  min-height: 42px;
  padding: 10px 12px;
  font-family: var(--font-sans);
  font-size: 15px;
  background: #fff;
}

.active-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.active-check input {
  min-height: 16px;
  width: 16px;
  margin: 0;
}

.batch-help {
  margin: 0;
  color: var(--warm-brown-muted);
  font-size: 0.84rem;
}

.batch-editor {
  border: 1px solid rgba(92, 138, 150, 0.2);
  border-radius: 10px;
  padding: 10px;
  background: #f9fbfc;
  display: grid;
  gap: 10px;
}

.batch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.batch-head span {
  font-family: var(--font-sign);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sky-label);
}

.batch-grid {
  display: grid;
  grid-template-columns: 1.5fr 1.2fr 1fr 0.8fr auto;
  gap: 8px;
  align-items: center;
}

.batch-grid-head {
  font-family: var(--font-sign);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sky-label);
}

.batch-remove {
  min-height: 42px;
}

.batch-row-add-wrap {
  grid-column: 1 / -1;
  display: grid;
  justify-items: center;
  margin-top: -2px;
  margin-bottom: 2px;
}

.batch-add-inline {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid rgba(92, 138, 150, 0.35);
  background: #eef4f6;
  color: var(--forest);
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}

.batch-add-inline:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.actions {
  display: flex;
  gap: 10px;
}

.btn {
  border: 1px solid transparent;
  border-radius: 999px;
  min-height: 40px;
  padding: 10px 14px;
  font-size: 0.86rem;
  font-weight: 650;
  cursor: pointer;
}

.btn.primary {
  background: var(--forest);
  color: #fff;
}

.btn.soft {
  background: #ecf3f4;
  color: var(--forest);
  border-color: rgba(92, 138, 150, 0.25);
}

.btn.danger {
  background: #fff3f2;
  color: #8b2f22;
  border-color: rgba(168, 66, 49, 0.25);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}

.list-head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.list-head h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.15rem;
  color: var(--forest);
}

.invite-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}

.invite-table th,
.invite-table td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid rgba(92, 138, 150, 0.18);
}

.invite-table input[type='checkbox'] {
  width: 16px;
  height: 16px;
}

.invite-table th {
  font-family: var(--font-sign);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sky-label);
}

.row-actions {
  display: flex;
  gap: 8px;
}

.batch-result {
  border: 1px solid rgba(92, 138, 150, 0.22);
  border-radius: 10px;
  background: #f8fbfc;
  padding: 12px;
  display: grid;
  gap: 8px;
}

.batch-result-title {
  margin: 0;
  color: var(--forest);
  font-family: var(--font-sign);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.batch-fail-list {
  margin: 0;
  padding-left: 18px;
  color: var(--warm-brown-muted);
  font-size: 0.9rem;
}

.progress-text {
  font-family: var(--font-sign);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.delivery-attempts {
  display: grid;
  gap: 8px;
}

.attempts-table td {
  vertical-align: top;
}

.attempt-status {
  display: inline-block;
  border-radius: 999px;
  padding: 3px 8px;
  font-family: var(--font-sign);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.attempt-status.ok {
  background: #e8f4ec;
  color: #205d34;
}

.attempt-status.fail {
  background: #fff1ef;
  color: #9a2c1f;
}

@media (max-width: 760px) {
  .admin-content {
    padding: 30px 16px 56px;
  }

  .actions {
    flex-wrap: wrap;
  }

  .invite-table {
    display: block;
    overflow-x: auto;
    white-space: nowrap;
  }

  .batch-grid {
    grid-template-columns: 1fr;
  }

  .batch-grid-head {
    display: none;
  }
}
</style>
