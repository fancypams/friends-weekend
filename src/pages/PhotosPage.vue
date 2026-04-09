<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import HeroHeader from '../components/HeroHeader.vue'
import MediaCard from '../components/gallery/MediaCard.vue'
import EmptyState from '../components/gallery/EmptyState.vue'
import LoadingState from '../components/gallery/LoadingState.vue'
import ErrorState from '../components/gallery/ErrorState.vue'
import FullScreenViewer from '../components/gallery/FullScreenViewer.vue'
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
const uploadBusy = ref(false)
const uploadError = ref('')
const nativePickerRef = ref(null)
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const isMobileViewport = ref(typeof window !== 'undefined' ? window.innerWidth <= 699 : false)

const mobileFeedMode = ref('grid')

const deletingById = ref({})
const previewRetryById = ref({})
const viewerOpen = ref(false)
const viewerMediaId = ref('')
const viewerMediaUrl = ref('')
const viewerLoading = ref(false)
const viewerError = ref('')
const viewerItemSnapshot = ref(null)
const viewerVariant = ref('processed')
let viewerLoadToken = 0

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
let embargoSweepTimer = null
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
const SIGNED_URL_REFRESH_BUFFER_SECONDS = 45
const SIGNED_URL_CACHE_STORAGE_KEY = 'friends-weekend:signed-url-cache:v1'
const SIGNED_URL_CACHE_MAX_ENTRIES = 500
const UPLOAD_DB_NAME = 'friends-weekend-upload-queue'
const UPLOAD_DB_STORE = 'queue_items'
const CAPTURE_WINDOW_START_MS = Date.parse('2026-07-31T07:00:00.000Z') // Jul 31 00:00 Seattle (PDT)
const CAPTURE_WINDOW_END_MS = Date.parse('2026-08-05T06:59:59.999Z') // Aug 4 23:59:59 Seattle (PDT)
const CAPTURE_WINDOW_LABEL = 'Jul 31-Aug 4, 2026 (Seattle time)'
const PT_UTC_OFFSET_HOURS = 7 // Event is in summer (PDT, UTC-7)
const PT_OFFSET_MS = PT_UTC_OFFSET_HOURS * 60 * 60 * 1000
const DAILY_REVEAL_HOUR_PT = 21 // 9:00 PM PT
const REVEAL_OPEN_WINDOW_END_HOUR_PT = 3 // 3:00 AM PT (exclusive)

const isSignedIn = computed(() => bypassAuth || Boolean(session.value?.user))
const isAdmin = computed(() => bypassAuth || profile.value?.role === 'admin')
const userId = computed(() => session.value?.user?.id ?? null)

const canLoadApp = computed(() => hasSupabaseConfig && isSignedIn.value)
const hasMore = computed(() => Boolean(galleryCursor.value))
const queuedUploadCount = computed(() => queueItems.value.filter((item) => item.status === 'queued').length)
const activeUploadCount = computed(() => (
  queueItems.value.filter((item) => ['requesting-ticket', 'uploading', 'processing'].includes(item.status)).length
))
const failedUploadCount = computed(() => queueItems.value.filter((item) => item.status === 'failed').length)
const failedUploadItems = computed(() => queueItems.value.filter((item) => item.status === 'failed'))
const pendingUploadCount = computed(() => queuedUploadCount.value + activeUploadCount.value)
const uploadStatusMessage = computed(() => {
  if (pendingUploadCount.value > 0) return `Uploading ${pendingUploadCount.value} file(s)…`
  if (failedUploadCount.value > 0) return `${failedUploadCount.value} file(s) failed to upload.`
  if (uploadError.value) return uploadError.value
  return ''
})
const showUploadStatus = computed(() => Boolean(uploadStatusMessage.value))
const uploadFailureDetails = computed(() => {
  const seen = new Set()
  const details = []
  for (const item of failedUploadItems.value) {
    const name = String(item.file?.name || 'File')
    const reason = String(item.error || 'Upload failed.')
    const key = `${name.toLowerCase()}::${reason.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    details.push({ id: item.id, name, reason })
    if (details.length >= 3) break
  }
  return details
})
const viewerIndex = computed(() => galleryItems.value.findIndex((item) => item.id === viewerMediaId.value))
const viewerItem = computed(() => {
  const idx = viewerIndex.value
  if (idx >= 0) return galleryItems.value[idx] || null
  if (viewerItemSnapshot.value?.id) return viewerItemSnapshot.value
  return null
})
const viewerTotal = computed(() => galleryItems.value.length)
const signedUrlCache = new Map()
const inFlightSignedUrlByKey = new Map()
let signedUrlCachePersistTimer = null

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
    .filter((item) => item.status === 'queued')
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

function revealAtIsoFromUploadIso(uploadIso) {
  const uploaded = new Date(String(uploadIso || ''))
  if (Number.isNaN(uploaded.getTime())) return null

  const uploadedMs = uploaded.getTime()
  const ptShifted = new Date(uploadedMs - PT_OFFSET_MS)
  const year = ptShifted.getUTCFullYear()
  const month = ptShifted.getUTCMonth()
  const day = ptShifted.getUTCDate()
  const hourPt = ptShifted.getUTCHours()

  if (hourPt >= DAILY_REVEAL_HOUR_PT || hourPt < REVEAL_OPEN_WINDOW_END_HOUR_PT) {
    return uploaded.toISOString()
  }

  let revealUtcMs = Date.UTC(year, month, day, DAILY_REVEAL_HOUR_PT + PT_UTC_OFFSET_HOURS, 0, 0, 0)

  return new Date(revealUtcMs).toISOString()
}

function isEmbargoedForViewer(item) {
  if (!item || item.owner_id === userId.value) return false
  const base = item.reveal_at || revealAtIsoFromUploadIso(item.published_at || item.created_at)
  const revealAt = String(base || '').trim()
  if (!revealAt) return false
  return Date.now() < new Date(revealAt).getTime()
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

async function refreshEmbargoedCards() {
  const items = galleryItems.value
  if (!items.length) return

  for (const item of items) {
    if (!item || item.owner_id === userId.value) continue

    const revealAt = item.reveal_at || revealAtIsoFromUploadIso(item.published_at || item.created_at)
    if (!revealAt) continue

    const revealMs = new Date(revealAt).getTime()
    if (!Number.isFinite(revealMs)) continue

    const locked = Date.now() < revealMs
    item.reveal_at = revealAt
    item.embargoed_for_viewer = locked

    if (locked) continue
    if (!item.owner_email) {
      const ownerEmail = await resolveOwnerEmail(item.owner_id)
      if (ownerEmail) item.owner_email = ownerEmail
    }
    if (!item.preview_url) {
      void signAndPatchPreview(item)
    }
  }
}

function startEmbargoSweep() {
  if (embargoSweepTimer || typeof window === 'undefined') return
  embargoSweepTimer = window.setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    void refreshEmbargoedCards()
  }, 30_000)
}

function stopEmbargoSweep() {
  if (!embargoSweepTimer || typeof window === 'undefined') return
  window.clearInterval(embargoSweepTimer)
  embargoSweepTimer = null
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

  const revealAt = revealAtIsoFromUploadIso(row.published_at || row.created_at)
  const embargoedForViewer = row.owner_id !== userId.value
    && Boolean(revealAt)
    && Date.now() < new Date(revealAt).getTime()
  const ownerEmail = embargoedForViewer ? '' : await resolveOwnerEmail(row.owner_id)
  const nextItem = {
    ...row,
    embargoed_for_viewer: embargoedForViewer,
    reveal_at: revealAt,
    owner_email: ownerEmail,
    preview_url: '',
  }

  galleryItems.value = [nextItem, ...galleryItems.value]
  if (!embargoedForViewer) {
    void signAndPatchPreview(nextItem)
  }
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

function signedUrlCacheKey(mediaId, variant) {
  return `${String(mediaId || '').trim()}::${String(variant || 'processed').trim()}`
}

function persistSignedUrlCacheSoon() {
  if (typeof window === 'undefined' || signedUrlCachePersistTimer) return
  signedUrlCachePersistTimer = window.setTimeout(() => {
    signedUrlCachePersistTimer = null
    try {
      const now = Math.floor(Date.now() / 1000)
      const entries = []
      for (const [key, value] of signedUrlCache.entries()) {
        const url = String(value?.url || '').trim()
        const expiresAt = Number(value?.expiresAt || 0)
        if (!url) continue
        if (expiresAt && expiresAt <= now + SIGNED_URL_REFRESH_BUFFER_SECONDS) continue
        entries.push([key, { url, expiresAt }])
      }

      if (entries.length > SIGNED_URL_CACHE_MAX_ENTRIES) {
        entries.sort((a, b) => Number(b[1].expiresAt || 0) - Number(a[1].expiresAt || 0))
      }
      const limited = entries.slice(0, SIGNED_URL_CACHE_MAX_ENTRIES)
      window.sessionStorage.setItem(SIGNED_URL_CACHE_STORAGE_KEY, JSON.stringify(limited))
    } catch {
      // Ignore storage quota / availability failures.
    }
  }, 120)
}

function hydrateSignedUrlCacheFromStorage() {
  if (typeof window === 'undefined') return
  try {
    const raw = window.sessionStorage.getItem(SIGNED_URL_CACHE_STORAGE_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return

    const now = Math.floor(Date.now() / 1000)
    for (const row of parsed) {
      const key = Array.isArray(row) ? String(row[0] || '').trim() : ''
      const value = Array.isArray(row) ? row[1] : null
      const url = String(value?.url || '').trim()
      const expiresAt = Number(value?.expiresAt || 0)

      if (!key || !url) continue
      if (expiresAt && expiresAt <= now + SIGNED_URL_REFRESH_BUFFER_SECONDS) continue

      signedUrlCache.set(key, { url, expiresAt })
    }
  } catch {
    // Ignore invalid or unavailable storage state.
  }
}

function clearSignedUrlCache(mediaId) {
  if (!mediaId) return
  const base = `${String(mediaId).trim()}::`
  let changed = false
  for (const key of signedUrlCache.keys()) {
    if (key.startsWith(base)) {
      signedUrlCache.delete(key)
      changed = true
    }
  }
  if (changed) persistSignedUrlCacheSoon()
}

function isSignedUrlExpiring(url, refreshBufferSeconds = SIGNED_URL_REFRESH_BUFFER_SECONDS) {
  const expiresAt = extractSignedTokenExpiry(url)
  if (!expiresAt) return true
  const now = Math.floor(Date.now() / 1000)
  return expiresAt <= now + refreshBufferSeconds
}

function getCachedSignedUrl(mediaId, variant) {
  const key = signedUrlCacheKey(mediaId, variant)
  const cached = signedUrlCache.get(key)
  if (!cached?.url) return ''

  const expiresAt = Number(cached.expiresAt || 0)
  const now = Math.floor(Date.now() / 1000)
  const expiring = expiresAt
    ? expiresAt <= now + SIGNED_URL_REFRESH_BUFFER_SECONDS
    : isSignedUrlExpiring(cached.url)

  if (expiring) {
    signedUrlCache.delete(key)
    persistSignedUrlCacheSoon()
    return ''
  }

  return cached.url
}

function setCachedSignedUrl(mediaId, variant, signedPayload) {
  const key = signedUrlCacheKey(mediaId, variant)
  const url = String(signedPayload?.signedUrl || '').trim()
  if (!url) return ''

  const tokenExpiry = extractSignedTokenExpiry(url)
  const expiresIn = Number(signedPayload?.expiresIn || 0)
  const now = Math.floor(Date.now() / 1000)
  const fallbackExpiry = expiresIn > 0 ? now + expiresIn : 0

  signedUrlCache.set(key, {
    url,
    expiresAt: tokenExpiry || fallbackExpiry || 0,
  })
  persistSignedUrlCacheSoon()

  return url
}

async function getSignedUrlCached(mediaId, variant, { force = false } = {}) {
  if (!mediaId) return ''
  const key = signedUrlCacheKey(mediaId, variant)

  if (force) signedUrlCache.delete(key)
  if (force) persistSignedUrlCacheSoon()

  const cachedUrl = getCachedSignedUrl(mediaId, variant)
  if (cachedUrl) return cachedUrl

  const existingRequest = inFlightSignedUrlByKey.get(key)
  if (existingRequest) return existingRequest

  const request = withSessionRetry(() => signMediaUrl(mediaId, variant))
    .then((signed) => setCachedSignedUrl(mediaId, variant, signed))
    .finally(() => {
      inFlightSignedUrlByKey.delete(key)
    })

  inFlightSignedUrlByKey.set(key, request)
  return request
}

function closeViewer() {
  viewerOpen.value = false
  viewerMediaId.value = ''
  viewerItemSnapshot.value = null
  viewerMediaUrl.value = ''
  viewerError.value = ''
  viewerLoading.value = false
  viewerVariant.value = 'processed'
  viewerLoadToken += 1
}

function openViewer(item) {
  if (!item?.id) return
  if (isEmbargoedForViewer(item)) return
  viewerItemSnapshot.value = item
  viewerOpen.value = true
  viewerMediaId.value = item.id
}

function setViewerByIndex(nextIndex) {
  const total = galleryItems.value.length
  if (!total) return

  const normalized = (nextIndex + total) % total
  const next = galleryItems.value[normalized]
  if (!next?.id) return
  viewerItemSnapshot.value = next
  viewerMediaId.value = next.id
}

function showNextViewerItem() {
  if (viewerTotal.value < 2 || viewerIndex.value < 0) return
  setViewerByIndex(viewerIndex.value + 1)
}

function showPrevViewerItem() {
  if (viewerTotal.value < 2 || viewerIndex.value < 0) return
  setViewerByIndex(viewerIndex.value - 1)
}

function prefetchViewerNeighbors() {
  if (!viewerOpen.value || viewerTotal.value < 2 || viewerIndex.value < 0) return

  const prevIndex = (viewerIndex.value - 1 + viewerTotal.value) % viewerTotal.value
  const nextIndex = (viewerIndex.value + 1) % viewerTotal.value
  const neighbors = [galleryItems.value[prevIndex], galleryItems.value[nextIndex]]

  for (const neighbor of neighbors) {
    if (!neighbor?.id) continue
    void getSignedUrlCached(neighbor.id, 'processed').catch(() => { })
  }
}

async function loadViewerMedia(item, { force = false, variantOverride = '' } = {}) {
  if (!item?.id || !viewerOpen.value) return

  const loadToken = ++viewerLoadToken
  viewerLoading.value = true
  viewerError.value = ''
  viewerMediaUrl.value = ''

  try {
    const variant = variantOverride || (item.media_type === 'image' ? 'original' : 'processed')
    viewerVariant.value = variant
    const url = await getSignedUrlCached(item.id, variant, { force })
    if (loadToken !== viewerLoadToken) return

    viewerMediaUrl.value = String(url || '').trim()
    if (!viewerMediaUrl.value) {
      viewerError.value = 'Unable to load media.'
    }

    prefetchViewerNeighbors()
  } catch (err) {
    if (loadToken !== viewerLoadToken) return
    viewerMediaUrl.value = ''
    if (!(await maybeReauth(err))) {
      viewerError.value = normalizeUploadError(err)
    } else {
      viewerError.value = 'Session expired. Please refresh this page.'
    }
  } finally {
    if (loadToken === viewerLoadToken) {
      viewerLoading.value = false
    }
  }
}

function handleViewerMediaError() {
  if (!viewerItem.value) return
  if (viewerItem.value.media_type === 'image' && viewerVariant.value === 'original') {
    void loadViewerMedia(viewerItem.value, { force: true, variantOverride: 'processed' })
    return
  }
  void loadViewerMedia(viewerItem.value, { force: true })
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
  return isSignedUrlExpiring(url, 30)
}

async function resolvePreviewUrl(item, { force = false } = {}) {
  if (isEmbargoedForViewer(item)) return ''
  const variant = item.media_type === 'image' ? 'thumb' : 'processed'
  try {
    return await getSignedUrlCached(item.id, variant, { force })
  } catch {
    return ''
  }
}

async function signAndPatchPreview(item, { force = false } = {}) {
  if (!item?.id) return
  const url = await resolvePreviewUrl(item, { force })
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

  await signAndPatchPreview(item, { force: true })
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
    void refreshEmbargoedCards()
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
  const existingSignatures = new Set(
    galleryItems.value
      .map((item) => `${String(item.original_filename || '').trim().toLowerCase()}::${Number(item.bytes || 0)}`)
      .filter((sig) => !sig.endsWith('::0')),
  )

  const queuedSignatures = new Set(
    queueItems.value
      .map((item) => `${String(item.file?.name || '').trim().toLowerCase()}::${Number(item.file?.size || 0)}`)
      .filter((sig) => !sig.endsWith('::0')),
  )

  const next = Array.from(files || []).map((file, idx) => {
    const mimeType = normalizedMime(file)
    const captureWindowError = captureWindowPrecheckError(file)
    let error = ''
    let status = 'queued'
    const signature = `${String(file?.name || '').trim().toLowerCase()}::${Number(file?.size || 0)}`

    if (!mimeType) {
      status = 'failed'
      error = 'Unsupported file type. Use JPEG, PNG, WEBP, HEIC, HEIF, MP4, or MOV.'
    } else if (mimeType.startsWith('image/') && Number(file.size) > IMAGE_MAX_BYTES) {
      status = 'failed'
      error = 'Image exceeds 25 MB limit.'
    } else if (mimeType.startsWith('video/') && Number(file.size) > VIDEO_MAX_BYTES) {
      status = 'failed'
      error = 'Video exceeds 250 MB limit.'
    } else if (captureWindowError) {
      status = 'failed'
      error = captureWindowError
    } else if (existingSignatures.has(signature) || queuedSignatures.has(signature)) {
      status = 'failed'
      error = duplicateUploadMessage(file)
    } else {
      queuedSignatures.add(signature)
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
    if (row.status === 'queued') {
      void persistQueueItem(row)
    } else {
      void removeQueueItemFromStorage(row.id)
    }
  }
  uploadError.value = ''

  if (canLoadApp.value) {
    void startUpload()
  }
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

function openNativeUploadPicker() {
  queueItems.value = queueItems.value.filter((item) => item.status !== 'failed')
  uploadError.value = ''
  const input = nativePickerRef.value
  if (!input) return
  input.value = ''
  input.click()
}

function handleNativePickerChange(event) {
  const files = Array.from(event.target?.files || [])
  if (!files.length) return
  queueItems.value = queueItems.value.filter((item) => item.status !== 'failed')
  uploadError.value = ''
  addSelectedFiles(files)
}

function fileSignatureFromNameAndSize(name, size) {
  return `${String(name || '').trim().toLowerCase()}::${Number(size || 0)}`
}

function gallerySignatureSet() {
  return new Set(
    galleryItems.value
      .map((item) => fileSignatureFromNameAndSize(item.original_filename, item.bytes))
      .filter((sig) => !sig.endsWith('::0')),
  )
}

function findExistingGalleryMediaByFile(file) {
  const signature = fileSignatureFromNameAndSize(file?.name, file?.size)
  return galleryItems.value.find((item) => (
    fileSignatureFromNameAndSize(item.original_filename, item.bytes) === signature
  )) || null
}

function duplicateUploadMessage(file) {
  const media = findExistingGalleryMediaByFile(file)
  if (!media) return 'This file already exists in the shared gallery.'

  const uploadRaw = media.published_at || media.created_at || ''
  const uploadDate = uploadRaw ? new Date(uploadRaw) : null
  const uploadLabel = uploadDate && !Number.isNaN(uploadDate.getTime())
    ? uploadDate.toLocaleString()
    : 'an earlier time'

  const myEmail = String(profile.value?.email || session.value?.user?.email || '').trim().toLowerCase()
  const ownerEmail = String(media.owner_email || '').trim().toLowerCase()
  const isCurrentUser = Boolean(
    (media.owner_id && userId.value && media.owner_id === userId.value)
    || (myEmail && ownerEmail && myEmail === ownerEmail)
  )

  if (isCurrentUser) {
    return `You uploaded this file on ${uploadLabel}.`
  }

  const uploaderName = ownerEmail ? ownerEmail.split('@')[0] : 'Another friend'
  return `${uploaderName} uploaded this file on ${uploadLabel}.`
}

function mediaTypeFromMime(mimeType) {
  return String(mimeType || '').startsWith('image/') ? 'image' : 'video'
}

function formatLocalDateTime(ts) {
  const date = new Date(Number(ts || 0))
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function captureWindowPrecheckError(file) {
  const timestamp = Number(file?.lastModified || 0)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  if (timestamp >= CAPTURE_WINDOW_START_MS && timestamp <= CAPTURE_WINDOW_END_MS) return ''

  const when = formatLocalDateTime(timestamp) || 'an out-of-range date'
  return `This file appears to be from ${when}, outside ${CAPTURE_WINDOW_LABEL}.`
}

function injectUploadedMedia({ mediaId, row, mimeType }) {
  if (!mediaId || galleryItems.value.some((item) => item.id === mediaId)) return

  const ownerId = userId.value || session.value?.user?.id || ''
  const ownerEmail = profile.value?.email || session.value?.user?.email || ''
  const nowIso = new Date().toISOString()

  const nextItem = {
    id: mediaId,
    owner_id: ownerId,
    owner_email: ownerEmail,
    media_type: mediaTypeFromMime(mimeType),
    mime_type: mimeType,
    original_filename: String(row?.file?.name || 'Upload'),
    bytes: Number(row?.file?.size || 0),
    status: 'published',
    captured_at: null,
    capture_source: null,
    processed_path: null,
    thumbnail_path: null,
    poster_path: null,
    created_at: nowIso,
    published_at: nowIso,
    embargoed_for_viewer: false,
    reveal_at: revealAtIsoFromUploadIso(nowIso),
    preview_url: '',
  }

  galleryItems.value = [nextItem, ...galleryItems.value]
  void signAndPatchPreview(nextItem)
}

function retryFailedUploads() {
  const failedIds = queueItems.value
    .filter((item) => item.status === 'failed')
    .map((item) => item.id)

  if (!failedIds.length) return

  for (const id of failedIds) {
    retryUpload(id)
  }
  if (canLoadApp.value) {
    void startUpload()
  }
}

async function startUpload() {
  if (uploadBusy.value || !canLoadApp.value) return

  const candidates = queueItems.value.filter((item) => item.status === 'queued')
  if (!candidates.length) return

  uploadBusy.value = true
  uploadError.value = ''
  const existingGallerySignatures = gallerySignatureSet()
  const queuedSignaturesInRun = new Set()
  const skippedDuplicates = []

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
    const signature = fileSignatureFromNameAndSize(file?.name, file?.size)

    if (!mimeType) {
      row.status = 'failed'
      row.error = 'Unsupported file type. Use JPEG, PNG, WEBP, HEIC, HEIF, MP4, or MOV.'
      await removeQueueItemFromStorage(row.id)
      continue
    }

    const captureWindowError = captureWindowPrecheckError(file)
    if (captureWindowError) {
      row.status = 'failed'
      row.error = captureWindowError
      await removeQueueItemFromStorage(row.id)
      continue
    }

    if (existingGallerySignatures.has(signature) || queuedSignaturesInRun.has(signature)) {
      skippedDuplicates.push({
        name: String(file?.name || 'File'),
        message: duplicateUploadMessage(file),
      })
      await removeQueueItemFromStorage(row.id)
      queueItems.value = queueItems.value.filter((item) => item.id !== row.id)
      continue
    }
    queuedSignaturesInRun.add(signature)

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

      injectUploadedMedia({
        mediaId: ticket.mediaId,
        row,
        mimeType,
      })

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
        await removeQueueItemFromStorage(row.id)
        break
      }
      row.error = isOnline.value ? normalizeUploadError(err) : 'Waiting for internet connection.'
      if (row.status === 'queued') {
        await persistQueueItem(row)
      } else {
        await removeQueueItemFromStorage(row.id)
      }
    }
  }

  uploadBusy.value = false

  if (skippedDuplicates.length) {
    if (skippedDuplicates.length === 1) {
      uploadError.value = `${skippedDuplicates[0].name}: ${skippedDuplicates[0].message}`
    } else {
      const first = skippedDuplicates[0]
      uploadError.value = `${skippedDuplicates.length} duplicate file(s) were skipped. ${first.name}: ${first.message}`
    }
  }

  // Drain any new queued files added while this run was in-flight.
  const hasQueued = queueItems.value.some((item) => item.status === 'queued')
  if (hasQueued && canLoadApp.value && isOnline.value) {
    queueMicrotask(() => {
      void startUpload()
    })
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
    clearSignedUrlCache(item.id)
    if (viewerMediaId.value === item.id) {
      closeViewer()
    }
    galleryItems.value = galleryItems.value.filter((row) => row.id !== item.id)
    void loadGallery({ reset: true })
  } catch (err) {
    galleryError.value = normalizeUploadError(err)
  } finally {
    setDeleting(item.id, false)
  }
}

watch(
  () => [viewerOpen.value, viewerMediaId.value],
  async ([open, mediaId]) => {
    if (!open || !mediaId) return
    const item = viewerItem.value
    if (!item) {
      closeViewer()
      return
    }

    await loadViewerMedia(item)
  },
)

watch(
  () => viewerOpen.value,
  (open) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = open ? 'hidden' : ''
  },
)

onMounted(async () => {
  hydrateSignedUrlCacheFromStorage()
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibilityChange)
  startEmbargoSweep()
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
  stopEmbargoSweep()
  if (authSubscription) {
    authSubscription.unsubscribe()
    authSubscription = null
  }
  if (signedUrlCachePersistTimer && typeof window !== 'undefined') {
    window.clearTimeout(signedUrlCachePersistTimer)
    signedUrlCachePersistTimer = null
  }
  signedUrlCache.clear()
  inFlightSignedUrlByKey.clear()
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
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

      <section v-else-if="authLoading" class="panel gallery-panel">
        <header class="gallery-header">
          <div>
            <h2>Shared media</h2>
            <p class="gallery-intro">
              We’re collecting memories all day as the weekend unfolds. Share photos and videos anytime, and each
              night at 9:00 PM Pacific we reveal the day’s gallery together.
            </p>
          </div>
        </header>
        <p class="sr-only">Loading shared gallery…</p>
        <LoadingState :count="isMobileViewport ? 6 : 8" />
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
              <p class="gallery-intro">
                We’re collecting memories all day as the weekend unfolds. Share photos and videos anytime, and each
                night at 9:00 PM Pacific we reveal the day’s gallery together.
              </p>
            </div>
          </header>

          <div v-if="showUploadStatus" class="upload-status" role="status" aria-live="polite">
            <div class="upload-status-copy">
              <p>{{ uploadStatusMessage }}</p>
              <ul v-if="uploadFailureDetails.length" class="upload-fail-list">
                <li v-for="detail in uploadFailureDetails" :key="detail.id">
                  <strong>{{ detail.name }}:</strong> {{ detail.reason }}
                </li>
                <li v-if="failedUploadCount > uploadFailureDetails.length">
                  +{{ failedUploadCount - uploadFailureDetails.length }} more
                </li>
              </ul>
            </div>
            <button
              v-if="failedUploadCount > 0"
              class="btn soft upload-status-btn"
              type="button"
              :disabled="uploadBusy"
              @click="retryFailedUploads"
            >
              Retry failed
            </button>
          </div>

          <ErrorState v-if="galleryError && !galleryItems.length" :message="galleryError"
            @retry="loadGallery({ reset: true })" />

          <LoadingState v-else-if="galleryLoading && !galleryItems.length" />

          <EmptyState v-else-if="!galleryItems.length" @upload-click="openNativeUploadPicker" />

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
              <button class="upload-card" type="button" @click="openNativeUploadPicker">
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
                @preview-loaded="clearPreviewRetry" @open="openViewer" />
            </div>

            <LoadingState
              v-if="galleryLoading && galleryItems.length"
              class="gallery-loading-inline"
              :count="isMobileViewport ? 4 : 6"
            />

            <button v-if="hasMore" class="btn soft load-more" type="button" :disabled="galleryLoading" @click="loadGallery()">
              {{ galleryLoading ? 'Loading…' : 'Load more' }}
            </button>
          </template>
        </section>
      </template>
    </main>

    <FullScreenViewer
      :open="viewerOpen"
      :item="viewerItem"
      :total="viewerTotal"
      :media-url="viewerMediaUrl"
      :loading="viewerLoading"
      :error="viewerError"
      @close="closeViewer"
      @next="showNextViewerItem"
      @prev="showPrevViewerItem"
      @media-error="handleViewerMediaError"
    />

    <input
      ref="nativePickerRef"
      class="native-upload-input"
      type="file"
      multiple
      accept="image/*,video/mp4,video/quicktime"
      @change="handleNativePickerChange"
    />
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

.gallery-intro {
  margin: 6px 0 0;
  max-width: 70ch;
  color: var(--warm-brown-muted);
  font-size: 0.92rem;
  line-height: 1.45;
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

.gallery-loading-inline {
  margin-top: 2px;
}

.upload-status {
  border: 1px solid rgba(92, 138, 150, 0.25);
  border-radius: 10px;
  background: rgba(244, 248, 250, 0.9);
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.upload-status p {
  margin: 0;
  font-size: 0.82rem;
  color: var(--warm-text-dark);
}

.upload-status-copy {
  min-width: 0;
}

.upload-fail-list {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 0.77rem;
  color: var(--warm-brown-muted);
  display: grid;
  gap: 3px;
}

.upload-fail-list li {
  line-height: 1.3;
}

.upload-status-btn {
  min-height: 34px;
  padding: 6px 11px;
  font-size: 0.76rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.native-upload-input {
  width: 1px;
  height: 1px;
  opacity: 0;
  position: fixed;
  left: -9999px;
  pointer-events: none;
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
