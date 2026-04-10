<script setup>
import { computed } from 'vue'
import AdminInsightsPanel from '../../components/admin/AdminInsightsPanel.vue'
import { useAdminData } from '../../composables/useAdminData'

const admin = useAdminData()

const groupedInterpretation = computed(() => {
  const summary = admin.funnelSummary.value
  const topFailures = admin.funnelTopFailures.value

  const success = (
    Number(summary.magic_link_requested_success || 0)
    + Number(summary.magic_link_clicked_observed || 0)
    + Number(summary.callback_session_exchange_success || 0)
    + Number(summary.invite_sent_success || 0)
  )

  const risk = (
    Number(summary.magic_link_requested_rate_limited || 0)
    + topFailures
      .filter((item) => String(item?.error_code || '').includes('telemetry_') || String(item?.error_code || '').includes('rate'))
      .reduce((total, item) => total + Number(item?.count || 0), 0)
  )

  const failure = (
    Number(summary.magic_link_requested_failed || 0)
    + Number(summary.callback_session_exchange_failed || 0)
    + Number(summary.callback_session_exchange_expired || 0)
    + Number(summary.callback_session_exchange_invalid || 0)
  )

  return { success, risk, failure }
})
</script>

<template>
  <AdminInsightsPanel
    :loading-active-users="admin.loadingActiveUsers.value"
    :loading-funnel-telemetry="admin.loadingFunnelTelemetry.value"
    :saving="admin.saving.value"
    :active-now-label="admin.activeNowLabel.value"
    :active-window-label="admin.activeWindowLabel.value"
    :active-users-error="admin.activeUsersError.value"
    :funnel-conversion-rate-label="admin.funnelConversionRateLabel.value"
    :funnel-window-hours-label="admin.funnelWindowHoursLabel.value"
    :funnel-telemetry-error="admin.funnelTelemetryError.value"
    :funnel-summary="admin.funnelSummary.value"
    :funnel-top-failures="admin.funnelTopFailures.value"
    @refresh-active-users="admin.refreshActiveUsersSummary"
    @refresh-funnel="admin.refreshFunnelTelemetry"
  />

  <section class="grouped-grid">
    <article class="group-card success">
      <p class="label">Success</p>
      <p class="value">{{ groupedInterpretation.success }}</p>
      <p class="note">Completed core journey milestones.</p>
    </article>
    <article class="group-card risk">
      <p class="label">Risk</p>
      <p class="value">{{ groupedInterpretation.risk }}</p>
      <p class="note">Rate limits and telemetry anomalies needing watch.</p>
    </article>
    <article class="group-card failure">
      <p class="label">Failure</p>
      <p class="value">{{ groupedInterpretation.failure }}</p>
      <p class="note">Failed / expired / invalid callback outcomes.</p>
    </article>
  </section>

  <section class="legend">
    <h3>Interpretation legend</h3>
    <ul>
      <li><strong>Success:</strong> successful request, click, callback exchange, and invite send events.</li>
      <li><strong>Risk:</strong> rate-limited flow and telemetry integrity anomalies.</li>
      <li><strong>Failure:</strong> failed, expired, or invalid callback and request failures.</li>
    </ul>
  </section>
</template>

<style scoped>
.grouped-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}

.group-card {
  border-radius: 12px;
  padding: 12px;
  display: grid;
  gap: 5px;
  border: 1px solid transparent;
}

.group-card.success {
  background: #ebf7ef;
  border-color: #cbe7d3;
}

.group-card.risk {
  background: #fff6e9;
  border-color: #f0d9ac;
}

.group-card.failure {
  background: #fff1ef;
  border-color: #f2ceca;
}

.label {
  margin: 0;
  font-family: var(--font-sign);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sky-label);
}

.value {
  margin: 0;
  font-family: var(--font-playfair);
  font-size: 1.45rem;
  color: var(--forest);
}

.note {
  margin: 0;
  color: var(--warm-brown-muted);
  font-size: 0.84rem;
}

.legend {
  border: 1px solid rgba(92, 138, 150, 0.2);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.52);
  padding: 12px;
}

.legend h3 {
  margin: 0 0 8px;
  font-family: var(--font-playfair);
  font-size: 1.1rem;
}

.legend ul {
  margin: 0;
  padding-left: 18px;
  color: var(--warm-brown-muted);
}
</style>
