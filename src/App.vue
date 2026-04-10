<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { hasSupabaseConfig } from './lib/supabaseClient'
import { sendPresenceHeartbeat } from './lib/presenceApi'

const route = useRoute()

const HEARTBEAT_MS = 60000
let heartbeatTimer = null
let inFlight = false

function shouldTrackPath(path) {
  const normalized = String(path || '').trim()
  if (!normalized) return false
  if (normalized === '/login') return false
  if (normalized.startsWith('/auth/callback')) return false
  return true
}

async function emitHeartbeat(path, { force = false } = {}) {
  if (!hasSupabaseConfig) return
  if (!shouldTrackPath(path)) return
  if (!force && typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  if (inFlight) return

  inFlight = true
  try {
    await sendPresenceHeartbeat(path)
  } catch {
    // Ignore heartbeat errors; presence is best-effort telemetry.
  } finally {
    inFlight = false
  }
}

function onVisibilityChange() {
  if (typeof document === 'undefined') return
  if (document.visibilityState !== 'visible') return
  void emitHeartbeat(route.fullPath || route.path, { force: true })
}

onMounted(() => {
  void emitHeartbeat(route.fullPath || route.path, { force: true })

  heartbeatTimer = window.setInterval(() => {
    void emitHeartbeat(route.fullPath || route.path)
  }, HEARTBEAT_MS)

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
})

watch(
  () => route.fullPath,
  (nextPath) => {
    void emitHeartbeat(nextPath, { force: true })
  },
)

onBeforeUnmount(() => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
})
</script>

<template>
  <router-view />
</template>
