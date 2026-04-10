<script setup>
const props = defineProps({
  loadingActiveUsers: { type: Boolean, default: false },
  loadingFunnelTelemetry: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  activeNowLabel: { type: String, default: '' },
  activeWindowLabel: { type: String, default: '' },
  activeUsersError: { type: String, default: '' },
  funnelConversionRateLabel: { type: String, default: '' },
  funnelWindowHoursLabel: { type: String, default: '' },
  funnelTelemetryError: { type: String, default: '' },
  funnelSummary: { type: Object, default: () => ({}) },
  funnelTopFailures: { type: Array, default: () => [] },
})

const emit = defineEmits(['refresh-active-users', 'refresh-funnel'])
</script>

<template>
  <div class="insights-grid">
    <section class="presence-panel">
      <div class="list-head">
        <h3>Live presence</h3>
        <button
          class="btn soft"
          type="button"
          :disabled="props.loadingActiveUsers || props.saving"
          @click="emit('refresh-active-users')"
        >
          {{ props.loadingActiveUsers ? 'Refreshing…' : 'Refresh active users' }}
        </button>
      </div>
      <p class="muted">{{ props.activeNowLabel }} · {{ props.activeWindowLabel }}</p>
      <p v-if="props.activeUsersError" class="error-text">{{ props.activeUsersError }}</p>
    </section>

    <section class="presence-panel">
      <div class="list-head">
        <h3>Funnel telemetry</h3>
        <button
          class="btn soft"
          type="button"
          :disabled="props.loadingFunnelTelemetry || props.saving"
          @click="emit('refresh-funnel')"
        >
          {{ props.loadingFunnelTelemetry ? 'Refreshing…' : 'Refresh telemetry' }}
        </button>
      </div>
      <p class="muted">
        Conversion {{ props.funnelConversionRateLabel }} · {{ props.funnelWindowHoursLabel }}
      </p>
      <p v-if="props.funnelTelemetryError" class="error-text">{{ props.funnelTelemetryError }}</p>
      <div v-else class="telemetry-grid">
        <p>Requested: <strong>{{ Number(props.funnelSummary.magic_link_requested_success || 0) }}</strong></p>
        <p>Clicked: <strong>{{ Number(props.funnelSummary.magic_link_clicked_observed || 0) }}</strong></p>
        <p>Callback success: <strong>{{ Number(props.funnelSummary.callback_session_exchange_success || 0) }}</strong></p>
        <p>Callback failed: <strong>{{ Number(props.funnelSummary.callback_session_exchange_failed || 0) + Number(props.funnelSummary.callback_session_exchange_expired || 0) + Number(props.funnelSummary.callback_session_exchange_invalid || 0) }}</strong></p>
        <p>Rate limited: <strong>{{ Number(props.funnelSummary.magic_link_requested_rate_limited || 0) }}</strong></p>
        <p>Invite sent: <strong>{{ Number(props.funnelSummary.invite_sent_success || 0) }}</strong></p>
      </div>
      <div v-if="props.funnelTopFailures.length" class="telemetry-failures">
        <p class="muted">Top failures</p>
        <ul class="batch-fail-list">
          <li v-for="item in props.funnelTopFailures" :key="`${item.step}-${item.error_code}-${item.error_message}`">
            <strong>{{ item.step }} · {{ item.error_code }}</strong>: {{ item.error_message }} ({{ item.count }})
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.insights-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.presence-panel {
  border: 1px solid rgba(92, 138, 150, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.48);
  padding: 12px 14px;
  display: grid;
  gap: 8px;
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

.muted {
  margin: 0;
  color: var(--warm-brown-muted);
}

.telemetry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 14px;
}

.telemetry-grid p {
  margin: 0;
  color: var(--forest);
  font-size: 0.92rem;
}

.telemetry-failures {
  display: grid;
  gap: 6px;
}

.batch-fail-list {
  margin: 0;
  padding-left: 18px;
  color: var(--warm-brown-muted);
  font-size: 0.9rem;
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
  .insights-grid {
    grid-template-columns: 1fr;
  }
}
</style>
