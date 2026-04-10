<script setup>
const props = defineProps({
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const emit = defineEmits(['refresh'])

function formatAttemptTime(value) {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}
</script>

<template>
  <section class="delivery-attempts">
    <div class="list-head">
      <h3>Magic link delivery attempts</h3>
      <button class="btn soft" type="button" :disabled="props.loading || props.saving" @click="emit('refresh')">
        {{ props.loading ? 'Refreshing…' : 'Refresh magic link attempts' }}
      </button>
    </div>

    <p v-if="props.error" class="error-text">{{ props.error }}</p>
    <p v-else-if="props.loading" class="muted">Loading magic link delivery attempts…</p>
    <p v-else-if="!props.rows.length" class="muted">No magic link delivery attempts yet.</p>

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
        <tr v-for="row in props.rows" :key="`magic-${row.id}`">
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

<style scoped>
.delivery-attempts {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(92, 138, 150, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.44);
  padding: 12px 14px;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.list-head h3 {
  margin: 0;
  font-family: var(--font-playfair);
  font-size: 1.1rem;
  color: var(--forest);
}

.invite-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  background: rgba(255, 255, 255, 0.38);
  border: 1px solid rgba(92, 138, 150, 0.14);
  border-radius: 10px;
  overflow: hidden;
}

.invite-table th,
.invite-table td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid rgba(92, 138, 150, 0.18);
}

.invite-table th {
  font-family: var(--font-sign);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sky-label);
  background: rgba(236, 245, 247, 0.72);
}

.invite-table tbody tr:nth-child(even) {
  background: rgba(255, 255, 255, 0.28);
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

.muted {
  margin: 0;
  color: var(--warm-brown-muted);
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

.btn.soft {
  background: #ecf3f4;
  color: var(--forest);
  border-color: rgba(92, 138, 150, 0.25);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 760px) {
  .invite-table {
    display: block;
    overflow-x: auto;
    white-space: nowrap;
  }
}
</style>
