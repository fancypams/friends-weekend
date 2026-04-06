<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient'
import {
  clearPostLoginRedirect,
  getAuthState,
  getPostLoginRedirect,
  sendMagicLink,
  setPostLoginRedirect,
} from '../lib/authAccess'

const route = useRoute()
const router = useRouter()

const email = ref('')
const loading = ref(false)
const infoMsg = ref('')
const errorMsg = ref('')
const checkingSession = ref(true)
const cooldownUntil = ref(0)

const COOLDOWN_SECONDS = 60
const RATE_LIMIT_COOLDOWN_SECONDS = 180
const COOLDOWN_KEY = 'magic-link-cooldown-until'

let cooldownTimer = null

const cooldownSeconds = computed(() => {
  const ms = cooldownUntil.value - Date.now()
  return ms > 0 ? Math.ceil(ms / 1000) : 0
})

const canSend = computed(() => !loading.value && cooldownSeconds.value === 0)

function startCooldown(seconds) {
  const until = Date.now() + seconds * 1000
  cooldownUntil.value = until
  localStorage.setItem(COOLDOWN_KEY, String(until))
}

function syncCooldownFromStorage() {
  const stored = Number(localStorage.getItem(COOLDOWN_KEY) || 0)
  cooldownUntil.value = Number.isFinite(stored) ? stored : 0
}

function startCooldownTicker() {
  if (cooldownTimer) return
  cooldownTimer = window.setInterval(() => {
    if (cooldownUntil.value <= Date.now()) {
      cooldownUntil.value = 0
      localStorage.removeItem(COOLDOWN_KEY)
    }
  }, 500)
}

function stopCooldownTicker() {
  if (cooldownTimer) {
    window.clearInterval(cooldownTimer)
    cooldownTimer = null
  }
}

function normalizeRedirect(value) {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/')) return '/'
  if (candidate.startsWith('//')) return '/'
  return candidate
}

async function routeAfterLogin() {
  const queryRedirect = normalizeRedirect(route.query.redirect)
  const storageRedirect = getPostLoginRedirect()
  const target = queryRedirect !== '/' ? queryRedirect : storageRedirect

  clearPostLoginRedirect()
  await router.replace(target || '/')
}

async function checkSessionAndRedirect() {
  if (!hasSupabaseConfig) {
    checkingSession.value = false
    return
  }

  try {
    const state = await getAuthState()

    if (state.signedIn && state.invited) {
      await routeAfterLogin()
      return
    }

    if (state.signedIn && !state.invited) {
      errorMsg.value = 'This account is not invited yet. Ask an admin to add your email.'
    }
  } catch (err) {
    errorMsg.value = err?.message || 'Could not check session'
  } finally {
    checkingSession.value = false
  }
}

async function submitMagicLink() {
  if (!canSend.value) return

  loading.value = true
  errorMsg.value = ''
  infoMsg.value = ''

  const redirectTarget = normalizeRedirect(route.query.redirect)
  setPostLoginRedirect(redirectTarget)

  try {
    const redirectTo = `${window.location.origin}/#/login`
    await sendMagicLink(email.value, redirectTo)
    startCooldown(COOLDOWN_SECONDS)
    infoMsg.value = `Magic link sent to ${email.value.trim().toLowerCase()}. Open it on this device.`
  } catch (err) {
    const message = err?.message || 'Failed to send magic link'
    if (message.toLowerCase().includes('rate limit')) {
      startCooldown(RATE_LIMIT_COOLDOWN_SECONDS)
      errorMsg.value = `Too many email requests. Wait ${RATE_LIMIT_COOLDOWN_SECONDS} seconds and try again.`
    } else {
      errorMsg.value = message
    }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  syncCooldownFromStorage()
  startCooldownTicker()

  if (supabase) {
    supabase.auth.onAuthStateChange(async (_event, _session) => {
      await checkSessionAndRedirect()
    })
  }

  await checkSessionAndRedirect()
})

onUnmounted(() => {
  stopCooldownTicker()
})
</script>

<template>
  <div class="login-page">
    <main class="login-shell">
      <section class="login-card">
        <h1>Sign In</h1>

        <p v-if="!hasSupabaseConfig" class="error-text">
          Supabase is not configured. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
        </p>

        <p v-else-if="checkingSession" class="muted">Checking session…</p>

        <template v-else>
          <p class="muted">
            Enter your invited email and we will send a magic login link.
          </p>

          <form class="magic-link-form" @submit.prevent="submitMagicLink">
            <input
              v-model="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="you@example.com"
              required
            />
            <button class="primary-btn" type="submit" :disabled="!canSend">
              {{ loading ? 'Sending…' : (cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s` : 'Send Magic Link') }}
            </button>
          </form>

          <p v-if="infoMsg" class="success-text">{{ infoMsg }}</p>
          <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>
        </template>
      </section>
    </main>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  background: #fff9f2;
  color: #1A3329;
  font-family: system-ui, 'Segoe UI', sans-serif;
  display: grid;
  place-items: center;
  padding: 20px;
}

.login-shell {
  width: 100%;
  max-width: 520px;
}

.login-card {
  background: #fff;
  border: 1px solid #c8d8d0;
  border-radius: 14px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  padding: 22px;
}

h1 {
  margin: 0 0 8px;
  font-size: 28px;
}

.muted {
  margin: 0;
  color: #4e6b5f;
  font-size: 14px;
}

.magic-link-form {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.magic-link-form input {
  border: 1px solid #c8d8d0;
  border-radius: 8px;
  padding: 10px;
  font-size: 14px;
}

.primary-btn {
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: #2E6352;
  color: #fff;
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.success-text {
  color: #2e6352;
  font-size: 13px;
  margin: 10px 0 0;
}

.error-text {
  color: #b94040;
  font-size: 13px;
  margin: 10px 0 0;
}

@media (max-width: 680px) {
  .magic-link-form {
    grid-template-columns: 1fr;
  }
}
</style>
