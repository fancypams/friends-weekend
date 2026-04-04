<script setup>
defineProps({
  showBack: {
    type: Boolean,
    default: false,
  },
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
      <p class="dates">July 31 – August 4, 2025</p>
      <div class="market-badge">
        Friends Weekend
        <div class="clock-wrap">
          <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
            <circle cx="40" cy="40" r="38" fill="#1E4237"/>
            <circle cx="40" cy="40" r="32" fill="#F5EFE6"/>
            <line x1="40" y1="40" x2="24" y2="31" stroke="#C94030" stroke-width="3.5" stroke-linecap="round"/>
            <line x1="40" y1="40" x2="61" y2="28" stroke="#C94030" stroke-width="2.5" stroke-linecap="round"/>
            <circle cx="40" cy="40" r="3" fill="#C94030"/>
          </svg>
        </div>
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
  background: #2E6352;
  color: #fff;
  padding: 24px 24px 0;
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
.back-btn:hover { color: #fff; }
.back-btn svg { width: 16px; height: 16px; }

.hero-inner {
  text-align: center;
  padding: 8px 0 0;
  margin-bottom: 25px;
  display: flex;
  flex-flow:column;
  justify-content: center;
  align-items: center;
}

.eyebrow {
  font-family: system-ui, 'Segoe UI', sans-serif;
  font-size: 10px;
  letter-spacing: 8px;
  text-transform: uppercase;
  opacity: 0.75;
  font-weight: 900;
  margin: 0 0 12px;
}
.city {
  font-family: 'Playfair Display', serif;
  font-size: 100px;
  font-weight: 700;
  line-height: 1;
  margin: 0 0 15px;
  letter-spacing: 1px;
  font-style: italic;
}
.dates {
  font-family: system-ui, 'Segoe UI', sans-serif;
  font-size: 12px;
  opacity: 0.85;
  margin: 10px 0 15px;
  text-transform: uppercase;
  letter-spacing: 3px;
  padding: 8px;
  border: solid 1px #A7B799;
  color: #A7B799;
}
.market-badge {
  position: relative;
  overflow: visible;
  display: inline-block;
  margin: 25px 0 10px;
  border: 4px solid #1E4237;
  border-radius: 6px;
  background: #F5F0E8;
  color: #C94030;
  padding: 15px 100px 15px 15px;
  font-family: system-ui, 'Segoe UI', sans-serif;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 3px;
  text-transform: uppercase;
  min-width: 350px;
}

.clock-wrap {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 75px;
  height: 75px;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25));
}
.clock-wrap svg {
  width: 100%;
  height: 100%;
}
</style>
