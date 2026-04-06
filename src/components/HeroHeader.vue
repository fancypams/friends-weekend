<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MarinersCompass from './MarinersCompass.vue'

defineProps({
  showBack: {
    type: Boolean,
    default: false,
  },
})

const targetMs = Date.parse('2026-07-23T00:00:00')
const nowMs = ref(Date.now())
let tickTimer = null

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

function updateNow() {
  nowMs.value = Date.now()
}

onMounted(() => {
  updateNow()
  tickTimer = setInterval(updateNow, 1000)
})

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
})
</script>

<template>
  <header class="hero-header">
    <router-link v-if="showBack" to="/" class="back-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
      Home
    </router-link>
    <div class="hero-inner">
      <svg class="hero-sign" viewBox="-15 0 680 375" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Friends Weekend Seattle">
        <!-- Outer border frame -->
        <rect x="90" y="30" width="500" height="290" rx="4" fill="none" stroke="#aaaaaa" stroke-width="5"/>

        <!-- Grid lines -->
        <line x1="90"  y1="175" x2="590" y2="175" stroke="#aaaaaa" stroke-width="3"/>
        <line x1="223" y1="30"  x2="223" y2="320" stroke="#aaaaaa" stroke-width="3"/>
        <line x1="356" y1="30"  x2="356" y2="320" stroke="#aaaaaa" stroke-width="3"/>
        <line x1="489" y1="30"  x2="489" y2="320" stroke="#aaaaaa" stroke-width="3"/>

        <!-- Main text -->
        <text x="285" y="150" text-anchor="middle" font-size="90" style="font-family:'Montserrat','Impact',sans-serif;fill:var(--red-accent);letter-spacing:3px;">FRIENDS</text>
        <text x="260" y="270" text-anchor="middle" font-size="90" style="font-family:'Montserrat','Impact',sans-serif;fill:var(--red-accent);letter-spacing:3px;">WEEKEND</text>

        <!-- Clock face -->
        <circle cx="576" cy="175" r="68" fill="white" stroke="#aaaaaa" stroke-width="2"/>
        <circle cx="576" cy="175" r="60" fill="none" stroke="#cccccc" stroke-width="1"/>

        <!-- Tick marks -->
        <line x1="576" y1="117" x2="576" y2="125" stroke="#777" stroke-width="1.5"/>
        <line x1="634" y1="175" x2="626" y2="175" stroke="#777" stroke-width="1.5"/>
        <line x1="576" y1="233" x2="576" y2="225" stroke="#777" stroke-width="1.5"/>
        <line x1="518" y1="175" x2="526" y2="175" stroke="#777" stroke-width="1.5"/>

        <!-- Clock hands -->
        <line x1="576" y1="175" x2="576" y2="127" stroke="#444" stroke-width="2"   stroke-linecap="round"/>
        <line x1="576" y1="175" x2="544" y2="147" stroke="#444" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="576" cy="175" r="3" fill="#444"/>
      </svg>

      <div class="countdown-badge" aria-live="polite">
        <MarinersCompass class="compass" aria-hidden="true" />
        <template v-for="(unit, index) in countdownUnits" :key="unit.key">
          <div class="count-item">
            <span class="count-value">{{ unit.value }}</span>
            <span class="count-label">{{ unit.label }}</span>
          </div>
          <span v-if="index < countdownUnits.length - 1" class="dot" aria-hidden="true"></span>
        </template>
      </div>
    </div>
  </header>
</template>

<style scoped>
.hero-header {
  background: var(--green-primary);
  color: var(--bg-white);
  padding: 14px 24px 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: visible;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  font-size: 14px;
  font-family: system-ui, 'Segoe UI', sans-serif;
  transition: color 0.15s;
  width: fit-content;
  margin-bottom: 8px;
}
.back-btn:hover { color: var(--bg-white); }
.back-btn svg { width: 16px; height: 16px; }

.hero-inner {
  text-align: center;
  padding: 4px 0 0;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.hero-sign {
  width: 100%;
  max-width: 560px;
  display: block;
}

.countdown-badge {
  max-width: 92vw;
  background: transparent;
  border-radius: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: none;
  margin-bottom: 30px;
}

.compass {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.compass svg {
  width: 100%;
  height: 100%;
}

.count-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 54px;
}

.count-value {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 20px;
  font-weight: 600;
  color: #F8F4EC;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.count-label {
  margin-top: 1px;
  font-family: system-ui, 'Segoe UI', sans-serif;
  font-size: 9px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: #D7E3DE;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.18);
}

.dot {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #D7E3DE;
}

@media (max-width: 680px) {
  .hero-header {
    padding-top: 12px;
  }

  .countdown-badge {
    width: fit-content;
    max-width: 100%;
    gap: 8px;
    padding: 0;
  }

  .count-item {
    min-width: 0;
  }

  .count-value {
    font-size: clamp(14px, 4.6vw, 18px);
  }

  .count-label {
    font-size: 8px;
    letter-spacing: 1.1px;
  }

  .dot {
    width: 3px;
    height: 3px;
  }

  .compass {
    width: 15px;
    height: 15px;
  }
}
</style>
