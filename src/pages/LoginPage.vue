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
const showInvite404 = ref(false)
const checkingSession = ref(true)
const cooldownUntil = ref(0)
const nowMs = ref(Date.now())

const COOLDOWN_SECONDS = 60
const RATE_LIMIT_COOLDOWN_SECONDS = 180
const COOLDOWN_KEY = 'magic-link-cooldown-until'

let cooldownTimer = null
let authSubscription = null

const cooldownSeconds = computed(() => {
  const ms = cooldownUntil.value - nowMs.value
  return ms > 0 ? Math.ceil(ms / 1000) : 0
})

const canSend = computed(() => !loading.value && cooldownSeconds.value === 0)

function startCooldown(seconds) {
  const until = Date.now() + seconds * 1000
  cooldownUntil.value = until
  nowMs.value = Date.now()
  localStorage.setItem(COOLDOWN_KEY, String(until))
}

function syncCooldownFromStorage() {
  const stored = Number(localStorage.getItem(COOLDOWN_KEY) || 0)
  cooldownUntil.value = Number.isFinite(stored) ? stored : 0
}

function startCooldownTicker() {
  if (cooldownTimer) return
  cooldownTimer = window.setInterval(() => {
    nowMs.value = Date.now()
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

function normalizeOrigin(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    return url.origin
  } catch {
    return ''
  }
}

function resolveMagicLinkRedirectTo() {
  const explicitUrl = String(import.meta.env.VITE_MAGIC_LINK_REDIRECT_URL || '').trim()
  if (explicitUrl) return explicitUrl

  const overrideOrigin = normalizeOrigin(import.meta.env.VITE_MAGIC_LINK_REDIRECT_ORIGIN)
  const origin = overrideOrigin || window.location.origin
  return `${origin}/#/login`
}

function parseHashParams() {
  const rawHash = String(window.location.hash || '')
  if (!rawHash) return new URLSearchParams()

  const hashValue = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  if (!hashValue) return new URLSearchParams()

  if (hashValue.includes('?')) {
    return new URLSearchParams(hashValue.split('?')[1] || '')
  }

  const normalized = hashValue.replace(/^\//, '')
  if (normalized.includes('error=')) {
    return new URLSearchParams(normalized)
  }

  return new URLSearchParams()
}

function getAuthErrorFromUrl() {
  const searchParams = new URLSearchParams(window.location.search || '')
  const hashParams = parseHashParams()

  const errorCode = String(searchParams.get('error_code') || hashParams.get('error_code') || '').toLowerCase()
  const description = String(searchParams.get('error_description') || hashParams.get('error_description') || '').toLowerCase()
  const error = String(searchParams.get('error') || hashParams.get('error') || '').toLowerCase()
  const hasAuthError = Boolean(error || errorCode || description)

  if (!hasAuthError) return ''

  if (errorCode === 'otp_expired' || description.includes('invalid or has expired')) {
    return 'Link expired. Request a new magic link and try again.'
  }

  if (error === 'access_denied') {
    return 'Sign-in link was not accepted. Request a new magic link and try again.'
  }

  return 'Could not complete sign in from that link. Request a new magic link and try again.'
}

function clearAuthErrorFromUrl() {
  const redirect = normalizeRedirect(route.query.redirect)
  const query = redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''
  const cleanUrl = `${window.location.origin}${window.location.pathname}#/login${query}`
  window.history.replaceState(window.history.state, '', cleanUrl)
}

function isInviteMissError(err) {
  const message = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '').toLowerCase()
  const status = Number(err?.status || err?.statusCode || 0)

  return (
    message.includes('signups not allowed')
    || message.includes('not allowed for otp')
    || message.includes('user not found')
    || message.includes('email not found')
    || code === 'user_not_found'
    || code === 'signup_disabled'
    || status === 422
  )
}

function resetInvite404() {
  showInvite404.value = false
  errorMsg.value = ''
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

  if (route.query.blocked === '1') {
    errorMsg.value = 'This account is not invited yet. Ask an admin to add your email.'
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
  showInvite404.value = false

  const redirectTarget = normalizeRedirect(route.query.redirect)
  setPostLoginRedirect(redirectTarget)

  try {
    const redirectTo = resolveMagicLinkRedirectTo()
    await sendMagicLink(email.value, redirectTo)
    startCooldown(COOLDOWN_SECONDS)
    infoMsg.value = `Magic link sent to ${email.value.trim().toLowerCase()}. Open it on this device.`
  } catch (err) {
    const message = err?.message || 'Failed to send magic link'
    if (message.toLowerCase().includes('rate limit')) {
      startCooldown(RATE_LIMIT_COOLDOWN_SECONDS)
      errorMsg.value = `Too many email requests. Wait ${RATE_LIMIT_COOLDOWN_SECONDS} seconds and try again.`
    } else if (isInviteMissError(err)) {
      showInvite404.value = true
    } else {
      errorMsg.value = message
    }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  const callbackError = getAuthErrorFromUrl()
  if (callbackError) {
    errorMsg.value = callbackError
    clearAuthErrorFromUrl()
  }

  syncCooldownFromStorage()
  startCooldownTicker()

  if (supabase) {
    const listener = supabase.auth.onAuthStateChange(async (_event, _session) => {
      await checkSessionAndRedirect()
    })
    authSubscription = listener.data.subscription
  }

  await checkSessionAndRedirect()
})

onUnmounted(() => {
  stopCooldownTicker()
  if (authSubscription) {
    authSubscription.unsubscribe()
    authSubscription = null
  }
})
</script>

<template>
  <div class="login-page" :class="{ 'invite-miss-mode': showInvite404 }">
    <div v-if="showInvite404" class="storm-flash" aria-hidden="true"></div>

    <main class="login-shell">
      <section class="login-card" :class="{ 'login-card-miss': showInvite404 }">
        <h1 v-if="!showInvite404">Signin</h1>

        <p v-if="!hasSupabaseConfig" class="error-text">
          Supabase is not configured. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
        </p>

        <p v-else-if="checkingSession" class="muted">Checking session…</p>

        <template v-else>
          <section v-if="showInvite404" class="invite-404">
            <img class="invite-cloud invite-cloud-a" src="../assets/clouds-two.png" alt="" aria-hidden="true" />
            <img class="invite-cloud invite-cloud-b" src="../assets/cloud-large.png" alt="" aria-hidden="true" />
            <img class="invite-cloud invite-cloud-c" src="../assets/clouds-two.png" alt="" aria-hidden="true" />
            <p class="invite-404-code">404</p>
            <button type="button" class="secondary-btn" @click="resetInvite404">Try another email</button>
          </section>

          <form v-else class="magic-link-form" @submit.prevent="submitMagicLink">
            <label for="invite-email" class="field-label">Invited email</label>
            <input
              id="invite-email"
              v-model="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="you@example.com"
              required
              @input="resetInvite404"
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
  background:
    radial-gradient(ellipse at top, rgba(122, 176, 180, 0.35), transparent 55%),
    linear-gradient(180deg, #edf7f8 0%, var(--bg-page) 40%, #efe9dd 100%);
  color: var(--forest);
  font-family: var(--font-sans);
  display: grid;
  place-items: center;
  padding: 24px;
  position: relative;
  overflow: hidden;
}

.login-page::before,
.login-page::after {
  content: '';
  position: absolute;
  background-repeat: no-repeat;
  background-size: contain;
  opacity: 0.65;
  pointer-events: none;
  transition: opacity 0.25s ease, filter 0.25s ease, transform 0.25s ease;
}

.login-page::before {
  width: min(700px, 78vw);
  height: 260px;
  top: -16px;
  left: -80px;
  background-image: url('../assets/clouds-two.png');
}

.login-page::after {
  width: min(760px, 86vw);
  height: 290px;
  bottom: -70px;
  right: -130px;
  background-image: url('../assets/cloud-large.png');
}

.invite-miss-mode {
  background:
    radial-gradient(ellipse at top, rgba(66, 92, 110, 0.5), transparent 60%),
    linear-gradient(180deg, #8ea8b3 0%, #6a7f89 38%, #4d6069 100%);
}

.invite-miss-mode::before,
.invite-miss-mode::after {
  opacity: 0.92;
  filter: grayscale(0.25) brightness(0.68) contrast(1.1);
}

.invite-miss-mode::before {
  width: min(2200px, 260vw);
  height: 980px;
  top: -170px;
  left: -700px;
  transform: translateY(8px) scale(1.28);
  animation: cloudDriftA 34s ease-in-out infinite alternate;
}

.invite-miss-mode::after {
  width: min(2400px, 285vw);
  height: 1080px;
  right: -900px;
  bottom: -420px;
  transform: translateY(-10px) scale(1.34);
  animation: cloudDriftB 41s ease-in-out infinite alternate;
}

.login-shell {
  width: 100%;
  max-width: 560px;
  z-index: 1;
}

.login-card {
  background: var(--bg-white);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(28, 40, 36, 0.15);
  border-top: 4px solid var(--green-primary);
  padding: 24px 22px 28px;
}

.login-card-miss {
  background: transparent;
  border-top: 0;
  box-shadow: none;
  padding: 0;
}

h1 {
  margin: 0 0 8px;
  font-family: var(--font-sign);
  font-size: clamp(24px, 4vw, 30px);
  font-weight: 700;
  color: var(--forest);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.muted {
  margin: 0;
  color: var(--driftwood);
  font-family: var(--font-playfair);
  font-size: 13px;
  font-style: italic;
}

.magic-link-form {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.invite-404 {
  margin-top: 14px;
  padding: 10px 0 6px;
  text-align: center;
  position: relative;
}

.invite-cloud {
  position: absolute;
  width: auto;
  height: auto;
  pointer-events: none;
  opacity: 0.62;
  filter: grayscale(0.22) brightness(0.74) contrast(1.05);
  z-index: 2;
}

.invite-cloud-a {
  width: min(1300px, 160vw);
  top: -320px;
  left: -560px;
  opacity: 0.58;
  animation: cloudFloatA 22s ease-in-out infinite alternate;
}

.invite-cloud-b {
  width: min(1700px, 210vw);
  right: -980px;
  bottom: -540px;
  transform: scaleX(-1);
  opacity: 0.66;
  animation: cloudFloatB 28s ease-in-out infinite alternate;
}

.invite-cloud-c {
  width: min(1120px, 136vw);
  right: -520px;
  top: -350px;
  opacity: 0.46;
  transform: rotate(-6deg);
  animation: cloudFloatC 18s ease-in-out infinite alternate;
}

.storm-flash {
  position: absolute;
  inset: -10% -10%;
  pointer-events: none;
  z-index: 4;
  background:
    radial-gradient(circle at 24% 16%, rgba(250, 253, 255, 0.62), rgba(250, 253, 255, 0) 44%),
    linear-gradient(160deg, rgba(242, 249, 255, 0.48), rgba(242, 249, 255, 0) 40%);
  mix-blend-mode: screen;
  opacity: 0;
  animation: lightningFlash 10.5s linear infinite;
}

.invite-404-code {
  margin: 0;
  font-family: var(--font-goldman);
  font-size: clamp(128px, 28vw, 240px);
  line-height: 0.9;
  color: #d3e3ea;
  letter-spacing: 2px;
  text-shadow: 0 8px 22px rgba(7, 15, 20, 0.65);
  position: relative;
  z-index: 1;
}

.secondary-btn {
  margin-top: 4px;
  border: 1px solid rgba(189, 218, 230, 0.45);
  border-radius: 8px;
  padding: 10px 13px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(230, 240, 245, 0.12);
  color: #f1f8fb;
  position: relative;
  z-index: 5;
}

.secondary-btn:hover {
  background: rgba(230, 240, 245, 0.22);
}

@keyframes cloudDriftA {
  0% { transform: translate(-12px, 0px) scale(1.26); }
  100% { transform: translate(22px, 16px) scale(1.31); }
}

@keyframes cloudDriftB {
  0% { transform: translate(10px, 0px) scale(1.32); }
  100% { transform: translate(-24px, -14px) scale(1.36); }
}

@keyframes cloudFloatA {
  0% { transform: translate(0px, 0px); }
  100% { transform: translate(26px, -14px); }
}

@keyframes cloudFloatB {
  0% { transform: translate(0px, 0px) scaleX(-1); }
  100% { transform: translate(-24px, 16px) scaleX(-1); }
}

@keyframes cloudFloatC {
  0% { transform: translate(0px, 0px) rotate(-6deg); }
  100% { transform: translate(18px, -12px) rotate(-3deg); }
}

@keyframes lightningFlash {
  0%, 7%, 16%, 33%, 100% {
    opacity: 0;
  }
  7.8% {
    opacity: 0.28;
  }
  8.2% {
    opacity: 0.72;
  }
  8.6% {
    opacity: 0.2;
  }
  9.1% {
    opacity: 0.82;
  }
  9.8% {
    opacity: 0.06;
  }
  10.4% {
    opacity: 0.64;
  }
  11.2% {
    opacity: 0;
  }
  34.2% {
    opacity: 0.22;
  }
  34.6% {
    opacity: 0.58;
  }
  35.2% {
    opacity: 0.14;
  }
  35.7% {
    opacity: 0.46;
  }
  36.3% {
    opacity: 0;
  }
}

.field-label {
  color: var(--forest);
  font-family: var(--font-sign);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.magic-link-form input {
  border: 1px solid var(--green-border);
  border-radius: 8px;
  padding: 11px 12px;
  font-size: 14px;
  color: var(--forest);
  background: #fff;
}

.primary-btn {
  border: 1px solid var(--deep-sky);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: var(--deep-sky);
  color: #fff;
  justify-self: start;
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.success-text {
  color: var(--green-primary);
  font-size: 13px;
  margin: 10px 0 0;
}

.error-text {
  color: var(--red-error);
  font-size: 13px;
  margin: 10px 0 0;
}

@media (max-width: 680px) {
  .login-page {
    padding: 16px;
  }

  .login-card {
    padding: 20px 16px 22px;
  }

  .primary-btn {
    width: 100%;
    justify-self: stretch;
  }

  .login-page::before {
    width: 95vw;
    top: -28px;
    left: -90px;
  }

  .login-page::after {
    width: 105vw;
    right: -160px;
    bottom: -50px;
  }
}
</style>
