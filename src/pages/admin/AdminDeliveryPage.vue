<script setup>
import { computed, ref } from 'vue'
import AdminInviteAttemptsTable from '../../components/admin/AdminInviteAttemptsTable.vue'
import AdminMagicLinkAttemptsTable from '../../components/admin/AdminMagicLinkAttemptsTable.vue'
import { useAdminData } from '../../composables/useAdminData'

const admin = useAdminData()
const searchQuery = ref('')
const statusFilter = ref('all')

const deliveryFailures = computed(() => (
  admin.deliveryAttempts.value.filter((row) => String(row?.status || '').toLowerCase() !== 'success')
))

const magicFailures = computed(() => (
  admin.magicLinkAttempts.value.filter((row) => String(row?.status || '').toLowerCase() !== 'success')
))

const troubleshootingItems = computed(() => {
  const mapped = [
    ...deliveryFailures.value.map((row) => ({
      id: `delivery-${row.id}`,
      source: 'Invite delivery',
      email: row.email,
      status: row.status,
      stage: row.failure_stage || '—',
      error: row.error_message || '—',
      created_at: row.created_at,
    })),
    ...magicFailures.value.map((row) => ({
      id: `magic-${row.id}`,
      source: 'Magic link',
      email: row.email,
      status: row.status,
      stage: row.failure_stage || '—',
      error: row.error_message || '—',
      created_at: row.created_at,
    })),
  ]
  return mapped
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)
})

function rowMatches(row) {
  const query = searchQuery.value.trim().toLowerCase()
  const status = String(row?.status || '').toLowerCase()
  const stage = String(row?.failure_stage || '').toLowerCase()
  const email = String(row?.email || '').toLowerCase()
  const error = String(row?.error_message || '').toLowerCase()

  const statusOk = statusFilter.value === 'all' || status === statusFilter.value
  if (!statusOk) return false
  if (!query) return true
  return email.includes(query) || stage.includes(query) || error.includes(query) || status.includes(query)
}

const filteredDelivery = computed(() => admin.deliveryAttempts.value.filter(rowMatches))
const filteredMagic = computed(() => admin.magicLinkAttempts.value.filter(rowMatches))
</script>

<template>
  <section class="filters">
    <label>
      <span>Search email / stage / error</span>
      <input v-model="searchQuery" type="text" placeholder="Find failures…" />
    </label>
    <label>
      <span>Status</span>
      <select v-model="statusFilter">
        <option value="all">All</option>
        <option value="success">Success</option>
        <option value="failed">Failed</option>
        <option value="rate_limited">Rate limited</option>
      </select>
    </label>
  </section>

  <section class="troubleshoot-card">
    <h3>Recent troubleshooting queue</h3>
    <p v-if="!troubleshootingItems.length" class="muted">No recent delivery failures.</p>
    <ul v-else class="troubleshoot-list">
      <li v-for="item in troubleshootingItems" :key="item.id">
        <strong>{{ item.source }}</strong> · {{ item.email }} · {{ item.stage }} · {{ item.error }}
      </li>
    </ul>
  </section>

  <AdminInviteAttemptsTable
    :rows="filteredDelivery"
    :loading="admin.loadingDeliveryAttempts.value"
    :saving="admin.saving.value"
    :error="admin.deliveryAttemptsError.value"
    @refresh="admin.refreshDeliveryAttempts"
  />

  <AdminMagicLinkAttemptsTable
    :rows="filteredMagic"
    :loading="admin.loadingMagicLinkAttempts.value"
    :saving="admin.saving.value"
    :error="admin.magicLinkAttemptsError.value"
    @refresh="admin.refreshMagicLinkAttempts"
  />
</template>

<style scoped>
.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

label {
  display: grid;
  gap: 6px;
  min-width: 240px;
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
  min-height: 40px;
  padding: 8px 10px;
  font-family: var(--font-sans);
  font-size: 14px;
  background: #fff;
}

.troubleshoot-card {
  border: 1px solid rgba(92, 138, 150, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.5);
  padding: 12px;
  display: grid;
  gap: 8px;
}

.troubleshoot-card h3 {
  margin: 0;
  font-family: var(--font-playfair);
  font-size: 1.1rem;
  color: var(--forest);
}

.troubleshoot-list {
  margin: 0;
  padding-left: 18px;
  color: var(--warm-brown-muted);
}

.muted {
  margin: 0;
  color: var(--warm-brown-muted);
}
</style>
