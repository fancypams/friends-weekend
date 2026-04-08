<script setup>
const emit = defineEmits(['uploadClick'])
</script>

<template>
  <section class="empty-state">
    <div class="empty-icon" aria-hidden="true">⬆</div>
    <h3>No media yet</h3>
    <p>Start sharing memories from your trip by uploading your first photo or video.</p>
    <button class="btn primary" type="button" @click="emit('uploadClick')">Upload First Media</button>
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
</style>
