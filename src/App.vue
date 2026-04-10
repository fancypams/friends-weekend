<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAuthState } from './lib/authAccess'
import { hasSupabaseConfig } from './lib/supabaseClient'
import { bypassAuth, supabase } from './lib/supabaseClient'
import { sendPresenceHeartbeat } from './lib/presenceApi'

const route = useRoute()
const router = useRouter()

const HEARTBEAT_MS = 60000
let heartbeatTimer = null
let inFlight = false
let authSubscription = null
const isAdmin = ref(Boolean(bypassAuth))

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

async function refreshAdminAccess() {
  if (bypassAuth) {
    isAdmin.value = true
    return
  }
  if (!hasSupabaseConfig) {
    isAdmin.value = false
    return
  }
  try {
    const state = await getAuthState()
    isAdmin.value = Boolean(state?.signedIn && state?.profile?.role === 'admin' && state?.profile?.active)
  } catch {
    isAdmin.value = false
  }
}

function goAdmin() {
  if (!isAdmin.value) return
  void router.push('/admin')
}

onMounted(() => {
  void emitHeartbeat(route.fullPath || route.path, { force: true })
  void refreshAdminAccess()

  heartbeatTimer = window.setInterval(() => {
    void emitHeartbeat(route.fullPath || route.path)
  }, HEARTBEAT_MS)

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  if (supabase) {
    const listener = supabase.auth.onAuthStateChange(() => {
      void refreshAdminAccess()
    })
    authSubscription = listener.data.subscription
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
  if (authSubscription) {
    authSubscription.unsubscribe()
    authSubscription = null
  }
})

const appVersion = __APP_VERSION__
const appGitSha = __APP_GIT_SHA__
const appBuildLabel = `v${appVersion} (${appGitSha})`
</script>

<template>
  <router-view />
  <teleport to="body">
    <div class="app-build-wrap">
      <button
        class="admin-peek"
        type="button"
        :disabled="!isAdmin"
        aria-label="Open admin"
        title="Admin"
        @click="goAdmin"
      >
        a
      </button>
      <p class="app-build-tag" :title="appBuildLabel">{{ appBuildLabel }}</p>
    </div>
  </teleport>
</template>

<style scoped>
.app-build-wrap {
  position: fixed;
  right: 10px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  z-index: 1301;
}

.admin-peek {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid rgba(128, 154, 159, 0.2);
  background: rgba(255, 255, 255, 0.35);
  color: rgba(28, 40, 36, 0.55);
  font-size: 10px;
  line-height: 1;
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  transition: opacity 0.12s ease, border-color 0.12s ease, background 0.12s ease;
  opacity: 0.5;
}

.admin-peek:hover:enabled {
  opacity: 0.95;
  border-color: rgba(128, 154, 159, 0.45);
  background: rgba(255, 255, 255, 0.7);
}

.admin-peek:disabled {
  opacity: 0.08;
  cursor: default;
}

.app-build-tag {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: rgba(28, 40, 36, 0.62);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(128, 154, 159, 0.36);
  border-radius: 999px;
  padding: 2px 8px;
  user-select: none;
  backdrop-filter: blur(2px);
}
</style>
