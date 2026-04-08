<script setup>
import { computed } from 'vue'
import UploaderBadge from './UploaderBadge.vue'

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  downloading: {
    type: Boolean,
    default: false,
  },
  deleting: {
    type: Boolean,
    default: false,
  },
  canRemove: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['view', 'download', 'remove'])

const uploaderName = computed(() => {
  const value = String(props.item?.owner_email || '').trim().toLowerCase()
  if (!value) return 'Friend'
  return value.split('@')[0].replace(/[._-]+/g, ' ')
})

const relativeTime = computed(() => {
  const raw = props.item?.published_at
  if (!raw) return 'Unknown time'
  const date = new Date(raw)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
})
</script>

<template>
  <article class="media-card">
    <button class="thumb-wrap" type="button" @click="emit('view', item)">
      <span v-if="!item.preview_url" class="thumb-skeleton" aria-hidden="true"></span>
      <img
        v-if="item.media_type === 'image' && item.preview_url"
        :src="item.preview_url"
        :alt="item.original_filename"
        loading="lazy"
        decoding="async"
      />
      <video
        v-else-if="item.media_type === 'video' && item.preview_url"
        :src="item.preview_url"
        preload="metadata"
        muted
        playsinline
      ></video>
      <span v-else class="thumb-empty">Preview unavailable</span>

      <span class="type-badge">{{ item.media_type === 'video' ? 'Video' : 'Photo' }}</span>

    </button>

    <div class="card-body">
      <div class="uploader-row">
        <UploaderBadge :name="uploaderName" :email-key="item.owner_email" size="sm" />
        <div class="uploader-copy">
          <strong>{{ uploaderName }}</strong>
          <small>{{ relativeTime }}</small>
        </div>
      </div>

      <div class="filename-row">
        <p class="filename">{{ item.original_filename }}</p>
        <button
          v-if="canRemove"
          class="btn danger icon-btn"
          type="button"
          :disabled="deleting"
          :aria-label="deleting ? 'Removing media' : 'Remove media'"
          @click="emit('remove', item)"
        >
          <span v-if="deleting">…</span>
          <span v-else aria-hidden="true">🗑</span>
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.media-card {
  border: 1px solid rgba(92, 138, 150, 0.24);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  display: grid;
  content-visibility: auto;
  contain-intrinsic-size: 280px;
}

.thumb-wrap {
  border: 0;
  padding: 0;
  background: #f1f5f7;
  cursor: pointer;
  position: relative;
  touch-action: manipulation;
}

.thumb-wrap img,
.thumb-wrap video {
  width: 100%;
  height: 152px;
  object-fit: cover;
  display: block;
}

.thumb-empty {
  height: 152px;
  display: grid;
  place-items: center;
  color: var(--warm-brown-muted);
  font-size: 0.8rem;
}

.thumb-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    rgba(227, 235, 240, 0.92) 20%,
    rgba(243, 248, 251, 0.95) 40%,
    rgba(227, 235, 240, 0.92) 60%
  );
  background-size: 200% 100%;
  animation: shimmer 1.2s linear infinite;
}

.type-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  background: rgba(35, 50, 56, 0.72);
  color: #fff;
}

.card-body {
  display: grid;
  gap: 10px;
  padding: 10px;
}

.uploader-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.uploader-copy {
  min-width: 0;
}

.uploader-copy strong,
.uploader-copy small,
.filename {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uploader-copy small {
  color: var(--warm-brown-muted);
  font-size: 0.76rem;
}

.filename {
  font-size: 0.82rem;
  margin: 0;
}

.filename-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.btn {
  border: 1px solid transparent;
  border-radius: 999px;
  min-height: 36px;
  padding: 8px 12px;
  font-size: 0.8rem;
  font-weight: 650;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.danger {
  border-color: rgba(185, 64, 64, 0.3);
  background: #fff1f1;
  color: #8e2525;
}

.icon-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
}

@media (min-width: 700px) {
  .thumb-wrap img,
  .thumb-wrap video,
  .thumb-empty {
    height: 190px;
  }
}

@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
</style>
