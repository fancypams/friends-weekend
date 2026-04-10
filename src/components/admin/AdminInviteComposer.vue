<script setup>
const props = defineProps({
  activeInvite: { type: Boolean, default: true },
  saving: { type: Boolean, default: false },
  batchRows: { type: Array, default: () => [] },
  familyOptions: { type: Array, default: () => [] },
  canAddAnotherRow: { type: Boolean, default: false },
  canSubmit: { type: Boolean, default: false },
  saveOnlyLabel: { type: String, default: 'Save invites' },
  saveAndSendLabel: { type: String, default: 'Save + send invites' },
})

const emit = defineEmits([
  'update:activeInvite',
  'update-row',
  'add-row-after',
  'remove-row',
  'save-only',
  'save-and-send',
])

function updateRow(rowId, field, value) {
  emit('update-row', { rowId, field, value })
}
</script>

<template>
  <form class="invite-form" @submit.prevent="emit('save-and-send')">
    <label class="active-check">
      <input
        :checked="props.activeInvite"
        type="checkbox"
        @change="emit('update:activeInvite', $event.target.checked)"
      />
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

        <template v-for="(row, index) in props.batchRows" :key="row.id">
          <input
            :value="row.email"
            type="email"
            autocomplete="off"
            placeholder="friend@example.com"
            :disabled="props.saving"
            @input="updateRow(row.id, 'email', $event.target.value)"
          />
          <input
            :value="row.display_name"
            type="text"
            autocomplete="off"
            placeholder="Alex"
            :disabled="props.saving"
            @input="updateRow(row.id, 'display_name', $event.target.value)"
          />
          <select
            :value="row.family"
            :disabled="props.saving"
            @change="updateRow(row.id, 'family', $event.target.value)"
          >
            <option value="" disabled>Select family</option>
            <option v-for="family in props.familyOptions" :key="`batch-${row.id}-${family}`" :value="family">
              {{ family }}
            </option>
          </select>
          <select
            :value="row.role"
            :disabled="props.saving"
            @change="updateRow(row.id, 'role', $event.target.value)"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button class="btn danger batch-remove" type="button" :disabled="props.saving" @click="emit('remove-row', row.id)">
            Remove
          </button>
          <div v-if="index === props.batchRows.length - 1" class="batch-row-add-wrap">
            <button
              class="batch-add-inline"
              type="button"
              :disabled="props.saving || !props.canAddAnotherRow"
              :aria-label="`Add row after ${row.email || 'this row'}`"
              @click="emit('add-row-after', row.id)"
            >
              +
            </button>
          </div>
        </template>
      </div>
    </section>

    <div class="actions">
      <button class="btn soft" type="button" :disabled="!props.canSubmit" @click="emit('save-only')">
        {{ props.saveOnlyLabel }}
      </button>
      <button class="btn primary" type="submit" :disabled="!props.canSubmit">
        {{ props.saveAndSendLabel }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.invite-form {
  display: grid;
  gap: 12px;
  width: 100%;
  border: 1px solid rgba(92, 138, 150, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.48);
  padding: 12px 14px;
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

.active-check span {
  font-family: var(--font-sign);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sky-label);
}

.batch-help {
  margin: 0;
  color: var(--warm-brown-muted);
  font-size: 0.84rem;
}

.batch-editor {
  border: 1px solid rgba(92, 138, 150, 0.2);
  border-radius: 10px;
  padding: 12px;
  background: #f6fafb;
  display: grid;
  gap: 10px;
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
  grid-template-columns: minmax(190px, 1.4fr) minmax(160px, 1fr) minmax(130px, 0.9fr) minmax(110px, 0.7fr) auto;
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

@media (max-width: 760px) {
  .actions {
    flex-wrap: wrap;
  }

  .batch-grid {
    grid-template-columns: 1fr;
  }

  .batch-grid-head {
    display: none;
  }
}
</style>
