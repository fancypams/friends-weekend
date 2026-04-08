<template>
  <div class="skeleton-grid" aria-hidden="true">
    <span v-for="n in 8" :key="n" class="skeleton-card"></span>
  </div>
</template>

<style scoped>
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.skeleton-card {
  display: block;
  border-radius: 10px;
  height: 168px;
  background: linear-gradient(90deg, #eef4f6 25%, #f6f9fa 50%, #eef4f6 75%);
  background-size: 200% 100%;
  animation: shimmer 1.15s infinite;
}

@media (min-width: 700px) {
  .skeleton-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 980px) {
  .skeleton-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
