<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import MediaCard from '../components/gallery/MediaCard.vue'
import UploadPanel from '../components/gallery/UploadPanel.vue'
import EmptyState from '../components/gallery/EmptyState.vue'
import LoadingState from '../components/gallery/LoadingState.vue'
import ErrorState from '../components/gallery/ErrorState.vue'
import { bypassAuth, hasSupabaseConfig, supabase } from '../lib/supabaseClient'
import {
  completeUpload,
  createUploadTicket,
  fetchGalleryFeed,
  fetchProfile,
  removeMedia,
  signMediaUrl,
  uploadWithSignedTicket,
} from '../lib/photosApi'

const session = ref(null)
const profile = ref(null)
const authLoading = ref(true)

const galleryItems = ref([])
const galleryCursor = ref(null)
const galleryLoading = ref(false)
const galleryError = ref('')

const queueItems = ref([])
const uploadPanelOpen = ref(false)
const uploadBusy = ref(false)
const uploadError = ref('')
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const isMobileViewport = ref(typeof window !== 'undefined' ? window.innerWidth <= 699 : false)

const mobileFeedMode = ref('grid')

const deletingById = ref({})
const previewRetryById = ref({})

const allowedMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
])

const mimeAliases = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'video/mov': 'video/quicktime',
  'video/x-m4v': 'video/mp4',
}

let authSubscription = null
let liveSyncChannel = null
let authHeartbeatTimer = null
let authHeartbeatInFlight = false
const INITIAL_PREVIEW_COUNT = 6
const LOAD_MORE_PREVIEW_COUNT = 2
const INITIAL_PAGE_SIZE = 12
const LOAD_MORE_PAGE_SIZE = 24
const IMAGE_MAX_BYTES = 25 * 1024 * 1024
const VIDEO_MAX_BYTES = 250 * 1024 * 1024
const UPLOAD_RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 700
const AUTH_HEARTBEAT_MS = 30_000
const AUTH_REFRESH_BUFFER_SECONDS = 90
const UPLOAD_DB_NAME = 'friends-weekend-upload-queue'
const UPLOAD_DB_STORE = 'queue_items'

const isSignedIn = computed(() => bypassAuth || Boolean(session.value?.user))
const isAdmin = computed(() => bypassAuth || profile.value?.role === 'admin')
const userId = computed(() => session.value?.user?.id ?? null)
const captureWindowLabel = computed(() => (
  'Capture window is Jul 31-Aug 4, 2026 (Seattle time).'
))

const canLoadApp = computed(() => hasSupabaseConfig && isSignedIn.value)
const hasMore = computed(() => Boolean(galleryCursor.value))
const selectedCount = computed(() => queueItems.value.length)

function normalizeUploadError(err) {
  if (!err) return 'Request failed'
  if (typeof err === 'string') return err
  const body = err.body || null
  return (
    body?.reason
    || body?.error
    || body?.message
    || err.reason
    || err.message
    || 'Request failed'
  )
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

function syncSessionIfSignedIn(nextSession) {
  if (!nextSession?.user) return false
  session.value = nextSession
  return true
}

async function getCurrentSessionSnapshot() {
  if (!supabase) return null
  const result = await supabase.auth.getSession().catch(() => null)
  return result?.data?.session ?? null
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
    if (!syncSessionIfSignedIn(nextSession)) {
      const fallbackSession = await getCurrentSessionSnapshot()
      if (!syncSessionIfSignedIn(fallbackSession)) throw err
    }
    return task()
  }
}

async function maybeReauth(err) {
  if (bypassAuth || !supabase || !looksLikeAuthError(err)) return false

  const fallbackSession = await getCurrentSessionSnapshot()
  return !syncSessionIfSignedIn(fallbackSession)
}

function guessMimeFromName(name) {
  const ext = String(name).trim().toLowerCase().split('.').pop() || ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic') return 'image/heic'
  if (ext === 'heif') return 'image/heif'
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4'
  if (ext === 'mov') return 'video/quicktime'
  return ''
}

function normalizedMime(file) {
  const raw = String(file?.type || '').trim().toLowerCase()
  const alias = mimeAliases[raw]
  const fromType = alias || raw
  const fromName = guessMimeFromName(file?.name)
  const mime = fromType || fromName
  return allowedMime.has(mime) ? mime : ''
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableUploadError(err) {
  const status = Number(err?.status || 0)
  const message = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '').toLowerCase()
  return (
    !isOnline.value
    || status >= 500
    || code === 'request_timeout'
    || message.includes('network')
    || message.includes('failed to fetch')
    || message.includes('timed out')
  )
}

async function withRetries(task, attempts = UPLOAD_RETRY_ATTEMPTS) {
  let lastError = null
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await task()
    } catch (err) {
      lastError = err
      if (i === attempts - 1 || !isRetryableUploadError(err)) throw err
      await sleep(RETRY_BASE_MS * (2 ** i))
    }
  }
  throw lastError || new Error('Request failed')
}

function openUploadDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }

    const request = indexedDB.open(UPLOAD_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(UPLOAD_DB_STORE)) {
        db.createObjectStore(UPLOAD_DB_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open upload DB'))
  })
}

async function persistQueueItem(item) {
  const db = await openUploadDb().catch(() => null)
  if (!db) return

  await new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_DB_STORE, 'readwrite')
    tx.objectStore(UPLOAD_DB_STORE).put(item)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error || new Error('Failed to persist queue item'))
  }).catch(() => { })

  db.close()
}

async function removeQueueItemFromStorage(id) {
  const db = await openUploadDb().catch(() => null)
  if (!db) return

  await new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_DB_STORE, 'readwrite')
    tx.objectStore(UPLOAD_DB_STORE).delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error || new Error('Failed to remove queue item'))
  }).catch(() => { })

  db.close()
}

async function loadPersistedQueue() {
  const db = await openUploadDb().catch(() => null)
  if (!db) return []

  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_DB_STORE, 'readonly')
    const request = tx.objectStore(UPLOAD_DB_STORE).getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error || new Error('Failed to read queue'))
  }).catch(() => [])

  db.close()
  return Array.isArray(rows) ? rows : []
}

async function restoreUploadQueue() {
  const rows = await loadPersistedQueue()
  if (!rows.length) return

  queueItems.value = rows
    .map((item) => {
      const transient = ['requesting-ticket', 'uploading', 'processing']
      const status = transient.includes(item.status) ? 'queued' : item.status
      return {
        ...item,
        progress: status === 'queued' ? 0 : Number(item.progress || 0),
        error: status === 'queued' ? 'Upload resumed after reconnect/reopen.' : String(item.error || ''),
      }
    })
    .filter((item) => item.status !== 'published')
}

function onOnline() {
  isOnline.value = true
  uploadError.value = ''
  const hasQueued = queueItems.value.some((item) => item.status === 'queued')
  if (hasQueued && canLoadApp.value && !uploadBusy.value) {
    void startUpload()
  }
}

function onOffline() {
  isOnline.value = false
  uploadError.value = 'You are offline. Uploads will resume when connection returns.'
}

function onResize() {
  if (typeof window === 'undefined') return
  isMobileViewport.value = window.innerWidth <= 699
}

async function keepSessionWarm() {
  if (bypassAuth || !supabase || !isSignedIn.value || authHeartbeatInFlight) return

  authHeartbeatInFlight = true
  try {
    const currentSession = await getCurrentSessionSnapshot()
    if (!currentSession?.user) return

    const now = Math.floor(Date.now() / 1000)
    const expiresAt = Number(currentSession.expires_at || 0)
    const expiringSoon = expiresAt > 0 && expiresAt <= now + AUTH_REFRESH_BUFFER_SECONDS

    if (!expiringSoon) {
      syncSessionIfSignedIn(currentSession)
      return
    }

    const refreshed = await supabase.auth.refreshSession().catch(() => null)
    const refreshedSession = refreshed?.data?.session ?? null
    if (syncSessionIfSignedIn(refreshedSession)) return
    syncSessionIfSignedIn(currentSession)
  } finally {
    authHeartbeatInFlight = false
  }
}

function startAuthHeartbeat() {
  if (authHeartbeatTimer || bypassAuth || !supabase) return
  authHeartbeatTimer = window.setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    void keepSessionWarm()
  }, AUTH_HEARTBEAT_MS)
}

function stopAuthHeartbeat() {
  if (!authHeartbeatTimer) return
  window.clearInterval(authHeartbeatTimer)
  authHeartbeatTimer = null
}

function onVisibilityChange() {
  if (typeof document === 'undefined' || document.hidden) return
  void keepSessionWarm()
}

function canRemove(item) {
  if (!item) return false
  return isAdmin.value || item.owner_id === userId.value
}

async function resolveOwnerEmail(ownerId) {
  const existing = galleryItems.value.find((row) => row.owner_id === ownerId && row.owner_email)
  if (existing?.owner_email) return existing.owner_email

  try {
    const nextProfile = await withSessionRetry(() => fetchProfile(ownerId))
    return nextProfile?.email || ''
  } catch {
    return ''
  }
}

async function applyRealtimeInsert(payload) {
  const row = payload?.new || null
  if (!row?.id) return
  if (String(row.status || '').toLowerCase() !== 'published') return
  if (galleryItems.value.some((item) => item.id === row.id)) return

  const ownerEmail = await resolveOwnerEmail(row.owner_id)
  const nextItem = {
    ...row,
    owner_email: ownerEmail,
    preview_url: '',
  }

  galleryItems.value = [nextItem, ...galleryItems.value]
  void signAndPatchPreview(nextItem)
}

function stopLiveSync() {
  if (!liveSyncChannel || !supabase) return
  supabase.removeChannel(liveSyncChannel)
  liveSyncChannel = null
}

function startLiveSync() {
  if (!supabase || !canLoadApp.value) return
  stopLiveSync()

  liveSyncChannel = supabase
    .channel(`photos-media-assets-${userId.value || 'guest'}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'media_assets', filter: 'status=eq.published' },
      async (payload) => {
        await applyRealtimeInsert(payload)
      },
    )
    .subscribe()
}

function setDeleting(mediaId, value) {
  deletingById.value = {
    ...deletingById.value,
    [mediaId]: value,
  }
}

function clearPreviewRetry(itemOrId) {
  const mediaId = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id
  if (!mediaId || !previewRetryById.value[mediaId]) return

  previewRetryById.value = {
    ...previewRetryById.value,
    [mediaId]: 0,
  }
}

function decodeBase64Url(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    return atob(padded)
  } catch {
    return ''
  }
}

function extractSignedTokenExpiry(url) {
  try {
    const token = new URL(String(url || '')).searchParams.get('token') || ''
    if (!token) return 0
    const payloadPart = token.split('.')[1] || ''
    const payloadJson = decodeBase64Url(payloadPart)
    if (!payloadJson) return 0
    const payload = JSON.parse(payloadJson)
    return Number(payload?.exp || 0)
  } catch {
    return 0
  }
}

function shouldRefreshPreviewForAuthExpiry(item) {
  const url = String(item?.preview_url || '').trim()
  if (!url) return true
  const expiresAt = extractSignedTokenExpiry(url)
  if (!expiresAt) return true

  const now = Math.floor(Date.now() / 1000)
  return expiresAt <= now + 30
}

async function resolvePreviewUrl(item) {
  const variant = item.media_type === 'image' ? 'thumb' : 'processed'
  try {
    const signed = await withSessionRetry(() => signMediaUrl(item.id, variant))
    return signed.signedUrl || ''
  } catch {
    return ''
  }
}

async function signAndPatchPreview(item) {
  if (!item?.id) return
  const url = await resolvePreviewUrl(item)
  if (!url) return

  const index = galleryItems.value.findIndex((row) => row.id === item.id)
  if (index < 0) return
  galleryItems.value[index].preview_url = url
}

async function handlePreviewLoadError(item) {
  const mediaId = item?.id
  if (!mediaId) return
  if (!shouldRefreshPreviewForAuthExpiry(item)) return

  const retries = Number(previewRetryById.value[mediaId] || 0)
  if (retries >= 1) return

  previewRetryById.value = {
    ...previewRetryById.value,
    [mediaId]: retries + 1,
  }

  await signAndPatchPreview(item)
}

async function hydratePreviews(items, awaitCount) {
  const immediate = items.slice(0, awaitCount)
  const deferred = items.slice(awaitCount)

  await Promise.all(immediate.map((item) => signAndPatchPreview(item)))
  for (const item of deferred) {
    void signAndPatchPreview(item)
  }
}

async function loadGallery({ reset = false } = {}) {
  if (!canLoadApp.value) return

  galleryLoading.value = true
  if (reset) galleryError.value = ''

  try {
    const cursor = reset ? null : galleryCursor.value
    const pageSize = reset ? INITIAL_PAGE_SIZE : LOAD_MORE_PAGE_SIZE
    const payload = await withSessionRetry(() => fetchGalleryFeed(cursor, pageSize))
    const nextItems = (payload.items || []).map((item) => ({
      ...item,
      preview_url: '',
    }))

    galleryItems.value = reset ? nextItems : [...galleryItems.value, ...nextItems]
    galleryCursor.value = payload.nextCursor || null

    const previewCount = reset ? INITIAL_PREVIEW_COUNT : LOAD_MORE_PREVIEW_COUNT
    await hydratePreviews(nextItems, previewCount)
  } catch (err) {
    if (!(await maybeReauth(err))) {
      galleryError.value = normalizeUploadError(err)
    }
  } finally {
    galleryLoading.value = false
  }
}

async function hydrateSession(nextSession) {
  session.value = nextSession

  if (!nextSession?.user) {
    profile.value = null
    galleryItems.value = []
    galleryCursor.value = null
    authLoading.value = false
    return
  }

  try {
    const nextProfile = await withSessionRetry(() => fetchProfile(nextSession.user.id)).catch(() => null)
    profile.value = nextProfile || {
      role: 'member',
      email: nextSession.user.email || '',
    }
    await loadGallery({ reset: true })
  } catch (err) {
    if (!(await maybeReauth(err))) galleryError.value = normalizeUploadError(err)
  } finally {
    authLoading.value = false
  }
}

function addSelectedFiles(files) {
  const next = Array.from(files || []).map((file, idx) => {
    const mimeType = normalizedMime(file)
    let error = ''
    let status = 'queued'

    if (!mimeType) {
      status = 'failed'
      error = 'Unsupported file type. Use JPEG, PNG, WEBP, HEIC, HEIF, MP4, or MOV.'
    } else if (mimeType.startsWith('image/') && Number(file.size) > IMAGE_MAX_BYTES) {
      status = 'failed'
      error = 'Image exceeds 25 MB limit.'
    } else if (mimeType.startsWith('video/') && Number(file.size) > VIDEO_MAX_BYTES) {
      status = 'failed'
      error = 'Video exceeds 250 MB limit.'
    }

    return {
      id: `${file.name}-${file.size}-${Date.now()}-${idx}`,
      file,
      status,
      progress: 0,
      error,
    }
  })

  queueItems.value = [...queueItems.value, ...next]
  for (const row of next) {
    void persistQueueItem(row)
  }
  uploadError.value = ''
}

function retryUpload(id) {
  queueItems.value = queueItems.value.map((item) => {
    if (item.id !== id) return item
    const next = {
      ...item,
      status: 'queued',
      progress: 0,
      error: '',
    }
    void persistQueueItem(next)
    return next
  })
}

function removeQueueItem(id) {
  queueItems.value = queueItems.value.filter((item) => item.id !== id)
  void removeQueueItemFromStorage(id)
}

async function startUpload() {
  if (uploadBusy.value || !canLoadApp.value) return

  const candidates = queueItems.value.filter((item) => item.status === 'queued')
  if (!candidates.length) return

  uploadBusy.value = true
  uploadError.value = ''

  for (const row of candidates) {
    if (!isOnline.value) {
      row.status = 'queued'
      row.error = 'Waiting for internet connection.'
      row.progress = 0
      await persistQueueItem(row)
      break
    }

    const file = row.file
    const mimeType = normalizedMime(file)

    if (!mimeType) {
      row.status = 'failed'
      row.error = 'Unsupported file type. Use JPEG, PNG, WEBP, HEIC, HEIF, MP4, or MOV.'
      await persistQueueItem(row)
      continue
    }

    try {
      row.status = 'requesting-ticket'
      row.progress = 10
      row.error = ''
      await persistQueueItem(row)

      const ticket = await withRetries(() => withSessionRetry(() => createUploadTicket({
        filename: file.name,
        mimeType,
        bytes: file.size,
      })))

      row.status = 'uploading'
      row.progress = 35
      await persistQueueItem(row)
      await withRetries(() => uploadWithSignedTicket(ticket, file))

      row.status = 'processing'
      row.progress = 80
      await persistQueueItem(row)
      await withRetries(() => withSessionRetry(() => completeUpload(ticket.mediaId)))

      row.status = 'published'
      row.progress = 100
      row.error = ''
      await removeQueueItemFromStorage(row.id)
      queueItems.value = queueItems.value.filter((item) => item.id !== row.id)
    } catch (err) {
      row.status = isOnline.value ? 'failed' : 'queued'
      row.progress = 0
      if (await maybeReauth(err)) {
        row.error = 'Session expired. Please refresh this page.'
        await persistQueueItem(row)
        break
      }
      row.error = isOnline.value ? normalizeUploadError(err) : 'Waiting for internet connection.'
      await persistQueueItem(row)
    }
  }

  uploadBusy.value = false
}

async function deleteMediaItem(item) {
  if (!item || !canRemove(item)) return

  const confirmed = window.confirm('Remove this media for everyone? This cannot be undone.')
  if (!confirmed) return

  setDeleting(item.id, true)
  galleryError.value = ''

  try {
    await withSessionRetry(() => removeMedia(item.id))
    await loadGallery({ reset: true })
  } catch (err) {
    if (!(await maybeReauth(err))) {
      galleryError.value = normalizeUploadError(err)
    }
  } finally {
    setDeleting(item.id, false)
  }
}

onMounted(async () => {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibilityChange)
  await restoreUploadQueue()

  if (!hasSupabaseConfig || !supabase) {
    authLoading.value = false
    return
  }

  if (bypassAuth) {
    session.value = { user: { id: '00000000-0000-0000-0000-000000000000', email: 'group@friends-weekend.local' } }
    profile.value = { role: 'admin', email: 'group@friends-weekend.local' }
    authLoading.value = false
    await loadGallery({ reset: true })
    startLiveSync()
    if (isOnline.value && queueItems.value.some((item) => item.status === 'queued')) {
      void startUpload()
    }
    return
  }

  const currentSession = await getCurrentSessionSnapshot()
  await hydrateSession(currentSession)
  startAuthHeartbeat()
  void keepSessionWarm()
  if (isSignedIn.value) startLiveSync()
  else stopLiveSync()
  if (isOnline.value && isSignedIn.value && queueItems.value.some((item) => item.status === 'queued')) {
    void startUpload()
  }

  const subscription = supabase.auth.onAuthStateChange(async (event, nextSession) => {
    if (!nextSession?.user) {
      stopLiveSync()
      await hydrateSession(nextSession)
      return
    }

    // Keep session in sync without reloading the gallery on every token refresh.
    session.value = nextSession

    if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
      await hydrateSession(nextSession)
      if (isSignedIn.value) startLiveSync()
      else stopLiveSync()
    }
  })

  authSubscription = subscription.data.subscription
})

onUnmounted(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopLiveSync()
  stopAuthHeartbeat()
  if (authSubscription) {
    authSubscription.unsubscribe()
    authSubscription = null
  }
})
</script>

<template>
  <div class="photos-page">
    <HeroHeader show-back />

    <main class="photos-content page-main">
      <section v-if="!hasSupabaseConfig" class="panel warning-panel">
        <h2>Supabase not configured</h2>
        <p>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before using the gallery.</p>
      </section>

      <section v-else-if="authLoading" class="panel centered">
        <p>Loading shared gallery…</p>
      </section>

      <section v-else-if="!isSignedIn" class="panel centered">
        <h2>Checking session…</h2>
        <p>Waiting for global authentication.</p>
      </section>

      <template v-else-if="isSignedIn">
        <section class="panel gallery-panel">
          <header class="gallery-header">
            <div>
              <h2>Shared media</h2>
            </div>
          </header>

          <ErrorState v-if="galleryError && !galleryItems.length" :message="galleryError"
            @retry="loadGallery({ reset: true })" />

          <LoadingState v-else-if="galleryLoading && !galleryItems.length" />

          <EmptyState v-else-if="!galleryItems.length" @upload-click="uploadPanelOpen = true" />

          <template v-else>
            <p v-if="galleryError" class="error-text">{{ galleryError }}</p>

            <div class="gallery-controls">
              <div class="mobile-feed-toggle" role="tablist" aria-label="Mobile feed layout">
                <button
                  class="toggle-btn"
                  :class="{ active: mobileFeedMode === 'grid' }"
                  type="button"
                  role="tab"
                  :aria-selected="mobileFeedMode === 'grid'"
                  @click="mobileFeedMode = 'grid'"
                >
                  Grid
                </button>
                <button
                  class="toggle-btn"
                  :class="{ active: mobileFeedMode === 'list' }"
                  type="button"
                  role="tab"
                  :aria-selected="mobileFeedMode === 'list'"
                  @click="mobileFeedMode = 'list'"
                >
                  List
                </button>
              </div>
            </div>

            <div class="gallery-feed" :class="`mobile-${mobileFeedMode}`">
              <button class="upload-card" type="button" @click="uploadPanelOpen = true">
                <span class="upload-card-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" focusable="false">
                    <path d="M12 4l5 5h-3v6h-4V9H7l5-5zm-7 13h14v3H5v-3z" fill="currentColor" />
                  </svg>
                </span>
                <strong>Upload media</strong>
                <small>Share photos and videos</small>
              </button>

              <MediaCard v-for="item in galleryItems" :key="item.id" :item="item"
                :overlay="isMobileViewport && mobileFeedMode === 'list'"
                :compact="isMobileViewport && mobileFeedMode === 'grid'" :deleting="Boolean(deletingById[item.id])"
                :can-remove="canRemove(item)" @remove="deleteMediaItem" @preview-error="handlePreviewLoadError"
                @preview-loaded="clearPreviewRetry" />
            </div>

            <button v-if="hasMore" class="btn soft load-more" type="button" :disabled="galleryLoading" @click="loadGallery()">
              {{ galleryLoading ? 'Loading…' : 'Load more' }}
            </button>
          </template>
        </section>
      </template>
    </main>

    <UploadPanel :open="uploadPanelOpen" :queue-items="queueItems" :selected-count="selectedCount"
      :upload-busy="uploadBusy" :upload-error="uploadError" :capture-window-label="captureWindowLabel"
      @close="uploadPanelOpen = false" @files-selected="addSelectedFiles" @upload="startUpload" @retry="retryUpload"
      @remove="removeQueueItem" />
  </div>
</template>

<style scoped>
.photos-page {
  min-height: 100vh;
  color: var(--warm-text-dark);
  font-family: var(--font-sans);
}

.photos-content {
  padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  display: grid;
  gap: 14px;
  touch-action: pan-y;
}

.panel {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(92, 138, 150, 0.3);
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 6px 18px rgba(28, 47, 54, 0.08);
}

.warning-panel {
  border-color: rgba(196, 160, 40, 0.55);
  background: #fff9ed;
}

.centered {
  text-align: center;
}

.gallery-panel {
  display: grid;
  gap: 12px;
}

.gallery-header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 10px;
}

.gallery-controls {
  display: flex;
  justify-content: flex-end;
}

.mobile-feed-toggle {
  display: none;
}

.gallery-feed {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.upload-card {
  border: 1px dashed rgba(92, 138, 150, 0.55);
  border-radius: 12px;
  background: #f4f8fa;
  min-height: 220px;
  padding: 12px;
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  color: var(--forest);
  cursor: pointer;
}

.upload-card strong {
  font-size: 0.92rem;
}

.upload-card small {
  font-size: 0.78rem;
  color: var(--warm-brown-muted);
}

.upload-card-icon {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  margin: 0 auto;
  background: rgba(92, 138, 150, 0.16);
}


h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  font-size: 1.35rem;
}

h2 {
  font-size: 1.1rem;
}

.muted {
  color: var(--warm-brown-muted);
  font-size: 0.84rem;
  line-height: 1.45;
}

.error-text {
  color: var(--red-error);
  font-size: 0.84rem;
  line-height: 1.35;
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

.btn.soft {
  border-color: rgba(92, 138, 150, 0.35);
  background: #f4f8fa;
  color: var(--forest);
}

.load-more {
  justify-self: center;
}

@media (min-width: 700px) {
  .gallery-feed {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 980px) {
  .gallery-feed {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 699px) {
  .photos-content {
    gap: 10px;
  }

  .panel {
    padding: 12px;
    border-radius: 12px;
  }

  .gallery-controls {
    justify-content: flex-start;
  }

  .mobile-feed-toggle {
    display: inline-flex;
    border: 1px solid rgba(92, 138, 150, 0.35);
    border-radius: 999px;
    background: #f4f8fa;
    padding: 3px;
    gap: 3px;
  }

  .toggle-btn {
    border: 0;
    min-height: 34px;
    padding: 0 14px;
    border-radius: 999px;
    background: transparent;
    color: var(--forest);
    font-size: 0.8rem;
    font-weight: 650;
    cursor: pointer;
  }

  .toggle-btn.active {
    background: var(--forest);
    color: #fff;
  }

  .gallery-feed {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .gallery-feed.mobile-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .gallery-feed.mobile-grid .upload-card {
    min-height: 0;
    aspect-ratio: 1 / 1;
    padding: 8px;
    gap: 4px;
  }

  .gallery-feed.mobile-grid .upload-card strong {
    font-size: 0.78rem;
  }

  .gallery-feed.mobile-grid .upload-card small {
    display: none;
  }

  .gallery-feed.mobile-grid .upload-card-icon {
    width: 30px;
    height: 30px;
  }

  .gallery-feed.mobile-list {
    grid-template-columns: 1fr;
  }

  .upload-card {
    min-height: 188px;
  }
}
</style>
