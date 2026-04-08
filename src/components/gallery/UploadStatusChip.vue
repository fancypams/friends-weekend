<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: {
    type: String,
    required: true,
  },
  progress: {
    type: Number,
    default: 0,
  },
})

const config = computed(() => {
  const byStatus = {
    queued: { label: 'Queued', tone: 'tone-muted' },
    'requesting-ticket': { label: 'Preparing', tone: 'tone-working' },
    uploading: { label: props.progress ? `${props.progress}%` : 'Uploading', tone: 'tone-working' },
    processing: { label: 'Processing', tone: 'tone-pending' },
    published: { label: 'Published', tone: 'tone-ok' },
    failed: { label: 'Failed', tone: 'tone-fail' },
  }

  return byStatus[props.status] || { label: props.status, tone: 'tone-muted' }
})

const busy = computed(() => ['requesting-ticket', 'uploading', 'processing'].includes(props.status))
</script>

<template>
  <span class="status-chip" :class="config.tone">
    <span class="dot" :class="{ pulse: busy }"></span>
    <span>{{ config.label }}</span>
  </span>
</template>

<style scoped>
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 0.72rem;
  padding: 4px 10px;
  letter-spacing: 0.02em;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.8;
}

.dot.pulse {
  animation: pulse 0.95s ease-in-out infinite;
}

.tone-muted {
  background: #f2f5f7;
  border-color: #dbe3e8;
  color: #5a6d79;
}

.tone-working {
  background: #e9f1ff;
  border-color: #bfd4ff;
  color: #2959b7;
}

.tone-pending {
  background: #fff5e3;
  border-color: #ffd38b;
  color: #8a5b00;
}

.tone-ok {
  background: #e8f6ec;
  border-color: #bbe5c6;
  color: #26723a;
}

.tone-fail {
  background: #fff0f0;
  border-color: #efb2b2;
  color: #a03333;
}

@keyframes pulse {
  0% {
    transform: scale(1);
    opacity: 0.65;
  }
  50% {
    transform: scale(1.3);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 0.65;
  }
}
</style>
