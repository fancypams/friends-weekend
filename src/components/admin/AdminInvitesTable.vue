<script setup>
const props = defineProps({
  loadingInvites: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  sortedInvites: { type: Array, default: () => [] },
  selectedEmails: { type: Array, default: () => [] },
  allSelected: { type: Boolean, default: false },
  canSendSelected: { type: Boolean, default: false },
  canSendAllActive: { type: Boolean, default: false },
})

const emit = defineEmits([
  'send-selected',
  'send-all-active',
  'refresh-invites',
  'set-all-selected',
  'toggle-selection',
  'resend',
  'remove',
])

function isSelected(email) {
  const key = String(email || '').trim().toLowerCase()
  return props.selectedEmails.includes(key)
}
</script>

<template>
  <div class="list-head">
    <h3>Current invites</h3>
    <div class="list-head-actions">
      <button class="btn soft" type="button" :disabled="!props.canSendSelected" @click="emit('send-selected')">
        Send selected
      </button>
      <button class="btn soft" type="button" :disabled="!props.canSendAllActive" @click="emit('send-all-active')">
        Send all active
      </button>
      <button class="btn soft" type="button" :disabled="props.loadingInvites || props.saving" @click="emit('refresh-invites')">
        {{ props.loadingInvites ? 'Refreshing…' : 'Refresh' }}
      </button>
    </div>
  </div>

  <p v-if="props.loadingInvites" class="muted">Loading invites…</p>
  <p v-else-if="!props.sortedInvites.length" class="muted">No invites yet.</p>

  <table v-else class="invite-table">
    <thead>
      <tr>
        <th>
          <input
            type="checkbox"
            :checked="props.allSelected"
            :disabled="props.saving || !props.sortedInvites.length"
            aria-label="Select all invites"
            @change="emit('set-all-selected', $event.target.checked)"
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
      <tr v-for="row in props.sortedInvites" :key="row.email">
        <td>
          <input
            type="checkbox"
            :checked="isSelected(row.email)"
            :disabled="props.saving"
            :aria-label="`Select ${row.email}`"
            @change="emit('toggle-selection', { email: row.email, checked: $event.target.checked })"
          />
        </td>
        <td>{{ row.email }}</td>
        <td>{{ row.display_name || '—' }}</td>
        <td>{{ row.family || '—' }}</td>
        <td>{{ row.role }}</td>
        <td>{{ row.active ? 'Yes' : 'No' }}</td>
        <td class="row-actions">
          <button class="btn soft" type="button" :disabled="props.saving" @click="emit('resend', row)">Resend</button>
          <button class="btn danger" type="button" :disabled="props.saving" @click="emit('remove', row)">Remove</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}

.list-head h3 {
  margin: 0;
  font-family: var(--font-playfair);
  font-size: 1.1rem;
  color: var(--forest);
}

.list-head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
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

.invite-table input[type='checkbox'] {
  width: 16px;
  height: 16px;
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

.row-actions {
  display: flex;
  gap: 8px;
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

.btn.danger {
  background: #fff3f2;
  color: #8b2f22;
  border-color: rgba(168, 66, 49, 0.25);
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
