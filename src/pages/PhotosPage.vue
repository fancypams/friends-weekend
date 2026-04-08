<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import HeroHeader from '../components/HeroHeader.vue'
import { bypassAuth, hasSupabaseConfig, supabase } from '../lib/supabaseClient'
import { globalSignOut } from '../lib/authAccess'
import {
  completeUpload,
  createUploadTicket,
  fetchGalleryFeed,
  fetchProfile,
  removeMedia,
  signMediaUrl,
  uploadWithSignedTicket,
} from '../lib/photosApi'

const router = useRouter()

const session = ref(null)
const profile = ref(null)
const authLoading = ref(true)
const authError = ref('')

const selectedFiles = ref([])
const uploadInProgress = ref(false)
const uploadResults = ref([])

const galleryItems = ref([])
const galleryCursor = ref(null)
const galleryLoading = ref(false)
const galleryError = ref('')
const activeIndex = ref(0)

const captureWindowLabel = 'Jul 31-Aug 4, 2026 (Seattle time)'

let authSubscription = null

const isSignedIn = computed(() => bypassAuth || Boolean(session.value?.user))
const isInvited = computed(() => bypassAuth || Boolean(profile.value?.active))
const isAdmin = computed(() => bypassAuth || profile.value?.role === 'admin')
const userId = computed(() => session.value?.user?.id ?? null)
const userEmail = computed(() => profile.value?.email ?? session.value?.user?.email ?? (bypassAuth ? 'group@friends-weekend.local' : ''))
const canLoadApp = computed(() => hasSupabaseConfig && (bypassAuth || (isSignedIn.value && isInvited.value)))
const activeItem = computed(() => galleryItems.value[activeIndex.value] ?? null)

let carouselTimer = null

function prettyDate(iso) {
  if (!iso) return 'Unknown date'
  const date = new Date(iso)
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function prettyBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return '--'
  const value = Number(bytes)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatUploader(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!value) return 'Friend'
  return value.split('@')[0]
}

function initialsFromEmail(email) {
  const value = formatUploader(email).replace(/[^a-z0-9]+/gi, ' ').trim()
  if (!value) return 'FR'
  const parts = value.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function avatarColor(email) {
  const value = String(email || '')
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 62% 42%)`
}

function mediaLabel(item) {
  return item?.media_type === 'video' ? 'Video' : 'Photo'
}

function normalizeUploadError(err) {
  if (!err) return 'Request failed'
  return typeof err === 'string' ? err : err.message || 'Request failed'
}

function looksLikeAuthError(err) {
  const message = normalizeUploadError(err).toLowerCase()
  const status = Number(err?.status || 0)
  const code = String(err?.code || '').toLowerCase()

  return (
    status === 401
    || code === 'invalid_jwt'
    || message.includes('no active session')
    || message.includes('invalid or expired token')
  )
}

async function withSessionRetry(task) {
  try {
    return await task()
  } catch (err) {
    if (bypassAuth || !supabase || !looksLikeAuthError(err)) {
      throw err
    }

    const refreshed = await supabase.auth.refreshSession().catch(() => null)
    const nextSession = refreshed?.data?.session ?? null
    if (!nextSession?.user) {
      throw err
    }

    session.value = nextSession
    return task()
  }
}

async function maybeReauth(err) {
  if (bypassAuth) return false
  if (!looksLikeAuthError(err)) return false

  authError.value = 'Session expired. Please sign in again.'
  goToLogin()
  return true
}

async function handleApiFailure(err, setMessage) {
  if (await maybeReauth(err)) return true
  setMessage(normalizeUploadError(err))
  return false
}

function goToLogin() {
  router.replace({
    path: '/login',
    query: { redirect: '/photos', reauth: '1' },
  })
}

async function signOut() {
  await globalSignOut().catch(() => {})
  goToLogin()
}

function guessMimeFromName(name) {
  const ext = String(name).toLowerCase().split('.').pop() || ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic') return 'image/heic'
  if (ext === 'heif') return 'image/heif'
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'mov') return 'video/quicktime'
  return ''
}

function canRemove(item) {
  if (!item) return false
  return isAdmin.value || item.owner_id === userId.value
}

function stopCarouselTimer() {
  if (carouselTimer) {
    clearInterval(carouselTimer)
    carouselTimer = null
  }
}

function startCarouselTimer() {
  stopCarouselTimer()
  if (galleryItems.value.length < 2) return

  carouselTimer = setInterval(() => {
    activeIndex.value = (activeIndex.value + 1) % galleryItems.value.length
  }, 5000)
}

function setActiveIndex(index) {
  const max = galleryItems.value.length - 1
  if (max < 0) {
    activeIndex.value = 0
    return
  }
  activeIndex.value = Math.max(0, Math.min(max, index))
  startCarouselTimer()
}

function showNext() {
  if (!galleryItems.value.length) return
  setActiveIndex((activeIndex.value + 1) % galleryItems.value.length)
}

function showPrev() {
  if (!galleryItems.value.length) return
  const next = activeIndex.value - 1 < 0 ? galleryItems.value.length - 1 : activeIndex.value - 1
  setActiveIndex(next)
}

async function hydrateItemUrls(items) {
  return Promise.all(
    items.map(async (item) => {
      const previewVariant = item.media_type === 'image' ? 'thumb' : 'processed'

      try {
        const signed = await withSessionRetry(() => signMediaUrl(item.id, previewVariant))
        return {
          ...item,
          preview_url: signed.signedUrl,
        }
      } catch {
        return {
          ...item,
          preview_url: null,
        }
      }
    }),
  )
}

async function loadGallery({ reset = false } = {}) {
  if (!canLoadApp.value) return

  galleryLoading.value = true
  galleryError.value = ''

  try {
    const cursor = reset ? null : galleryCursor.value
    const payload = await withSessionRetry(() => fetchGalleryFeed(cursor, 24))
    const hydrated = await hydrateItemUrls(payload.items || [])

    if (reset) {
      galleryItems.value = hydrated
      activeIndex.value = 0
    } else {
      galleryItems.value = [...galleryItems.value, ...hydrated]
    }

    galleryCursor.value = payload.nextCursor || null
  } catch (err) {
    await handleApiFailure(err, (message) => {
      galleryError.value = message
    })
  } finally {
    galleryLoading.value = false
  }
}

async function hydrateSession(nextSession) {
  session.value = nextSession
  authError.value = ''

  if (!nextSession?.user) {
    profile.value = null
    galleryItems.value = []
    galleryCursor.value = null
    authLoading.value = false
    return
  }

  try {
    const nextProfile = await withSessionRetry(() => fetchProfile(nextSession.user.id))
    if (!nextProfile) {
      throw new Error('Could not load profile')
    }

    profile.value = nextProfile

    if (!nextProfile.active) {
      authError.value = 'Your account is not currently invited to this shared gallery.'
      authLoading.value = false
      return
    }

    await loadGallery({ reset: true })
  } catch (err) {
    await handleApiFailure(err, (message) => {
      authError.value = message
    })
  } finally {
    authLoading.value = false
  }
}

function handleFileSelection(event) {
  selectedFiles.value = Array.from(event.target.files || [])
}

async function startUpload() {
  if (!selectedFiles.value.length || !canLoadApp.value) return

  uploadInProgress.value = true
  uploadResults.value = []

  for (const file of selectedFiles.value) {
    const row = {
      name: file.name,
      size: file.size,
      status: 'preparing',
      error: '',
    }

    uploadResults.value.push(row)

    try {
      const mimeType = file.type || guessMimeFromName(file.name)
      if (!mimeType) {
        throw new Error('Unsupported file type')
      }

      row.status = 'requesting-ticket'
      const ticket = await withSessionRetry(() => createUploadTicket({
        filename: file.name,
        mimeType,
        bytes: file.size,
      }))

      row.status = 'uploading'
      await uploadWithSignedTicket(ticket, file)

      row.status = 'processing'
      await withSessionRetry(() => completeUpload(ticket.mediaId))

      row.status = 'published'
    } catch (err) {
      row.status = 'failed'
      if (await maybeReauth(err)) {
        row.error = 'Session expired. Please sign in again.'
        break
      }
      row.error = normalizeUploadError(err)
    }
  }

  selectedFiles.value = []
  uploadInProgress.value = false
  await loadGallery({ reset: true })
}

async function deleteMediaItem(item) {
  if (!item || !canRemove(item)) return

  const confirmed = window.confirm('Remove this media for everyone? This cannot be undone.')
  if (!confirmed) return

  try {
    await withSessionRetry(() => removeMedia(item.id))
    await loadGallery({ reset: true })
  } catch (err) {
    await handleApiFailure(err, (message) => {
      galleryError.value = message
    })
  }
}

onMounted(async () => {
  if (!hasSupabaseConfig || !supabase) {
    authLoading.value = false
    return
  }

  if (bypassAuth) {
    session.value = { user: { id: '00000000-0000-0000-0000-000000000000', email: 'group@friends-weekend.local' } }
    profile.value = { active: true, role: 'admin', email: 'group@friends-weekend.local' }
    authLoading.value = false
    await loadGallery({ reset: true })
    return
  }

  const { data } = await supabase.auth.getSession()
  await hydrateSession(data.session)

  const subscription = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
    await hydrateSession(nextSession)
    if (!nextSession?.user) {
      goToLogin()
    }
  })

  authSubscription = subscription.data.subscription
})

onUnmounted(() => {
  stopCarouselTimer()
  if (authSubscription) {
    authSubscription.unsubscribe()
    authSubscription = null
  }
})

watch(
  () => galleryItems.value.length,
  (length) => {
    if (!length) {
      activeIndex.value = 0
      stopCarouselTimer()
      return
    }

    if (activeIndex.value >= length) {
      activeIndex.value = 0
    }

    startCarouselTimer()
  },
)
</script>

<template>
  <div class="photos-page">
    <HeroHeader show-back />

    <main class="photos-body">
      <section v-if="!hasSupabaseConfig" class="card warning">
        <h2>Supabase Not Configured</h2>
        <p>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your environment before using photos.</p>
      </section>

      <section v-else-if="authLoading" class="card">
        <div class="spinner"></div>
        <p>Loading shared photos…</p>
      </section>

      <section v-else-if="!isSignedIn" class="card auth-card">
        <h2>Sign In Required</h2>
        <p>Your session ended. Continue from the login page.</p>
        <button class="primary-btn" type="button" @click="goToLogin">Go To Login</button>
      </section>

      <section v-else-if="!isInvited" class="card warning">
        <h2>Invite Required</h2>
        <p>{{ authError || 'Your account is not currently approved for this gallery.' }}</p>
        <button class="secondary-btn" type="button" @click="signOut">Sign out</button>
      </section>

      <template v-else>
        <section class="carousel-shell">
          <header class="gallery-head">
            <div>
              <h2>Weekend Gallery</h2>
              <p class="muted">Signed in as <strong>{{ userEmail }}</strong></p>
            </div>
            <button class="secondary-btn" type="button" @click="loadGallery({ reset: true })" :disabled="galleryLoading">
              Refresh
            </button>
          </header>

          <div v-if="activeItem" class="carousel-frame">
            <img
              v-if="activeItem.media_type === 'image' && activeItem.preview_url"
              class="carousel-media"
              :src="activeItem.preview_url"
              :alt="activeItem.original_filename"
            />
            <video
              v-else-if="activeItem.media_type === 'video' && activeItem.preview_url"
              class="carousel-media"
              :src="activeItem.preview_url"
              controls
              preload="metadata"
              playsinline
            ></video>
            <div v-else class="carousel-placeholder">Preview unavailable</div>

            <div class="carousel-overlay">
              <div class="uploader-chip">
                <span class="uploader-avatar" :style="{ background: avatarColor(activeItem.owner_email) }">
                  {{ initialsFromEmail(activeItem.owner_email) }}
                </span>
                <div class="uploader-text">
                  <strong>{{ formatUploader(activeItem.owner_email) }}</strong>
                  <small>{{ mediaLabel(activeItem) }} · {{ prettyDate(activeItem.published_at) }}</small>
                </div>
              </div>
              <strong class="carousel-title">{{ activeItem.original_filename }}</strong>
            </div>

            <button class="carousel-nav left" type="button" @click="showPrev">Prev</button>
            <button class="carousel-nav right" type="button" @click="showNext">Next</button>
          </div>

          <div v-else class="carousel-empty">
            <strong>No media yet</strong>
            <p>Upload photos or videos and they will appear here.</p>
          </div>

          <p v-if="galleryError" class="error-text">{{ galleryError }}</p>
          <p v-if="galleryLoading && !galleryItems.length" class="muted">Loading gallery…</p>
        </section>

        <section class="card">
          <h3>All Uploads</h3>
          <div v-if="galleryItems.length" class="gallery-grid">
            <article
              v-for="(item, index) in galleryItems"
              :key="item.id"
              class="gallery-card"
              :class="{ active: index === activeIndex }"
              @click="setActiveIndex(index)"
            >
              <img
                v-if="item.media_type === 'image' && item.preview_url"
                :src="item.preview_url"
                :alt="item.original_filename"
                loading="lazy"
              />
              <video
                v-else-if="item.media_type === 'video' && item.preview_url"
                :src="item.preview_url"
                controls
                preload="metadata"
                playsinline
              ></video>
              <div v-else class="placeholder">Preview unavailable</div>

              <span class="tile-badge" :style="{ background: avatarColor(item.owner_email) }">
                {{ initialsFromEmail(item.owner_email) }}
              </span>
              <span v-if="item.media_type === 'video'" class="tile-type">Video</span>

              <div class="gallery-meta">
                <strong>{{ item.original_filename }}</strong>
                <small>{{ prettyDate(item.published_at) }}</small>
                <small>By {{ formatUploader(item.owner_email) }}</small>
                <small v-if="item.captured_at">Captured {{ prettyDate(item.captured_at) }}</small>
              </div>

              <button
                v-if="canRemove(item)"
                class="danger-btn"
                type="button"
                @click.stop="deleteMediaItem(item)"
              >
                Remove
              </button>
            </article>
          </div>

          <p v-else-if="!galleryLoading" class="muted">No photos or videos yet.</p>

          <button
            v-if="galleryCursor"
            class="secondary-btn load-more"
            type="button"
            :disabled="galleryLoading"
            @click="loadGallery()"
          >
            {{ galleryLoading ? 'Loading…' : 'Load More' }}
          </button>
        </section>

        <section class="card">
          <h3>Upload Your Photos Or Videos</h3>
          <p class="muted">
            Photos up to 25 MB, videos up to 250 MB. Uploads auto-publish after processing.
            Only media captured during {{ captureWindowLabel }} is accepted.
          </p>
          <input
            class="file-input"
            type="file"
            multiple
            accept="image/*,video/mp4,video/quicktime"
            @change="handleFileSelection"
          />
          <div class="upload-actions">
            <span>{{ selectedFiles.length }} file(s) selected</span>
            <button class="primary-btn" type="button" :disabled="uploadInProgress || !selectedFiles.length" @click="startUpload">
              {{ uploadInProgress ? 'Uploading…' : 'Upload Selected' }}
            </button>
          </div>

          <ul v-if="uploadResults.length" class="upload-results">
            <li v-for="row in uploadResults" :key="`${row.name}-${row.size}`">
              <div>
                <strong>{{ row.name }}</strong>
                <small>{{ prettyBytes(row.size) }}</small>
              </div>
              <span :class="['status-chip', row.status]">{{ row.status }}</span>
              <p v-if="row.error" class="error-text">{{ row.error }}</p>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.photos-page {
  min-height: 100vh;
  background: transparent;
  color: #1A3329;
  font-family: system-ui, 'Segoe UI', sans-serif;
}

.photos-body {
  max-width: 1080px;
  margin: 0 auto;
  padding: 72px 20px 64px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.card {
  background: #fff;
  border: 1px solid #c8d8d0;
  border-radius: 14px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  padding: 18px;
}

.warning {
  border-color: #d48d37;
  background: #fff7e9;
}

.auth-card {
  text-align: center;
}

.carousel-shell {
  position: relative;
}

.gallery-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

h2,
h3 {
  margin: 0 0 8px;
}

p {
  margin: 0;
}

.muted {
  color: #4e6b5f;
  font-size: 13px;
}

.error-text {
  color: #b94040;
  font-size: 13px;
  margin-top: 8px;
}

.primary-btn,
.secondary-btn,
.danger-btn {
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn {
  background: #2E6352;
  color: #fff;
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-btn {
  background: #f0f6f4;
  border-color: #c8d8d0;
  color: #1A3329;
}

.danger-btn {
  background: #fff3f3;
  border-color: #d98686;
  color: #8a1f1f;
}

.carousel-frame {
  position: relative;
  min-height: 420px;
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(135deg, #0f2a22, #285647);
  box-shadow: 0 16px 32px rgba(16, 34, 28, 0.25);
}

.carousel-media {
  width: 100%;
  height: 420px;
  object-fit: cover;
  display: block;
}

.carousel-placeholder {
  min-height: 420px;
  display: grid;
  place-items: center;
  color: #f0f6f4;
  font-size: 14px;
}

.carousel-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
  padding: 14px;
  background: linear-gradient(to top, rgba(8, 17, 14, 0.72), rgba(8, 17, 14, 0));
}

.uploader-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.uploader-avatar {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
}

.uploader-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  color: #fff;
}

.uploader-text strong,
.carousel-title {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.uploader-text small {
  color: rgba(255, 255, 255, 0.82);
  font-size: 11px;
}

.carousel-title {
  color: #fff;
  max-width: 48%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.carousel-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  border: 0;
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.84);
  color: #1a3329;
  cursor: pointer;
}

.carousel-nav.left {
  left: 12px;
}

.carousel-nav.right {
  right: 12px;
}

.carousel-empty {
  border-radius: 18px;
  border: 1px dashed #9cb7ab;
  min-height: 220px;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 16px;
  color: #3f5f53;
}

.gallery-grid {
  margin-top: 12px;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.gallery-card {
  position: relative;
  border: 1px solid #dbe7e1;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.gallery-card:hover {
  transform: translateY(-2px);
  border-color: #8eb5a7;
  box-shadow: 0 8px 16px rgba(20, 51, 42, 0.14);
}

.gallery-card.active {
  border-color: #2e6352;
  box-shadow: 0 0 0 2px rgba(46, 99, 82, 0.2);
}

.gallery-card img,
.gallery-card video {
  width: 100%;
  height: 180px;
  object-fit: cover;
  background: #f3f7f5;
}

.gallery-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
}

.tile-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.tile-type {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(15, 42, 34, 0.78);
  color: #fff;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 4px 7px;
}

.gallery-meta small,
.upload-results small {
  color: #4e6b5f;
  font-size: 12px;
}

.placeholder {
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f7f5;
  color: #4e6b5f;
  font-size: 13px;
}

.load-more {
  margin-top: 12px;
}

.file-input {
  margin-top: 8px;
}

.upload-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  font-size: 13px;
  color: #4e6b5f;
}

.upload-results {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.upload-results li {
  border: 1px solid #e4ece8;
  border-radius: 10px;
  padding: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.status-chip {
  display: inline-flex;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  border: 1px solid #c8d8d0;
}

.status-chip.published {
  background: #e4f4ef;
  border-color: #a3d0c2;
}

.status-chip.failed {
  background: #ffefef;
  border-color: #e4aaaa;
}

.status-chip.processing,
.status-chip.uploading,
.status-chip.requesting-ticket,
.status-chip.preparing {
  background: #f4f6ff;
  border-color: #c6cfee;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #c8d8d0;
  border-top-color: #2E6352;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 8px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .gallery-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .carousel-frame,
  .carousel-media {
    min-height: 320px;
    height: 320px;
  }

  .carousel-overlay {
    flex-direction: column;
    align-items: flex-start;
  }

  .carousel-title {
    max-width: 100%;
  }

  .carousel-nav {
    top: auto;
    bottom: 10px;
    transform: none;
  }

  .carousel-nav.left {
    left: 10px;
  }

  .carousel-nav.right {
    right: 10px;
  }

  .upload-results li {
    flex-direction: column;
    align-items: flex-start;
  }

  .upload-actions {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
