import { computed, ref } from 'vue'
import { getAuthState } from '../lib/authAccess'
import { bypassAuth, supabase } from '../lib/supabaseClient'
import {
  inviteAndSend,
  listInviteDeliveryAttempts,
  listInvites,
  listMagicLinkAttempts,
  removeInvite,
  upsertInvite,
} from '../lib/invitesApi'
import { FAMILIES } from '../lib/families'
import { fetchActiveUsersSummary } from '../lib/presenceApi'
import { fetchFunnelTelemetry } from '../lib/telemetryApi'

const DELIVERY_ATTEMPTS_LIMIT = 50
const MAGIC_LINK_ATTEMPTS_LIMIT = 50
const MAX_BATCH_CONCURRENCY = 3

const authLoading = ref(true)
const canManage = ref(false)
const accessError = ref('')

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

const magicLinkAttempts = ref([])
const loadingMagicLinkAttempts = ref(false)
const magicLinkAttemptsError = ref('')

const activeUsersSummary = ref({
  active_now_count: 0,
  total_active_members: 0,
  inactivity_minutes: 15,
  cutoff_at: null,
  items: [],
})
const loadingActiveUsers = ref(false)
const activeUsersError = ref('')

const funnelTelemetry = ref({
  window_minutes: 1440,
  summary: {},
  top_failures: [],
})
const loadingFunnelTelemetry = ref(false)
const funnelTelemetryError = ref('')

const operationProgress = ref({
  active: false,
  label: '',
  completed: 0,
  total: 0,
})

let attemptsRealtimeChannel = null
let sessionConsumers = 0
let initialized = false

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

const activeNowLabel = computed(() => {
  const summary = activeUsersSummary.value || {}
  return `${summary.active_now_count || 0} active now / ${summary.total_active_members || 0} invited`
})

const activeWindowLabel = computed(() => {
  const summary = activeUsersSummary.value || {}
  return `Inactivity window: ${summary.inactivity_minutes || 15}m`
})

const funnelSummary = computed(() => funnelTelemetry.value?.summary || {})
const funnelWindowHoursLabel = computed(() => {
  const minutes = Number(funnelTelemetry.value?.window_minutes || 1440)
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours}h window`
})

const funnelConversionRateLabel = computed(() => {
  const sent = Number(funnelSummary.value?.magic_link_requested_success || 0)
  const converted = Number(funnelSummary.value?.callback_session_exchange_success || 0)
  if (!sent) return '0%'
  const rate = Math.round((converted / sent) * 1000) / 10
  return `${rate}%`
})

const funnelTopFailures = computed(() => (
  Array.isArray(funnelTelemetry.value?.top_failures) ? funnelTelemetry.value.top_failures : []
))

function createBatchRow() {
  return {
    id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    email: '',
    display_name: '',
    family: '',
    role: 'member',
  }
}

function resetMessages() {
  errorMsg.value = ''
  successMsg.value = ''
  batchResult.value = null
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
  if (!row.email || !row.display_name || !row.family) return 'Missing required fields (email, display name, family).'
  if (!row.email.includes('@')) return 'Invalid email format.'
  return ''
}

function sortByCreatedDesc(rows) {
  return [...rows].sort((a, b) => (
    new Date(String(b?.created_at || 0)).getTime() - new Date(String(a?.created_at || 0)).getTime()
  ))
}

function upsertAttemptRows(existingRows, incomingRow, limit) {
  const incomingId = String(incomingRow?.id || '').trim()
  if (!incomingId) return existingRows

  const next = existingRows.filter((row) => String(row?.id || '') !== incomingId)
  next.unshift(incomingRow)
  return sortByCreatedDesc(next).slice(0, limit)
}

function removeAttemptRow(existingRows, rowId) {
  const key = String(rowId || '').trim()
  if (!key) return existingRows
  return existingRows.filter((row) => String(row?.id || '') !== key)
}

function applyResendProviderEvent(row) {
  const emailId = String(row?.email_id || '').trim()
  if (!emailId) return

  deliveryAttempts.value = deliveryAttempts.value.map((item) => {
    if (String(item?.provider_message_id || '').trim() !== emailId) return item
    return {
      ...item,
      latest_provider_event: String(row?.event_type || '').trim() || null,
      latest_provider_event_at: row?.occurred_at ?? null,
      latest_provider_event_message: row?.bounce_message ?? null,
    }
  })
}

async function refreshInvites() {
  if (!canManage.value || loadingInvites.value) return
  loadingInvites.value = true
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
  if (!canManage.value || loadingDeliveryAttempts.value) return
  loadingDeliveryAttempts.value = true
  deliveryAttemptsError.value = ''
  try {
    const data = await listInviteDeliveryAttempts({ limit: DELIVERY_ATTEMPTS_LIMIT })
    deliveryAttempts.value = Array.isArray(data?.items) ? data.items : []
  } catch (err) {
    deliveryAttemptsError.value = err?.message || 'Failed to load invite delivery attempts.'
  } finally {
    loadingDeliveryAttempts.value = false
  }
}

async function refreshMagicLinkAttempts() {
  if (!canManage.value || loadingMagicLinkAttempts.value) return
  loadingMagicLinkAttempts.value = true
  magicLinkAttemptsError.value = ''
  try {
    const data = await listMagicLinkAttempts({ limit: MAGIC_LINK_ATTEMPTS_LIMIT })
    magicLinkAttempts.value = Array.isArray(data?.items) ? data.items : []
  } catch (err) {
    magicLinkAttemptsError.value = err?.message || 'Failed to load magic link attempts.'
  } finally {
    loadingMagicLinkAttempts.value = false
  }
}

async function refreshActiveUsersSummary() {
  if (!canManage.value || loadingActiveUsers.value) return
  loadingActiveUsers.value = true
  activeUsersError.value = ''
  try {
    const data = await fetchActiveUsersSummary({ inactivityMinutes: 15 })
    activeUsersSummary.value = {
      active_now_count: Number(data?.active_now_count || 0),
      total_active_members: Number(data?.total_active_members || 0),
      inactivity_minutes: Number(data?.inactivity_minutes || 15),
      cutoff_at: data?.cutoff_at || null,
      items: Array.isArray(data?.items) ? data.items : [],
    }
  } catch (err) {
    activeUsersError.value = err?.message || 'Failed to load active users summary.'
  } finally {
    loadingActiveUsers.value = false
  }
}

async function refreshFunnelTelemetry() {
  if (!canManage.value || loadingFunnelTelemetry.value) return
  loadingFunnelTelemetry.value = true
  funnelTelemetryError.value = ''
  try {
    const data = await fetchFunnelTelemetry({ windowMinutes: 1440 })
    funnelTelemetry.value = {
      window_minutes: Number(data?.window_minutes || 1440),
      summary: data?.summary && typeof data.summary === 'object' ? data.summary : {},
      top_failures: Array.isArray(data?.top_failures) ? data.top_failures : [],
    }
  } catch (err) {
    funnelTelemetryError.value = err?.message || 'Failed to load funnel telemetry.'
  } finally {
    loadingFunnelTelemetry.value = false
  }
}

async function refreshAllAdminData() {
  await Promise.all([
    refreshInvites(),
    refreshDeliveryAttempts(),
    refreshMagicLinkAttempts(),
    refreshActiveUsersSummary(),
    refreshFunnelTelemetry(),
  ])
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
  batchResult.value = { label, total, sent: completed, failed }

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
  operationProgress.value = { active: total > 0, label, completed: 0, total }
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

async function processInviteRows({ rows, initialFailed = [], label, verb, failureVerb = 'send', emptyError, onRow }) {
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
          failed.push({ email, reason: err?.message || `Failed to ${failureVerb} invite.` })
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
      ? { label: 'Save invites', total: parsed.failed.length, sent: 0, failed: parsed.failed }
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
      ? { label: 'Save + send invites', total: parsed.failed.length, sent: 0, failed: parsed.failed }
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

function updateBatchRow({ rowId, field, value }) {
  const allowed = new Set(['email', 'display_name', 'family', 'role'])
  if (!allowed.has(field)) return

  batchRows.value = batchRows.value.map((row) => (
    row.id === rowId ? { ...row, [field]: value } : row
  ))
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

async function resendInvite(row) {
  await runInviteBatch([row], `Resend ${row?.email || 'invite'}`)
}

async function removeInviteRow(row) {
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

function startAttemptsRealtime() {
  if (!supabase || attemptsRealtimeChannel || !canManage.value) return

  attemptsRealtimeChannel = supabase
    .channel('admin-attempts-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'invite_delivery_attempts' },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          deliveryAttempts.value = removeAttemptRow(deliveryAttempts.value, payload.old?.id)
          return
        }

        const row = payload.new || null
        if (!row) return
        deliveryAttempts.value = upsertAttemptRows(
          deliveryAttempts.value,
          {
            ...row,
            latest_provider_event: null,
            latest_provider_event_at: null,
            latest_provider_event_message: null,
          },
          DELIVERY_ATTEMPTS_LIMIT,
        )
        void refreshActiveUsersSummary()
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'magic_link_attempts' },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          magicLinkAttempts.value = removeAttemptRow(magicLinkAttempts.value, payload.old?.id)
          return
        }

        const row = payload.new || null
        if (!row) return
        magicLinkAttempts.value = upsertAttemptRows(magicLinkAttempts.value, row, MAGIC_LINK_ATTEMPTS_LIMIT)
        void refreshActiveUsersSummary()
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'resend_email_events' },
      (payload) => {
        if (payload.eventType === 'DELETE') return
        applyResendProviderEvent(payload.new || null)
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_presence' },
      () => {
        void refreshActiveUsersSummary()
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'funnel_events' },
      () => {
        void refreshFunnelTelemetry()
      },
    )
    .subscribe()
}

function stopAttemptsRealtime() {
  if (!supabase || !attemptsRealtimeChannel) return
  supabase.removeChannel(attemptsRealtimeChannel)
  attemptsRealtimeChannel = null
}

async function ensureAdminAccess() {
  if (initialized) return

  accessError.value = ''
  if (bypassAuth) {
    canManage.value = true
    authLoading.value = false
    initialized = true
    startAttemptsRealtime()
    await refreshAllAdminData()
    return
  }

  try {
    const state = await getAuthState()
    canManage.value = Boolean(state?.signedIn && state?.profile?.role === 'admin' && state?.profile?.active)
    authLoading.value = false
    initialized = true

    if (canManage.value) {
      startAttemptsRealtime()
      await refreshAllAdminData()
    }
  } catch (err) {
    accessError.value = err?.message || 'Could not verify admin access.'
    authLoading.value = false
    initialized = true
  }
}

async function startAdminSession() {
  sessionConsumers += 1
  await ensureAdminAccess()
}

function endAdminSession() {
  sessionConsumers = Math.max(0, sessionConsumers - 1)
  if (sessionConsumers === 0) stopAttemptsRealtime()
}

export function useAdminData() {
  return {
    authLoading,
    canManage,
    accessError,
    invites,
    sortedInvites,
    selectedEmails,
    allSelected,
    activeInviteRows,
    selectedInviteRows,
    batchRows,
    activeInvite,
    familyOptions,
    batchResult,
    loadingInvites,
    loadingDeliveryAttempts,
    loadingMagicLinkAttempts,
    loadingActiveUsers,
    loadingFunnelTelemetry,
    saving,
    deliveryAttempts,
    magicLinkAttempts,
    activeUsersSummary,
    funnelTelemetry,
    funnelSummary,
    funnelTopFailures,
    errorMsg,
    successMsg,
    progressMessage,
    deliveryAttemptsError,
    magicLinkAttemptsError,
    activeUsersError,
    funnelTelemetryError,
    enteredBatchRowCount,
    saveOnlyLabel,
    saveAndSendLabel,
    canSubmit,
    canAddAnotherRow,
    canSendSelected,
    canSendAllActive,
    activeNowLabel,
    activeWindowLabel,
    funnelWindowHoursLabel,
    funnelConversionRateLabel,
    startAdminSession,
    endAdminSession,
    refreshAllAdminData,
    refreshInvites,
    refreshDeliveryAttempts,
    refreshMagicLinkAttempts,
    refreshActiveUsersSummary,
    refreshFunnelTelemetry,
    updateBatchRow,
    addBatchRow,
    addBatchRowAfter,
    removeBatchRow,
    saveInviteOnly,
    saveAndSend,
    sendSelectedBatch,
    sendAllActiveBatch,
    resendInvite,
    removeInviteRow,
    setAllSelected,
    toggleSelection,
    resetMessages,
  }
}
