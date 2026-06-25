<script setup>
defineProps({
  uploadEnabled: {
    type: Boolean,
    default: true,
  },
  lockedLabel: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['uploadClick'])
</script>

<template>
  <section class="empty-state">
    <div class="empty-icon" aria-hidden="true">⬆</div>
    <h3>Uploads locked for now</h3>
    <p>
      Your upload window opens 2 hours before your scheduled Seattle departure and closes 1 hour after your actual
      arrival at your final destination.
    </p>
    <button class="btn primary" type="button" :disabled="!uploadEnabled" @click="emit('uploadClick')">
      {{ uploadEnabled ? 'Upload First Media' : 'Uploads Locked' }}
    </button>
    <small v-if="!uploadEnabled && lockedLabel" class="locked-note">{{ lockedLabel }}</small>
  </section>
</template>

<style scoped>
.empty-state {
  border: 1px dashed rgba(92, 138, 150, 0.45);
  border-radius: 14px;
  background: #fbfdff;
  min-height: 280px;
  display: grid;
  align-content: center;
  justify-items: center;
  text-align: center;
  gap: 10px;
  padding: 20px;
}

.empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 1.35rem;
  background: rgba(122, 176, 180, 0.2);
  color: #2e3428;
}

h3,
p {
  margin: 0;
}

p {
  color: var(--warm-brown-muted);
  max-width: 320px;
}

.btn {
  border: 1px solid transparent;
  border-radius: 999px;
  min-height: 44px;
  padding: 10px 14px;
  font-weight: 650;
  font-size: 0.84rem;
  cursor: pointer;
}

.btn.primary {
  background: var(--forest);
  color: #fff;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.locked-note {
  color: var(--warm-brown-muted);
  font-size: 0.78rem;
}
</style>
