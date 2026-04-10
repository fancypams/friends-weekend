<script setup>
import { computed } from 'vue'
import { useAdminData } from '../../composables/useAdminData'

const admin = useAdminData()

const callbackFailures = computed(() => (
  Number(admin.funnelSummary.value.callback_session_exchange_failed || 0)
  + Number(admin.funnelSummary.value.callback_session_exchange_expired || 0)
  + Number(admin.funnelSummary.value.callback_session_exchange_invalid || 0)
))

const rateLimited = computed(() => (
  Number(admin.funnelSummary.value.magic_link_requested_rate_limited || 0)
))

const pendingFailures = computed(() => (
  admin.deliveryAttempts.value.filter((row) => String(row?.status || '').toLowerCase() !== 'success').length
  + admin.magicLinkAttempts.value.filter((row) => String(row?.status || '').toLowerCase() !== 'success').length
))

async function refreshOverview() {
  await Promise.all([
    admin.refreshActiveUsersSummary(),
    admin.refreshFunnelTelemetry(),
    admin.refreshDeliveryAttempts(),
    admin.refreshMagicLinkAttempts(),
  ])
}
</script>

<template>
  <section class="overview-grid">
    <article class="kpi-card">
      <p class="kpi-label">Active users</p>
      <p class="kpi-value">{{ admin.activeUsersSummary.value.active_now_count || 0 }}</p>
      <p class="kpi-sub">{{ admin.activeNowLabel.value }}</p>
    </article>
    <article class="kpi-card">
      <p class="kpi-label">Conversion</p>
      <p class="kpi-value">{{ admin.funnelConversionRateLabel.value }}</p>
      <p class="kpi-sub">{{ admin.funnelWindowHoursLabel.value }}</p>
    </article>
    <article class="kpi-card">
      <p class="kpi-label">Callback failures</p>
      <p class="kpi-value">{{ callbackFailures }}</p>
      <p class="kpi-sub">Failed + expired + invalid</p>
    </article>
    <article class="kpi-card">
      <p class="kpi-label">Rate limited</p>
      <p class="kpi-value">{{ rateLimited }}</p>
      <p class="kpi-sub">Magic link request limits</p>
    </article>
    <article class="kpi-card">
      <p class="kpi-label">Pending failures</p>
      <p class="kpi-value">{{ pendingFailures }}</p>
      <p class="kpi-sub">Recent delivery + magic-link failures</p>
    </article>
  </section>

  <section class="quick-actions">
    <button class="btn soft" type="button" :disabled="admin.saving.value" @click="refreshOverview">
      Refresh all
    </button>
    <router-link class="btn soft action-link" to="/admin/invites">Go to invites</router-link>
    <router-link class="btn soft action-link" to="/admin/delivery">Go to delivery</router-link>
    <router-link class="btn soft action-link" to="/admin/telemetry">Go to telemetry</router-link>
  </section>
</template>

<style scoped>
.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}

.kpi-card {
  border: 1px solid rgba(92, 138, 150, 0.2);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.52);
  padding: 12px;
  display: grid;
  gap: 4px;
}

.kpi-label {
  margin: 0;
  font-family: var(--font-sign);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sky-label);
}

.kpi-value {
  margin: 0;
  font-family: var(--font-playfair);
  font-size: 1.45rem;
  color: var(--forest);
}

.kpi-sub {
  margin: 0;
  font-size: 0.84rem;
  color: var(--warm-brown-muted);
}

.quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn {
  border: 1px solid rgba(92, 138, 150, 0.25);
  border-radius: 999px;
  min-height: 38px;
  padding: 9px 12px;
  font-size: 0.86rem;
  font-weight: 650;
  cursor: pointer;
}

.btn.soft {
  background: #ecf3f4;
  color: var(--forest);
}

.action-link {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
</style>
