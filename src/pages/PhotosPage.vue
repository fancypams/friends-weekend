<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import MediaCard from '../components/gallery/MediaCard.vue'
import UploadPanel from '../components/gallery/UploadPanel.vue'
import FullScreenViewer from '../components/gallery/FullScreenViewer.vue'
import EmptyState from '../components/gallery/EmptyState.vue'
import LoadingState from '../components/gallery/LoadingState.vue'
import ErrorState from '../components/gallery/ErrorState.vue'
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

const session = ref(null)
const profile = ref(null)
const authLoading = ref(true)
const authError = ref('')

const galleryItems = ref([])
const galleryCursor = ref(null)
const galleryLoading = ref(false)
const galleryError = ref('')

const queueItems = ref([])
const uploadPanelOpen = ref(false)
const uploadBusy = ref(false)
const uploadError = ref('')
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

const viewerOpen = ref(false)
const viewerIndex = ref(0)
const viewerUrl = ref('')
const viewerLoading = ref(false)
const viewerError = ref('')
const carouselIndex = ref(0)

const downloadingById = ref({})
const deletingById = ref({})
let carouselTimer = null

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
const INITIAL_PREVIEW_COUNT = 6
const LOAD_MORE_PREVIEW_COUNT = 2
const INITIAL_PAGE_SIZE = 12
const LOAD_MORE_PAGE_SIZE = 24
const IMAGE_MAX_BYTES = 25 * 1024 * 1024
const VIDEO_MAX_BYTES = 250 * 1024 * 1024
const UPLOAD_RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 700
const UPLOAD_DB_NAME = 'friends-weekend-upload-queue'
const UPLOAD_DB_STORE = 'queue_items'

const isSignedIn = computed(() => bypassAuth || Boolean(session.value?.user))
const isInvited = computed(() => bypassAuth || Boolean(profile.value?.active))
const isAdmin = computed(() => bypassAuth || profile.value?.role === 'admin')
const userId = computed(() => session.value?.user?.id ?? null)
const userEmail = computed(() => profile.value?.email ?? session.value?.user?.email ?? 'friend@local')
const captureWindowLabel = computed(() => (
  'Capture window is Jul 31-Aug 4, 2026 (Seattle time).'
))

const canLoadApp = computed(() => hasSupabaseConfig && (bypassAuth || (isSignedIn.value && isInvited.value)))
const hasMore = computed(() => Boolean(galleryCursor.value))
const activeItem = computed(() => galleryItems.value[viewerIndex.value] ?? null)
const featuredItem = computed(() => galleryItems.value[carouselIndex.value] ?? null)
const hasCarouselNav = computed(() => galleryItems.value.length > 1)
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

async function withSessionRetry(task) {
  try {
    return await task()
  } catch (err) {
    if (bypassAuth || !supabase || !looksLikeAuthError(err)) {
      throw err
    }

    const refreshed = await supabase.auth.refreshSession().catch(() => null)
    const nextSession = refreshed?.data?.session ?? null
    if (!nextSession?.user) throw err

    session.value = nextSession
    return task()
  }
}

async function maybeReauth(err) {
  if (bypassAuth || !looksLikeAuthError(err)) return false
  authError.value = 'Session expired. Please refresh this page.'
  return true
}

async function signOut() {
  stopLiveSync()
  await globalSignOut().catch(() => {})
  session.value = null
  profile.value = null
  authError.value = 'Signed out.'
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

function canRemove(item) {
  if (!item) return false
  return isAdmin.value || item.owner_id === userId.value
}

function formatUploader(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!value) return 'Friend'
  return value.split('@')[0].replace(/[._-]+/g, ' ')
}

function prettyDate(iso) {
  if (!iso) return 'Unknown date'
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
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
    carouselIndex.value = (carouselIndex.value + 1) % galleryItems.value.length
  }, 4000)
}

function setCarouselIndex(index, { pause = false } = {}) {
  const max = galleryItems.value.length - 1
  if (max < 0) {
    carouselIndex.value = 0
    return
  }
  carouselIndex.value = Math.max(0, Math.min(max, index))
  if (pause) {
    stopCarouselTimer()
  } else {
    startCarouselTimer()
  }
}

function showCarouselNext() {
  if (!galleryItems.value.length) return
  setCarouselIndex((carouselIndex.value + 1) % galleryItems.value.length, { pause: true })
}

function showCarouselPrev() {
  if (!galleryItems.value.length) return
  setCarouselIndex((carouselIndex.value - 1 + galleryItems.value.length) % galleryItems.value.length, { pause: true })
}

function focusCarouselByItem(item) {
  const index = galleryItems.value.findIndex((row) => row.id === item?.id)
  if (index < 0) return
  setCarouselIndex(index, { pause: true })
}

function preserveSelections(mutator) {
  const activeViewerId = activeItem.value?.id || null
  const activeCarouselId = featuredItem.value?.id || null
  mutator()

  if (!galleryItems.value.length) {
    viewerIndex.value = 0
    carouselIndex.value = 0
    return
  }

  if (activeViewerId) {
    const nextViewerIndex = galleryItems.value.findIndex((row) => row.id === activeViewerId)
    viewerIndex.value = nextViewerIndex >= 0 ? nextViewerIndex : 0
  } else if (viewerIndex.value > galleryItems.value.length - 1) {
    viewerIndex.value = galleryItems.value.length - 1
  }

  if (activeCarouselId) {
    const nextCarouselIndex = galleryItems.value.findIndex((row) => row.id === activeCarouselId)
    carouselIndex.value = nextCarouselIndex >= 0 ? nextCarouselIndex : 0
  } else if (carouselIndex.value > galleryItems.value.length - 1) {
    carouselIndex.value = galleryItems.value.length - 1
  }
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

  preserveSelections(() => {
    galleryItems.value = [nextItem, ...galleryItems.value]
  })
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

function setDownloading(mediaId, value) {
  downloadingById.value = {
    ...downloadingById.value,
    [mediaId]: value,
  }
}

function setDeleting(mediaId, value) {
  deletingById.value = {
    ...deletingById.value,
    [mediaId]: value,
  }
}

function triggerDownload(url, filename) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || 'media'
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
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

    if (!galleryItems.value.length) {
      viewerIndex.value = 0
      carouselIndex.value = 0
    } else if (viewerIndex.value > galleryItems.value.length - 1) {
      viewerIndex.value = galleryItems.value.length - 1
    }

    if (carouselIndex.value > galleryItems.value.length - 1) {
      carouselIndex.value = galleryItems.value.length - 1
    }

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
    if (!nextProfile) throw new Error('Could not load profile')

    profile.value = nextProfile
    if (!nextProfile.active) {
      authError.value = 'Your account is not currently invited to this shared gallery.'
      return
    }

    await loadGallery({ reset: true })
  } catch (err) {
    if (!(await maybeReauth(err))) {
      authError.value = normalizeUploadError(err)
    }
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

async function downloadMedia(item) {
  if (!item) return

  const mediaId = item.id
  setDownloading(mediaId, true)
  galleryError.value = ''

  try {
    const signed = await withSessionRetry(() => signMediaUrl(mediaId, 'original'))
    triggerDownload(signed.signedUrl, item.original_filename)
  } catch (err) {
    if (!(await maybeReauth(err))) {
      galleryError.value = normalizeUploadError(err)
    }
  } finally {
    setDownloading(mediaId, false)
  }
}

async function deleteMediaItem(item) {
  if (!item || !canRemove(item)) return

  const confirmed = window.confirm('Remove this media for everyone? This cannot be undone.')
  if (!confirmed) return

  setDeleting(item.id, true)
  galleryError.value = ''

  try {
    await withSessionRetry(() => removeMedia(item.id))

    if (viewerOpen.value && activeItem.value?.id === item.id) {
      viewerOpen.value = false
      viewerUrl.value = ''
    }

    await loadGallery({ reset: true })
  } catch (err) {
    if (!(await maybeReauth(err))) {
      galleryError.value = normalizeUploadError(err)
    }
  } finally {
    setDeleting(item.id, false)
  }
}

async function hydrateViewerUrl() {
  if (!viewerOpen.value || !activeItem.value) return

  viewerLoading.value = true
  viewerError.value = ''

  try {
    const signed = await withSessionRetry(() => signMediaUrl(activeItem.value.id, 'processed'))
    viewerUrl.value = signed.signedUrl || ''
  } catch (err) {
    viewerUrl.value = ''
    if (!(await maybeReauth(err))) {
      viewerError.value = normalizeUploadError(err)
    }
  } finally {
    viewerLoading.value = false
  }
}

async function openViewerByIndex(index) {
  viewerIndex.value = index
  viewerOpen.value = true
  await hydrateViewerUrl()
}

async function openViewerByItem(item) {
  const index = galleryItems.value.findIndex((row) => row.id === item.id)
  if (index < 0) return
  await openViewerByIndex(index)
}

function closeViewer() {
  viewerOpen.value = false
  viewerUrl.value = ''
  viewerError.value = ''
}

async function showNext() {
  if (!galleryItems.value.length) return
  viewerIndex.value = (viewerIndex.value + 1) % galleryItems.value.length
  await hydrateViewerUrl()
}

async function showPrev() {
  if (!galleryItems.value.length) return
  viewerIndex.value = (viewerIndex.value - 1 + galleryItems.value.length) % galleryItems.value.length
  await hydrateViewerUrl()
}

onMounted(async () => {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  await restoreUploadQueue()

  if (!hasSupabaseConfig || !supabase) {
    authLoading.value = false
    return
  }

  if (bypassAuth) {
    session.value = { user: { id: '00000000-0000-0000-0000-000000000000', email: 'group@friends-weekend.local' } }
    profile.value = { active: true, role: 'admin', email: 'group@friends-weekend.local' }
    authLoading.value = false
    await loadGallery({ reset: true })
    startLiveSync()
    if (isOnline.value && queueItems.value.some((item) => item.status === 'queued')) {
      void startUpload()
    }
    return
  }

  const { data } = await supabase.auth.getSession()
  await hydrateSession(data.session)
  if (isInvited.value) startLiveSync()
  else stopLiveSync()
  if (isOnline.value && isInvited.value && queueItems.value.some((item) => item.status === 'queued')) {
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

    if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
      await hydrateSession(nextSession)
      if (isInvited.value) startLiveSync()
      else stopLiveSync()
    }
  })

  authSubscription = subscription.data.subscription
})

onUnmounted(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  stopCarouselTimer()
  stopLiveSync()
  if (authSubscription) {
    authSubscription.unsubscribe()
    authSubscription = null
  }
})

watch(
  () => galleryItems.value.length,
  (length) => {
    if (!length) {
      carouselIndex.value = 0
      stopCarouselTimer()
      return
    }

    if (carouselIndex.value >= length) {
      carouselIndex.value = 0
    }

    startCarouselTimer()
  },
)
</script>

<template>
  <div class="photos-page">
    <HeroHeader show-back />

    <main class="photos-content">
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

      <section v-else-if="!isInvited" class="panel warning-panel">
        <h2>Invite required</h2>
        <p>{{ authError || 'Your account is not currently approved for this gallery.' }}</p>
        <button class="btn soft" type="button" @click="signOut">Sign out</button>
      </section>

      <template v-else>
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

            <article v-if="featuredItem" class="carousel-frame">
              <button class="carousel-media-btn" type="button" @click="openViewerByIndex(carouselIndex)">
                <img
v-if="featuredItem.media_type === 'image' && featuredItem.preview_url" class="carousel-media"
                  :src="featuredItem.preview_url" :alt="featuredItem.original_filename" />
                <video
v-else-if="featuredItem.media_type === 'video' && featuredItem.preview_url"
                  class="carousel-media" :src="featuredItem.preview_url" muted playsinline preload="metadata"></video>
                <span v-else class="carousel-empty">Preview unavailable</span>
              </button>

              <div class="carousel-overlay">
                <p>{{ formatUploader(featuredItem.owner_email) }} · {{ prettyDate(featuredItem.published_at) }}</p>
              </div>

              <button
v-if="hasCarouselNav" class="carousel-nav left"
                type="button"
aria-label="Show previous item"
                @click="showCarouselPrev"
              >
                ‹
              </button>
              <button v-if="hasCarouselNav" class="carousel-nav right" type="button" aria-label="Show next item"
                @click="showCarouselNext">
                ›
              </button>
            </article>

            <div class="gallery-grid">
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
                :downloading="Boolean(downloadingById[item.id])" :deleting="Boolean(deletingById[item.id])"
                :can-remove="canRemove(item)" @view="focusCarouselByItem" @download="downloadMedia"
                @remove="deleteMediaItem" />
            </div>

            <button v-if="hasMore" class="btn soft load-more" type="button" :disabled="galleryLoading"
              @click="loadGallery()">
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

    <FullScreenViewer :open="viewerOpen" :item="activeItem" :index="viewerIndex" :total="galleryItems.length"
      :media-url="viewerUrl" :loading="viewerLoading" :error="viewerError" :can-delete="canRemove(activeItem)"
      :downloading="Boolean(activeItem && downloadingById[activeItem.id])"
      :deleting="Boolean(activeItem && deletingById[activeItem.id])" @close="closeViewer" @next="showNext"
      @prev="showPrev" @download="downloadMedia" @delete="deleteMediaItem" />
  </div>
</template>

<style scoped>
.photos-page {
  min-height: 100vh;
  color: var(--warm-text-dark);
  font-family: var(--font-sans);
}

.photos-content {
  max-width: 1080px;
  margin: 0 auto;
  padding: 72px 16px calc(88px + env(safe-area-inset-bottom, 0px));
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

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.upload-card {
  border: 1px dashed rgba(92, 138, 150, 0.55);
  border-radius: 12px;
  background: #f4f8fa;
  min-height: 248px;
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

.carousel-frame {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(130deg, #2b4b55, #37535f);
  border: 1px solid rgba(92, 138, 150, 0.28);
  box-shadow: 0 10px 24px rgba(28, 47, 54, 0.16);
}

.carousel-media-btn {
  border: 0;
  padding: 0;
  width: 100%;
  background: transparent;
  cursor: pointer;
  touch-action: pan-y;
}

.carousel-media {
  width: 100%;
  height: 320px;
  display: block;
  object-fit: cover;
}

.carousel-empty {
  height: 320px;
  color: rgba(255, 255, 255, 0.95);
  display: grid;
  place-items: center;
}

.carousel-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 14px;
  background: linear-gradient(to top, rgba(11, 20, 24, 0.72), rgba(11, 20, 24, 0));
  color: #fff;
}

.carousel-overlay p {
  font-size: 0.78rem;
  opacity: 0.9;
}

.carousel-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #23383f;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

.carousel-nav.left {
  left: 10px;
}

.carousel-nav.right {
  right: 10px;
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
  .photos-content {
    padding-inline: 20px;
  }

  .carousel-media,
  .carousel-empty {
    height: 420px;
  }

  .gallery-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 980px) {
  .photos-content {
    padding-top: 86px;
  }

  .gallery-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
