<script setup>
import AdminInviteComposer from '../../components/admin/AdminInviteComposer.vue'
import AdminInvitesTable from '../../components/admin/AdminInvitesTable.vue'
import { useAdminData } from '../../composables/useAdminData'

const admin = useAdminData()
</script>

<template>
  <AdminInviteComposer
    :active-invite="admin.activeInvite.value"
    :saving="admin.saving.value"
    :batch-rows="admin.batchRows.value"
    :family-options="admin.familyOptions.value"
    :can-add-another-row="admin.canAddAnotherRow.value"
    :can-submit="admin.canSubmit.value"
    :save-only-label="admin.saveOnlyLabel.value"
    :save-and-send-label="admin.saveAndSendLabel.value"
    @update:active-invite="admin.activeInvite.value = $event"
    @update-row="admin.updateBatchRow"
    @add-row-after="admin.addBatchRowAfter"
    @remove-row="admin.removeBatchRow"
    @save-only="admin.saveInviteOnly"
    @save-and-send="admin.saveAndSend"
  />

  <section v-if="admin.batchResult.value" class="batch-result" aria-live="polite">
    <p class="batch-result-title">
      {{ admin.batchResult.value.label }}: {{ admin.batchResult.value.sent }} sent / {{ admin.batchResult.value.total }} total
    </p>
    <ul v-if="admin.batchResult.value.failed?.length" class="batch-fail-list">
      <li v-for="item in admin.batchResult.value.failed" :key="`${item.email}-${item.reason}`">
        <strong>{{ item.email }}:</strong> {{ item.reason }}
      </li>
    </ul>
  </section>

  <AdminInvitesTable
    :loading-invites="admin.loadingInvites.value"
    :saving="admin.saving.value"
    :sorted-invites="admin.sortedInvites.value"
    :selected-emails="admin.selectedEmails.value"
    :all-selected="admin.allSelected.value"
    :can-send-selected="admin.canSendSelected.value"
    :can-send-all-active="admin.canSendAllActive.value"
    @send-selected="admin.sendSelectedBatch"
    @send-all-active="admin.sendAllActiveBatch"
    @refresh-invites="admin.refreshInvites"
    @set-all-selected="admin.setAllSelected"
    @toggle-selection="admin.toggleSelection($event.email, $event.checked)"
    @resend="admin.resendInvite"
    @remove="admin.removeInviteRow"
  />
</template>

<style scoped>
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
</style>
