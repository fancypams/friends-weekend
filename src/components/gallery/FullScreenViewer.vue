<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import UploaderBadge from './UploaderBadge.vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  item: {
    type: Object,
    default: null,
  },
  index: {
    type: Number,
    default: 0,
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
  canDelete: {
    type: Boolean,
    default: false,
  },
  downloading: {
    type: Boolean,
    default: false,
  },
  deleting: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'next', 'prev', 'download', 'delete'])

const zoom = ref(1)
const touchStartX = ref(null)

const uploaderName = computed(() => {
  const value = String(props.item?.owner_email || '').trim().toLowerCase()
  if (!value) return 'Friend'
  return value.split('@')[0].replace(/[._-]+/g, ' ')
})

function resetZoom() {
  zoom.value = 1
}

function onTouchStart(event) {
  touchStartX.value = event.touches?.[0]?.clientX ?? null
}

function onTouchEnd(event) {
  if (touchStartX.value == null) return

  const endX = event.changedTouches?.[0]?.clientX ?? null
  if (endX == null) return

  const diff = touchStartX.value - endX
  if (Math.abs(diff) > 50) {
    if (diff > 0) emit('next')
    else emit('prev')
    resetZoom()
  }

  touchStartX.value = null
}

function onKeydown(event) {
  if (!props.open) return

  if (event.key === 'Escape') emit('close')
  if (event.key === 'ArrowLeft') {
    emit('prev')
    resetZoom()
  }
  if (event.key === 'ArrowRight') {
    emit('next')
    resetZoom()
  }
}

function zoomIn() {
  zoom.value = Math.min(zoom.value + 0.5, 3)
}

function zoomOut() {
  zoom.value = Math.max(zoom.value - 0.5, 1)
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="open && item" class="viewer-overlay" role="dialog" aria-modal="true">
    <div class="viewer-backdrop" @click="emit('close')"></div>

    <section class="viewer-shell">
      <header class="viewer-header">
        <div class="uploader-wrap">
          <UploaderBadge :name="uploaderName" :email-key="item.owner_email" size="md" />
          <div class="uploader-copy">
            <strong>{{ uploaderName }}</strong>
            <small>{{ new Date(item.published_at).toLocaleString() }}</small>
          </div>
        </div>

        <button class="icon-btn" type="button" @click="emit('close')" aria-label="Close viewer">×</button>
      </header>

      <div class="viewer-body" @touchstart="onTouchStart" @touchend="onTouchEnd">
        <button v-if="total > 1" class="nav-btn left" type="button" @click="emit('prev')" aria-label="Previous media">‹</button>

        <div class="media-frame">
          <div v-if="loading" class="media-note">Loading media…</div>

          <img
            v-else-if="item.media_type === 'image' && mediaUrl"
            :src="mediaUrl"
            :alt="item.original_filename"
            :style="{ transform: `scale(${zoom})` }"
          />

          <video
            v-else-if="item.media_type === 'video' && mediaUrl"
            :src="mediaUrl"
            controls
            playsinline
            preload="metadata"
          ></video>

          <div v-else class="media-note">Preview unavailable</div>
        </div>

        <button v-if="total > 1" class="nav-btn right" type="button" @click="emit('next')" aria-label="Next media">›</button>
      </div>

      <footer class="viewer-footer">
        <div class="footer-left">
          <strong class="filename">{{ item.original_filename }}</strong>
          <small>{{ index + 1 }} / {{ total }}</small>
          <p v-if="error" class="error-text">{{ error }}</p>
        </div>

        <div class="footer-actions">
          <button
            v-if="item.media_type === 'image'"
            class="icon-btn"
            type="button"
            :disabled="zoom <= 1"
            @click="zoomOut"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            v-if="item.media_type === 'image'"
            class="icon-btn"
            type="button"
            :disabled="zoom >= 3"
            @click="zoomIn"
            aria-label="Zoom in"
          >
            +
          </button>

          <button class="btn primary" type="button" :disabled="downloading" @click="emit('download', item)">
            {{ downloading ? 'Downloading…' : 'Download' }}
          </button>

          <button
            v-if="canDelete"
            class="btn danger"
            type="button"
            :disabled="deleting"
            @click="emit('delete', item)"
          >
            {{ deleting ? 'Removing…' : 'Remove' }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding:
    calc(10px + env(safe-area-inset-top, 0px))
    calc(10px + env(safe-area-inset-right, 0px))
    calc(10px + env(safe-area-inset-bottom, 0px))
    calc(10px + env(safe-area-inset-left, 0px));
}

.viewer-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(5, 10, 12, 0.82);
}

.viewer-shell {
  position: relative;
  width: min(100%, 940px);
  max-height: calc(100dvh - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  background: #fff;
  border-radius: 14px;
  border: 1px solid rgba(92, 138, 150, 0.35);
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.viewer-header,
.viewer-footer {
  padding: 10px;
  border-bottom: 1px solid rgba(92, 138, 150, 0.22);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.viewer-footer {
  border-bottom: 0;
  border-top: 1px solid rgba(92, 138, 150, 0.22);
}

.uploader-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.uploader-copy strong,
.uploader-copy small {
  display: block;
}

.uploader-copy small {
  color: var(--warm-brown-muted);
  font-size: 0.75rem;
}

.viewer-body {
  min-height: 260px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #f3f6f8;
  touch-action: pan-x pinch-zoom;
}

.media-frame {
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  min-height: 220px;
  display: grid;
  place-items: center;
}

.media-frame img,
.media-frame video {
  width: 100%;
  max-height: min(68vh, 560px);
  object-fit: contain;
  display: block;
  background: #101517;
  transition: transform 0.2s ease;
}

.media-note {
  color: var(--warm-brown-muted);
  font-size: 0.86rem;
}

.filename {
  display: block;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-left small {
  color: var(--warm-brown-muted);
  font-size: 0.76rem;
}

.footer-left p {
  margin: 2px 0 0;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn {
  border: 1px solid transparent;
  border-radius: 999px;
  min-height: 44px;
  padding: 8px 12px;
  font-weight: 650;
  font-size: 0.82rem;
  cursor: pointer;
}

.btn:disabled,
.icon-btn:disabled,
.nav-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--forest);
  color: #fff;
}

.btn.danger {
  border-color: rgba(185, 64, 64, 0.3);
  background: #fff1f1;
  color: #8e2525;
}

.icon-btn,
.nav-btn {
  border: 1px solid rgba(92, 138, 150, 0.28);
  background: #fff;
  color: #2f4650;
  border-radius: 999px;
  min-width: 44px;
  min-height: 44px;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
}

.nav-btn {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}

.error-text {
  color: #a03333;
  font-size: 0.8rem;
}

@media (max-width: 760px) {
  .viewer-body {
    grid-template-columns: 1fr;
  }

  .nav-btn {
    display: none;
  }

  .viewer-footer {
    align-items: start;
    flex-direction: column;
  }

  .footer-left,
  .footer-actions {
    width: 100%;
  }
}
</style>
