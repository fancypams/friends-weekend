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
      <p class="eyebrow">never sleepless in</p>
      <h1 class="city">Seattle</h1>
      <p class="dates">July 23 - August 2, 2026</p>
      <div class="market-badge">
        Friends Weekend
        <div class="clock-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="12" cy="12" r="9"></circle>
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5v5l3.5 2"></path>
          </svg>
        </div>
      </div>

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
    <div class="scallop">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 50" preserveAspectRatio="none">
        <path d="M0,0 L1200,0 L1200,30 Q1170,50 1140,30 Q1110,50 1080,30 Q1050,50 1020,30 Q990,50 960,30 Q930,50 900,30 Q870,50 840,30 Q810,50 780,30 Q750,50 720,30 Q690,50 660,30 Q630,50 600,30 Q570,50 540,30 Q510,50 480,30 Q450,50 420,30 Q390,50 360,30 Q330,50 300,30 Q270,50 240,30 Q210,50 180,30 Q150,50 120,30 Q90,50 60,30 Q30,50 0,30 Z" fill="#1E4237" />
      </svg>
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

.scallop {
  position: absolute;
  bottom: -50px;
  left: 0;
  width: 100%;
  line-height: 0;
  z-index: 1;
}
.scallop svg {
  width: 100%;
  display: block;
  height: 50px;
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
  flex-flow:column;
  justify-content: center;
  align-items: center;
}

.eyebrow {
  font-family: system-ui, 'Segoe UI', sans-serif;
  font-size: 9px;
  letter-spacing: 6px;
  text-transform: uppercase;
  opacity: 0.7;
  font-weight: 700;
  margin: 0 0 8px;
}
.city {
  font-family: 'Playfair Display', serif;
  font-size: clamp(46px, 7vw, 72px);
  font-weight: 600;
  line-height: 1;
  margin: 0 0 10px;
  letter-spacing: 0.5px;
  font-style: italic;
}
.dates {
  font-family: system-ui, 'Segoe UI', sans-serif;
  font-size: 10px;
  opacity: 0.75;
  margin: 0 0 12px;
  text-transform: uppercase;
  letter-spacing: 2.6px;
  padding: 0;
  border: 0;
  color: var(--green-sage);
  }
.market-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 0 12px;
  border-radius: 999px;
  background: var(--bg-cream);
  color: var(--red-accent);
  padding: 7px 13px;
  font-family: system-ui, 'Segoe UI', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  min-width: 206px;
}

.clock-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 999px;
  color: #2E6352;
}
.clock-wrap svg {
  width: 20px;
  height: 20px;
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

  .city {
    font-size: clamp(40px, 12vw, 58px);
  }

  .dates {
    letter-spacing: 2px;
    font-size: 9px;
  }

  .market-badge {
    min-width: 0;
    width: fit-content;
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
