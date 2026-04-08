<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import UploadStatusChip from './UploadStatusChip.vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  queueItems: {
    type: Array,
    default: () => [],
  },
  selectedCount: {
    type: Number,
    default: 0,
  },
  uploadBusy: {
    type: Boolean,
    default: false,
  },
  uploadError: {
    type: String,
    default: '',
  },
  captureWindowLabel: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close', 'filesSelected', 'upload', 'retry', 'remove'])

const isDragging = ref(false)
const fileInputRef = ref(null)
const isTouchUi = ref(false)
let touchMediaQuery = null

const pickerLabel = computed(() => (
  isTouchUi.value ? 'Choose photos or videos' : 'Choose files'
))

function handleDragOver(event) {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function handleDrop(event) {
  event.preventDefault()
  isDragging.value = false
  const files = Array.from(event.dataTransfer?.files || [])
  emit('filesSelected', files)
}

function handleFileSelect(event) {
  const files = Array.from(event.target?.files || [])
  emit('filesSelected', files)
}

function formatFileSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value)) return '--'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function updateTouchUi() {
  if (typeof window === 'undefined') return
  isTouchUi.value = Boolean(
    window.matchMedia('(pointer: coarse)').matches
    || window.matchMedia('(hover: none)').matches,
  )
}

onMounted(() => {
  if (typeof window === 'undefined') return
  touchMediaQuery = window.matchMedia('(pointer: coarse)')
  updateTouchUi()
  touchMediaQuery.addEventListener('change', updateTouchUi)
})

onUnmounted(() => {
  if (touchMediaQuery) {
    touchMediaQuery.removeEventListener('change', updateTouchUi)
    touchMediaQuery = null
  }
})
</script>

<template>
  <div v-if="open" class="upload-overlay">
    <div class="upload-backdrop" @click="emit('close')"></div>

    <section class="upload-shell" role="dialog" aria-modal="true" aria-label="Upload media">
      <header class="upload-head">
        <h2>Upload Media</h2>
        <button class="icon-btn" type="button" @click="emit('close')" aria-label="Close upload panel">×</button>
      </header>

      <div class="upload-content">
        <div
          class="drop-zone"
          :class="{ active: isDragging }"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
        >
          <input
            ref="fileInputRef"
            class="file-input"
            type="file"
            multiple
            accept="image/*,video/mp4,video/quicktime"
            @change="handleFileSelect"
          />

          <div class="drop-copy">
            <p>
              <button class="link-btn" type="button" @click="fileInputRef?.click()">{{ pickerLabel }}</button>
              <template v-if="!isTouchUi">
                or drag and drop
              </template>
            </p>
            <small>Photos and videos from the trip</small>
          </div>
        </div>

        <div class="helper-text" aria-label="Upload guidelines">
          <ul>
            <li>Photos up to 25 MB, videos up to 250 MB.</li>
            <li>{{ captureWindowLabel }}</li>
            <li>Supported: JPG, PNG, WEBP, HEIC, HEIF, MP4, MOV.</li>
          </ul>
        </div>

        <p v-if="uploadError" class="error-text">{{ uploadError }}</p>

        <div v-if="queueItems.length" class="queue-wrap">
          <h3>Upload Queue</h3>

          <ul class="queue-list">
            <li v-for="item in queueItems" :key="item.id" class="queue-item">
              <div class="file-icon" aria-hidden="true">{{ item.file.type.startsWith('image/') ? '🖼' : '🎬' }}</div>

              <div class="file-copy">
                <p>{{ item.file.name }}</p>
                <small>{{ formatFileSize(item.file.size) }}</small>
                <small v-if="item.error" class="error-text">{{ item.error }}</small>
              </div>

              <div class="queue-actions">
                <UploadStatusChip :status="item.status" :progress="item.progress" />

                <button
                  v-if="item.status === 'failed'"
                  class="icon-btn"
                  type="button"
                  @click="emit('retry', item.id)"
                  aria-label="Retry upload"
                >
                  ↻
                </button>

                <button
                  v-if="item.status === 'queued' || item.status === 'failed'"
                  class="icon-btn danger"
                  type="button"
                  @click="emit('remove', item.id)"
                  aria-label="Remove from queue"
                >
                  ×
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <footer class="upload-actions">
        <p>{{ selectedCount }} file(s) selected</p>
        <button class="btn primary" type="button" :disabled="uploadBusy || !selectedCount" @click="emit('upload')">
          {{ uploadBusy ? 'Uploading…' : 'Upload now' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.upload-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: grid;
  align-items: end;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.upload-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(6, 12, 14, 0.55);
}

.upload-shell {
  position: relative;
  width: 100%;
  max-height: calc(92dvh - env(safe-area-inset-bottom, 0px));
  background: #fff;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  border: 1px solid rgba(92, 138, 150, 0.26);
  display: grid;
  grid-template-rows: auto 1fr;
}

.upload-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px;
  border-bottom: 1px solid rgba(92, 138, 150, 0.22);
}

.upload-head h2,
.upload-content p,
.upload-content h3 {
  margin: 0;
}

.upload-content {
  overflow-y: auto;
  padding: 14px;
  padding-bottom: 14px;
  display: grid;
  gap: 12px;
  touch-action: pan-y;
}

.drop-zone {
  border: 1px dashed rgba(92, 138, 150, 0.6);
  border-radius: 12px;
  background: rgba(122, 176, 180, 0.12);
  min-height: 140px;
  padding: 14px;
  display: grid;
  place-items: center;
  text-align: center;
}

.drop-zone.active {
  border-color: var(--forest);
  background: rgba(122, 176, 180, 0.22);
}

.file-input {
  width: 1px;
  height: 1px;
  opacity: 0;
  position: absolute;
  pointer-events: none;
}

.drop-copy small {
  color: var(--warm-brown-muted);
}

.link-btn {
  border: 0;
  padding: 0;
  background: transparent;
  color: #2959b7;
  text-decoration: underline;
  font-weight: 600;
  cursor: pointer;
}

.helper-text {
  border-radius: 10px;
  background: #f5f8fa;
  border: 1px solid #dbe3e8;
  padding: 10px;
  font-size: 0.8rem;
  color: #5a6d79;
}

.helper-text ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 4px;
}

.upload-actions {
  border-top: 1px solid rgba(92, 138, 150, 0.22);
  background: #fff;
  padding: 12px 14px calc(12px + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--warm-brown-muted);
  font-size: 0.84rem;
  position: sticky;
  bottom: 0;
  z-index: 2;
}

.queue-wrap h3 {
  margin-bottom: 8px;
  font-size: 0.85rem;
  color: #5a6d79;
}

.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.queue-item {
  border: 1px solid rgba(92, 138, 150, 0.2);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.file-icon {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: #eff4f7;
  font-size: 1rem;
  flex: 0 0 auto;
}

.file-copy {
  min-width: 0;
  flex: 1;
}

.file-copy p,
.file-copy small {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-copy p {
  font-size: 0.86rem;
}

.file-copy small {
  color: var(--warm-brown-muted);
  font-size: 0.76rem;
}

.queue-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
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

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--forest);
  color: #fff;
}

.icon-btn {
  border: 1px solid rgba(92, 138, 150, 0.28);
  background: #f4f8fa;
  color: #2f4650;
  border-radius: 8px;
  min-width: 44px;
  min-height: 44px;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
}

.icon-btn.danger {
  border-color: rgba(185, 64, 64, 0.35);
  background: #fff1f1;
  color: #8e2525;
}

.error-text {
  color: #a03333;
}

@media (min-width: 760px) {
  .upload-overlay {
    align-items: center;
    justify-items: center;
    padding:
      calc(20px + env(safe-area-inset-top, 0px))
      calc(20px + env(safe-area-inset-right, 0px))
      calc(20px + env(safe-area-inset-bottom, 0px))
      calc(20px + env(safe-area-inset-left, 0px));
  }

  .upload-shell {
    width: min(780px, 100%);
    border-radius: 16px;
    max-height: calc(86dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  }

  .upload-actions {
    padding: 12px 14px;
  }
}
</style>
