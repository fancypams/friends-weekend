<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  item: {
    type: Object,
    default: null,
  },
  total: {
    type: Number,
    default: 0,
  },
  mediaUrl: {
    type: String,
    default: '',
  },
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close', 'next', 'prev', 'media-error'])

const touchStartX = ref(null)
const imageReady = ref(false)
const imagePreloading = ref(false)
let imagePreloadToken = 0

const isImageItem = computed(() => props.item?.media_type === 'image')
const showImageSkeleton = computed(() => props.loading || (isImageItem.value && imagePreloading.value))

function onTouchStart(event) {
  touchStartX.value = event.touches?.[0]?.clientX ?? null
}

function onTouchEnd(event) {
  if (touchStartX.value == null) return

  const endX = event.changedTouches?.[0]?.clientX ?? null
  if (endX == null) {
    touchStartX.value = null
    return
  }

  const diff = touchStartX.value - endX
  if (Math.abs(diff) > 50) {
    if (diff > 0) emit('next')
    else emit('prev')
  }

  touchStartX.value = null
}

function onKeydown(event) {
  if (!props.open) return

  if (event.key === 'Escape') emit('close')
  if (event.key === 'ArrowLeft') emit('prev')
  if (event.key === 'ArrowRight') emit('next')
}

function startImagePreload(url) {
  const token = ++imagePreloadToken

  if (!props.open || !isImageItem.value || !url) {
    imageReady.value = false
    imagePreloading.value = false
    return
  }

  imageReady.value = false
  imagePreloading.value = true

  const img = new Image()
  img.decoding = 'async'
  img.onload = () => {
    if (token !== imagePreloadToken) return
    imageReady.value = true
    imagePreloading.value = false
  }
  img.onerror = () => {
    if (token !== imagePreloadToken) return
    imageReady.value = false
    imagePreloading.value = false
    emit('media-error', props.item)
  }
  img.src = url
}

watch(
  () => [props.open, props.mediaUrl, props.item?.id, props.item?.media_type],
  ([open, mediaUrl]) => {
    if (!open) {
      imagePreloadToken += 1
      imageReady.value = false
      imagePreloading.value = false
      return
    }

    if (!isImageItem.value) {
      imageReady.value = false
      imagePreloading.value = false
      return
    }

    startImagePreload(String(mediaUrl || '').trim())
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="open && item" class="viewer-overlay" role="dialog" aria-modal="true" @click.self="emit('close')">
    <button class="close-btn" type="button" aria-label="Close viewer" @click="emit('close')">×</button>

    <div class="viewer-body" @touchstart="onTouchStart" @touchend="onTouchEnd" @click="emit('close')">
      <div v-if="showImageSkeleton" class="media-skeleton" aria-hidden="true"></div>

      <img
        v-else-if="isImageItem && mediaUrl && imageReady"
        :src="mediaUrl"
        :alt="item.original_filename"
        class="viewer-media"
        @click.stop
      />

      <video
        v-else-if="item.media_type === 'video' && mediaUrl"
        :src="mediaUrl"
        class="viewer-media"
        controls
        playsinline
        preload="metadata"
        @click.stop
        @error="emit('media-error', item)"
      ></video>

      <div v-else class="media-note">{{ error || 'Unable to load media.' }}</div>
    </div>
  </div>
</template>

<style scoped>
.viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--bg-white) 14%, transparent) 1px, transparent 0),
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--bg-white) 38%, transparent) 0%,
      color-mix(in srgb, var(--bg-white) 24%, transparent) 100%
    );
  background-size: 3px 3px, 100% 100%;
  padding:
    calc(10px + env(safe-area-inset-top, 0px))
    calc(14px + env(safe-area-inset-right, 0px))
    calc(10px + env(safe-area-inset-bottom, 0px))
    calc(14px + env(safe-area-inset-left, 0px));
}

.viewer-body {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  touch-action: pan-x pinch-zoom;
}

.viewer-media,
.media-skeleton {
  max-width: min(96vw, 1240px);
  max-height: calc(100dvh - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  width: auto;
  height: auto;
}

.viewer-media {
  object-fit: contain;
  display: block;
}

.media-skeleton {
  width: min(92vw, 1120px);
  aspect-ratio: 4 / 3;
  border-radius: 10px;
  background: linear-gradient(
    100deg,
    color-mix(in srgb, var(--bg-white) 62%, transparent) 20%,
    color-mix(in srgb, var(--bg-white) 82%, transparent) 40%,
    color-mix(in srgb, var(--bg-white) 62%, transparent) 60%
  );
  background-size: 200% 100%;
  animation: shimmer 1.15s linear infinite;
}

.media-note {
  color: var(--bg-cream);
  font-size: 0.95rem;
  text-shadow: 0 2px 6px color-mix(in srgb, var(--forest) 55%, transparent);
}

.close-btn {
  position: absolute;
  z-index: 1;
  border: 1px solid color-mix(in srgb, var(--bg-white) 50%, transparent);
  background: color-mix(in srgb, var(--forest) 42%, transparent);
  color: var(--bg-white);
  border-radius: 999px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  backdrop-filter: blur(2px);
}

.close-btn {
  top: calc(10px + env(safe-area-inset-top, 0px));
  right: calc(14px + env(safe-area-inset-right, 0px));
}

@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 760px) {
  .close-btn {
    min-width: 40px;
    min-height: 40px;
    font-size: 1.2rem;
  }

  .media-skeleton {
    width: min(94vw, 900px);
  }
}
</style>
