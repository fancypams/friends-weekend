<script setup>
const props = defineProps({
  message: {
    type: String,
    default: 'Failed to load media',
  },
})

const emit = defineEmits(['retry'])
</script>

<template>
  <section class="error-state">
    <div class="error-icon" aria-hidden="true">!</div>
    <h3>Something went wrong</h3>
    <p>{{ props.message }}</p>
    <button class="btn primary" type="button" @click="emit('retry')">Try Again</button>
  </section>
</template>

<style scoped>
.error-state {
  border: 1px solid rgba(185, 64, 64, 0.3);
  border-radius: 14px;
  background: #fff8f8;
  min-height: 220px;
  display: grid;
  align-content: center;
  justify-items: center;
  text-align: center;
  gap: 10px;
  padding: 20px;
}

.error-icon {
  width: 56px;
  height: 56px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 1.35rem;
  font-weight: 700;
  background: #ffdede;
  color: #8e2525;
}

h3,
p {
  margin: 0;
}

p {
  color: #9a4141;
  max-width: 360px;
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
</style>
