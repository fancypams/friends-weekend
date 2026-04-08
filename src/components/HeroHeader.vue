<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { globalSignOut } from '../lib/authAccess'

defineProps({
  showBack: {
    type: Boolean,
    default: false,
  },
})

const targetMs = Date.parse('2026-07-23T00:00:00')
const nowMs = ref(Date.now())
let tickTimer = null

const menuOpen = ref(false)
const router = useRouter()

// ── Cloud animation ──
const headerRef = ref(null)
const cloudBackStyle = ref({})
const cloudFrontStyle = ref({})

let animFrame = null
let animStart = null
let prevTimestamp = null
let normMouseX = 0.5
let normMouseY = 0.5
let backPushCurrent = 0
let frontPushCurrent = 0

function onMouseMove(e) {
  const rect = headerRef.value?.getBoundingClientRect()
  if (!rect) return
  normMouseX = (e.clientX - rect.left) / rect.width
  normMouseY = (e.clientY - rect.top) / rect.height
}

function animateClouds(timestamp) {
  if (!animStart) animStart = timestamp
  const dt = prevTimestamp ? Math.min(timestamp - prevTimestamp, 50) : 16
  prevTimestamp = timestamp
  const t = (timestamp - animStart) / 1000

  // Two overlapping sine waves per axis for organic, non-mechanical drift
  const backX  = Math.sin(t * 0.037) * 20 + Math.sin(t * 0.071) * 10 - 16
  const backY  = Math.sin(t * 0.028) * 5  + Math.sin(t * 0.053) * 3
  const frontX = Math.sin(t * 0.041) * 22 + Math.sin(t * 0.067) * 12 + 16
  const frontY = Math.cos(t * 0.031) * 6  + Math.cos(t * 0.059) * 3

  // Raw proximity (0–1)
  const backProxRaw  = Math.max(0, 1 - Math.hypot(normMouseX - 0.2,  normMouseY - 0.25) / 0.45)
  const frontProxRaw = Math.max(0, 1 - Math.hypot(normMouseX - 0.75, normMouseY - 0.8)  / 0.45)

  // Cubic ease on proximity for smooth ease-in, lerp for smooth ease-out
  const backTarget  = backProxRaw  * backProxRaw  * backProxRaw  * 60
  const frontTarget = frontProxRaw * frontProxRaw * frontProxRaw * 70

  const factor = 1 - Math.exp(-dt / 180)
  backPushCurrent  += (backTarget  - backPushCurrent)  * factor
  frontPushCurrent += (frontTarget - frontPushCurrent) * factor

  cloudBackStyle.value  = { transform: `translate(${backX  - backPushCurrent}px, ${backY}px)` }
  cloudFrontStyle.value = { transform: `translate(${frontX + frontPushCurrent}px, ${frontY}px)` }

  animFrame = requestAnimationFrame(animateClouds)
}

const totalMsLeft = computed(() => Math.max(0, targetMs - nowMs.value))

const countdown = computed(() => {
  let remaining = Math.floor(totalMsLeft.value / 1000)
  const days = Math.floor(remaining / 86400)
  remaining -= days * 86400
  const hours = Math.floor(remaining / 3600)
  remaining -= hours * 3600
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining - minutes * 60

  return {
    days: String(days).padStart(2, '0'),
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
  }
})

const countdownUnits = computed(() => [
  { key: 'days', label: 'Days', value: countdown.value.days },
  { key: 'hours', label: 'Hours', value: countdown.value.hours },
  { key: 'minutes', label: 'Minutes', value: countdown.value.minutes },
  { key: 'seconds', label: 'Seconds', value: countdown.value.seconds },
])

async function signOutFromMenu() {
  menuOpen.value = false
  await globalSignOut().catch(() => {})
  await router.replace('/login')
}

function updateNow() {
  nowMs.value = Date.now()
}

onMounted(() => {
  updateNow()
  tickTimer = setInterval(updateNow, 1000)
  animFrame = requestAnimationFrame(animateClouds)
})

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
  if (animFrame) cancelAnimationFrame(animFrame)
})
</script>

<template>
  <header ref="headerRef" class="hero-header" @mousemove="onMouseMove">
    <!-- Hamburger button -->
    <button class="hamburger" :class="{ open: menuOpen }" @click="menuOpen = !menuOpen" aria-label="Toggle menu">
      <span /><span /><span />
    </button>

    <!-- Dropdown menu -->
    <nav v-if="menuOpen" class="nav-dropdown">
      <router-link to="/" class="nav-item" @click="menuOpen = false">Home</router-link>
      <router-link to="/basics" class="nav-item" @click="menuOpen = false">Basics</router-link>
      <router-link to="/itinerary" class="nav-item" @click="menuOpen = false">Itinerary</router-link>
      <router-link to="/pre-trip" class="nav-item" @click="menuOpen = false">Pre-Trip Prep</router-link>
      <router-link to="/photos" class="nav-item" @click="menuOpen = false">Photos</router-link>
      <button type="button" class="nav-item nav-signout" @click="signOutFromMenu">Sign out</button>
    </nav>

    <!-- Clouds: behind text -->
    <img class="clouds-back" src="../assets/clouds-two.png" alt="" aria-hidden="true" :style="cloudBackStyle" />

    <!-- Main content -->
    <div class="hero-content">
      <p class="hero-label">Friends Weekend</p>
      <router-link to="/" class="hero-city">SEATTLE</router-link>
      <div class="countdown-badge" aria-live="polite">
        <template v-for="(unit, index) in countdownUnits" :key="unit.key">
          <div class="count-item">
            <span class="count-value">{{ unit.value }}</span>
            <span class="count-label">{{ unit.label }}</span>
          </div>
          <span v-if="index < countdownUnits.length - 1" class="count-sep" aria-hidden="true">·</span>
        </template>
      </div>
    </div>

    <!-- Clouds: in front of text -->
    <img class="clouds-front" src="../assets/cloud-large.png" alt="" aria-hidden="true" :style="cloudFrontStyle" />
  </header>
</template>

<style scoped>
.hero-header {
  position: relative;
  min-height: fit-content;
  display: flex;
  flex-direction: column;
}

/* ── Hamburger ── */
.hamburger {
  position: absolute;
  top: 16px;
  right: 20px;
  z-index: 10;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
}
.hamburger span {
  display: block;
  width: 24px;
  height: 2px;
  background: var(--sky-label);
  border-radius: 2px;
  transition: opacity 0.2s, transform 0.2s;
  transform-origin: center;
}
.hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.hamburger.open span:nth-child(2) { opacity: 0; }
.hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

/* ── Dropdown ── */
.nav-dropdown {
  position: absolute;
  top: 52px;
  right: 16px;
  z-index: 10;
  background: var(--bg-white);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  overflow: hidden;
  min-width: 160px;
}
.nav-item {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 14px 20px;
  font-family: var(--font-sign);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--forest);
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.nav-item:hover {
  background: var(--parchment);
  color: var(--terracotta);
}
.nav-item.router-link-active {
  color: var(--terracotta);
}

.nav-signout {
  border-top: 1px solid rgba(92, 138, 150, 0.25);
}

/* ── Cloud layers ── */
.clouds-back {
  position: absolute;
  top: 0;
  width: 72%;
  z-index: 1;
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.14));
}

.clouds-front {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 75%;
  z-index: 3;
  pointer-events: none;
  user-select: none;
  margin: 0 -175px -70px;
  filter: drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.14));
}

/* ── Content ── */
.hero-content {
  position: relative;
  z-index: 2;
  padding: 20px 105px;
  display: flex;
  flex-direction: column;
  align-items: start;
}

.hero-label {
  font-family: var(--font-sign);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--sky-label);
  margin: 0 0 4px;
  align-self: start;
}

.hero-city {
  font-family: var(--font-goldman);
  font-size: clamp(72px, 16vw, 210px);
  font-weight: 700;
  color: var(--gold);
  margin: 0 0 16px;
  line-height: 0.9;
  letter-spacing: -1px;
  text-decoration: none;
  display: block;
}

/* ── Countdown ── */
.countdown-badge {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  align-self: start;
}

.count-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
}

.count-value {
  font-family: var(--font-goldman);
  font-size: clamp(16px, 3vw, 22px);
  font-weight: 700;
  color: var(--sky-label);
  line-height: 1;
}

.count-label {
  font-family: var(--font-playfair);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: lowercase;
  color: var(--sky-label);
  opacity: 0.8;
}

.count-sep {
  color: var(--sky-label);
  opacity: 0.5;
  font-size: 14px;
}

@media (max-width: 768px) {
  .hero-content {
    padding: 16px 24px 52px;
  }

  .clouds-back {
    width: 100%;
    right: 0;
    margin: 15px;
  }

  .clouds-front {
    width: 60%;
    margin: 0 0 30px;
  }

  .hero-city {
    font-size: clamp(52px, 17vw, 100px);
  }

  .hero-label {
    margin: 0 0 10px;
  }

  .countdown-badge {
    margin: 0 0 -30px;
  }

  .count-value {
    font-size: clamp(14px, 4vw, 18px);
  }
}
</style>
