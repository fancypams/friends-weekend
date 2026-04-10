<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import HeroHeader from '../components/HeroHeader.vue'
import { useAdminData } from '../composables/useAdminData'

const route = useRoute()
const admin = useAdminData()

const tabs = [
  { to: '/admin', label: 'Overview' },
  { to: '/admin/invites', label: 'Invites' },
  { to: '/admin/delivery', label: 'Delivery' },
  { to: '/admin/telemetry', label: 'Telemetry' },
]

const sharedStatus = computed(() => {
  if (admin.errorMsg.value) return { type: 'error', message: admin.errorMsg.value }
  if (admin.successMsg.value) return { type: 'success', message: admin.successMsg.value }
  if (admin.progressMessage.value) return { type: 'muted', message: admin.progressMessage.value }
  return null
})

function isActiveTab(path) {
  if (path === '/admin') return route.path === '/admin'
  return route.path.startsWith(path)
}

onMounted(async () => {
  await admin.startAdminSession()
})

onBeforeUnmount(() => {
  admin.endAdminSession()
})
</script>

<template>
  <div class="admin-page">
    <HeroHeader show-back />
    <main class="admin-content page-main">
      <section class="panel admin-panel">
        <div class="admin-head">
          <p class="section-label">Admin</p>
          <h2 class="welcome-heading">Admin Workspace</h2>
          <p class="intro">Operational center for invites, delivery diagnostics, and auth funnel telemetry.</p>
        </div>

        <p v-if="admin.authLoading.value" class="muted">Checking admin access…</p>
        <p v-else-if="!admin.canManage.value" class="error-text">{{ admin.accessError.value || 'Admin access required.' }}</p>

        <template v-else>
          <nav class="admin-tabs" aria-label="Admin workspace sections">
            <router-link
              v-for="tab in tabs"
              :key="tab.to"
              class="admin-tab"
              :class="{ active: isActiveTab(tab.to) }"
              :to="tab.to"
            >
              {{ tab.label }}
            </router-link>
          </nav>

          <section v-if="sharedStatus" class="status-banner" :class="sharedStatus.type" aria-live="polite">
            {{ sharedStatus.message }}
          </section>

          <section class="admin-body">
            <router-view />
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
  max-width: 1240px;
  margin: 0 auto;
  padding: 44px 24px 80px;
  width: 100%;
}

.admin-panel {
  display: grid;
  gap: 14px;
}

.admin-head {
  display: grid;
  gap: 8px;
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
  font-size: clamp(1.75rem, 2.2vw, 2.2rem);
}

.intro {
  margin: 0;
  color: var(--warm-brown-muted);
  max-width: 72ch;
}

.admin-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.admin-tab {
  text-decoration: none;
  border: 1px solid rgba(92, 138, 150, 0.25);
  border-radius: 999px;
  min-height: 36px;
  padding: 8px 12px;
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--sky-label);
  background: rgba(236, 245, 247, 0.85);
}

.admin-tab.active {
  color: var(--forest);
  border-color: rgba(92, 138, 150, 0.45);
  background: rgba(225, 237, 240, 1);
}

.status-banner {
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 0.92rem;
}

.status-banner.success {
  background: #ebf6ef;
  border: 1px solid #c4e4ce;
  color: #1e5d34;
}

.status-banner.error {
  background: #fff2ef;
  border: 1px solid #f4cec7;
  color: #8e2b22;
}

.status-banner.muted {
  background: #f2f6f7;
  border: 1px solid #d7e4e7;
  color: #4f7077;
}

.admin-body {
  display: grid;
  gap: 14px;
}

.muted {
  margin: 0;
  color: var(--warm-brown-muted);
}

@media (max-width: 760px) {
  .admin-content {
    padding: 30px 16px 56px;
  }
}
</style>
