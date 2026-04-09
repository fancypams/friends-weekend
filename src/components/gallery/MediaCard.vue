<script setup>
import { computed } from 'vue'
import UploaderBadge from './UploaderBadge.vue'

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  deleting: {
    type: Boolean,
    default: false,
  },
  canRemove: {
    type: Boolean,
    default: false,
  },
  overlay: {
    type: Boolean,
    default: false,
  },
  compact: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['remove', 'preview-error', 'preview-loaded'])

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
  <article class="media-card" :class="{ 'overlay-card': overlay, 'compact-card': compact }">
    <div class="thumb-wrap">
      <span v-if="!item.preview_url" class="thumb-skeleton" aria-hidden="true"></span>
      <img
        v-if="item.media_type === 'image' && item.preview_url"
        :src="item.preview_url"
        :alt="item.original_filename"
        loading="lazy"
        decoding="async"
        @error="emit('preview-error', item)"
        @load="emit('preview-loaded', item)"
      />
      <video
        v-else-if="item.media_type === 'video' && item.preview_url"
        :src="item.preview_url"
        preload="metadata"
        muted
        playsinline
        @error="emit('preview-error', item)"
        @loadedmetadata="emit('preview-loaded', item)"
      ></video>
      <span v-else class="thumb-empty">Preview unavailable</span>

      <button
        v-if="compact && canRemove"
        class="btn danger icon-btn compact-remove"
        type="button"
        :disabled="deleting"
        :aria-label="deleting ? 'Removing media' : 'Remove media'"
        @click="emit('remove', item)"
      >
        <span v-if="deleting">…</span>
        <span v-else aria-hidden="true">🗑</span>
      </button>
    </div>

    <div class="card-body">
      <div class="meta-row">
        <div class="uploader-row">
          <UploaderBadge :name="uploaderName" :email-key="item.owner_email" size="sm" />
          <div class="uploader-copy">
            <strong>{{ uploaderName }}</strong>
            <small>{{ relativeTime }}</small>
          </div>
        </div>

        <div class="actions-row">
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
    </div>
  </article>
</template>

<style scoped>
.media-card {
  border: 1px solid rgba(92, 138, 150, 0.24);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  display: block;
  position: relative;
  content-visibility: auto;
  contain-intrinsic-size: 280px;
}

.thumb-wrap {
  background: #f1f5f7;
  position: relative;
}

.thumb-wrap img,
.thumb-wrap video {
  width: 100%;
  height: 132px;
  object-fit: cover;
  display: block;
}

.thumb-empty {
  height: 132px;
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

.card-body {
  display: grid;
  gap: 10px;
  padding: 10px;
  background: #fff;
}

.meta-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
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
.uploader-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uploader-copy small {
  color: var(--warm-brown-muted);
  font-size: 0.76rem;
}

.actions-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
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

.compact-remove {
  position: absolute;
  bottom: 8px;
  right: 8px;
  min-width: 26px;
  min-height: 26px;
  padding: 3px;
  z-index: 2;
  border-width: 1px;
  font-size: 0.68rem;
}

@media (min-width: 700px) {
  .thumb-wrap img,
  .thumb-wrap video,
  .thumb-empty {
    height: 190px;
  }
}

@media (max-width: 699px) {
  .compact-card .thumb-wrap img,
  .compact-card .thumb-wrap video,
  .compact-card .thumb-empty {
    height: 100%;
  }

  .compact-card .thumb-wrap,
  .compact-card .thumb-empty {
    aspect-ratio: 1 / 1;
  }

  .compact-card .card-body {
    display: none;
  }

  .compact-card .btn.danger {
    border-color: rgba(185, 64, 64, 0.5);
    background: rgba(255, 236, 236, 0.75);
    color: #b63b3b;
    backdrop-filter: blur(2px);
  }

  .overlay-card .thumb-wrap img,
  .overlay-card .thumb-wrap video,
  .overlay-card .thumb-empty {
    height: 236px;
  }

  .overlay-card .card-body {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(to top, rgba(7, 16, 20, 0.78), rgba(7, 16, 20, 0.02));
    color: #fff;
  }

  .overlay-card .meta-row {
    align-items: flex-end;
  }

  .overlay-card .uploader-copy small {
    color: rgba(255, 255, 255, 0.86);
  }

  .overlay-card .btn.danger {
    border-color: rgba(255, 255, 255, 0.44);
    background: rgba(16, 24, 29, 0.48);
    color: #fff;
    backdrop-filter: blur(4px);
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
