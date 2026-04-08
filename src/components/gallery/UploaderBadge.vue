<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: {
    type: String,
    default: 'Friend',
  },
  avatar: {
    type: String,
    default: '',
  },
  emailKey: {
    type: String,
    default: '',
  },
  size: {
    type: String,
    default: 'md',
  },
})

const initials = computed(() => {
  const clean = String(props.name || '').trim()
  if (!clean) return 'FR'
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase()
})

const sizeClass = computed(() => {
  if (props.size === 'sm') return 'badge-sm'
  if (props.size === 'lg') return 'badge-lg'
  return 'badge-md'
})

const background = computed(() => {
  const value = String(props.emailKey || props.name || '')
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 62% 42%)`
})
</script>

<template>
  <span class="uploader-badge" :class="sizeClass" :style="{ backgroundColor: background }" aria-hidden="true">
    <img v-if="avatar" :src="avatar" :alt="name" />
    <span v-else>{{ initials }}</span>
  </span>
</template>

<style scoped>
.uploader-badge {
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  color: #fff;
  font-weight: 700;
  overflow: hidden;
  flex: 0 0 auto;
}

.uploader-badge img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.badge-sm {
  width: 30px;
  height: 30px;
  font-size: 0.66rem;
}

.badge-md {
  width: 36px;
  height: 36px;
  font-size: 0.74rem;
}

.badge-lg {
  width: 42px;
  height: 42px;
  font-size: 0.82rem;
}
</style>
