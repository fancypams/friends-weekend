<script setup>
import { computed, onMounted, ref } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import { getAuthState } from '../lib/authAccess'
import { bypassAuth } from '../lib/supabaseClient'
import { inviteAndSend, listInvites, removeInvite, upsertInvite } from '../lib/photosApi'

const authLoading = ref(true)
const canManage = ref(false)
const invites = ref([])
const loadingInvites = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const successMsg = ref('')

const form = ref({
  email: '',
  display_name: '',
  role: 'member',
  active: true,
})

const sortedInvites = computed(() => (
  [...invites.value].sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')))
))

const canSubmit = computed(() => {
  const email = String(form.value.email || '').trim()
  return Boolean(email && email.includes('@') && !saving.value)
})

function resetMessages() {
  errorMsg.value = ''
  successMsg.value = ''
}

function normalizePayload() {
  return {
    email: String(form.value.email || '').trim().toLowerCase(),
    display_name: String(form.value.display_name || '').trim() || null,
    role: form.value.role === 'admin' ? 'admin' : 'member',
    active: Boolean(form.value.active),
  }
}

async function refreshInvites() {
  if (!canManage.value) return
  loadingInvites.value = true
  errorMsg.value = ''
  try {
    const data = await listInvites()
    invites.value = Array.isArray(data?.items) ? data.items : []
  } catch (err) {
    errorMsg.value = err?.message || 'Failed to load invites.'
  } finally {
    loadingInvites.value = false
  }
}

async function saveInviteOnly() {
  if (!canSubmit.value) return
  saving.value = true
  resetMessages()
  try {
    await upsertInvite(normalizePayload())
    successMsg.value = 'Invite updated.'
    await refreshInvites()
  } catch (err) {
    errorMsg.value = err?.message || 'Failed to save invite.'
  } finally {
    saving.value = false
  }
}

async function saveAndSend() {
  if (!canSubmit.value) return
  saving.value = true
  resetMessages()
  try {
    await inviteAndSend(normalizePayload())
    successMsg.value = 'Invite saved and email sent.'
    await refreshInvites()
  } catch (err) {
    errorMsg.value = err?.message || 'Failed to send invite.'
  } finally {
    saving.value = false
  }
}

async function resend(row) {
  saving.value = true
  resetMessages()
  try {
    await inviteAndSend({
      email: row.email,
      display_name: row.display_name || null,
      role: row.role || 'member',
      active: row.active !== false,
    })
    successMsg.value = `Invite resent to ${row.email}.`
    await refreshInvites()
  } catch (err) {
    errorMsg.value = err?.message || 'Failed to resend invite.'
  } finally {
    saving.value = false
  }
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
    return
  }

  try {
    const state = await getAuthState()
    canManage.value = Boolean(state?.signedIn && state?.profile?.role === 'admin' && state?.profile?.active)
    if (canManage.value) {
      await refreshInvites()
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
            Add or update a friend, then send a personalized invite in one click.
          </p>

          <form class="invite-form" @submit.prevent="saveAndSend">
            <label>
              <span>Email</span>
              <input v-model="form.email" type="email" autocomplete="email" required placeholder="friend@example.com" />
            </label>

            <label>
              <span>Display name</span>
              <input v-model="form.display_name" type="text" autocomplete="name" placeholder="Alex" />
            </label>

            <label>
              <span>Role</span>
              <select v-model="form.role">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            <label class="active-check">
              <input v-model="form.active" type="checkbox" />
              <span>Active invite</span>
            </label>

            <div class="actions">
              <button class="btn soft" type="button" :disabled="!canSubmit" @click="saveInviteOnly">
                Save only
              </button>
              <button class="btn primary" type="submit" :disabled="!canSubmit">
                Save + send
              </button>
            </div>
          </form>

          <p v-if="successMsg" class="success-text">{{ successMsg }}</p>
          <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>

          <div class="list-head">
            <h3>Current invites</h3>
            <button class="btn soft" type="button" :disabled="loadingInvites || saving" @click="refreshInvites">
              {{ loadingInvites ? 'Refreshing…' : 'Refresh' }}
            </button>
          </div>

          <p v-if="loadingInvites" class="muted">Loading invites…</p>
          <p v-else-if="!sortedInvites.length" class="muted">No invites yet.</p>

          <table v-else class="invite-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sortedInvites" :key="row.email">
                <td>{{ row.email }}</td>
                <td>{{ row.display_name || '—' }}</td>
                <td>{{ row.role }}</td>
                <td>{{ row.active ? 'Yes' : 'No' }}</td>
                <td class="row-actions">
                  <button class="btn soft" type="button" :disabled="saving" @click="resend(row)">Resend</button>
                  <button class="btn danger" type="button" :disabled="saving" @click="remove(row)">Remove</button>
                </td>
              </tr>
            </tbody>
          </table>
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
}
</style>
